import { describe, expect, it } from 'vitest';

import { csvDoExtrato, doMaisNovoParaOMaisVelho, montarExtratoDoItem } from './extrato';

/**
 * O caso real: "Palha de Ninho e Brigadeiro", da Gostinho de Céu.
 *
 * Três entradas na mão e seis vendas entre 14/08 e 22/08. Cada entrada gravou
 * quanto o produto tinha antes, e é isso que transforma o extrato em
 * conferência: em 18/08 o app registrou "antes = 3" e em 22/08 "antes = 1" —
 * os dois bateram com o que as vendas deixavam, provando que nada vazou.
 */
const ITEM = '4wgha3zzrhqKbejtCSmn';

const movimento = (createdAt: string, delta: number, stockAfter: number, extra: any = {}) => ({
  id: `m-${createdAt}`,
  itemId: ITEM,
  type: delta >= 0 ? 'entrada' : 'saida',
  delta,
  stockBefore: stockAfter - delta,
  stockAfter,
  userName: 'Gostinho do Céu',
  note: '',
  createdAt: new Date(createdAt),
  ...extra,
});

const venda = (orderDateTime: string, quantidade: number, extra: any = {}) => ({
  id: `o-${orderDateTime}`,
  status: 'delivered',
  source: 'pdv',
  customerName: 'Cliente Balcão',
  orderDateTime,
  stockDeductedItems: { [ITEM]: quantidade },
  ...extra,
});

const palha = () =>
  montarExtratoDoItem({
    itemId: ITEM,
    estoqueAtual: 7,
    movimentos: [
      movimento('2026-08-14T13:20:36Z', 6, 6, { stockBefore: null, note: 'Estoque inicial' }),
      movimento('2026-08-18T13:24:31Z', 3, 6),
      movimento('2026-08-22T16:42:45Z', 6, 7),
    ],
    pedidos: [
      venda('2026-08-14T18:19:05Z', 1),
      venda('2026-08-15T16:11:03Z', 1),
      venda('2026-08-15T19:20:34Z', 1),
      venda('2026-08-18T16:50:53Z', 1),
      venda('2026-08-18T21:20:03Z', 1),
      venda('2026-08-20T13:48:07Z', 3),
    ],
  });

