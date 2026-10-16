import { describe, expect, it, vi } from 'vitest';

// O Prazo grava no Firestore por batch; aqui só interessa o que vai para o caixa.
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  doc: () => ({ id: 'tx-prazo' }),
  increment: (n: number) => n,
  writeBatch: () => ({ set: vi.fn(), update: vi.fn(), commit: vi.fn(async () => {}) }),
}));

import { registrarPagamentoSplits } from './payments';

const base = {
  contaCasaCustomerId: 'cliente-1',
  caixaAberto: true,
  tituloVenda: 'Delivery #R2X4Y - Aline',
  tituloPrazo: 'Delivery #R2X4Y - Aline (Prazo)',
  creditDescription: 'Delivery #R2X4Y',
  channel: 'delivery',
};

describe('registrarPagamentoSplits grava o dia da venda', () => {
  it('delivery de ontem finalizado hoje leva o momento do PEDIDO em todas as partes', async () => {
    // Gostinho, 16/10/2026: pedido das 17:51 de 15/10 finalizado às 11:11 de 16/10.
    const registrarLancamento = vi.fn(async () => {});
    await registrarPagamentoSplits({}, {
      ...base,
      registrarLancamento,
      orderId: 'pedido-aline',
      pedidoFeitoEm: '2026-10-15T20:51:05.000Z',
      splits: [
        { methodId: 'pix', amount: 50 },
        { methodId: 'conta_casa', amount: 33 },
      ] as any,
    });

    expect(registrarLancamento).toHaveBeenCalledTimes(2);
    for (const [lancamento] of registrarLancamento.mock.calls as any[]) {
      expect(lancamento.orderId).toBe('pedido-aline');
      expect(lancamento.vendidoEm).toEqual(new Date('2026-10-15T20:51:05.000Z'));
    }
  });

  it('aceita o Timestamp do Firestore', async () => {
    const registrarLancamento = vi.fn(async () => {});
    const quando = new Date('2026-10-15T20:51:05.000Z');
    await registrarPagamentoSplits({}, {
      ...base,
      registrarLancamento,
      orderId: 'p',
      pedidoFeitoEm: { toMillis: () => quando.getTime() },
      splits: [{ methodId: 'pix', amount: 10 }] as any,
    });
    expect((registrarLancamento.mock.calls[0] as any[])[0].vendidoEm).toEqual(quando);
  });

  it('sem pedido ou sem data legível, não inventa dia', async () => {
    const registrarLancamento = vi.fn(async () => {});
    await registrarPagamentoSplits({}, {
      ...base,
      registrarLancamento,
      encomendaId: 'enc-1',
      pedidoFeitoEm: '2026-10-15T20:51:05.000Z',
      splits: [{ methodId: 'pix', amount: 10 }] as any,
    });
    await registrarPagamentoSplits({}, {
      ...base,
      registrarLancamento,
      orderId: 'p',
      pedidoFeitoEm: 'não é data',
      splits: [{ methodId: 'pix', amount: 10 }] as any,
    });
    for (const [lancamento] of registrarLancamento.mock.calls as any[]) {
      expect(lancamento).not.toHaveProperty('vendidoEm');
    }
  });
});
