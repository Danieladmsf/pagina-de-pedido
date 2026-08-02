'use client';

import { useEffect, useRef, useState, type SetStateAction } from 'react';
import type { FormaPagamento } from './payment-methods';
import { pagamentosDoPedido, type PagamentoDoPedido } from '@/lib/payment-breakdown';

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
  /** Permite informar desconto ou acréscimo no fechamento. */
  allowAdjustments?: boolean;
  /** Permite usar Conta da Casa (Prazo), inclusive em pagamentos múltiplos. */
  allowPrazo?: boolean;
}

export interface CheckoutResult {
  splitsToProcess: PaymentSplit[];
  paymentString: string;
  /**
   * O mesmo pagamento em dado, não em frase — é o que o pedido grava em
   * `payments`. A `paymentString` continua sendo gravada para o cupom e para
   * quem lê pedido antigo, mas relatório nenhum precisa interpretá-la.
   */
  payments: PagamentoDoPedido[];
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
  allowAdjustments = true,
  allowPrazo = true,
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

  // Capacidades podem mudar com o modal aberto. Mantemos o estado interno
  // imediatamente coerente e, abaixo, também usamos valores sanitizados nos
  // cálculos/buildCheckout para não depender do timing deste efeito.
  useEffect(() => {
    if (allowPrazo) return;
    setSelectedPayment(prev => prev === 'conta_casa' ? '' : prev);
    setPaymentSplits(prev => prev.filter(split => split.methodId !== 'conta_casa'));
  }, [allowPrazo]);

  useEffect(() => {
    if (!allowAdjustments) {
      // Splits may have been calculated from a discounted/surcharged total.
      // Clear the payment composition too, otherwise revocation could zero the
      // adjustment but still persist the old (now excessive) split amounts.
      setAjusteRaw('');
      setSelectedPayment('');
      setValorRecebido('');
      setPaymentSplits([]);
    }
  }, [allowAdjustments]);

  const allowedFormasPagamento = allowPrazo
    ? formasPagamento
    : formasPagamento.filter(forma => forma.id !== 'conta_casa');
  const adjustmentRevokedWithPendingValue = !allowAdjustments && ajusteRaw !== '';
  const permissionFilteredSelectedPayment = !allowPrazo && selectedPayment === 'conta_casa' ? '' : selectedPayment;
  const prazoFilteredPaymentSplits = allowPrazo
    ? paymentSplits
    : paymentSplits.filter(split => split.methodId !== 'conta_casa');

  const selectPayment = (methodId: string) => {
    setSelectedPayment(!allowPrazo && methodId === 'conta_casa' ? '' : methodId);
  };

  const updatePaymentSplits = (updater: SetStateAction<PaymentSplit[]>) => {
    setPaymentSplits(prev => {
      const allowedPrev = allowPrazo ? prev : prev.filter(split => split.methodId !== 'conta_casa');
      const next = typeof updater === 'function' ? updater(allowedPrev) : updater;
      return allowPrazo ? next : next.filter(split => split.methodId !== 'conta_casa');
    });
  };

  const ajusteValor = Number((ajusteRaw || '').replace(',', '.')) || 0;
  const ajusteBruto = ajusteUnidade === 'percent' ? (subtotal * ajusteValor) / 100 : ajusteValor;
  const descontoAplicado = allowAdjustments && ajusteTipo === 'desconto' ? Math.min(Math.max(0, ajusteBruto), subtotal) : 0;
  const acrescimoAplicado = allowAdjustments && ajusteTipo === 'acrescimo' ? Math.max(0, ajusteBruto) : 0;

  // Frete dentro da cobrança (se já nasceu fora do total, não soma de novo).
  const feeInCharge = feeAlreadyOffTotal ? 0 : deliveryFee;
  // Splits are amounts, not percentages. If subtotal/fee/adjustment changes,
  // they no longer represent the current charge and must be recomposed.
  const paymentBasis = Math.max(0, subtotal + feeInCharge - descontoAplicado + acrescimoAplicado);
  const paymentBasisRef = useRef(paymentBasis);
  const paymentBasisChangedWithSplits = Math.abs(paymentBasisRef.current - paymentBasis) > 0.001
    && prazoFilteredPaymentSplits.length > 0;

  useEffect(() => {
    const changed = Math.abs(paymentBasisRef.current - paymentBasis) > 0.001;
    paymentBasisRef.current = paymentBasis;
    if (!changed || paymentSplits.length === 0) return;
    setPaymentSplits([]);
    setSelectedPayment('');
    setValorRecebido('');
  }, [paymentBasis]);

