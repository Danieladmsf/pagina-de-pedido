import { describe, expect, it } from 'vitest';
import { encomendaComoPedido } from './pedido';

/**
 * A encomenda a prazo é o único tipo de compra que o extrato do cliente ainda
 * não sabia abrir: a descrição é "Encomenda ab12c" (sem "#") e ela nem mora em
 * `orders`. Agora o lançamento guarda `encomendaId` e a tela lê a encomenda por
 * aqui — estes testes travam a leitura, que é onde o valor pode mentir.
 */
describe('encomendaComoPedido', () => {
  it('bolo vira uma linha só, com sabor e peso no nome', () => {
    const pedido = encomendaComoPedido({
      id: 'enc1',
      total: 180,
      bolo: { flavor: 'Chocolatudo', weight: '2 kg', filling: 'Brigadeiro', total: 180 },
    });

    expect(pedido?.items).toEqual([{ name: 'Bolo Chocolatudo 2 kg', quantity: 1, unitPrice: 180 }]);
    expect(pedido?.totalAmount).toBe(180);
  });

  it('cai no recheio e no tamanho quando o bolo é do modelo antigo', () => {
    const pedido = encomendaComoPedido({
      id: 'enc2',
      bolo: { size: 'M', filling: 'Ninho com Nutella', dough: 'branca', total: 95 },
    });

    expect(pedido?.items[0].name).toBe('Bolo Ninho com Nutella M');
  });

  it('junta tortas, docinhos e especiais mantendo quantidade e valor unitário', () => {
    const pedido = encomendaComoPedido({
      id: 'enc3',
      total: 130,
      bolo: null,
      tortasItems: [{ id: 't1', name: 'Torta de Limão', qty: 1, unitPrice: 60, total: 60 }],
      docinhosItems: [{ id: 'd1', name: 'Brigadeiro', qty: 50, unitPrice: 1.4, total: 70 }],
      especialItems: [],
    });

    expect(pedido?.items).toEqual([
      { name: 'Torta de Limão', quantity: 1, unitPrice: 60 },
      { name: 'Brigadeiro', quantity: 50, unitPrice: 1.4 },
    ]);
  });

  it('encomenda sem itens não quebra a tela', () => {
    const pedido = encomendaComoPedido({ id: 'enc4', bolo: null, total: 0 });
    expect(pedido?.items).toEqual([]);
  });

  it('sem id não vira pedido nenhum', () => {
    expect(encomendaComoPedido({ total: 10 })).toBeNull();
    expect(encomendaComoPedido(null)).toBeNull();
  });
});
