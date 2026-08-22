import { describe, expect, it } from 'vitest';

import {
  faturamentoDoPeriodo,
  origemDoLancamento,
  pedidosJaNoCaixa,
  porFormaDePagamento,
  resumoDeVendasDoCaixa,
  vendasDoPeriodo,
} from './faturamento';

/**
 * O caso real que motivou esta lib (Gostinho de Céu, 22/08/2026):
 *
 * O Dashboard mostrava R$ 181,00 de vendas num dia em que o caixa tinha
 * R$ 441,00. A diferença eram duas encomendas entregues (R$ 100 + R$ 160), que
 * vivem em `encomendas` e nunca estiveram em `orders`. Os testes abaixo travam
 * exatamente esse dia, e as três armadilhas em volta dele: fiado recebido não é
 * venda nova, venda cancelada não conta, e pedido lançado no caixa não pode
 * entrar duas vezes.
 */

const venda = (extra: any = {}) => ({
  id: extra.id || Math.random().toString(36).slice(2),
  tipo: 'venda',
  titulo: 'PDV #ABCDE - Balcão',
  valor: 10,
  formaPagamento: 'dinheiro',
  data: new Date('2026-08-22T15:00:00Z'),
  ...extra,
});

const dia = (iso: string) => new Date(iso);

describe('origemDoLancamento', () => {
  it('separa pedido, encomenda, fiado recebido e venda avulsa', () => {
    expect(origemDoLancamento(venda({ orderId: 'o1' }))).toBe('pedido');
    expect(origemDoLancamento(venda({ titulo: 'PDV #ZYKV9 - Balcão' }))).toBe('pedido');
    expect(origemDoLancamento(venda({ encomendaId: 'e1', titulo: 'x' }))).toBe('encomenda');
    // Lançamento antigo de encomenda: só o título, sem id gravado.
    expect(origemDoLancamento(venda({ titulo: 'Encomenda ZEQ5P - Entrega (Agda)' }))).toBe('encomenda');
    expect(origemDoLancamento(venda({ titulo: 'Acerto de Prazo - Kenia' }))).toBe('fiado_recebido');
    expect(origemDoLancamento(venda({ titulo: 'Venda balcão' }))).toBe('avulsa');
  });

  it('acerto de prazo vence a busca por "#" no título', () => {
    expect(origemDoLancamento(venda({ titulo: 'Acerto de Prazo - Ana #A1B2C' }))).toBe('fiado_recebido');
  });
});

