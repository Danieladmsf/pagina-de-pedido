import { describe, expect, it } from 'vitest';

import { baseReceiptCss, buildReceiptDocument, resolvePrinterSize } from './receipt-print';
import { buildOrderReceiptHtml } from './order-receipt-html';
import { buildEncomendaReceiptHtml } from './encomendas/receipt';

/**
 * O que estes testes protegem: os três cupons do sistema (pedido, caixa e
 * encomenda) precisam sair da MESMA base. Antes eram três cópias e elas
 * divergiram — a da encomenda nem tinha `@page`, então o fallback do navegador
 * imprimia em folha A4.
 *
 * O ponto mais fácil de quebrar de novo é a assimetria entre os dois caminhos:
 * o QZ Tray ignora `@media print`/`@page` (renderiza como tela), então tudo que
 * define a caixa do cupom tem que estar no `body`, e o bloco de impressão só
 * pode REPETIR essa medida — nunca contradizê-la.
 */

const loja80 = { general: { name: 'Loja Teste', printerSize: '80mm' } };
const loja58 = { general: { name: 'Loja Teste', printerSize: '58mm' } };

const pedido = {
  id: 'abc123def456',
  orderDateTime: '2026-07-24T12:00:00.000Z',
  status: 'pending',
  orderType: 'delivery',
  customerName: 'Fulano de Tal',
  customerPhone: '11999998888',
  deliveryAddress: 'Rua das Flores, 10',
  paymentMethod: 'Dinheiro',
  deliveryFee: 5,
  totalAmount: 35,
  items: [{ name: 'Pizza', quantity: 1, unitPrice: 30 }],
};

const encomenda: any = {
  id: 'enc001',
  customerName: 'Ciclana',
  customerPhone: '11988887777',
  status: 'pendente',
  delivery: { type: 'retirada', date: '2026-08-01', time: '15:00' },
  total: 200,
  sinal: 100,
  sinalPercent: 50,
  saldo: 100,
};

describe('resolvePrinterSize', () => {
  it('lê o formato novo, o legado e cai em 80mm por padrão', () => {
    expect(resolvePrinterSize(loja58)).toBe('58mm');
    expect(resolvePrinterSize({ printerSize: '58mm' })).toBe('58mm');
    expect(resolvePrinterSize(loja80)).toBe('80mm');
    expect(resolvePrinterSize(undefined)).toBe('80mm');
    expect(resolvePrinterSize({ general: {} })).toBe('80mm');
  });
});

describe('baseReceiptCss', () => {
  it('não contradiz o body no bloco de impressão (o QZ não lê @media print)', () => {
    const css = baseReceiptCss('80mm', { padding: '16px' });
    const bloco = css.slice(css.indexOf('@media print'));
    // A regra de impressão repete o mesmo padding do body — se voltar a zerar,
    // o cupom sai com margem no QZ e sem margem no navegador.
    expect(bloco).toContain('padding:16px');
    expect(bloco).not.toContain('padding:0');
  });

  it('usa a medida do papel escolhido', () => {
    expect(baseReceiptCss('58mm')).toContain('@page { size:58mm auto; margin:0; }');
    expect(baseReceiptCss('80mm')).toContain('@page { size:80mm auto; margin:0; }');
  });

  it('reforça mais a tinta e a fonte no 58mm', () => {
    expect(baseReceiptCss('58mm')).toContain('-webkit-text-stroke:0.4px');
    expect(baseReceiptCss('58mm')).toContain('font-size:13px');
    expect(baseReceiptCss('80mm')).toContain('-webkit-text-stroke:0.3px');
    expect(baseReceiptCss('80mm')).toContain('font-size:12px');
  });
});

describe('buildReceiptDocument', () => {
  it('gera um documento fechado, com o corpo e o CSS de quem chamou', () => {
    const html = buildReceiptDocument({ size: '80mm', body: '<p>oi</p>', css: '.x{color:#000;}', title: 'Cupom X' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.endsWith('</body></html>')).toBe(true);
    expect(html).toContain('<title>Cupom X</title>');
    expect(html).toContain('<p>oi</p>');
    expect(html).toContain('.x{color:#000;}');
  });
});

describe('os três cupons saem da mesma base', () => {
  const cupons = (loja: any) => ({
    pedido: buildOrderReceiptHtml(pedido, loja),
    cozinha: buildOrderReceiptHtml(pedido, loja, true),
    encomenda: buildEncomendaReceiptHtml(encomenda, loja),
  });

  it('todos declaram a largura do papel da loja (80mm)', () => {
    for (const html of Object.values(cupons(loja80))) {
      expect(html).toContain('@page { size:80mm auto; margin:0; }');
      expect(html).toContain('width:80mm');
    }
  });

  it('todos acompanham a loja quando ela é 58mm', () => {
    for (const html of Object.values(cupons(loja58))) {
      expect(html).toContain('@page { size:58mm auto; margin:0; }');
      expect(html).toContain('font-size:13px');
    }
  });
});

describe('cupom do pedido', () => {
  it('mantém os dados que o entregador precisa', () => {
    const html = buildOrderReceiptHtml(pedido, loja80);
    expect(html).toContain('Fulano de Tal');
    expect(html).toContain('Rua das Flores, 10');
    expect(html).toContain('*** ENTREGA ***');
    expect(html).toContain('Pedido: #abc12');
    expect(html).toContain('35.00');
  });

  it('na via da cozinha some o dinheiro e aparece o cabeçalho de produção', () => {
    const html = buildOrderReceiptHtml(pedido, loja80, true);
    expect(html).toContain('*** PRODUÇÃO COZINHA ***');
    expect(html).not.toContain('TOTAL');
  });

  it('escapa o que o cliente digitou', () => {
    const html = buildOrderReceiptHtml({ ...pedido, customerName: '<script>x</script>' }, loja80);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
