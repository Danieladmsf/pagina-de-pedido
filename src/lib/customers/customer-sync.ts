/**
 * Sincronização centralizada do cliente a partir de um pedido.
 *
 * FONTE ÚNICA DE VERDADE: todos os fluxos que tocam o cadastro do cliente a
 * partir de um pedido (app do cliente, chegada de pedido no painel, entrega,
 * balcão) chamam `syncCustomerFromOrder`. Assim os dados que as Campanhas usam
 * (endereço, totalPedidos, ticketMedio, ultimoPedido) ficam SEMPRE corretos e
 * em sincronia, sem cada tela reimplementar a lógica (e introduzir bugs como o
 * endereço ser sobrescrito por vazio).
 *
 * Garantias:
 *  - Identidade/endereço: faz upsert preenchendo SÓ campos não-vazios — nunca
 *    sobrescreve um valor bom com string vazia.
 *  - Contagem (totalPedidos/ticketMedio/ultimoPedido): IDEMPOTENTE via a flag
 *    `customerCounted` no pedido, dentro de uma transação. Rodar duas vezes (ou
 *    em dois PCs) não conta o mesmo pedido em dobro.
 */
import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  runTransaction,
} from 'firebase/firestore';
import { getPhoneVariants, isValidCreditPhone, normalizeCreditPhone } from '@/lib/customer-credit';

export type CustomerLinkCollection = 'orders' | 'encomendas';

export interface SyncOptions {
  ownerId: string;
  /** true = também conta o pedido (totalPedidos/ticket/ultimoPedido). Use na entrega/finalização. */
  countOrder: boolean;
  /**
   * `false` não escreve em `clientes`. Se o telefone ainda não existir e não
   * houver colisão, devolve o id determinístico proposto para o pedido já
   * nascer vinculado; o dono materializa o cadastro depois.
   */
  writeCustomer?: boolean;
  /** Coleção na qual `order.id` deve receber `clienteId`; `null` só resolve. */
  linkCollection?: CustomerLinkCollection | null;
  /** Histórico já ligado pode ler arquivado; venda nova nunca deve optar por ele. */
  allowArchivedCustomer?: boolean;
}

export interface SyncResult {
  /** true se um cliente novo foi criado nesta chamada. */
  created: boolean;
  /** true se o pedido foi contabilizado agora (false se já tinha sido). */
  counted: boolean;
  customerId: string | null;
  /** Mais de um cadastro ativo tinha o mesmo telefone normalizado. */
  ambiguous?: boolean;
}

const ANON_NAMES = new Set(['cliente balcao', 'cliente balcão', 'cliente', '']);

// Marcas de acento soltas depois do NFD (montado assim para não deixar
// caractere invisível no código-fonte).
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * Id determinístico para o cliente SEM telefone (venda de balcão só com nome).
 * Sem isso o id era aleatório: duas sincronizações do mesmo pedido rodando ao
 * mesmo tempo (dois PCs, ou criação + entrega) liam "não existe" juntas e cada
 * uma criava um cadastro novo — foi assim que um mesmo nome virou 4 clientes.
 */