describe('resumoDeVendasDoCaixa', () => {
  it('soma o dia real de 22/08: R$ 181 de pedidos + R$ 260 de encomendas = R$ 441', () => {
    const resumo = resumoDeVendasDoCaixa([
      venda({ tipo: 'abertura', titulo: 'Abertura de Caixa', valor: 12, formaPagamento: '--' }),
      venda({ titulo: 'Encomenda MT0BA - Entrega (AGDA)', valor: 100, formaPagamento: 'debito', encomendaId: 'MT0BA' }),
      venda({ titulo: 'Encomenda ZEQ5P - Entrega (Agda)', valor: 160, formaPagamento: 'debito', encomendaId: 'ZEQ5P' }),
      venda({ titulo: 'PDV #C9P4V - Balcão', valor: 40, formaPagamento: 'pix' }),
      venda({ titulo: 'Delivery #NMO87 - Samantha', valor: 38, formaPagamento: 'debito' }),
      venda({ titulo: 'PDV #ZYKV9 - Balcão', valor: 16, formaPagamento: 'dinheiro' }),
      venda({ titulo: 'PDV #AZ6MB - Balcão', valor: 20, formaPagamento: 'dinheiro' }),
      venda({ titulo: 'PDV #H1PRQ - Balcão', valor: 26, formaPagamento: 'debito' }),
      venda({ titulo: 'PDV #5IW45 - Balcão', valor: 41, formaPagamento: 'credito' }),
    ]);

    expect(resumo.totalVendas).toBe(441);
    expect(resumo.porOrigem.encomenda).toBe(260);
    expect(resumo.porOrigem.pedido).toBe(181);
    expect(resumo.fiadoRecebido).toBe(0);
  });

  it('abertura, sangria e suprimento não são venda', () => {
    const resumo = resumoDeVendasDoCaixa([
      venda({ tipo: 'abertura', valor: 100 }),
      venda({ tipo: 'sangria', valor: -50 }),
      venda({ tipo: 'suprimento', valor: 30 }),
      venda({ valor: 25 }),
    ]);
    expect(resumo.totalVendas).toBe(25);
  });

  it('venda cancelada fica fora de todos os totais', () => {
    const resumo = resumoDeVendasDoCaixa([
      venda({ valor: 30 }),
      venda({ valor: 70, canceled: true }),
    ]);
    expect(resumo.totalVendas).toBe(30);
    expect(resumo.totalRecebido).toBe(30);
  });

  it('fiado recebido entra separado: não é venda nova, mas o dinheiro entrou', () => {
    const resumo = resumoDeVendasDoCaixa([
      venda({ valor: 100, formaPagamento: 'dinheiro' }),
      venda({ titulo: 'Acerto de Prazo - Kenia', valor: 93, formaPagamento: 'pix' }),
    ]);
    expect(resumo.totalVendas).toBe(100);
    expect(resumo.fiadoRecebido).toBe(93);
    // O card da tela soma os dois: é o que a gaveta e as formas mostram.
    expect(resumo.totalRecebido).toBe(193);
  });

  it('respeita a janela de datas, com o fim exclusivo', () => {
    const resumo = resumoDeVendasDoCaixa(
      [
        venda({ valor: 10, data: dia('2026-08-21T23:59:00Z') }),
        venda({ valor: 20, data: dia('2026-08-22T10:00:00Z') }),
        venda({ valor: 40, data: dia('2026-08-23T00:00:00Z') }),
      ],
      { de: dia('2026-08-22T00:00:00Z'), ate: dia('2026-08-23T00:00:00Z') },
    );
    expect(resumo.totalVendas).toBe(20);
  });

  it('soma centavos sem resíduo de ponto flutuante', () => {
    const resumo = resumoDeVendasDoCaixa([
      venda({ valor: 0.1 }), venda({ valor: 0.2 }),
    ]);
    expect(resumo.totalVendas).toBe(0.3);
  });
});

describe('pedidosJaNoCaixa', () => {
  const pedidos = [
    { id: 'C9P4Vabc', createdAt: '2026-08-22T14:00:00Z' },
    { id: 'ZYKV9xyz', createdAt: '2026-08-22T14:30:00Z' },
  ];

  it('reconhece o pedido pelo orderId gravado', () => {
    const cobertos = pedidosJaNoCaixa([venda({ orderId: 'C9P4Vabc', titulo: 'qualquer' })], pedidos);
    expect([...cobertos]).toEqual(['C9P4Vabc']);
  });

  it('reconhece o pedido antigo pelo "#" do título', () => {
    const cobertos = pedidosJaNoCaixa(
      [venda({ titulo: 'PDV #ZYKV9 - Balcão', data: dia('2026-08-22T15:00:00Z') })],
      pedidos,
    );
    expect([...cobertos]).toEqual(['ZYKV9xyz']);
  });

  it('não casa pedido criado DEPOIS do lançamento', () => {
    const cobertos = pedidosJaNoCaixa(
      [venda({ titulo: 'PDV #ZYKV9 - Balcão', data: dia('2026-08-22T13:00:00Z') })],
      pedidos,
    );
    expect(cobertos.size).toBe(0);
  });

  it('encomenda e acerto de prazo não cobrem pedido nenhum', () => {
    const cobertos = pedidosJaNoCaixa(
      [
        venda({ encomendaId: 'e1', titulo: 'Encomenda C9P4V - Entrega' }),
        venda({ titulo: 'Acerto de Prazo - Ana' }),
      ],
      pedidos,
    );
    expect(cobertos.size).toBe(0);
  });
});

