import { describe, expect, it } from 'vitest';
import {
  allocatePayment,
  buildItemsCsv,
  buildStatement,
  buildStatementCsv,
  exportFileName,
  findPaymentTransaction,
  legacyOrderRef,
  matchOrderForTransaction,
  missingOrderRefs,
  statementTotals,
  type CreditTransaction,
} from './prazo-statement';

const tx = (over: Partial<CreditTransaction>): CreditTransaction => ({
  id: 'tx',
  type: 'debit',
  amount: 10,
  date: '2026-07-01T12:00:00.000Z',
  ...over,
});

describe('buildStatement', () => {
  it('ordena por data e acumula o saldo lançamento a lançamento', () => {
    const rows = buildStatement([
      tx({ id: 'b', amount: 30, date: '2026-07-02T10:00:00.000Z' }),
      tx({ id: 'a', amount: 50, date: '2026-07-01T10:00:00.000Z' }),
      tx({ id: 'c', type: 'credit', amount: 20, date: '2026-07-03T10:00:00.000Z' }),
    ]);

    expect(rows.map((row) => row.tx.id)).toEqual(['a', 'b', 'c']);
    expect(rows.map((row) => row.balanceAfter)).toEqual([50, 80, 60]);
  });

  it('não quebra com data ausente ou inválida', () => {
    const rows = buildStatement([tx({ id: 'sem-data', date: '' }), tx({ id: 'ok', amount: 5 })]);
    expect(rows).toHaveLength(2);
    expect(rows[rows.length - 1].balanceAfter).toBeCloseTo(15);
  });
});

describe('vínculo com o pedido', () => {
  const orders = [
    { id: 'ab12cXYZ', items: [], orderDateTime: '2026-07-01T10:00:00.000Z' },
    { id: 'zz999abc', items: [], orderDateTime: '2026-07-01T10:00:00.000Z' },
  ];

  it('usa o orderId quando o lançamento tem o campo novo', () => {
    expect(matchOrderForTransaction(tx({ orderId: 'zz999abc' }), orders)?.id).toBe('zz999abc');
  });

  it('não mistura collections quando pedido e encomenda têm o mesmo id', () => {
    const pedido = { id: 'mesmo-id', items: [] };
    const encomenda = { id: 'mesmo-id', items: [], origem: 'encomenda' };

    expect(matchOrderForTransaction(tx({ orderId: 'mesmo-id' }), [encomenda, pedido])).toBe(pedido);
    expect(matchOrderForTransaction(tx({ encomendaId: 'mesmo-id' }), [pedido, encomenda])).toBe(encomenda);
  });

  it('cai no prefixo da descrição para os lançamentos antigos', () => {
    expect(legacyOrderRef('PDV #ab12c')).toBe('ab12c');
    expect(matchOrderForTransaction(tx({ description: 'PDV #ab12c' }), orders)?.id).toBe('ab12cXYZ');
  });

  it('não casa o prefixo com um pedido criado depois do lançamento', () => {
    const orderFuturo = { id: 'ab12cFUTURO', orderDateTime: '2026-07-02T10:00:00.000Z' };
    expect(matchOrderForTransaction(tx({ description: 'PDV #ab12c' }), [orderFuturo])).toBeNull();
  });

  it('lançamento de mesa (sem "#") não casa com pedido nenhum', () => {
    expect(legacyOrderRef('Mesa 5')).toBe('');
    expect(matchOrderForTransaction(tx({ description: 'Mesa 5' }), orders)).toBeNull();
  });

  it('orderId que não está na lista não cai no prefixo por engano', () => {
    expect(matchOrderForTransaction(tx({ orderId: 'sumiu', description: 'PDV #ab12c' }), orders)).toBeNull();
  });

  it('fallback legado ignora encomenda com o mesmo prefixo', () => {
    const encomenda = {
      id: 'ab12c-encomenda',
      origem: 'encomenda',
      orderDateTime: '2026-07-01T09:00:00.000Z',
    };
    expect(matchOrderForTransaction(tx({ description: 'PDV #ab12c' }), [...orders, encomenda])?.id)
      .toBe('ab12cXYZ');
  });
});

