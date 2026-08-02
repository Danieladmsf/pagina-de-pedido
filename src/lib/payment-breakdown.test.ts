import { describe, expect, it } from 'vitest';
import { faturamentoPorPagamento, nomeDaForma, partesDoPagamento } from './payment-breakdown';

describe('nomeDaForma', () => {
  it('junta o que a base gravou de jeitos diferentes', () => {
    expect(nomeDaForma('Pix')).toBe('Pix');
    expect(nomeDaForma('credito')).toBe('Crédito');
    expect(nomeDaForma('DÉBITO')).toBe('Débito');
    expect(nomeDaForma('conta_casa')).toBe('Prazo');
    expect(nomeDaForma('')).toBe('Não definido');
  });

  it('forma criada pela loja passa direto', () => {
    expect(nomeDaForma('vale refeição')).toBe('Vale refeição');
  });
});

describe('partesDoPagamento', () => {
  it('uma forma só leva o total da venda', () => {
    expect(partesDoPagamento('Pix', 42.5)).toEqual([{ forma: 'Pix', valor: 42.5 }]);
  });

  it('quebra a venda dividida em partes com valor', () => {
    // Caso real da tela (02/08/2026): virava uma "forma de pagamento" própria.
    expect(partesDoPagamento('Pix: R$ 59.30 | Pix: R$ 28.40 | Débito: R$ 38.40', 126.1)).toEqual([
      { forma: 'Pix', valor: 59.3 },
      { forma: 'Pix', valor: 28.4 },
      { forma: 'Débito', valor: 38.4 },
    ]);
  });

  it('nota entre parênteses não vira forma de pagamento', () => {
    expect(partesDoPagamento('Dinheiro (Troco para R$ 50.00)', 32)).toEqual([
      { forma: 'Dinheiro', valor: 32 },
    ]);
    expect(partesDoPagamento('Prazo (Taxa de entrega paga direto ao motoboy)', 80)).toEqual([
      { forma: 'Prazo', valor: 80 },
    ]);
  });

  it('formato legado com + e sem valor declarado não perde dinheiro', () => {
    expect(partesDoPagamento('Pix R$ 25 + Dinheiro R$ 15', 40)).toEqual([
      { forma: 'Pix', valor: 25 },
      { forma: 'Dinheiro', valor: 15 },
    ]);
    // Sem valor em nenhuma parte, o total se reparte entre elas.
    expect(partesDoPagamento('Pix + Dinheiro', 40)).toEqual([
      { forma: 'Pix', valor: 20 },
      { forma: 'Dinheiro', valor: 20 },
    ]);
    // Com valor em uma só, a outra fica com o que sobra.
    expect(partesDoPagamento('Pix: R$ 30.00 | Dinheiro', 50)).toEqual([
      { forma: 'Pix', valor: 30 },
      { forma: 'Dinheiro', valor: 20 },
    ]);
  });

  it('venda sem forma gravada não some do faturamento', () => {
    expect(partesDoPagamento('', 19.9)).toEqual([{ forma: 'Não definido', valor: 19.9 }]);
  });
});

describe('faturamentoPorPagamento', () => {
  it('a parte de cada venda dividida entra na sua forma', () => {
    const linhas = faturamentoPorPagamento([
      { paymentMethod: 'Pix', totalAmount: 100 },
      { paymentMethod: 'Pix: R$ 59.30 | Pix: R$ 28.40 | Débito: R$ 38.40', totalAmount: 126.1 },
      { paymentMethod: 'Dinheiro: R$ 30.00 | Débito: R$ 20.00', totalAmount: 50 },
    ]);

    expect(linhas).toEqual([
      { forma: 'Pix', total: 187.7, vendas: 2 },
      { forma: 'Débito', total: 58.4, vendas: 2 },
      { forma: 'Dinheiro', total: 30, vendas: 1 },
    ]);
  });

  it('o total por forma fecha com o total das vendas', () => {
    const vendas = [
      { paymentMethod: 'Pix: R$ 59.30 | Débito: R$ 38.40', totalAmount: 97.7 },
      { paymentMethod: 'Dinheiro (Troco para R$ 50.00)', totalAmount: 32.35 },
      { paymentMethod: 'credito', totalAmount: 10.05 },
    ];
    const somaDasFormas = faturamentoPorPagamento(vendas).reduce((s, l) => s + l.total, 0);
    const somaDasVendas = vendas.reduce((s, v) => s + v.totalAmount, 0);
    expect(somaDasFormas).toBeCloseTo(somaDasVendas, 2);
  });

  it('sem venda no período, sem linha', () => {
    expect(faturamentoPorPagamento([])).toEqual([]);
  });
});
