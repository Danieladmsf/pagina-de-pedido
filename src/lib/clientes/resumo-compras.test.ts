import { describe, expect, it } from 'vitest';
import { ordenarCompras, resumoDeCompras, rotuloDaForma, rotuloDoCanal } from './resumo-compras';

const compra = (over: any = {}) => ({
  id: 'p1',
  orderDateTime: '2026-07-10T12:00:00.000Z',
  totalAmount: 50,
  paymentMethod: 'Pix',
  orderType: 'pickup',
  source: 'pdv',
  status: 'delivered',
  items: [{ name: 'Marmita g', quantity: 2, unitPrice: 20 }],
  ...over,
});

describe('rotuloDaForma', () => {
  it('junta o que a base gravou de jeitos diferentes', () => {
    // Casos reais da producao: legado em minusculo e troco no meio do texto.
    expect(rotuloDaForma('Pix')).toBe('Pix');
    expect(rotuloDaForma('credito')).toBe('Credito');
    expect(rotuloDaForma('Dinheiro (Troco para R$ 50.00)')).toBe('Dinheiro');
    expect(rotuloDaForma('Pix R$ 25 + Dinheiro R$ 15')).toBe('Múltiplos');
    expect(rotuloDaForma('')).toBe('Não informado');
  });
});

describe('rotuloDoCanal', () => {
  it('traduz orderType/source para o vocabulário da loja', () => {
    expect(rotuloDoCanal(compra({ orderType: 'dine_in' }))).toBe('Mesa');
    expect(rotuloDoCanal(compra({ orderType: 'delivery' }))).toBe('Delivery');
    expect(rotuloDoCanal(compra({ orderType: 'pickup', source: 'pdv' }))).toBe('Balcão');
    expect(rotuloDoCanal(compra({ orderType: 'pickup', source: 'cardapio' }))).toBe('Retirada');
    expect(rotuloDoCanal(compra({ origem: 'encomenda' }))).toBe('Encomenda');
  });
});

describe('resumoDeCompras', () => {
  it('soma, conta e tira a média das compras válidas', () => {
    const r = resumoDeCompras([
      compra({ id: 'a', totalAmount: 50 }),
      compra({ id: 'b', totalAmount: 30 }),
    ]);
    expect(r.quantidade).toBe(2);
    expect(r.total).toBe(80);
    expect(r.ticketMedio).toBe(40);
  });

  it('CANCELADA não entra em total, ticket, forma, canal nem itens', () => {
    const r = resumoDeCompras([
      compra({ id: 'ok', totalAmount: 50 }),
      compra({ id: 'x', totalAmount: 999, status: 'canceled', paymentMethod: 'Débito' }),
    ]);
    expect(r.quantidade).toBe(1);
    expect(r.total).toBe(50);
    expect(r.canceladas).toBe(1);
    expect(r.totalCancelado).toBe(999);
    expect(r.porForma.map((f) => f.chave)).toEqual(['Pix']);
    expect(r.topItens.reduce((s, i) => s + i.quantidade, 0)).toBe(2);
  });

  it('quebra por forma de pagamento, da maior para a menor', () => {
    const r = resumoDeCompras([
      compra({ id: 'a', paymentMethod: 'Pix', totalAmount: 10 }),
      compra({ id: 'b', paymentMethod: 'Dinheiro (Troco para R$ 50.00)', totalAmount: 70 }),
      compra({ id: 'c', paymentMethod: 'pix', totalAmount: 20 }),
    ]);
    expect(r.porForma[0]).toEqual({ chave: 'Dinheiro', quantidade: 1, total: 70 });
    expect(r.porForma[1]).toEqual({ chave: 'Pix', quantidade: 2, total: 30 });
  });

  it('primeira e última compra saem das datas, não da ordem da lista', () => {
    const r = resumoDeCompras([
      compra({ id: 'meio', orderDateTime: '2026-07-10T12:00:00.000Z' }),
      compra({ id: 'velha', orderDateTime: '2026-05-01T12:00:00.000Z' }),
      compra({ id: 'nova', orderDateTime: '2026-07-30T12:00:00.000Z' }),
    ]);
    expect(r.primeira?.toISOString()).toBe('2026-05-01T12:00:00.000Z');
    expect(r.ultima?.toISOString()).toBe('2026-07-30T12:00:00.000Z');
  });

  it('itens mais comprados somam quantidade entre as compras', () => {
    const r = resumoDeCompras([
      compra({ id: 'a', items: [{ name: 'Coca', quantity: 1, unitPrice: 8 }] }),
      compra({ id: 'b', items: [{ name: 'Coca', quantity: 3, unitPrice: 8 }, { name: 'Torta', quantity: 1, unitPrice: 60 }] }),
    ]);
    expect(r.topItens[0]).toEqual({ nome: 'Coca', quantidade: 4, total: 32 });
  });

  it('conta por qual chave cada compra foi ligada ao cliente', () => {
    // É o que deixa a tela honesta: "achei 3, sendo 1 só pelo telefone".
    const r = resumoDeCompras([
      compra({ id: 'a', vinculo: 'clienteId' }),
      compra({ id: 'b', vinculo: 'clienteId' }),
      compra({ id: 'c', vinculo: 'telefone' }),
    ]);
    expect(r.vinculoPorId).toBe(2);
    expect(r.vinculoPorTelefone).toBe(1);
  });

  it('lista vazia não quebra e não divide por zero', () => {
    const r = resumoDeCompras([]);
    expect(r.quantidade).toBe(0);
    expect(r.ticketMedio).toBe(0);
    expect(r.primeira).toBeNull();
  });
});

describe('ordenarCompras', () => {
  it('mais nova primeiro', () => {
    const lista = ordenarCompras([
      compra({ id: 'velha', orderDateTime: '2026-01-01T10:00:00.000Z' }),
      compra({ id: 'nova', orderDateTime: '2026-07-01T10:00:00.000Z' }),
    ]);
    expect(lista.map((c) => c.id)).toEqual(['nova', 'velha']);
  });
});
