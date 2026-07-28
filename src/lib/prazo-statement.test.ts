import { describe, expect, it } from 'vitest';
import {
  buildItemsCsv,
  buildStatement,
  buildStatementCsv,
  exportFileName,
  legacyOrderRef,
  matchOrderForTransaction,
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
  const orders = [{ id: 'ab12cXYZ', items: [] }, { id: 'zz999abc', items: [] }];

  it('usa o orderId quando o lançamento tem o campo novo', () => {
    expect(matchOrderForTransaction(tx({ orderId: 'zz999abc' }), orders)?.id).toBe('zz999abc');
  });

  it('cai no prefixo da descrição para os lançamentos antigos', () => {
    expect(legacyOrderRef('PDV #ab12c')).toBe('ab12c');
    expect(matchOrderForTransaction(tx({ description: 'PDV #ab12c' }), orders)?.id).toBe('ab12cXYZ');
  });

  it('lançamento de mesa (sem "#") não casa com pedido nenhum', () => {
    expect(legacyOrderRef('Mesa 5')).toBe('');
    expect(matchOrderForTransaction(tx({ description: 'Mesa 5' }), orders)).toBeNull();
  });

  it('orderId que não está na lista não cai no prefixo por engano', () => {
    expect(matchOrderForTransaction(tx({ orderId: 'sumiu', description: 'PDV #ab12c' }), orders)).toBeNull();
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

describe('exportação', () => {
  const rows = buildStatement(
    [
      tx({ id: 'a', amount: 50, description: 'PDV #ab12c', orderId: 'ab12cXYZ', date: '2026-07-01T13:00:00.000Z' }),
      tx({ id: 'b', type: 'credit', amount: 20, description: 'Pagamento; com ponto-e-virgula', paymentMethod: 'pix', date: '2026-07-02T13:00:00.000Z' }),
    ],
    [{ id: 'ab12cXYZ', items: [{ name: 'X-Salada', quantity: 2, unitPrice: 25, addons: [{ name: 'Bacon' }] }] }],
  );

  it('gera o CSV com BOM, ponto-e-vírgula e número em pt-BR', () => {
    const csv = buildStatementCsv(rows, { nome: 'Ana', celular: '16999999999' });

    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Data;Hora;Tipo;Descricao;Pedido');
    expect(csv).toContain('50,00');
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
