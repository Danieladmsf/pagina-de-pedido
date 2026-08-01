import { describe, expect, it } from 'vitest';
import {
  auditIntegrity,
  baselineFromReport,
  compareDeadReferences,
  isValidPhone,
  legacyReference,
  normalizeName,
  normalizePhone,
  planIntegrityBackfills,
  uniqueLegacyTarget,
} from './integridade-core.mjs';

const rec = (collection, id, data = {}, extra = {}) => ({
  id,
  path: `${collection}/${id}`,
  data,
  updateTime: extra.updateTime || { seconds: 1 },
  ...extra,
});

const credit = (customerId, id, data = {}) => ({
  id,
  path: `clientes/${customerId}/credit_transactions/${id}`,
  parentId: customerId,
  data,
  updateTime: { seconds: 1 },
});

const emptyDataset = (overrides = {}) => ({
  profiles: [],
  menuItems: [],
  promotions: [],
  orders: [],
  encomendas: [],
  clientes: [],
  cashRegisters: [],
  cashTransactions: [],
  creditTransactions: [],
  ...overrides,
});

describe('normalizacao usada pela integridade', () => {
  it('normaliza telefone brasileiro sem remover DDI de forma ambigua', () => {
    expect(normalizePhone('+55 (16) 99215-6780')).toBe('16992156780');
    expect(normalizePhone('5516992156780')).toBe('16992156780');
    expect(normalizePhone('551234')).toBe('551234');
    expect(isValidPhone('(16) 3212-3456')).toBe(true);
    expect(isValidPhone('123')).toBe(false);
  });

  it('normaliza nome e extrai somente referencia marcada com #', () => {
    expect(normalizeName('  Joao   da Silva ')).toBe('joao da silva');
    expect(legacyReference('PDV #Ab12C (Prazo)')).toBe('Ab12C');
    expect(legacyReference('Mesa 4 - Finalizada')).toBe('');
  });
});

