import { describe, expect, it } from 'vitest';
import {
  findLegacyOrderBefore,
  isUnlinkedLegacyCashSale,
  matchCashSaleSource,
  orderCreatedAtMillis,
  valueToMillis,
} from './order-linking';

const antigo = { id: 'abcde-velho', orderDateTime: '2026-07-01T10:00:00.000Z' };
const futuro = { id: 'abcde-futuro', orderDateTime: '2027-01-01T10:00:00.000Z' };
const lancadoEm = { toDate: () => new Date('2026-07-01T11:00:00.000Z') };

describe('corte temporal do prefixo legado', () => {
  it('aceita somente pedido criado antes do lançamento', () => {
    expect(findLegacyOrderBefore([futuro, antigo], 'abcde', lancadoEm)?.id).toBe('abcde-velho');
  });

  it('não deixa pedido futuro ocupar um prefixo antigo', () => {
    expect(findLegacyOrderBefore([futuro], 'abcde', lancadoEm)).toBeNull();
  });

  it('não adivinha quando dois pedidos anteriores colidem no prefixo', () => {
    const outroAntigo = { id: 'abcde-outro', orderDateTime: '2026-06-30T10:00:00.000Z' };

    expect(findLegacyOrderBefore([antigo, outroAntigo], 'abcde', lancadoEm)).toBeNull();
  });

  it('não adivinha quando alguma das datas necessárias está ausente', () => {
    expect(findLegacyOrderBefore([{ id: 'abcde-sem-data' }], 'abcde', lancadoEm)).toBeNull();
    expect(findLegacyOrderBefore([antigo], 'abcde', null)).toBeNull();
  });

  it('entende Timestamp, Date e ISO sem mudar a precedência de createdAt', () => {
    expect(valueToMillis({ seconds: 2, nanoseconds: 500_000_000 })).toBe(2500);
    expect(orderCreatedAtMillis({
      createdAt: { toMillis: () => 1234 },
      orderDateTime: '2020-01-01T00:00:00.000Z',
    })).toBe(1234);
  });
});

describe('vínculo da venda no Caixa', () => {
  it('id exato do pedido vence sem depender da data', () => {
    const pedido = { id: 'pedido-exato' };
    expect(matchCashSaleSource({ tipo: 'venda', orderId: pedido.id }, [pedido])) .toBe(pedido);
  });

  it('encomenda casa somente pela coleção convertida e pelo id exato', () => {
    const encomenda = { id: 'enc-1', origem: 'encomenda' };
    expect(matchCashSaleSource({ tipo: 'venda', encomendaId: 'enc-1' }, [], [encomenda])).toBe(encomenda);
    expect(matchCashSaleSource({ tipo: 'venda', encomendaId: 'enc-1' }, [{ id: 'enc-1' }], [])).toBeNull();
  });

  it('aplica o corte temporal apenas ao prefixo antigo', () => {
    expect(matchCashSaleSource(
      { tipo: 'venda', titulo: 'PDV #abcde - Balcão', data: lancadoEm },
      [futuro, antigo],
    )?.id).toBe('abcde-velho');
  });

  it('sinaliza venda antiga que ficou sem um vínculo seguro', () => {
    expect(isUnlinkedLegacyCashSale({ tipo: 'venda', titulo: 'Mesa 4 - Finalizada' }, null)).toBe(true);
    expect(isUnlinkedLegacyCashSale({ tipo: 'venda', titulo: 'PDV #abcde - Balcão' }, antigo)).toBe(false);
    expect(isUnlinkedLegacyCashSale({ tipo: 'venda', titulo: 'Acerto de Prazo - Ana' }, null)).toBe(false);
    expect(isUnlinkedLegacyCashSale({ tipo: 'venda', orderId: 'pedido-removido' }, null)).toBe(false);
  });
});
