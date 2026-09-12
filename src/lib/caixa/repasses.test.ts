import { describe, expect, it } from 'vitest';
import { saiDaGaveta, totalEmDinheiro, totalForaDaGaveta, valorDoRepasse } from './repasses';

describe('saiDaGaveta', () => {
  it('dinheiro sai da gaveta', () => {
    expect(saiDaGaveta('dinheiro')).toBe(true);
    expect(saiDaGaveta('Dinheiro')).toBe(true);
  });

  it('pix e cartão não saem da gaveta', () => {
    expect(saiDaGaveta('pix')).toBe(false);
    expect(saiDaGaveta('debito')).toBe(false);
    expect(saiDaGaveta('credito')).toBe(false);
  });

  it('sem forma declarada é dinheiro: todo fechamento antes de 09/2026 era', () => {
    expect(saiDaGaveta(undefined)).toBe(true);
    expect(saiDaGaveta('')).toBe(true);
  });
});

describe('valorDoRepasse', () => {
  it('o pago manda sobre o total', () => {
    expect(valorDoRepasse({ valorPago: 30, total: 80 })).toBe(30);
  });

  it('sem valorPago cai no total (cupom antigo)', () => {
    expect(valorDoRepasse({ total: 80 })).toBe(80);
  });

  it('pagamento adiado não vale nada', () => {
    expect(valorDoRepasse({ valorPago: 0, total: 80 })).toBe(0);
    expect(valorDoRepasse({})).toBe(0);
  });
});

describe('totalEmDinheiro', () => {
  it('separa o que saiu da gaveta do que foi por Pix', () => {
    const repasses = [
      { valorPago: 74, formaPagamento: 'dinheiro' },
      { valorPago: 55, formaPagamento: 'pix' },
      { valorPago: 20, formaPagamento: 'dinheiro' },
    ];
    expect(totalEmDinheiro(repasses)).toBe(94);
    expect(totalForaDaGaveta(repasses)).toBe(55);
  });

  it('o caso da Lima Limão: semana inteira por Pix não tira nada da gaveta', () => {
    const repasses = [{ valorPago: 4162.6, formaPagamento: 'pix' }];
    expect(totalEmDinheiro(repasses)).toBe(0);
    expect(totalForaDaGaveta(repasses)).toBe(4162.6);
  });

  it('fechamento legado (sem forma) continua saindo todo da gaveta', () => {
    const repasses = [{ valorPago: 45 }, { total: 30 }];
    expect(totalEmDinheiro(repasses)).toBe(75);
    expect(totalForaDaGaveta(repasses)).toBe(0);
  });

  it('lista vazia é zero nos dois lados', () => {
    expect(totalEmDinheiro([])).toBe(0);
    expect(totalForaDaGaveta([])).toBe(0);
  });
});
