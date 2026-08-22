import { describe, expect, it } from 'vitest';

import { idDoLancamentoDeEncomenda } from './lancamento-id';

/**
 * A duplicata real: dois lançamentos de sinal de R$ 160,00 para a encomenda
 * ZEQ5PNX4, com dois segundos entre eles. Com id fixo o segundo clique cai no
 * mesmo documento e o caixa fecha pelo que entrou de verdade.
 */
describe('idDoLancamentoDeEncomenda', () => {
  it('devolve o mesmo id para a mesma etapa da mesma encomenda', () => {
    expect(idDoLancamentoDeEncomenda('ZEQ5PNX4', 'sinal')).toBe('enc-ZEQ5PNX4-sinal');
    expect(idDoLancamentoDeEncomenda('ZEQ5PNX4', 'sinal')).toBe(idDoLancamentoDeEncomenda('ZEQ5PNX4', 'sinal'));
  });

  it('sinal e entrada da mesma encomenda são lançamentos diferentes', () => {
    expect(idDoLancamentoDeEncomenda('MT0BAZEIDW0FMU', 'sinal'))
      .not.toBe(idDoLancamentoDeEncomenda('MT0BAZEIDW0FMU', 'entrada'));
  });

  it('não deixa passar caractere que quebraria o caminho do documento', () => {
    expect(idDoLancamentoDeEncomenda('a/b c', 'sinal')).toBe('enc-abc-sinal');
  });

  it('encomenda sem id falha alto, em vez de gravar num id inventado', () => {
    expect(() => idDoLancamentoDeEncomenda('', 'sinal')).toThrow();
  });
});
