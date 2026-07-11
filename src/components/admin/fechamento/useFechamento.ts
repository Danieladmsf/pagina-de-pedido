'use client';

import { useState } from 'react';
import type { FormaPagamento } from './payment-methods';

export type PaymentSplit = { methodId: string; label: string; amount: number; received?: number };

export interface FechamentoParams {
  /** Subtotal dos itens (sem taxa de entrega). */
  subtotal: number;
  /** Taxa de entrega do pedido (0 quando não há). */
  deliveryFee?: number;
  /** true quando o frete já nasceu fora do totalAmount (payDeliveryToMotoboy no pedido). */
  feeAlreadyOffTotal?: boolean;
  /** Regra do delivery: pagamento a Prazo ⇒ frete sai da cobrança (pago direto ao motoboy). */
  feePaidToMotoboyOnPrazo?: boolean;
  formasPagamento: FormaPagamento[];
}

export interface CheckoutResult {
  splitsToProcess: PaymentSplit[];
  paymentString: string;
  discount: number;
  surcharge: number;
  /** Total efetivamente cobrado (desconto/acréscimo e feeOff já aplicados). */
  finalTotal: number;
  /** true quando o frete saiu da cobrança AGORA (Prazo) — gravar totalAmount ajustado + payDeliveryToMotoboy. */
  feeOffApplied: boolean;
}