describe('auditIntegrity', () => {
  it('separa fallback textual de referencia explicitamente morta', () => {
    const report = auditIntegrity(emptyDataset({
      profiles: [rec('store_profiles', 'loja', { general: { name: 'Loja' } })],
      orders: [rec('orders', 'ABCDEF', {
        ownerId: 'loja',
        customerPhone: '16999999999',
        orderDateTime: '2025-01-01T10:00:00.000Z',
        items: [{ id: 'produto-removido' }],
      })],
      cashRegisters: [rec('cash_registers', 'sessao', { ownerId: 'loja' })],
      cashTransactions: [rec('cash_transactions', 'cx1', {
        ownerId: 'loja', caixaId: 'sessao', tipo: 'venda', titulo: 'PDV #ABCDE', data: '2025-01-01T11:00:00.000Z',
      })],
    }));

    expect(report.summary.byKind.pedido_produto).toBe(1);
    expect(report.summary.byKind.caixa_pedido_prefixo).toBe(1);
    expect(report.summary.byKind.pedido_cliente_telefone).toBe(1);
    expect(report.summary.byCategory.orphan).toBe(1);
    expect(report.guardrail.deadReferenceKeys).toHaveLength(0);
  });

  it('trata clienteId proposto recente como pendência e escala após 24 horas', () => {
    const recent = auditIntegrity(emptyDataset({
      now: '2026-07-31T12:00:00.000Z',
      profiles: [rec('store_profiles', 'loja')],
      orders: [rec('orders', 'novo', {
        ownerId: 'loja', clienteId: 'cliente-proposto', customerIdentityPending: true,
        createdAt: '2026-07-31T11:00:00.000Z',
      })],
    }));
    expect(recent.summary.byKind.pedido_cliente_pendente).toBe(1);
    expect(recent.guardrail.deadReferenceKeys).toHaveLength(0);

    const stale = auditIntegrity(emptyDataset({
      now: '2026-07-31T12:00:00.000Z',
      profiles: [rec('store_profiles', 'loja')],
      orders: [rec('orders', 'antigo', {
        ownerId: 'loja', clienteId: 'cliente-proposto', customerIdentityPending: true,
        createdAt: '2026-07-29T11:00:00.000Z',
      })],
    }));
    expect(stale.summary.byKind.pedido_cliente).toBe(1);
    expect(stale.guardrail.deadReferenceKeys).toHaveLength(1);
  });

  it('encontra referencias mortas em promocao, combo, caixa e prazo', () => {
    const customer = rec('clientes', 'c1', { ownerId: 'loja', celular: '16999999999' });
    const report = auditIntegrity(emptyDataset({
      profiles: [rec('store_profiles', 'loja')],
      clientes: [customer],
      promotions: [rec('promotions', 'promo', {
        ownerId: 'loja', items: [{ menuItemId: 'p-inexistente' }],
      })],
      menuItems: [rec('menuItems', 'combo', {
        ownerId: 'loja', isCombo: true, comboItems: [{ itemId: 'componente-inexistente' }],
      })],
      cashTransactions: [rec('cash_transactions', 'cash', {
        ownerId: 'loja', tipo: 'venda', caixaId: 'sessao-inexistente', orderId: 'pedido-inexistente',
      })],
      creditTransactions: [credit('c1', 'tx', { type: 'debit', amount: 10, orderId: 'pedido-inexistente' })],
    }));

    expect(report.summary.byCategory.dead_reference).toBe(5);
    expect(report.summary.byKind.promocao_produto).toBe(1);
    expect(report.summary.byKind.combo_produto).toBe(1);
    expect(report.summary.byKind.caixa_sessao).toBe(1);
    expect(report.summary.byKind.caixa_pedido).toBe(1);
    expect(report.summary.byKind.prazo_pedido).toBe(1);
  });

  it('mede duplicidade, orfao de extrato e divergencia de saldo', () => {
    const report = auditIntegrity(emptyDataset({
      profiles: [rec('store_profiles', 'loja')],
      clientes: [
        rec('clientes', 'c1', { ownerId: 'loja', celular: '(16) 99999-9999', creditBalance: 7 }),
        rec('clientes', 'c2', { ownerId: 'loja', celular: '16999999999' }),
        rec('clientes', 'c3', { ownerId: 'loja', nome: 'Maria' }),
        rec('clientes', 'c4', { ownerId: 'loja', nome: 'MÁRIA' }),
      ],
      creditTransactions: [
        credit('c1', 'debit', { type: 'debit', amount: 10 }),
        credit('apagado', 'orphan', { type: 'debit', amount: 5 }),
      ],
    }));

    expect(report.summary.byKind.cliente_telefone_duplicado).toBe(1);
    expect(report.summary.byKind.cliente_nome_duplicado_sem_telefone).toBe(1);
    expect(report.summary.byKind.extrato_cliente_inexistente).toBe(1);
    expect(report.summary.byKind.cliente_saldo_divergente).toBe(1);
  });

  it('valida creditTxId no extrato do cliente indicado pelo acerto', () => {
    const report = auditIntegrity(emptyDataset({
      profiles: [rec('store_profiles', 'loja')],
      clientes: [
        rec('clientes', 'c1', { ownerId: 'loja' }),
        rec('clientes', 'c2', { ownerId: 'loja' }),
      ],
      cashRegisters: [rec('cash_registers', 'sessao', { ownerId: 'loja' })],
      creditTransactions: [
        credit('c1', 'ok', { type: 'credit', amount: 10, channel: 'acerto' }),
        credit('c1', 'debito', { type: 'debit', amount: 10 }),
        credit('c2', 'outra-pessoa', { type: 'credit', amount: 10 }),
        credit('c1', 'sem-caixa', { type: 'credit', amount: 5, channel: 'acerto' }),
      ],
      cashTransactions: [
        rec('cash_transactions', 'ok', { ownerId: 'loja', caixaId: 'sessao', tipo: 'acerto_prazo', clienteId: 'c1', creditTxId: 'ok' }),
        rec('cash_transactions', 'inexistente', { ownerId: 'loja', caixaId: 'sessao', tipo: 'acerto_prazo', clienteId: 'c1', creditTxId: 'nao-existe' }),
        rec('cash_transactions', 'outra-pessoa', { ownerId: 'loja', caixaId: 'sessao', tipo: 'acerto_prazo', clienteId: 'c1', creditTxId: 'outra-pessoa' }),
        rec('cash_transactions', 'tipo-errado', { ownerId: 'loja', caixaId: 'sessao', tipo: 'acerto_prazo', clienteId: 'c1', creditTxId: 'debito' }),
        rec('cash_transactions', 'sem-cliente', { ownerId: 'loja', caixaId: 'sessao', tipo: 'acerto_prazo', creditTxId: 'ok' }),
      ],
    }));

    expect(report.summary.byKind.caixa_prazo_transacao).toBe(2);
    expect(report.summary.byKind.caixa_prazo_transacao_tipo).toBe(1);
    expect(report.summary.byKind.caixa_prazo_cliente_ausente).toBe(1);
    expect(report.summary.byKind.prazo_acerto_sem_caixa).toBe(1);
  });

  it('nao inclui arquivado em conflitos ativos, mas detecta uso posterior', () => {
    const report = auditIntegrity(emptyDataset({
      profiles: [rec('store_profiles', 'loja')],
      clientes: [
        rec('clientes', 'ativo', { ownerId: 'loja', celular: '16999999999' }),
        rec('clientes', 'arquivado', {
          ownerId: 'loja',
          celular: '(16) 99999-9999',
          archived: true,
          archivedAt: '2025-02-01T00:00:00.000Z',
        }),
      ],
      orders: [rec('orders', 'novo', {
        ownerId: 'loja',
        clienteId: 'arquivado',
        createdAt: '2025-03-01T00:00:00.000Z',
      })],
    }));

    expect(report.summary.byKind.cliente_telefone_duplicado).toBeUndefined();
    expect(report.summary.byKind.vinculo_cliente_arquivado_posterior).toBe(1);
  });

  it('valida o destino persistido por uma unificacao de clientes', () => {
    const report = auditIntegrity(emptyDataset({
      profiles: [rec('store_profiles', 'loja')],
      clientes: [rec('clientes', 'origem', {
        ownerId: 'loja', archived: true, mergedInto: 'destino-apagado',
      })],
    }));

    expect(report.summary.byKind.cliente_unificacao_destino).toBe(1);
    expect(report.guardrail.deadReferenceKeys).toHaveLength(1);
  });

  it('compara somente referencias mortas com a baseline', () => {
    const report = auditIntegrity(emptyDataset({
      profiles: [rec('store_profiles', 'loja')],
      promotions: [rec('promotions', 'promo', {
        ownerId: 'loja', items: [{ menuItemId: 'morto' }],
      })],
    }));
    const baseline = baselineFromReport(report);
    expect(baseline.deadReferenceKeys[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(baseline.deadReferenceKeys[0]).not.toContain('clientes/');
    expect(compareDeadReferences(report, baseline)).toEqual({ newKeys: [], resolvedKeys: [] });
    expect(compareDeadReferences(report, { deadReferenceKeys: [] }).newKeys).toHaveLength(1);
  });
});

describe('planIntegrityBackfills', () => {
  it('combina createdAt, orderCode e clienteId sem sobrescrever campos existentes', () => {
    const order = rec('orders', 'curto123', {
      ownerId: 'loja',
      orderDateTime: '2025-02-03T12:30:00.000Z',
      customerPhone: '(16) 99999-9999',
    });
    const plan = planIntegrityBackfills(emptyDataset({
      orders: [order],
      clientes: [rec('clientes', 'cliente-correto', { ownerId: 'loja', celular: '16999999999' })],
    }));

    expect(plan.proposals).toHaveLength(1);
    expect(plan.proposals[0].patch).toMatchObject({
      clienteId: 'cliente-correto',
      orderCode: 'curto123',
    });
    expect(plan.proposals[0].patch.createdAt.toISOString()).toBe('2025-02-03T12:30:00.000Z');
    expect(plan.proposals[0].kinds).toEqual(['clienteId', 'createdAt', 'orderCode']);
  });

  it('nao escolhe cliente quando o telefone tem zero ou varios candidatos', () => {
    const orders = [
      rec('orders', 'zero', { ownerId: 'loja', customerPhone: '16888888888' }),
      rec('orders', 'duplo', { ownerId: 'loja', customerPhone: '16999999999' }),
    ];
    const clientes = [
      rec('clientes', 'c1', { ownerId: 'loja', celular: '16999999999' }),
      rec('clientes', 'c2', { ownerId: 'loja', celular: '(16) 99999-9999' }),
    ];
    const plan = planIntegrityBackfills(emptyDataset({ orders, clientes }), { only: ['clienteId'] });

    expect(plan.proposals).toHaveLength(0);
    expect(plan.summary.skippedByReason.cliente_nao_encontrado).toBe(1);
    expect(plan.summary.skippedByReason.telefone_ambiguo).toBe(1);
  });

  it('nunca escolhe cliente arquivado no backfill', () => {
    const plan = planIntegrityBackfills(emptyDataset({
      orders: [rec('orders', 'pedido', { ownerId: 'loja', customerPhone: '16999999999' })],
      clientes: [rec('clientes', 'arquivado', {
        ownerId: 'loja', celular: '16999999999', archived: true,
      })],
    }), { only: ['clienteId'] });

    expect(plan.proposals).toHaveLength(0);
    expect(plan.summary.skippedByReason.cliente_nao_encontrado).toBe(1);
  });

  it('liga prefixo somente a um destino que ja existia no lancamento', () => {
    const source = rec('cash_transactions', 'tx', {
      ownerId: 'loja', tipo: 'venda', titulo: 'PDV #ABCDE', data: '2025-05-01T12:00:00.000Z',
    });
    const oldOrder = rec('orders', 'ABCDE-old', {
      ownerId: 'loja', orderDateTime: '2025-04-01T12:00:00.000Z',
    });
    const futureCollision = rec('orders', 'ABCDE-future', {
      ownerId: 'loja', orderDateTime: '2026-04-01T12:00:00.000Z',
    });

    expect(uniqueLegacyTarget({
      source,
      ownerId: 'loja',
      prefix: 'ABCDE',
      candidates: [oldOrder, futureCollision],
    }).target?.id).toBe('ABCDE-old');

    const plan = planIntegrityBackfills(emptyDataset({
      orders: [oldOrder, futureCollision],
      cashTransactions: [source],
    }), { only: ['legacyLinks'] });
    expect(plan.proposals[0].patch).toEqual({ orderId: 'ABCDE-old' });
  });

  it('bloqueia prefixo ambiguo e candidato sem data', () => {
    const source = credit('c1', 'tx', {
      type: 'debit', description: 'PDV #ABCDE', date: '2025-05-01T12:00:00.000Z',
    });
    const customer = rec('clientes', 'c1', { ownerId: 'loja', celular: '16999999999' });
    const orders = [
      rec('orders', 'ABCDE-1', { ownerId: 'loja', orderDateTime: '2025-01-01T12:00:00.000Z' }),
      rec('orders', 'ABCDE-2', { ownerId: 'loja', orderDateTime: '2025-02-01T12:00:00.000Z' }),
      rec('orders', 'ABCDE-3', { ownerId: 'loja' }),
    ];
    const plan = planIntegrityBackfills(emptyDataset({
      clientes: [customer], orders, creditTransactions: [source],
    }), { only: ['legacyLinks'] });

    expect(plan.proposals).toHaveLength(0);
    expect(plan.summary.skippedByReason.candidato_sem_data).toBe(1);
  });
});
