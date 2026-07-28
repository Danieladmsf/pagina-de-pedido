import { describe, expect, it } from 'vitest';
import { estaQuitada, saldoAReceber, valorRecebido } from './pagamento';

const enc = (over: any = {}) => ({ total: 240, sinal: 120, ...over });

describe('valorRecebido', () => {
  it('usa valorPago quando existe', () => {
    expect(valorRecebido(enc({ valorPago: 240 }))).toBe(240);
    expect(valorRecebido(enc({ valorPago: 0, sinalLancado: true }))).toBe(0);
  });

  it('encomenda antiga (sem valorPago) cai no comportamento de antes', () => {
    expect(valorRecebido(enc({ sinalLancado: true }))).toBe(120);
    expect(valorRecebido(enc({ sinalLancado: false }))).toBe(0);
    expect(valorRecebido(enc())).toBe(0);
  });

  it('não devolve valor negativo nem quebra sem encomenda', () => {
    expect(valorRecebido(enc({ valorPago: -50 }))).toBe(0);
    expect(valorRecebido(null)).toBe(0);
  });
});

describe('saldoAReceber', () => {
  it('desconta o que já entrou', () => {
    expect(saldoAReceber(enc({ valorPago: 120 }))).toBe(120);
    expect(saldoAReceber(enc({ valorPago: 0 }))).toBe(240);
  });

  it('quem pagou tudo na hora não deve nada na entrega', () => {
    expect(saldoAReceber(enc({ valorPago: 240 }))).toBe(0);
    expect(estaQuitada(enc({ valorPago: 240 }))).toBe(true);
  });

  it('pagou a mais não vira saldo negativo', () => {
    expect(saldoAReceber(enc({ valorPago: 300 }))).toBe(0);
  });

  it('centavo de arredondamento não deixa a conta "quase quitada"', () => {
    expect(saldoAReceber({ total: 91, sinal: 45.5, valorPago: 90.995 })).toBe(0);
  });

  it('encomenda antiga com sinal lançado ainda deve o saldo', () => {
    expect(saldoAReceber(enc({ sinalLancado: true }))).toBe(120);
  });
});
