import { describe, expect, it } from 'vitest';
import { buildComprasCsv, buildComprasItensCsv } from './compras-export';
import { buildComprasHtml } from './compras-receipt';

const compra = (over: any = {}) => ({
  id: 'ped1',
  orderCode: 'ABC12345',
  orderDateTime: '2026-07-10T15:30:00.000Z',
  totalAmount: 50,
  paymentMethod: 'Pix',
  orderType: 'pickup',
  source: 'pdv',
  status: 'delivered',
  items: [{ name: 'Marmita g', quantity: 2, unitPrice: 25, addons: [{ name: 'Ovo frito' }] }],
  ...over,
});

const cliente = { nome: 'Thais Falaguasta', celular: '16992156780' };

describe('buildComprasCsv', () => {
  it('abre certo no Excel brasileiro: BOM, ponto-e-vírgula e vírgula decimal', () => {
    const csv = buildComprasCsv([compra()], cliente);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Data;Hora;Pedido');
    expect(csv).toContain('50,00');
  });

  it('leva o cabeçalho de quem é o arquivo', () => {
    const csv = buildComprasCsv([compra()], cliente);
    expect(csv).toContain('Thais Falaguasta');
    expect(csv).toContain('16992156780');
  });

  it('CANCELADA aparece marcada e SEM valor na linha — somar a coluna dá o total da tela', () => {
    const csv = buildComprasCsv([
      compra({ id: 'a', totalAmount: 50 }),
      compra({ id: 'b', totalAmount: 999, status: 'canceled' }),
    ], cliente);

    const linhaCancelada = csv.split('\r\n').find((l) => l.includes('CANCELADA'))!;
    expect(linhaCancelada).toBeTruthy();
    // A coluna de valor fica vazia: quem soma a planilha tem que chegar no
    // mesmo número da tela.
    expect(linhaCancelada.endsWith(';')).toBe(true);
    expect(linhaCancelada).not.toContain('999,00');

    expect(csv).toContain('TOTAL (1 compras);;50,00');
    // Mas o valor cancelado aparece no rodapé, rotulado — sumir esconderia
    // dinheiro que passou pelo caixa e voltou.
    expect(csv).toContain('Canceladas (1), fora do total;;999,00');
  });

  it('fecha com a quebra por forma de pagamento e por canal', () => {
    const csv = buildComprasCsv([
      compra({ id: 'a', paymentMethod: 'Pix', totalAmount: 30 }),
      compra({ id: 'b', paymentMethod: 'Dinheiro (Troco para R$ 50.00)', totalAmount: 20 }),
    ], cliente);
    expect(csv).toContain('Por forma de pagamento');
    expect(csv).toContain('Pix');
    expect(csv).toContain('Dinheiro');
    expect(csv).toContain('Por canal');
    expect(csv).toContain('Balcão');
  });
});

describe('buildComprasItensCsv', () => {
  it('uma linha por item, com adicionais e total do item', () => {
    const csv = buildComprasItensCsv([compra()], cliente);
    expect(csv).toContain('Marmita g');
    expect(csv).toContain('Ovo frito');
    expect(csv).toContain('50,00'); // 2 x 25
  });

  it('compra cancelada não lista itens: eles não foram vendidos', () => {
    const csv = buildComprasItensCsv([compra({ status: 'canceled' })], cliente);
    expect(csv).not.toContain('Marmita g');
  });
});

describe('buildComprasHtml (cupom)', () => {
  it('sai como documento de cupom, com cliente e total', () => {
    const html = buildComprasHtml({
      storeInfo: { general: { name: 'Minha Loja' } },
      cliente,
      compras: [compra()],
      filtro: 'Tudo',
    });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('HISTORICO DE COMPRAS');
    expect(html).toContain('Thais Falaguasta');
    expect(html).toContain('Minha Loja');
  });

  it('avisa que cancelada não entra no total', () => {
    const html = buildComprasHtml({
      storeInfo: {},
      cliente,
      compras: [compra({ id: 'a' }), compra({ id: 'b', status: 'canceled' })],
    });
    expect(html).toContain('nao entram no total');
  });

  it('lista vazia não quebra o cupom', () => {
    const html = buildComprasHtml({ storeInfo: {}, cliente, compras: [] });
    expect(html).toContain('Nenhuma compra no periodo');
  });
});
