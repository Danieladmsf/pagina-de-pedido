/**
 * Repasse do fechamento (motoboy, freelancer): o que sai da GAVETA e o que não.
 *
 * Antes, todo repasse era tratado como dinheiro físico. Quem paga o motoboy por
 * Pix e marcava o pagamento no fechamento via o caixa acusar uma falta do
 * tamanho do repasse — então não marcava, e a dívida do motoboy crescia sozinha
 * (R$ 4.326,60 acumulados na Lima Limão). Ver [[saldo-motoboy-nao-zera]].
 *
 * Regra única: só baixa a gaveta o repasse pago em dinheiro. Repasse sem forma
 * declarada é dinheiro — é o que todo fechamento anterior a 09/2026 era.
 */

export interface RepasseComForma {
  valorPago?: number;
  total?: number;
  formaPagamento?: string;
}

/**
 * O repasse saiu da gaveta? Vazio conta como dinheiro tanto quanto ausente —
 * `??` deixaria `formaPagamento: ''` (legado) cair no lado errado e a gaveta
 * fecharia sobrando o valor do repasse.
 */
export const saiDaGaveta = (forma?: string) =>
  (forma || 'dinheiro').toLowerCase().includes('dinheiro');

/** Quanto o repasse vale — o pago manda; `total` é a reserva do cupom antigo. */
export const valorDoRepasse = (r: RepasseComForma) => Number(r.valorPago ?? r.total ?? 0) || 0;

/** Soma só o que saiu em dinheiro: é isso que a conferência da gaveta desconta. */
export const totalEmDinheiro = (repasses: readonly RepasseComForma[]) =>
  repasses.reduce((s, r) => s + (saiDaGaveta(r.formaPagamento) ? valorDoRepasse(r) : 0), 0);

/** Soma o que foi quitado sem tocar no dinheiro físico (Pix). */
export const totalForaDaGaveta = (repasses: readonly RepasseComForma[]) =>
  repasses.reduce((s, r) => s + (saiDaGaveta(r.formaPagamento) ? 0 : valorDoRepasse(r)), 0);
