/**
 * Dinheiro da encomenda — regra pura, usada pela aba do PDV e pelo balcão.
 *
 * O modelo antigo só sabia dizer "o sinal foi lançado?" (`sinalLancado`), e o
 * sinal é uma metade combinada lá na hora do orçamento. Isso não fecha conta em
 * dois casos reais: a cliente que paga o valor cheio na hora e a que paga o
 * restante na entrega — nos dois o sistema continuava achando que faltava
 * exatamente `saldo`, e o dinheiro entrava (ou não) no escuro.
 *
 * Agora o que manda é `valorPago`: quanto DESTA encomenda já entrou no caixa.
 * As encomendas antigas não têm o campo, então a leitura cai no comportamento
 * de antes (sinal lançado = sinal recebido) — nada precisa ser migrado.
 */

import type { Encomenda } from './types';

type EncomendaLike = Pick<Encomenda, 'total' | 'sinal'> & {
  valorPago?: number;
  sinalLancado?: boolean;
};

/** Quanto já entrou no caixa por esta encomenda. */
export function valorRecebido(enc: EncomendaLike | null | undefined): number {
  if (!enc) return 0;
  if (typeof enc.valorPago === 'number') return Math.max(0, enc.valorPago);
  // Legado: antes da entrada flexível, "sinal lançado" era o único recebimento.
  return enc.sinalLancado ? Math.max(0, Number(enc.sinal) || 0) : 0;
}

/** Quanto ainda falta receber (nunca negativo: pagar a mais não vira dívida da loja). */
export function saldoAReceber(enc: EncomendaLike | null | undefined): number {
  if (!enc) return 0;
  const total = Math.max(0, Number(enc.total) || 0);
  const resto = total - valorRecebido(enc);
  // Centavos de arredondamento não podem virar "falta R$ 0,004 para quitar".
  return resto > 0.009 ? resto : 0;
}

/** true quando a encomenda já está paga por inteiro. */
export function estaQuitada(enc: EncomendaLike | null | undefined): boolean {
  return saldoAReceber(enc) === 0;
}