describe('faturamentoDoPeriodo', () => {
  const janela = { de: dia('2026-08-22T00:00:00Z'), ate: dia('2026-08-23T00:00:00Z') };

  it('não conta duas vezes o pedido que já está no caixa', () => {
    const pedidos = [{ id: 'C9P4Vabc', status: 'delivered', totalAmount: 40, orderDateTime: '2026-08-22T14:00:00Z' }];
    const total = faturamentoDoPeriodo({
      lancamentos: [venda({ orderId: 'C9P4Vabc', valor: 40, formaPagamento: 'pix' })],
      pedidos,
      ...janela,
    });
    expect(total.totalVendas).toBe(40);
    expect(total.foraDoCaixa).toBe(0);
  });

  it('no dia em que o caixa foi usado, o caixa é a conta', () => {
    // O pedido "semCaixa" quase certamente ESTÁ no caixa: a comanda de mesa
    // antiga vira "Mesa 5 - Finalizada", sem id e sem "#". Somar os dois lados
    // dobraria o almoço — são 188 lançamentos assim na Sucos e Vitaminas.
    const total = faturamentoDoPeriodo({
      lancamentos: [venda({ orderId: 'outro', valor: 40 })],
      pedidos: [
        { id: 'outro', status: 'delivered', totalAmount: 40, orderDateTime: '2026-08-22T14:00:00Z' },
        { id: 'semCaixa', status: 'delivered', totalAmount: 25, orderDateTime: '2026-08-22T16:00:00Z' },
      ],
      ...janela,
    });
    expect(total.totalVendas).toBe(40);
    expect(total.foraDoCaixa).toBe(0);
  });

  it('o pedido do dia SEM caixa nenhum entra na conta', () => {
    const total = faturamentoDoPeriodo({
      lancamentos: [venda({ orderId: 'ontem', valor: 40, data: dia('2026-08-21T14:00:00Z') })],
      pedidos: [
        { id: 'ontem', status: 'delivered', totalAmount: 40, orderDateTime: '2026-08-21T14:00:00Z' },
        { id: 'hoje', status: 'delivered', totalAmount: 25, orderDateTime: '2026-08-22T16:00:00Z' },
      ],
      de: dia('2026-08-21T00:00:00Z'),
      ate: dia('2026-08-23T00:00:00Z'),
    });
    expect(total.totalVendas).toBe(65);
    expect(total.foraDoCaixa).toBe(25);
  });

  it('loja que ainda não usa caixa continua vendo o faturamento dos pedidos', () => {
    const total = faturamentoDoPeriodo({
      lancamentos: [],
      pedidos: [
        { id: 'a', status: 'delivered', totalAmount: 30, orderDateTime: '2026-08-22T14:00:00Z' },
        { id: 'b', status: 'received', totalAmount: 12, orderDateTime: '2026-08-22T15:00:00Z' },
      ],
      ...janela,
    });
    expect(total.totalVendas).toBe(42);
  });

  it('pedido cancelado não entra', () => {
    const total = faturamentoDoPeriodo({
      lancamentos: [],
      pedidos: [{ id: 'a', status: 'canceled', totalAmount: 30, orderDateTime: '2026-08-22T14:00:00Z' }],
      ...janela,
    });
    expect(total.totalVendas).toBe(0);
  });

  it('encomenda cancelada usa a outra grafia e também fica de fora', () => {
    const total = faturamentoDoPeriodo({
      lancamentos: [],
      pedidos: [{ id: 'e1', status: 'cancelada', totalAmount: 200, orderDateTime: '2026-08-22T14:00:00Z' }],
      ...janela,
    });
    expect(total.totalVendas).toBe(0);
  });

  it('o dia inteiro da Gostinho: R$ 181 de pedidos + R$ 260 de encomendas', () => {
    const total = faturamentoDoPeriodo({
      lancamentos: [
        venda({ titulo: 'Encomenda MT0BA - Entrega', valor: 100, formaPagamento: 'debito', encomendaId: 'MT0BA' }),
        venda({ titulo: 'Encomenda ZEQ5P - Entrega', valor: 160, formaPagamento: 'debito', encomendaId: 'ZEQ5P' }),
        venda({ orderId: 'p1', valor: 40, formaPagamento: 'pix' }),
        venda({ orderId: 'p2', valor: 141, formaPagamento: 'debito' }),
      ],
      pedidos: [
        { id: 'p1', status: 'delivered', totalAmount: 40, orderDateTime: '2026-08-22T15:00:00Z' },
        { id: 'p2', status: 'delivered', totalAmount: 141, orderDateTime: '2026-08-22T16:00:00Z' },
      ],
      ...janela,
    });
    expect(total.totalVendas).toBe(441);
    expect(total.porOrigem.encomenda).toBe(260);
    expect(total.porOrigem.pedido).toBe(181);
  });
});

