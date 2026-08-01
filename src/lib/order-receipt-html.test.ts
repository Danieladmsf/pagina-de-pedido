import { describe, expect, it } from 'vitest';
import { buildOrderReceiptHtml } from './order-receipt-html';

const baseOrder = {
  id: 'firestore-document-id',
  orderDateTime: '2026-07-31T12:00:00.000Z',
  orderType: 'pickup',
  customerName: 'Ana',
  customerPhone: '16999999999',
  items: [],
  totalAmount: 0,
};

describe('código no cupom do pedido', () => {
  it('imprime orderCode e não expõe o id interno quando os dois diferem', () => {
    const html = buildOrderReceiptHtml({ ...baseOrder, orderCode: 'ABC12345' }, {});

    expect(html).toContain('Pedido: #ABC12 (ABC12345)');
    expect(html).not.toContain('firestore-document-id');
  });

  it('mantém o id como código de pedidos legados', () => {
    const html = buildOrderReceiptHtml({ ...baseOrder, id: 'OLD12345' }, {});

    expect(html).toContain('Pedido: #OLD12 (OLD12345)');
  });
});