export function nameDocId(ownerId: string, nome: string) {
  const slug = nome
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${ownerId}_n_${slug}`;
}

/**
 * Identidade provisória por PEDIDO para cliente sem telefone. O sufixo impede
 * que duas pessoas homônimas sejam fundidas. Repetir a sincronização do mesmo
 * pedido continua idempotente.
 */
export function unidentifiedCustomerDocId(ownerId: string, nome: string, orderId: string) {
  const token = String(orderId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return token ? `${nameDocId(ownerId, nome)}_${token}` : '';
}

/**
 * Proposta local, sem I/O. Permite que operador/cliente anônimo grave o vínculo
 * no pedido mesmo sem permissão de escrever em `clientes`. Quando o dono abrir
 * o registro, `syncCustomerFromOrder` valida colisões antes de materializá-lo.
 */
export function proposedCustomerId(ownerId: string, order: any): string | null {
  if (!ownerId || !order) return null;
  const phone = normalizeCreditPhone(String(order.customerPhone || ''));
  if (isValidCreditPhone(phone)) return `${ownerId}_${phone}`;
  const name = String(order.customerName || '').trim();
  if (!name || ANON_NAMES.has(name.toLowerCase())) return null;
  const proposed = unidentifiedCustomerDocId(ownerId, name, String(order.id || ''));
  return proposed && !proposed.startsWith(`${ownerId}_n__`) ? proposed : null;
}

type ResolvedCustomer = {
  id: string;
  data: any;
  isNew: boolean;
  unidentified: boolean;
  source: 'explicit' | 'phone' | 'proposed';
};

const ownsCustomer = (data: any, ownerId: string) => data?.ownerId === ownerId;

/**
 * Resolve uma identidade sem jamais consultar pelo nome.
 *
 * Ordem do contrato:
 *  1. `clienteId` explícito e pertencente à loja;
 *  2. exatamente um cadastro ativo com o telefone normalizado;
 *  3. id determinístico novo (só quando a chamada pode escrever).
 *
 * Duplicidade e colisão com cadastro arquivado são conflitos: não escolhemos
 * o primeiro e não reativamos/reescrevemos o arquivado por acidente.
 */
async function resolveCustomer(
  db: Firestore,
  order: any,
  ownerId: string,
  options: { writeCustomer: boolean; allowArchivedCustomer: boolean },
): Promise<{ customer: ResolvedCustomer | null; ambiguous: boolean }> {
  const explicitId = String(order?.clienteId || '').trim();
  if (explicitId) {
    const explicitSnap = await getDoc(doc(db, 'clientes', explicitId));
    if (explicitSnap.exists()) {
      const data: any = explicitSnap.data() || {};
      if (ownsCustomer(data, ownerId)
        && !data.mergeInProgress
        && (options.allowArchivedCustomer || data.archived !== true)) {
        return {
          customer: {
            id: explicitId,
            data,
            isNew: false,
            unidentified: data.naoIdentificado === true,
            source: 'explicit',
          },
          ambiguous: false,
        };
      }
    }
    // Id inexistente, de outra loja ou arquivado em uma venda nova: nunca o
    // materializa. Ainda é seguro tentar o fallback legado pelo telefone.
  }

  const rawPhone = String(order?.customerPhone || '').trim();
  const normalizedPhone = normalizeCreditPhone(rawPhone);
  const validPhone = isValidCreditPhone(normalizedPhone);
  const name = String(order?.customerName || '').trim();

  if (validPhone) {
    const clientesRef = collection(db, 'clientes');
    const snap = await getDocs(query(
      clientesRef,
      where('ownerId', '==', ownerId),
      where('celular', 'in', getPhoneVariants(rawPhone)),
    ));
    const matching = snap.docs
      .map((candidate) => ({ id: candidate.id, data: candidate.data() || {} }))
      .filter(({ data }) =>
        ownsCustomer(data, ownerId)
        && normalizeCreditPhone(String(data.celular || '')) === normalizedPhone);

    const allUnique = Array.from(new Map(matching.map((candidate) => [candidate.id, candidate])).values());
    const unique = allUnique.filter(({ data }) =>
      !data.mergeInProgress && (options.allowArchivedCustomer || data.archived !== true));
    if (unique.length > 1) return { customer: null, ambiguous: true };
    if (unique.length === 1) {
      return {
        customer: { ...unique[0], isNew: false, unidentified: false, source: 'phone' },
        ambiguous: false,
      };
    }
    // Um cadastro arquivado, mesmo com id legado/não determinístico, conserva
    // esta identidade. Criar outro ativo com o mesmo telefone duplicaria saldo
    // e histórico; a restauração deve ser decisão explícita na aba Clientes.
    if (allUnique.some(({ data }) =>
      data.mergeInProgress || (!options.allowArchivedCustomer && data.archived === true))) {
      return { customer: null, ambiguous: true };
    }

    const deterministicId = proposedCustomerId(ownerId, order)!;
    const deterministicSnap = await getDoc(doc(db, 'clientes', deterministicId));
    if (deterministicSnap.exists()) {
      const data: any = deterministicSnap.data() || {};
      const sameIdentity = ownsCustomer(data, ownerId)
        && normalizeCreditPhone(String(data.celular || '')) === normalizedPhone;
      if (sameIdentity && !data.mergeInProgress && (options.allowArchivedCustomer || data.archived !== true)) {
        return {
          customer: { id: deterministicId, data, isNew: false, unidentified: false, source: 'phone' },
          ambiguous: false,
        };
      }
      // O id determinístico já pertence a um cadastro que trocou de número,
      // foi arquivado, ou está corrompido. Sobrescrevê-lo partiria o histórico.
      return { customer: null, ambiguous: true };
    }

    return {
      customer: { id: deterministicId, data: {}, isNew: true, unidentified: false, source: 'proposed' },
      ambiguous: false,
    };
  }

  const normalizedName = name.toLowerCase();
  if (!name || ANON_NAMES.has(normalizedName)) return { customer: null, ambiguous: false };

  const deterministicId = proposedCustomerId(ownerId, order) || '';
  // Sem id do registro não existe token estável que separe homônimos. Nesse
  // caso mantemos o fallback textual no pedido, mas não inventamos um vínculo.
  if (!deterministicId || deterministicId.startsWith(`${ownerId}_n__`)) {
    return { customer: null, ambiguous: false };
  }

  const deterministicSnap = await getDoc(doc(db, 'clientes', deterministicId));
  if (deterministicSnap.exists()) {
    const data: any = deterministicSnap.data() || {};
    if (!ownsCustomer(data, ownerId)
      || data.mergeInProgress
      || (!options.allowArchivedCustomer && data.archived === true)) {
      return { customer: null, ambiguous: true };
    }
    return {
      customer: { id: deterministicId, data, isNew: false, unidentified: true, source: 'phone' },
      ambiguous: false,
    };
  }

  return {
    customer: { id: deterministicId, data: {}, isNew: true, unidentified: true, source: 'proposed' },
    ambiguous: false,
  };
}

/** Extrai o endereço estruturado do pedido (campos planos ou objeto address). */
function extractAddress(order: any) {
  const a = order?.address && typeof order.address === 'object' ? order.address : {};
  const pick = (...vals: any[]) => {
    for (const v of vals) {
      const s = (v ?? '').toString().trim();
      if (s) return s;
    }
    return '';
  };
  return {
    logradouro: pick(order?.street, a.street, order?.logradouro),
    logradouroNumero: pick(order?.number, a.number, order?.logradouroNumero),
    complemento: pick(order?.complement, a.complement, order?.complemento),
    bairro: pick(order?.neighborhood, a.neighborhood, order?.bairro),
    cidade: pick(order?.city, a.city, order?.cidade),
  };
}

export async function syncCustomerFromOrder(
  db: Firestore,
  order: any,
  options: SyncOptions,
): Promise<SyncResult> {
  const { ownerId, countOrder } = options;
  const empty: SyncResult = { created: false, counted: false, customerId: null };
  if (!db || !ownerId || !order) return empty;

  const rawPhone = (order.customerPhone || '').toString().trim();
  const phone = normalizeCreditPhone(rawPhone);
  const nome = (order.customerName || '').toString().trim();

  const writeCustomer = options.writeCustomer !== false;
  const { customer, ambiguous } = await resolveCustomer(db, order, ownerId, {
    writeCustomer,
    allowArchivedCustomer: options.allowArchivedCustomer === true,
  });
  if (!customer) return { ...empty, ambiguous };

  const customerId = customer.id;
  const existing: any = customer.data;
  const isNew = customer.isNew;
  const clientRef = doc(db, 'clientes', customerId);

  // ── 1. Upsert de identidade/endereço (nunca sobrescreve com vazio) ──
  const addr = extractAddress(order);
  const patch: any = { id: customerId, ownerId };
  if (nome) patch.nome = nome;
  // `clienteId` explícito pode vir de um pedido antigo, criado antes de o
  // cliente trocar de número. O vínculo deve sobreviver à troca sem restaurar
  // silenciosamente o telefone antigo no cadastro.
  if (isValidCreditPhone(phone) && customer.source !== 'explicit') patch.celular = phone;
  patch.naoIdentificado = customer.unidentified;
  if (addr.logradouro) patch.logradouro = addr.logradouro;
  if (addr.logradouroNumero) patch.logradouroNumero = addr.logradouroNumero;
  if (addr.complemento) patch.complemento = addr.complemento;
  if (addr.bairro) patch.bairro = addr.bairro;
  if (addr.cidade) patch.cidade = addr.cidade;
  if (order.customerBirthDate && !existing.dataNascimento) patch.dataNascimento = order.customerBirthDate;

  if (isNew) {
    patch.clienteDesde = new Date().toLocaleDateString('pt-BR');
  }

  if (writeCustomer) await setDoc(clientRef, patch, { merge: true });

  // ── 2. Vínculo por id + contagem idempotente do pedido ──
  let counted = false;
  const linkCollection = options.linkCollection === undefined ? 'orders' : options.linkCollection;
  if (order.id && linkCollection && writeCustomer) {
    const orderRef = doc(db, linkCollection, order.id);
    const valor = Number(order.totalAmount) || 0;
    const hoje = new Date().toLocaleDateString('pt-BR');
    counted = await runTransaction(db, async (tx) => {
      const oSnap = await tx.get(orderRef);
      if (!oSnap.exists()) return false;
      const persistedOrder: any = oSnap.data() || {};
      const persistedCustomerId = String(persistedOrder.clienteId || '').trim();
      // Outro fluxo já vinculou uma identidade diferente. Nunca troca o dono
      // do histórico com base num snapshot/telefone possivelmente atrasado.
      if (persistedCustomerId && persistedCustomerId !== customerId) return false;

      const shouldCount = countOrder
        && linkCollection === 'orders'
        && persistedOrder.customerCounted !== true;
      const orderPatch: any = {};
      if (!persistedCustomerId) orderPatch.clienteId = customerId;

      if (!shouldCount) {
        if (Object.keys(orderPatch).length > 0) tx.update(orderRef, orderPatch);
        return false;
      }

      const cSnap = await tx.get(clientRef);
      const c: any = cSnap.exists() ? cSnap.data() : {};
      const oldPedidos = Number(c.totalPedidos) || 0;
      const oldTicket = Number(c.ticketMedio) || 0;
      const novoTotal = oldPedidos + 1;
      const novoTicket = (oldPedidos * oldTicket + valor) / novoTotal;
      tx.set(clientRef, { totalPedidos: novoTotal, ticketMedio: novoTicket, ultimoPedido: hoje }, { merge: true });
      tx.update(orderRef, { ...orderPatch, customerCounted: true });
      return true;
    });
  }

  return { created: isNew && writeCustomer, counted, customerId, ambiguous: false };
}
