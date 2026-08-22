import { describe, expect, it } from 'vitest';

import { faturamentoDoPeriodo, vendasDoPeriodo } from './faturamento';
import dados from './__fixtures__/gostinho-22-08.json';

/**
 * O dia que expôs o problema, com os dados de produção (nomes trocados).
 *
 * 22/08/2026, Gostinho de Céu: o Dashboard mostrava a soma da coleção `orders`
 * e ignorava as duas encomendas entregues naquela manhã. Este teste é a régua —
 * o número da tela tem que ser o mesmo que o caixa fecha, com encomenda dentro.
 */
const lancamentos = dados.lancamentos as any[];
const pedidos = dados.orders as any[];
const encomendas = dados.encomendas as any[];
const janela = { de: new Date('2026-08-22T00:00:00Z'), ate: new Date('2026-08-23T00:00:00Z') };

/** O que a tela fazia antes: somar `orders` e mais nada. */
const somaAntiga = pedidos
  .filter((o) => o.status !== 'canceled')
  .reduce((soma, o) => soma + (Number(o.totalAmount) || 0), 0);

/** A verdade da gaveta: os lançamentos de venda daquele caixa. */
const somaDoCaixa = lancamentos
  .filter((l) => l.tipo === 'venda' && !l.canceled)
  .reduce((soma, l) => soma + (Number(l.valor) || 0), 0);

describe('faturamento com os dados reais de 22/08/2026', () => {
  it('o Dashboard passa a fechar com o caixa, no centavo', () => {
    const faturamento = faturamentoDoPeriodo({ lancamentos, pedidos, ...janela });
    expect(faturamento.totalVendas).toBe(somaDoCaixa);
  });

  it('as encomendas que a tela escondia são R$ 260,00 do dia', () => {
    const faturamento = faturamentoDoPeriodo({ lancamentos, pedidos, ...janela });
    expect(faturamento.porOrigem.encomenda).toBe(260);
    // Era exatamente esta diferença que a dona somava na mão.
    expect(faturamento.totalVendas - somaAntiga).toBe(260);
    expect(somaAntiga).toBe(189);
    expect(faturamento.totalVendas).toBe(449);
  });

  it('nenhum pedido é contado duas vezes: todos foram lançados no caixa', () => {
    const faturamento = faturamentoDoPeriodo({ lancamentos, pedidos, ...janela });
    expect(faturamento.foraDoCaixa).toBe(0);
    // 7 pedidos + 2 encomendas, e a abertura de caixa não é venda.
    expect(faturamento.quantidade).toBe(9);
  });

  it('cada venda acha o documento que a originou', () => {
    const vendas = vendasDoPeriodo({ lancamentos, pedidos, encomendas, ...janela });
    expect(vendas).toHaveLength(9);
    expect(vendas.every((v) => v.documento !== null)).toBe(true);
    expect(vendas.filter((v) => v.origem === 'encomenda')).toHaveLength(2);
  });
});
