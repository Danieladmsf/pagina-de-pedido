import { describe, expect, it } from 'vitest';
import { CANAL_LABELS, canalDaVenda, rotuloDoCanalDaVenda } from './order-channel';

describe('canalDaVenda', () => {
  it('separa o que o orderType juntava: cardápio x PDV', () => {
    // O mesmo "pickup" nas duas origens era uma fatia só chamada "Retirada".
    expect(canalDaVenda({ orderType: 'pickup', source: 'cardapio' })).toBe('delivery_retirada');
    expect(canalDaVenda({ orderType: 'pickup', source: 'pdv' })).toBe('balcao');
    // E o mesmo "dine_in" virava tudo "Mesa".
    expect(canalDaVenda({ orderType: 'dine_in', source: 'cardapio' })).toBe('delivery_local');
    expect(canalDaVenda({ orderType: 'dine_in', source: 'pdv' })).toBe('mesa');
  });

  it('entrega é entrega, venha do cardápio ou do PDV', () => {
    expect(canalDaVenda({ orderType: 'delivery', source: 'cardapio' })).toBe('delivery_entrega');
    expect(canalDaVenda({ orderType: 'delivery', source: 'pdv' })).toBe('delivery_entrega');
  });

  it('encomenda tem canal próprio, seja qual for o tipo do pedido', () => {
    expect(canalDaVenda({ origem: 'encomenda', orderType: 'pickup' })).toBe('encomenda');
    expect(canalDaVenda({ origem: 'encomenda', orderType: 'delivery' })).toBe('encomenda');
  });

  it('pedido antigo sem source usa a marca do checkout público', () => {
    // `source` só existe de junho/2026 para cá; antes disso o que sobra é o uid
    // anônimo e o telefone de identificação, que o PDV nunca gravou.
    expect(canalDaVenda({ orderType: 'pickup', customerUid: 'anon-1' })).toBe('delivery_retirada');
    expect(canalDaVenda({ orderType: 'dine_in', customerIdentifier: '16992156780' })).toBe('delivery_local');
    expect(canalDaVenda({ orderType: 'pickup' })).toBe('balcao');
  });

  it('pedido sem tipo cai no lado certo: com mesa é comanda, sem mesa é balcão', () => {
    expect(canalDaVenda({ tableNumber: 4 })).toBe('mesa');
    expect(canalDaVenda({})).toBe('balcao');
  });

  it('todo canal tem rótulo em português', () => {
    expect(rotuloDoCanalDaVenda({ orderType: 'dine_in', source: 'cardapio' }))
      .toBe('Delivery · Comer no local');
    for (const label of Object.values(CANAL_LABELS)) {
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });
});