describe('contarVendas', () => {
  const janela = { de: dia('2026-08-22T00:00:00Z'), ate: dia('2026-08-23T00:00:00Z') };

  it('venda dividida em duas formas conta como UMA venda', () => {
    const total = faturamentoDoPeriodo({
      lancamentos: [
        venda({ orderId: 'p1', valor: 59.3, formaPagamento: 'pix' }),
        venda({ orderId: 'p1', valor: 38.4, formaPagamento: 'debito' }),
      ],
      pedidos: [{ id: 'p1', status: 'delivered', totalAmount: 97.7, orderDateTime: '2026-08-22T15:00:00Z' }],
      ...janela,
    });
    expect(total.totalVendas).toBe(97.7);
    expect(total.quantidade).toBe(1);
  });

  it('sinal e entrega da mesma encomenda contam como uma venda só', () => {
    const total = faturamentoDoPeriodo({
      lancamentos: [
        venda({ titulo: 'Encomenda ZEQ5P - Sinal', valor: 160, encomendaId: 'ZEQ5PNX4' }),
        venda({ titulo: 'Encomenda ZEQ5P - Entrega', valor: 160, encomendaId: 'ZEQ5PNX4' }),
      ],
      pedidos: [],
      ...janela,
    });
    expect(total.totalVendas).toBe(320);
    expect(total.quantidade).toBe(1);
  });

  it('fiado recebido não conta como venda na quantidade', () => {
    const total = faturamentoDoPeriodo({
      lancamentos: [
        venda({ orderId: 'p1', valor: 40 }),
        venda({ titulo: 'Acerto de Prazo - Ana', valor: 93, formaPagamento: 'pix' }),
      ],
      pedidos: [],
      ...janela,
    });
    expect(total.quantidade).toBe(1);
    expect(total.fiadoRecebido).toBe(93);
  });
});