describe('montarExtratoDoItem', () => {
  it('mostra o saldo depois de cada linha, como um extrato bancário', () => {
    const extrato = palha();
    const saldos = extrato.linhas.map((l) => l.saldoDepois);
    expect(saldos).toEqual([6, 5, 4, 3, 6, 5, 4, 1, 7]);
  });

  it('fecha com o estoque de hoje', () => {
    const extrato = palha();
    expect(extrato.saldoFinal).toBe(7);
    expect(extrato.estoqueAtual).toBe(7);
    expect(extrato.diferencaFinal).toBe(0);
  });

  it('conta entradas, saídas e vendas separadamente', () => {
    const extrato = palha();
    expect(extrato.entradas).toBe(15);
    expect(extrato.saidasManuais).toBe(0);
    expect(extrato.vendido).toBe(8);
  });

  it('as duas conferências do caso real fecham', () => {
    const extrato = palha();
    expect(extrato.conferencia).toEqual({ pontos: 2, ok: 2, totalDivergente: 0 });
    expect(extrato.linhas.some((l) => l.diferenca !== undefined)).toBe(false);
  });

  it('aponta o DIA em que sumiu unidade sem passar pelo app', () => {
    // Mesma história, mas duas palhas somem entre 15/08 e 18/08: a entrada de
    // 18/08 registra "antes = 1" onde as vendas deixavam 3.
    const extrato = montarExtratoDoItem({
      itemId: ITEM,
      estoqueAtual: 4,
      movimentos: [
        movimento('2026-08-14T13:20:36Z', 6, 6, { stockBefore: null, note: 'Estoque inicial' }),
        movimento('2026-08-18T13:24:31Z', 3, 4),
      ],
      pedidos: [
        venda('2026-08-14T18:19:05Z', 1),
        venda('2026-08-15T16:11:03Z', 1),
        venda('2026-08-15T19:20:34Z', 1),
      ],
    });

    const apontada = extrato.linhas.find((l) => l.diferenca !== undefined);
    expect(apontada?.quando?.toISOString()).toBe('2026-08-18T13:24:31.000Z');
    expect(apontada?.diferenca).toBe(-2);
    expect(extrato.conferencia).toEqual({ pontos: 1, ok: 0, totalDivergente: -2 });
  });

  it('uma diferença antiga não contamina o resto do extrato', () => {
    const extrato = montarExtratoDoItem({
      itemId: ITEM,
      estoqueAtual: 5,
      movimentos: [
        movimento('2026-08-14T13:00:00Z', 6, 6, { stockBefore: null }),
        movimento('2026-08-16T13:00:00Z', 2, 4), // antes=2, mas as vendas deixavam 5
        movimento('2026-08-18T13:00:00Z', 1, 5), // antes=4: fecha com o anterior
      ],
      pedidos: [venda('2026-08-15T13:00:00Z', 1)],
    });
    expect(extrato.conferencia).toEqual({ pontos: 2, ok: 1, totalDivergente: -3 });
    expect(extrato.linhas.filter((l) => l.diferenca !== undefined)).toHaveLength(1);
    // Reancorou: o final continua batendo com o estoque de hoje.
    expect(extrato.diferencaFinal).toBe(0);
  });

  it('venda anterior ao controle não recebe saldo (o produto era ilimitado)', () => {
    const extrato = montarExtratoDoItem({
      itemId: ITEM,
      estoqueAtual: 6,
      movimentos: [movimento('2026-08-14T13:00:00Z', 6, 6, { stockBefore: null })],
      pedidos: [venda('2026-08-01T13:00:00Z', 4)],
    });
    expect(extrato.linhas[0].tipo).toBe('venda');
    expect(extrato.linhas[0].saldoDepois).toBeNull();
    expect(extrato.conferencia.pontos).toBe(0);
    expect(extrato.diferencaFinal).toBe(0);
  });

  it('pedido cancelado não entra no extrato', () => {
    const extrato = montarExtratoDoItem({
      itemId: ITEM,
      estoqueAtual: 6,
      movimentos: [movimento('2026-08-14T13:00:00Z', 6, 6, { stockBefore: null })],
      pedidos: [venda('2026-08-15T13:00:00Z', 2, { status: 'canceled' })],
    });
    expect(extrato.linhas).toHaveLength(1);
    expect(extrato.vendido).toBe(0);
  });

  it('ignora movimento e venda de outro produto', () => {
    const extrato = montarExtratoDoItem({
      itemId: ITEM,
      estoqueAtual: 6,
      movimentos: [{ ...movimento('2026-08-14T13:00:00Z', 6, 6), itemId: 'outro' }],
      pedidos: [{ ...venda('2026-08-15T13:00:00Z', 2), stockDeductedItems: { outro: 2 } }],
    });
    expect(extrato.linhas).toHaveLength(0);
  });

  it('guarda o pedido para a dona reconhecer a venda', () => {
    const extrato = montarExtratoDoItem({
      itemId: ITEM,
      estoqueAtual: 5,
      movimentos: [movimento('2026-08-14T13:00:00Z', 6, 6, { stockBefore: null })],
      pedidos: [venda('2026-08-15T13:00:00Z', 1, { id: 'KsRq7PaYrg3PWzhDnsBY', customerName: 'Simone', source: 'pdv' })],
    });
    const linha = extrato.linhas.find((l) => l.tipo === 'venda');
    expect(linha?.pedido).toEqual({
      id: 'KsRq7PaYrg3PWzhDnsBY',
      codigo: 'KSRQ7',
      canal: 'PDV',
      cliente: 'Simone',
    });
  });
});

describe('doMaisNovoParaOMaisVelho', () => {
  it('inverte a ordem sem mexer no original', () => {
    const extrato = palha();
    const invertido = doMaisNovoParaOMaisVelho(extrato.linhas);
    expect(invertido[0].saldoDepois).toBe(7);
    expect(extrato.linhas[0].saldoDepois).toBe(6);
  });
});

describe('csvDoExtrato', () => {
  it('sai com resumo, cabeçalho e a linha mais nova primeiro', () => {
    const csv = csvDoExtrato(palha(), 'Palha de Ninho e Brigadeiro');
    const linhas = csv.split('\n');
    // Ponto-e-vírgula e BOM: é o que abre certo no Excel em português.
    expect(csv.startsWith('﻿')).toBe(true);
    expect(linhas[0]).toContain('Palha de Ninho e Brigadeiro');
    expect(linhas[1]).toBe('Estoque hoje;7');
    expect(linhas[2]).toBe('Entradas;15;Saidas;0;Vendido;8');
    expect(linhas[4]).toBe('Quando;Tipo;Quantidade;Ficou com;Quem;Pedido;Cliente;Observacao');
    // A mais nova é a entrada de 22/08, que deixou 7.
    expect(linhas[5]).toContain('Entrada;+6;7');
  });

  it('escapa o nome do cliente que tem aspas ou ponto-e-vírgula', () => {
    const extrato = montarExtratoDoItem({
      itemId: ITEM,
      estoqueAtual: 5,
      movimentos: [movimento('2026-08-14T13:00:00Z', 6, 6, { stockBefore: null })],
      pedidos: [venda('2026-08-15T13:00:00Z', 1, { customerName: 'Ana "Nina"; Silva' })],
    });
    expect(csvDoExtrato(extrato, 'X')).toContain('"Ana ""Nina""; Silva"');
  });
});
