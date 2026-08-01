import { collection, doc, increment, writeBatch } from 'firebase/firestore';
import { findCreditCustomers, isValidCreditPhone, validateCustomerCredit, sumPendingCreditOrdersForOwner } from '@/lib/customer-credit';

// Centraliza o pós-fechamento financeiro que era copiado em NovoPedidoTab,
// MesasTab e DeliveryTab. São duas etapas porque cada canal grava/atualiza o
// pedido no meio delas: (1) resolver a Conta da Casa antes de gravar e
// (2) lançar os splits no caixa/crédito depois. Cada aba mantém só os títulos.

export type PaymentSplit = { methodId: string; amount: number };

type LancamentoInput = {
  tipo: 'venda';
  titulo: string;
  valor: number;
  formaPagamento: string;
  /** Pedido que originou a venda — o vínculo firme, sem depender do título. */
  orderId?: string;
  /** Encomenda que originou a venda (coleção própria, não é `orders`). */
  encomendaId?: string;
  /** Cliente do Prazo, quando esta parte da venda foi fiada. */
  clienteId?: string;
};
type RegistrarLancamento = (input: LancamentoInput) => Promise<any> | any;

// ---- Etapa 1: resolver Conta da Casa (crédito) antes de gravar o pedido ----

export type ContaCasaResult =
  | { kind: 'none' }
  | { kind: 'ok'; customerId: string | null; amount: number }
  | { kind: 'register'; phone: string }
  | { kind: 'blocked'; message: string };

/**
 * Valida o limite de prazo quando há split em "conta_casa". Não toca em UI:
 * devolve um resultado que a aba traduz no seu próprio modal/toast.
 *  - `none`     -> não há Conta da Casa, siga o fluxo normal.
 *  - `ok`       -> cliente validado; use `customerId` para lançar a dívida.
 *  - `register` -> abrir cadastro rápido com o telefone sugerido (`''` quando faltou telefone).
 *  - `blocked`  -> limite estourado/vencido; mostrar `message`.
 */
export async function resolveContaCasa(
  db: any,
  params: {
    splits: PaymentSplit[];
    ownerId: string;
    phone: string;
    // Balcão/Mesa somam pedidos a prazo em andamento no limite; Delivery não.
    includePending?: boolean;
  }
): Promise<ContaCasaResult> {
  const { splits, ownerId, phone, includePending = true } = params;

  const contaCasaSplits = splits.filter((s) => s.methodId === 'conta_casa');
  if (contaCasaSplits.length === 0) return { kind: 'none' };

  const amount = contaCasaSplits.reduce((sum, s) => sum + s.amount, 0);

  if (!isValidCreditPhone(phone)) {
    return { kind: 'register', phone: '' };
  }

  let pendingAmount: number | undefined;
  if (includePending) {
    // Pedidos novos usam clienteId; telefone só entra como fallback nos
    // legados. Com mais de um cadastro para o número não escolhemos um id.
    const candidates = await findCreditCustomers(db, ownerId, phone);
    const uniqueCustomerId = candidates.length === 1 ? candidates[0].id : undefined;
    pendingAmount = await sumPendingCreditOrdersForOwner(db, ownerId, phone, uniqueCustomerId);
  }
  const creditCheck = await validateCustomerCredit(
    db,
    ownerId,
    phone,
    amount,
    pendingAmount !== undefined ? { pendingAmount } : undefined
  );

  if (!creditCheck.allowed) {
    if (creditCheck.reason === 'not_found') return { kind: 'register', phone };
    return {
      kind: 'blocked',
      message: creditCheck.message || 'Este pedido passa do limite de prazo do cliente.',
    };
  }

  return { kind: 'ok', customerId: creditCheck.customer?.id || null, amount };
}

// ---- Etapa 2: lançar os splits no caixa / Conta da Casa após gravar o pedido ----

/**
 * Percorre os splits do fechamento e:
 *  - em "conta_casa": grava o débito em credit_transactions, incrementa o
 *    creditBalance do cliente e registra a forma "conta_casa" no caixa (Prazo);
 *  - nas demais formas: registra a venda no caixa.
 * A aba fornece apenas os títulos, a descrição do débito e o pedido de origem.
 *
 * DUAS REGRAS QUE VALEM DINHEIRO:
 *
 * 1. O débito do Prazo NÃO depende do caixa. Antes a função inteira saía fora
 *    quando o caixa estava fechado — no Delivery dava para finalizar um pedido
 *    "no Prazo", o pedido ia para entregue e a dívida simplesmente não existia.
 *    Só o LANÇAMENTO NO CAIXA depende do caixa aberto; a dívida do cliente é
 *    registrada sempre.
 *
 * 2. Débito e saldo entram na MESMA escrita (batch). Eram duas idas separadas:
 *    quando a segunda falhava, o extrato e o `creditBalance` do cadastro
 *    ficavam com valores diferentes e ninguém percebia.
 */
export async function registrarPagamentoSplits(
  db: any,
  params: {
    splits: PaymentSplit[];
    contaCasaCustomerId: string | null;
    registrarLancamento?: RegistrarLancamento | null;
    caixaAberto?: boolean;
    tituloVenda: string;
    tituloPrazo: string;
    creditDescription: string;
    /** Pedido que originou a dívida — vira o vínculo firme do extrato. */
    orderId?: string;
    /** Encomenda que originou a venda (mora em `encomendas`, não em `orders`). */
    encomendaId?: string;
    /** 'balcao' | 'mesa' | 'delivery' | 'encomenda' — de onde veio a venda. */
    channel?: string;
    onContaCasaSemCliente?: () => void;
  }
): Promise<void> {
  const {
    splits,
    contaCasaCustomerId,
    registrarLancamento,
    caixaAberto = true,
    tituloVenda,
    tituloPrazo,
    creditDescription,
    orderId,
    encomendaId,
    channel,
    onContaCasaSemCliente,
  } = params;

  // O id vai junto em TODA parte da venda: é ele que liga o lançamento do caixa
  // ao pedido sem depender do "#" do título — que Mesa nunca teve e encomenda
  // também não. Sem isso, expandir, reimprimir e cancelar ficam cegos.
  const vinculo = {
    ...(orderId ? { orderId } : {}),
    ...(encomendaId ? { encomendaId } : {}),
  };

  for (const split of splits) {
    if (split.methodId === 'conta_casa') {
      if (!contaCasaCustomerId) {
        onContaCasaSemCliente?.();
        continue;
      }

      const newTrans = doc(collection(db, 'clientes', contaCasaCustomerId, 'credit_transactions'));
      const batch = writeBatch(db);
      batch.set(newTrans, {
        id: newTrans.id,
        type: 'debit',
        amount: split.amount,
        date: new Date().toISOString(),
        description: creditDescription,
        ...vinculo,
        ...(channel ? { channel } : {}),
      });
      batch.update(doc(db, 'clientes', contaCasaCustomerId), { creditBalance: increment(split.amount) });
      await batch.commit();

      // Registra também no caixa (forma "Prazo") para aparecer na lista e
      // participar do fechamento/conferência. Não entra no dinheiro da gaveta.
      if (caixaAberto && registrarLancamento) {
        await registrarLancamento({
          tipo: 'venda',
          titulo: tituloPrazo,
          valor: split.amount,
          formaPagamento: 'conta_casa',
          clienteId: contaCasaCustomerId,
          ...vinculo,
        });
      }
    } else if (caixaAberto && registrarLancamento) {
      await registrarLancamento({
        tipo: 'venda',
        titulo: tituloVenda,
        valor: split.amount,
        formaPagamento: split.methodId,
        ...vinculo,
      });
    }
  }
}