describe('vendasDoPeriodo', () => {
  const janela = { de: dia('2026-08-22T00:00:00Z'), ate: dia('2026-08-23T00:00:00Z') };

  it('devolve uma linha por venda, com o documento de origem', () => {
    const pedido = { id: 'p1', status: 'delivered', totalAmount: 97.7, orderDateTime: '2026-08-22T15:00:00Z' };
    const encomenda = { id: 'ZEQ5PNX4', customerName: 'Agda' };
    const vendas = vendasDoPeriodo({
      lancamentos: [
        venda({ orderId: 'p1', valor: 59.3, formaPagamento: 'pix' }),
        venda({ orderId: 'p1', valor: 38.4, formaPagamento: 'debito' }),
        venda({ titulo: 'Encomenda ZEQ5P - Entrega', valor: 160, formaPagamento: 'debito' }),
      ],
      pedidos: [pedido],
      encomendas: [encomenda],
      ...janela,
    });

    expect(vendas).toHaveLength(2);
    const doPedido = vendas.find((v) => v.vinculo === 'o:p1');
    expect(doPedido?.valor).toBe(97.7);
    expect(doPedido?.formas).toEqual(['Pix', 'Débito']);
    expect(doPedido?.documento).toBe(pedido);
    // Lançamento antigo guarda só o prefixo no título: acha a encomenda mesmo assim.
    const daEncomenda = vendas.find((v) => v.origem === 'encomenda');
    expect(daEncomenda?.valor).toBe(160);
    expect(daEncomenda?.documento).toBe(encomenda);
  });

  it('venda avulsa sem vínculo continua aparecendo, sem documento', () => {
    const vendas = vendasDoPeriodo({
      lancamentos: [venda({ titulo: 'Venda balcão', valor: 12 })],
      pedidos: [],
      ...janela,
    });
    expect(vendas).toHaveLength(1);
    expect(vendas[0].documento).toBeNull();
    expect(vendas[0].origem).toBe('avulsa');
  });

  it('fiado recebido não vira venda', () => {
    const vendas = vendasDoPeriodo({
      lancamentos: [venda({ titulo: 'Acerto de Prazo - Ana', valor: 93 })],
      pedidos: [],
      ...janela,
    });
    expect(vendas).toHaveLength(0);
  });

  it('a soma das vendas é o mesmo total do faturamento do período', () => {
    const entrada = {
      lancamentos: [
        venda({ titulo: 'Encomenda MT0BA - Entrega', valor: 100, formaPagamento: 'debito' }),
        venda({ orderId: 'p1', valor: 40, formaPagamento: 'pix' }),
      ],
      pedidos: [
        { id: 'p1', status: 'delivered', totalAmount: 40, orderDateTime: '2026-08-22T15:00:00Z' },
        { id: 'p2', status: 'delivered', totalAmount: 25, orderDateTime: '2026-08-22T16:00:00Z' },
      ],
      ...janela,
    };
    const soma = vendasDoPeriodo(entrada).reduce((s, v) => s + v.valor, 0);
    expect(soma).toBe(faturamentoDoPeriodo(entrada).totalVendas);
    // 100 da encomenda + 40 do pedido lançado. O "p2" não entra: houve caixa
    // nesse dia, e o que não está lá não pode ser somado por fora sem risco de
    // dobrar uma venda que o caixa já tem sem vínculo.
    expect(soma).toBe(140);
  });
});

describe('porFormaDePagamento', () => {
  it('agrupa pela forma canônica e deixa o fiado de fora por padrão', () => {
    const { entradas } = resumoDeVendasDoCaixa([
      venda({ valor: 100, formaPagamento: 'debito' }),
      venda({ valor: 60, formaPagamento: 'Débito' }),
      venda({ valor: 40, formaPagamento: 'pix' }),
      venda({ titulo: 'Acerto de Prazo - Ana', valor: 93, formaPagamento: 'pix' }),
    ]);
    expect(porFormaDePagamento(entradas)).toEqual([
      { forma: 'Débito', total: 160, vendas: 2 },
      { forma: 'Pix', total: 40, vendas: 1 },
    ]);
    expect(porFormaDePagamento(entradas, { incluirFiado: true })[1]).toEqual({
      forma: 'Pix', total: 133, vendas: 2,
    });
  });

  it('conta_casa e prazo são a mesma linha', () => {
    const { entradas } = resumoDeVendasDoCaixa([
      venda({ valor: 30, formaPagamento: 'conta_casa' }),
      venda({ valor: 20, formaPagamento: 'prazo' }),
    ]);
    expect(porFormaDePagamento(entradas)).toEqual([{ forma: 'Prazo', total: 50, vendas: 2 }]);
  });
});
