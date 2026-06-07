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
  getDocs,
  query,
  where,
  setDoc,
  runTransaction,
} from 'firebase/firestore';
import { normalizeCreditPhone, getPhoneVariants } from '@/lib/customer-credit';

export interface SyncOptions {
  ownerId: string;
  /** true = também conta o pedido (totalPedidos/ticket/ultimoPedido). Use na entrega/finalização. */
  countOrder: boolean;
}

export interface SyncResult {
  /** true se um cliente novo foi criado nesta chamada. */
  created: boolean;
  /** true se o pedido foi contabilizado agora (false se já tinha sido). */
  counted: boolean;
  customerId: string | null;
}

const ANON_NAMES = new Set(['cliente balcao', 'cliente balcão', 'cliente', '']);

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
  { ownerId, countOrder }: SyncOptions,
): Promise<SyncResult> {
  const empty: SyncResult = { created: false, counted: false, customerId: null };
  if (!db || !ownerId || !order) return empty;

  const rawPhone = (order.customerPhone || '').toString().trim();
  const phone = normalizeCreditPhone(rawPhone);
  const nome = (order.customerName || '').toString().trim();

  // Sem identificação útil → ignora (ex.: venda anônima de balcão "Cliente Balcão").
  if (!phone && ANON_NAMES.has(nome.toLowerCase())) return empty;
  if (!phone && !nome) return empty;

  const clientesRef = collection(db, 'clientes');
  const q = phone
    ? query(clientesRef, where('ownerId', '==', ownerId), where('celular', 'in', getPhoneVariants(rawPhone)))
    : query(clientesRef, where('ownerId', '==', ownerId), where('nome', '==', nome));

  const snap = await getDocs(q);
  const isNew = snap.empty;
  const customerId = !isNew ? snap.docs[0].id : (phone ? `${ownerId}_${phone}` : doc(clientesRef).id);
  const existing: any = isNew ? {} : snap.docs[0].data();
  const clientRef = doc(db, 'clientes', customerId);

  // ── 1. Upsert de identidade/endereço (nunca sobrescreve com vazio) ──
  const addr = extractAddress(order);
  const patch: any = { id: customerId, ownerId };
  if (nome) patch.nome = nome;
  if (phone) patch.celular = phone;
  if (addr.logradouro) patch.logradouro = addr.logradouro;
  if (addr.logradouroNumero) patch.logradouroNumero = addr.logradouroNumero;
  if (addr.complemento) patch.complemento = addr.complemento;
  if (addr.bairro) patch.bairro = addr.bairro;
  if (addr.cidade) patch.cidade = addr.cidade;
  if (order.customerBirthDate && !existing.dataNascimento) patch.dataNascimento = order.customerBirthDate;

  if (isNew) {
    patch.clienteDesde = new Date().toLocaleDateString('pt-BR');
    patch.totalPedidos = 0;
    patch.totalPontos = 0;
    patch.ticketMedio = 0;
    patch.creditBalance = 0;
    patch.ultimoPedido = '';
  }

  await setDoc(clientRef, patch, { merge: true });

  // ── 2. Contagem idempotente do pedido ──
  let counted = false;
  if (countOrder && order.id) {
    const orderRef = doc(db, 'orders', order.id);
    const valor = Number(order.totalAmount) || 0;
    const hoje = new Date().toLocaleDateString('pt-BR');
    await runTransaction(db, async (tx) => {
      const oSnap = await tx.get(orderRef);
      if (oSnap.exists() && oSnap.data().customerCounted === true) return; // já contado
      const cSnap = await tx.get(clientRef);
      const c: any = cSnap.exists() ? cSnap.data() : {};
      const oldPedidos = Number(c.totalPedidos) || 0;
      const oldTicket = Number(c.ticketMedio) || 0;
      const novoTotal = oldPedidos + 1;
      const novoTicket = (oldPedidos * oldTicket + valor) / novoTotal;
      tx.set(clientRef, { totalPedidos: novoTotal, ticketMedio: novoTicket, ultimoPedido: hoje }, { merge: true });
      if (oSnap.exists()) tx.update(orderRef, { customerCounted: true });
      counted = true;
    });
  }

  return { created: isNew, counted, customerId };
}
