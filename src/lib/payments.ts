import { collection, doc, setDoc, updateDoc, increment } from 'firebase/firestore';
import { validateCustomerCredit, sumPendingCreditOrdersForOwner } from '@/lib/customer-credit';

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

  if (!phone || phone.replace(/\D/g, '').length < 10) {
    return { kind: 'register', phone: '' };
  }

  const pendingAmount = includePending
    ? await sumPendingCreditOrdersForOwner(db, ownerId, phone)
    : undefined;
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
 * Tudo fica gated em `caixaAberto` (Delivery pode estar com caixa fechado);
 * nos canais que exigem caixa aberto para chegar aqui, o gate é inócuo.
 * A aba fornece apenas os títulos e a descrição do débito.
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
    onContaCasaSemCliente,
  } = params;

  if (!caixaAberto) return;

  for (const split of splits) {
    if (split.methodId === 'conta_casa') {
      if (contaCasaCustomerId) {
        const newTrans = doc(collection(db, 'clientes', contaCasaCustomerId, 'credit_transactions'));
        await setDoc(newTrans, {
          id: newTrans.id,
          type: 'debit',
          amount: split.amount,
          date: new Date().toISOString(),
          description: creditDescription,
        });
        await updateDoc(doc(db, 'clientes', contaCasaCustomerId), { creditBalance: increment(split.amount) });
        // Registra também no caixa (forma "Prazo") para aparecer na lista e
        // participar do fechamento/conferência. Não entra no dinheiro da gaveta.
        if (registrarLancamento) {
          await registrarLancamento({
            tipo: 'venda',
            titulo: tituloPrazo,
            valor: split.amount,
            formaPagamento: 'conta_casa',
          });
        }
      } else {
        onContaCasaSemCliente?.();
      }
    } else if (registrarLancamento) {
      await registrarLancamento({
        tipo: 'venda',
        titulo: tituloVenda,
        valor: split.amount,
        formaPagamento: split.methodId,
      });
    }
  }
}