/**
 * O caso real: a compra de 23/07 não abria no extrato porque o pedido tinha o
 * telefone gravado como "(16)992156780" e a busca por telefone não o trouxe.
 * O extrato já sabia o pedido ("PDV #lstG2") — faltava ir buscá-lo pelo id.
 */
describe('missingOrderRefs', () => {
  const orders = [{ id: 'ab12cXYZ', items: [], orderDateTime: '2026-07-01T10:00:00.000Z' }];

  it('devolve o prefixo da compra antiga cujo pedido não veio na lista', () => {
    const faltando = missingOrderRefs([
      tx({ id: '1', description: 'PDV #ab12c' }),
      tx({ id: '2', description: 'PDV #lstG2' }),
    ], orders);

    expect(faltando).toEqual({ ids: [], prefixes: ['lstG2'] });
  });

  it('devolve o orderId quando o lançamento é dos novos', () => {
    expect(missingOrderRefs([tx({ id: '1', orderId: 'sumiu' })], orders)).toEqual({
      ids: ['sumiu'],
      prefixes: [],
    });
  });

  it('ignora pagamentos e lançamentos sem pedido nenhum (mesa, acerto)', () => {
    expect(missingOrderRefs([
      tx({ id: '1', type: 'credit', amount: 20, description: 'Pagamento recebido (pix)' }),
      tx({ id: '2', description: 'Mesa 5' }),
    ], orders)).toEqual({ ids: [], prefixes: [] });
  });

  it('não repete o mesmo pedido quando duas compras apontam para ele', () => {
    expect(missingOrderRefs([
      tx({ id: '1', description: 'PDV #lstG2' }),
      tx({ id: '2', description: 'PDV #lstG2' }),
    ], orders).prefixes).toEqual(['lstG2']);
  });
});

describe('statementTotals', () => {
  it('separa compras de pagamentos e calcula o ticket médio', () => {
    const totals = statementTotals(buildStatement([
      tx({ id: 'a', amount: 50, date: '2026-07-01T10:00:00.000Z' }),
      tx({ id: 'b', amount: 30, date: '2026-07-02T10:00:00.000Z' }),
      tx({ id: 'c', type: 'credit', amount: 20, date: '2026-07-03T10:00:00.000Z' }),
    ]));

    expect(totals.totalPurchases).toBe(80);
    expect(totals.totalPaid).toBe(20);
    expect(totals.balance).toBe(60);
    expect(totals.purchaseCount).toBe(2);
    expect(totals.averageTicket).toBe(40);
  });

  it('pagamento total zera a idade da dívida; a compra seguinte reabre', () => {
    const totals = statementTotals(buildStatement([
      tx({ id: 'a', amount: 50, date: '2026-05-01T10:00:00.000Z' }),
      tx({ id: 'b', type: 'credit', amount: 50, date: '2026-06-01T10:00:00.000Z' }),
      tx({ id: 'c', amount: 40, date: '2026-07-10T10:00:00.000Z' }),
    ]));

    expect(totals.balance).toBe(40);
    expect(totals.debtSince?.toISOString()).toBe('2026-07-10T10:00:00.000Z');
  });

  it('cliente quite não tem dívida datada', () => {
    const totals = statementTotals(buildStatement([
      tx({ id: 'a', amount: 50 }),
      tx({ id: 'b', type: 'credit', amount: 50, date: '2026-07-02T10:00:00.000Z' }),
    ]));

    expect(totals.balance).toBe(0);
    expect(totals.debtSince).toBeNull();
  });

  it('extrato vazio devolve saldo zero', () => {
    const totals = statementTotals([]);
    expect(totals.balance).toBe(0);
    expect(totals.averageTicket).toBe(0);
  });
});

