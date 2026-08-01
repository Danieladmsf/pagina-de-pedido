import { describe, expect, it } from 'vitest';
import {
  mergeCustomerMetrics,
  mergedCashReferencePatch,
  mergedTransactionId,
  referencesCustomer,
} from './customer-merge';

describe('customer merge', () => {
  it('gera id determinístico para repetir merge interrompido sem duplicar extrato', () => {
    expect(mergedTransactionId('cliente-a', 'tx-1')).toBe('merge_cliente-a_tx-1');
    expect(mergedTransactionId('cliente-a', 'tx-1')).toBe(mergedTransactionId('cliente-a', 'tx-1'));
    expect(mergedTransactionId('cliente-b', 'tx-1')).not.toBe(mergedTransactionId('cliente-a', 'tx-1'));
  });
  it('reconhece referencias diretas ao cliente em qualquer colecao vinculada', () => {
    expect(referencesCustomer({ clienteId: 'cliente-a' }, 'cliente-a')).toBe(true);
    expect(referencesCustomer({ clienteId: 'cliente-b' }, 'cliente-a')).toBe(false);
    expect(referencesCustomer({}, 'cliente-a')).toBe(false);
  });

  it('soma pedidos e pontos e pondera o ticket medio', () => {
    expect(mergeCustomerMetrics(
      { totalPedidos: 2, ticketMedio: 20, totalPontos: 4 },
      { totalPedidos: 1, ticketMedio: 50, totalPontos: 3 },
    )).toEqual({ totalPedidos: 3, ticketMedio: 30, totalPontos: 7 });
  });

  it('redireciona o creditTxId do acerto para a copia no destino', () => {
    expect(mergedCashReferencePatch('origem', 'destino', { creditTxId: 'tx-1' }, new Set(['tx-1'])))
      .toEqual({ clienteId: 'destino', creditTxId: 'merge_origem_tx-1' });
    expect(mergedCashReferencePatch('origem', 'destino', { creditTxId: 'sumiu' }, new Set(['tx-1'])))
      .toBeNull();
  });
});
