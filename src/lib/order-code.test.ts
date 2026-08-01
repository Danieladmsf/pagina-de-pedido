import { describe, expect, it } from 'vitest';
import { generateOrderCode, getOrderCode, getOrderCodePrefix } from './order-code';

describe('orderCode', () => {
  it('gera oito caracteres legíveis sem reutilizar o id do documento', () => {
    const code = generateOrderCode(new Uint8Array([0, 1, 25, 26, 35, 36, 37, 255]));

    expect(code).toBe('ABZ09ABD');
    expect(code).toMatch(/^[A-Z0-9]{8}$/);
  });

  it('prefere orderCode para exibição', () => {
    expect(getOrderCode({ id: 'firestore-document-id', orderCode: 'CLIENTE8' })).toBe('CLIENTE8');
    expect(getOrderCodePrefix({ id: 'firestore-document-id', orderCode: 'CLIENTE8' })).toBe('CLIEN');
  });

  it('usa o id como fallback para pedidos legados', () => {
    expect(getOrderCode({ id: 'ABC12345' })).toBe('ABC12345');
    expect(getOrderCodePrefix({ id: 'ABC12345' })).toBe('ABC12');
    expect(getOrderCode({ id: 'ABC12345', orderCode: '   ' })).toBe('ABC12345');
  });
});