describe('allocatePayment', () => {
  it('caso real da Luciana: o acerto de R$ 64 quitou a compra de 03/07', () => {
    // Extrato de produção (Gostinho de Céu, cliente ...107): compra em 03/07,
    // acerto em 30/07 e uma compra nova 7 minutos depois do acerto.
    const extrato = [
      tx({ id: 'compra-jul', amount: 64, description: 'PDV #r8DFZ', date: '2026-07-03T20:11:01.450Z' }),
      tx({ id: 'acerto', type: 'credit', amount: 64, description: 'Pagamento recebido (PIX)', date: '2026-07-30T19:41:52.621Z' }),
      tx({ id: 'compra-nova', amount: 57, description: 'PDV #Ie0Vt', date: '2026-07-30T19:48:20.834Z' }),
    ];

    const alloc = allocatePayment(extrato, 'acerto', [{
      id: 'r8DFZabc',
      items: [],
      orderDateTime: '2026-07-03T20:00:00.000Z',
    }])!;

    expect(alloc.balanceBefore).toBe(64);
    expect(alloc.balanceAfter).toBe(0);
    expect(alloc.leftover).toBe(0);
    expect(alloc.covered).toHaveLength(1);
    expect(alloc.covered[0].tx.id).toBe('compra-jul');
    expect(alloc.covered[0].applied).toBe(64);
    expect(alloc.covered[0].settled).toBe(true);
    // A compra FEITA DEPOIS do acerto não pode aparecer como quitada por ele.
    expect(alloc.covered.map((c) => c.tx.id)).not.toContain('compra-nova');
    expect(alloc.covered[0].order?.id).toBe('r8DFZabc');
  });

  it('quita da compra mais antiga para a mais nova e marca a parcial', () => {
    const extrato = [
      tx({ id: 'c1', amount: 30, date: '2026-07-01T10:00:00.000Z' }),
      tx({ id: 'c2', amount: 50, date: '2026-07-02T10:00:00.000Z' }),
      tx({ id: 'pag', type: 'credit', amount: 45, date: '2026-07-03T10:00:00.000Z' }),
    ];

    const alloc = allocatePayment(extrato, 'pag')!;

    expect(alloc.balanceBefore).toBe(80);
    expect(alloc.balanceAfter).toBe(35);
    expect(alloc.covered).toEqual([
      expect.objectContaining({ applied: 30, amount: 30, settled: true }),
      expect.objectContaining({ applied: 15, amount: 50, settled: false }),
    ]);
  });

  it('pagamento maior que a dívida deixa a sobra como crédito a favor', () => {
    const extrato = [
      tx({ id: 'c1', amount: 20, date: '2026-07-01T10:00:00.000Z' }),
      tx({ id: 'pag', type: 'credit', amount: 50, date: '2026-07-02T10:00:00.000Z' }),
    ];

    const alloc = allocatePayment(extrato, 'pag')!;

    expect(alloc.leftover).toBe(30);
    expect(alloc.balanceAfter).toBe(-30);
    expect(alloc.covered).toHaveLength(1);
  });

  it('pagamento em conta sem dívida não inventa compra quitada', () => {
    // Foi o caso da conta que afundou até -R$ 96: baixa repetida sem dívida.
    const extrato = [
      tx({ id: 'c1', amount: 24, date: '2026-07-01T10:00:00.000Z' }),
      tx({ id: 'pag1', type: 'credit', amount: 24, date: '2026-07-02T10:00:00.000Z' }),
      tx({ id: 'pag2', type: 'credit', amount: 24, date: '2026-07-02T10:05:00.000Z' }),
    ];

    const alloc = allocatePayment(extrato, 'pag2')!;

    expect(alloc.covered).toEqual([]);
    expect(alloc.balanceBefore).toBe(0);
    expect(alloc.leftover).toBe(24);
    expect(alloc.balanceAfter).toBe(-24);
  });

  it('crédito a favor de um pagamento anterior abate a compra seguinte', () => {
    const extrato = [
      tx({ id: 'pag-adiantado', type: 'credit', amount: 40, date: '2026-07-01T10:00:00.000Z' }),
      tx({ id: 'c1', amount: 100, date: '2026-07-02T10:00:00.000Z' }),
      tx({ id: 'pag', type: 'credit', amount: 60, date: '2026-07-03T10:00:00.000Z' }),
    ];

    const alloc = allocatePayment(extrato, 'pag')!;

    // A compra de 100 entrou já abatida em 40; o pagamento de 60 fecha o resto.
    expect(alloc.balanceBefore).toBe(60);
    expect(alloc.covered).toEqual([expect.objectContaining({ applied: 60, amount: 100, settled: true })]);
    expect(alloc.balanceAfter).toBe(0);
  });

  it('pagamento fora do extrato devolve null', () => {
    expect(allocatePayment([tx({ id: 'c1', amount: 10 })], 'nao-existe')).toBeNull();
  });
});