  const resetPaymentComposition = adjustmentRevokedWithPendingValue || paymentBasisChangedWithSplits;
  const effectiveSelectedPayment = resetPaymentComposition ? '' : permissionFilteredSelectedPayment;
  const effectivePaymentSplits = resetPaymentComposition ? [] : prazoFilteredPaymentSplits;
  const prazoInvolved = effectiveSelectedPayment === 'conta_casa' || effectivePaymentSplits.some(s => s.methodId === 'conta_casa');
  const feeOffApplied = feePaidToMotoboyOnPrazo && prazoInvolved && deliveryFee > 0 && !feeAlreadyOffTotal;
  // Aviso "taxa paga direto ao motoboy" (vale também quando o frete já nasceu fora).
  const prazoFeeNote = feePaidToMotoboyOnPrazo && prazoInvolved && deliveryFee > 0;

  // finalTotal é a fonte única → propaga p/ splits, troco, totalAmount do
  // pedido e valor lançado no caixa.
  const finalTotal = Math.max(0, subtotal + feeInCharge - descontoAplicado + acrescimoAplicado - (feeOffApplied ? deliveryFee : 0));

  const totalPaid = effectivePaymentSplits.reduce((sum, s) => sum + s.amount, 0);
  const remaining = Math.max(0, finalTotal - totalPaid);
  const isFullyPaid = remaining <= 0;
  const recebidoNum = Number(valorRecebido) || 0;
  const troco = !isSplitMode && effectiveSelectedPayment === 'dinheiro' && recebidoNum > finalTotal ? recebidoNum - finalTotal : 0;
  const falta = isSplitMode ? remaining : (effectiveSelectedPayment === 'dinheiro' ? Math.max(0, finalTotal - recebidoNum) : (effectiveSelectedPayment ? 0 : finalTotal));
  const quitado = falta <= 0.001 && (isSplitMode ? effectivePaymentSplits.length > 0 : !!effectiveSelectedPayment);

  const labelFor = (methodId: string) => {
    if (methodId === 'conta_casa') return 'Prazo';
    return allowedFormasPagamento.find(f => f.id === methodId)?.label || methodId;
  };

  // Adiciona a forma selecionada como uma parte do pagamento múltiplo.
  const addSplit = () => {
    if (!effectiveSelectedPayment) return;
    let amount = remaining;
    let received: number | undefined = undefined;
    const valRec = valorRecebido ? Number(valorRecebido) : 0;

    if (effectiveSelectedPayment === 'dinheiro') {
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

    setPaymentSplits(prev => [...prev, { methodId: effectiveSelectedPayment, label: labelFor(effectiveSelectedPayment), amount, received }]);
    setSelectedPayment('');
    setValorRecebido('');
  };

  // Monta os splits finais + paymentString + valores a persistir. Não altera
  // estado — o chamador decide o que fazer (criar pedido, encerrar mesa etc.).
  const buildCheckout = (): CheckoutResult => {
    const splitsToProcess: PaymentSplit[] = isSplitMode ? [...effectivePaymentSplits] : [];
    let paymentString = '';

    if (!isSplitMode) {
      // Fluxo SIMPLES (1 forma)
      const label = labelFor(effectiveSelectedPayment);
      let change = 0;
      if (effectiveSelectedPayment === 'dinheiro' && valorRecebido) {
        const valRec = Number(valorRecebido);
        if (valRec > finalTotal) change = valRec - finalTotal;
      }
      if (prazoFeeNote && effectiveSelectedPayment === 'conta_casa') {
        paymentString = `${label} (Taxa de entrega paga direto ao motoboy)`;
      } else {
        paymentString = effectiveSelectedPayment === 'dinheiro' && change > 0
          ? `${label} (Troco para R$ ${Number(valorRecebido).toFixed(2)})`
          : label;
      }
      if (effectiveSelectedPayment) {
        splitsToProcess.push({ methodId: effectiveSelectedPayment, label, amount: finalTotal });
      }
    } else {
      // Fluxo MÚLTIPLO (split): incorpora a forma pendente selecionada, se houver.
      if (effectiveSelectedPayment) {
        let amount = remaining;
        let received: number | undefined = undefined;
        const valRec = valorRecebido ? Number(valorRecebido) : 0;
        if (effectiveSelectedPayment === 'dinheiro') {
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
          splitsToProcess.push({ methodId: effectiveSelectedPayment, label: labelFor(effectiveSelectedPayment), amount, received });
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
      payments: pagamentosDoPedido(splitsToProcess),
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
    subtotal, deliveryFee, feeInCharge, formasPagamento: allowedFormasPagamento,
    allowAdjustments, allowPrazo,
    // estado
    selectedPayment: effectiveSelectedPayment, setSelectedPayment: selectPayment,
    valorRecebido, setValorRecebido,
    isSplitMode, setIsSplitMode,
    paymentSplits: effectivePaymentSplits, setPaymentSplits: updatePaymentSplits,
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