// Estado + cálculo únicos do fechamento de venda (modal de pagamento).
// Usado por Balcão (NovoPedidoTab), Mesas (MesasTab) e Delivery (DeliveryTab)
// para que desconto/acréscimo, split, troco e Prazo se comportem igual em
// todos os canais. A UI correspondente é o FechamentoModal.
export function useFechamento({
  subtotal,
  deliveryFee = 0,
  feeAlreadyOffTotal = false,
  feePaidToMotoboyOnPrazo = false,
  formasPagamento,
}: FechamentoParams) {
  const [selectedPayment, setSelectedPayment] = useState('');
  const [valorRecebido, setValorRecebido] = useState<string>('');
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [paymentSplits, setPaymentSplits] = useState<PaymentSplit[]>([]);

  // Ajuste de venda (desconto/acréscimo) aplicado sobre o subtotal dos itens
  // (a taxa de entrega fica fora da base do % e do teto do desconto).
  const [ajusteTipo, setAjusteTipo] = useState<'desconto' | 'acrescimo'>('desconto');
  const [ajusteUnidade, setAjusteUnidade] = useState<'reais' | 'percent'>('reais');
  const [ajusteRaw, setAjusteRaw] = useState('');

  const ajusteValor = Number((ajusteRaw || '').replace(',', '.')) || 0;
  const ajusteBruto = ajusteUnidade === 'percent' ? (subtotal * ajusteValor) / 100 : ajusteValor;
  const descontoAplicado = ajusteTipo === 'desconto' ? Math.min(Math.max(0, ajusteBruto), subtotal) : 0;
  const acrescimoAplicado = ajusteTipo === 'acrescimo' ? Math.max(0, ajusteBruto) : 0;

  // Frete dentro da cobrança (se já nasceu fora do total, não soma de novo).
  const feeInCharge = feeAlreadyOffTotal ? 0 : deliveryFee;
  const prazoInvolved = selectedPayment === 'conta_casa' || paymentSplits.some(s => s.methodId === 'conta_casa');
  const feeOffApplied = feePaidToMotoboyOnPrazo && prazoInvolved && deliveryFee > 0 && !feeAlreadyOffTotal;
  // Aviso "taxa paga direto ao motoboy" (vale também quando o frete já nasceu fora).
  const prazoFeeNote = feePaidToMotoboyOnPrazo && prazoInvolved && deliveryFee > 0;

  // finalTotal é a fonte única → propaga p/ splits, troco, totalAmount do
  // pedido e valor lançado no caixa.
  const finalTotal = Math.max(0, subtotal + feeInCharge - descontoAplicado + acrescimoAplicado - (feeOffApplied ? deliveryFee : 0));

  const totalPaid = paymentSplits.reduce((sum, s) => sum + s.amount, 0);
  const remaining = Math.max(0, finalTotal - totalPaid);
  const isFullyPaid = remaining <= 0;
  const recebidoNum = Number(valorRecebido) || 0;
  const troco = !isSplitMode && selectedPayment === 'dinheiro' && recebidoNum > finalTotal ? recebidoNum - finalTotal : 0;
  const falta = isSplitMode ? remaining : (selectedPayment === 'dinheiro' ? Math.max(0, finalTotal - recebidoNum) : (selectedPayment ? 0 : finalTotal));
  const quitado = falta <= 0.001 && (isSplitMode ? paymentSplits.length > 0 : !!selectedPayment);

  const labelFor = (methodId: string) => {
    if (methodId === 'conta_casa') return 'Prazo';
    return formasPagamento.find(f => f.id === methodId)?.label || methodId;
  };

  // Adiciona a forma selecionada como uma parte do pagamento múltiplo.
  const addSplit = () => {
    if (!selectedPayment) return;
    let amount = remaining;
    let received: number | undefined = undefined;
    const valRec = valorRecebido ? Number(valorRecebido) : 0;

    if (selectedPayment === 'dinheiro') {
      if (valRec > 0) {
        if (valRec >= remaining) {
          received = valRec;
          amount = remaining;
        } else {
          amount = valRec;
          received = valRec;
        }
      }
    } else if (valRec > 0) {
      amount = Math.min(valRec, remaining);
    }

    if (amount <= 0) return;

    setPaymentSplits(prev => [...prev, { methodId: selectedPayment, label: labelFor(selectedPayment), amount, received }]);
    setSelectedPayment('');
    setValorRecebido('');
  };

  // Monta os splits finais + paymentString + valores a persistir. Não altera
  // estado — o chamador decide o que fazer (criar pedido, encerrar mesa etc.).
  const buildCheckout = (): CheckoutResult => {
    const splitsToProcess: PaymentSplit[] = isSplitMode ? [...paymentSplits] : [];
    let paymentString = '';

    if (!isSplitMode) {
      // Fluxo SIMPLES (1 forma)
      const label = labelFor(selectedPayment);
      let change = 0;
      if (selectedPayment === 'dinheiro' && valorRecebido) {
        const valRec = Number(valorRecebido);
        if (valRec > finalTotal) change = valRec - finalTotal;
      }
      if (prazoFeeNote && selectedPayment === 'conta_casa') {
        paymentString = `${label} (Taxa de entrega paga direto ao motoboy)`;
      } else {
        paymentString = selectedPayment === 'dinheiro' && change > 0
          ? `${label} (Troco para R$ ${Number(valorRecebido).toFixed(2)})`
          : label;
      }
      splitsToProcess.push({ methodId: selectedPayment, label, amount: finalTotal });
    } else {
      // Fluxo MÚLTIPLO (split): incorpora a forma pendente selecionada, se houver.
      if (selectedPayment) {
        let amount = remaining;
        let received: number | undefined = undefined;
        const valRec = valorRecebido ? Number(valorRecebido) : 0;
        if (selectedPayment === 'dinheiro') {
          if (valRec > 0) {
            if (valRec >= remaining) {
              received = valRec;
              amount = remaining;
            } else {
              amount = valRec;
              received = valRec;
            }
          }
        } else if (valRec > 0) {
          amount = Math.min(valRec, remaining);
        }
        if (amount > 0) {
          splitsToProcess.push({ methodId: selectedPayment, label: labelFor(selectedPayment), amount, received });
        }
      }

      paymentString = splitsToProcess.map(s => `${s.label}: R$ ${s.amount.toFixed(2)}`).join(' | ');
      const splitsTemPrazo = splitsToProcess.some(s => s.methodId === 'conta_casa');
      if (feePaidToMotoboyOnPrazo && splitsTemPrazo && deliveryFee > 0) {
        paymentString += ' (Taxa de entrega paga direto ao motoboy)';
      }
      const totalReceived = splitsToProcess.reduce((acc, s) => acc + (s.received || s.amount), 0);
      if (totalReceived > finalTotal) {
        paymentString += ` (Troco para R$ ${totalReceived.toFixed(2)})`;
      }
    }

    // feeOff/total finais derivados dos splits realmente processados.
    const prazoFinal = splitsToProcess.some(s => s.methodId === 'conta_casa');
    const feeOff = feePaidToMotoboyOnPrazo && prazoFinal && deliveryFee > 0 && !feeAlreadyOffTotal;
    const chargedTotal = Math.max(0, subtotal + feeInCharge - descontoAplicado + acrescimoAplicado - (feeOff ? deliveryFee : 0));

    return {
      splitsToProcess,
      paymentString,
      discount: descontoAplicado,
      surcharge: acrescimoAplicado,
      finalTotal: chargedTotal,
      feeOffApplied: feeOff,
    };
  };

  // Limpa tudo (ao abrir o modal e após finalizar).
  const reset = () => {
    setSelectedPayment('');
    setValorRecebido('');
    setPaymentSplits([]);
    setIsSplitMode(false);
    setAjusteTipo('desconto');
    setAjusteUnidade('reais');
    setAjusteRaw('');
  };

  return {
    // parâmetros ecoados (o modal renderiza os totais a partir daqui)
    subtotal, deliveryFee, feeInCharge, formasPagamento,
    // estado
    selectedPayment, setSelectedPayment,
    valorRecebido, setValorRecebido,
    isSplitMode, setIsSplitMode,
    paymentSplits, setPaymentSplits,
    ajusteTipo, setAjusteTipo,
    ajusteUnidade, setAjusteUnidade,
    ajusteRaw, setAjusteRaw,
    // derivados
    ajusteValor, descontoAplicado, acrescimoAplicado,
    prazoInvolved, prazoFeeNote, feeOffApplied,
    finalTotal, totalPaid, remaining, isFullyPaid,
    troco, falta, quitado,
    // ações
    addSplit, buildCheckout, reset,
  };
}

export type UseFechamentoReturn = ReturnType<typeof useFechamento>;