describe('findPaymentTransaction', () => {
  const extrato = [
    tx({ id: 'compra', amount: 64, date: '2026-07-03T20:11:01.450Z' }),
    tx({ id: 'acerto', type: 'credit', amount: 64, date: '2026-07-30T19:41:52.621Z' }),
  ];

  it('o id gravado no lançamento do caixa manda', () => {
    const achado = findPaymentTransaction(extrato, { id: 'acerto', amount: 999, at: new Date() });
    expect(achado?.id).toBe('acerto');
  });

  it('lançamento antigo casa pela hora mais próxima (relógios diferentes)', () => {
    // Caixa grava serverTimestamp; o extrato, o relógio do navegador.
    const achado = findPaymentTransaction(extrato, { amount: 64, at: new Date('2026-07-30T19:41:52.835Z') });
    expect(achado?.id).toBe('acerto');
  });

  it('nunca casa com uma COMPRA de mesmo valor', () => {
    const achado = findPaymentTransaction(extrato, { amount: 64, at: new Date('2026-07-03T20:11:01.450Z') });
    // Fora da janela do crédito, mas ele é o único de R$ 64 — a compra não conta.
    expect(achado?.id).toBe('acerto');
  });

  it('dois pagamentos iguais fora da janela não chutam qual foi', () => {
    const dois = [
      tx({ id: 'p1', type: 'credit', amount: 24, date: '2026-07-01T10:00:00.000Z' }),
      tx({ id: 'p2', type: 'credit', amount: 24, date: '2026-07-05T10:00:00.000Z' }),
    ];
    expect(findPaymentTransaction(dois, { amount: 24, at: new Date('2026-07-20T10:00:00.000Z') })).toBeNull();
    expect(findPaymentTransaction(dois, { amount: 24, at: new Date('2026-07-05T10:02:00.000Z') })?.id).toBe('p2');
  });

  it('valor que não existe no extrato devolve null', () => {
    expect(findPaymentTransaction(extrato, { amount: 13, at: new Date() })).toBeNull();
  });
});

describe('exportação', () => {
  const rows = buildStatement(
    [
      tx({ id: 'a', amount: 50, description: 'PDV #ab12c', orderId: 'ab12cXYZ', date: '2026-07-01T13:00:00.000Z' }),
      tx({ id: 'b', type: 'credit', amount: 20, description: 'Pagamento; com ponto-e-virgula', paymentMethod: 'pix', date: '2026-07-02T13:00:00.000Z' }),
    ],
    [{
      id: 'ab12cXYZ',
      orderCode: 'PEDIDO88',
      items: [{ name: 'X-Salada', quantity: 2, unitPrice: 25, addons: [{ name: 'Bacon' }] }],
    }],
  );

  it('gera o CSV com BOM, ponto-e-vírgula e número em pt-BR', () => {
    const csv = buildStatementCsv(rows, { nome: 'Ana', celular: '16999999999' });

    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Data;Hora;Tipo;Descricao;Pedido');
    expect(csv).toContain('50,00');
    expect(csv).toContain('PEDIDO88');
    // Campo com ";" tem que sair entre aspas, senão vira duas colunas.
    expect(csv).toContain('"Pagamento; com ponto-e-virgula"');
    expect(csv).toContain('TOTAIS');
  });

  it('o CSV de itens só lista compras com pedido casado', () => {
    const csv = buildItemsCsv(rows, { nome: 'Ana' });

    expect(csv).toContain('X-Salada');
    expect(csv).toContain('Bacon');
    expect(csv).toContain('50,00');
    expect(csv).not.toContain('Pagamento');
  });

  it('nome do arquivo sai sem acento nem espaço', () => {
    expect(exportFileName('extrato-prazo', 'José da Silva Ção')).toMatch(/^extrato-prazo-jose-da-silva-cao-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(exportFileName('extrato-prazo', '')).toMatch(/^extrato-prazo-cliente-/);
  });
});
