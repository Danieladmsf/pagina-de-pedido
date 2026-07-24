import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { baseReceiptCss, buildReceiptDocument, claimAutoPrint, resolvePrintMode, resolvePrinterSize } from './receipt-print';
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

describe('resolvePrintMode', () => {
  it('o campo novo manda, mesmo com o legado gravado ao contrário', () => {
    // Este é o ponto do refactor: perfil que tem os dois e discorda não pode
    // mais fazer o som obedecer um e a impressão obedecer o outro.
    expect(resolvePrintMode({ general: { printMode: 'auto_sound', manualPrint: true } })).toBe('auto_sound');
    expect(resolvePrintMode({ general: { printMode: 'manual', manualPrint: false } })).toBe('manual');
  });

  it('perfil antigo, que só tem manualPrint, continua funcionando sem migração', () => {
    expect(resolvePrintMode({ general: { manualPrint: true } })).toBe('manual');
    expect(resolvePrintMode({ general: { manualPrint: false } })).toBe('auto_silent');
    expect(resolvePrintMode({ manualPrint: true })).toBe('manual');
  });

  it('lê o campo na raiz do perfil, não só dentro de general', () => {
    expect(resolvePrintMode({ printMode: 'auto_sound' })).toBe('auto_sound');
  });

  it('sem perfil, ou com valor estragado, cai no automático silencioso', () => {
    expect(resolvePrintMode(undefined)).toBe('auto_silent');
    expect(resolvePrintMode({})).toBe('auto_silent');
    expect(resolvePrintMode({ general: { printMode: 'qualquer_coisa' } })).toBe('auto_silent');
    expect(resolvePrintMode({ general: { printMode: 'qualquer_coisa', manualPrint: true } })).toBe('manual');
  });
});

describe('claimAutoPrint', () => {
  // localStorage de mentira: o teste roda em node, sem navegador.
  function storageFalso(throwOnWrite = false) {
    const map = new Map<string, string>();
    return {
      get length() { return map.size; },
      key: (i: number) => Array.from(map.keys())[i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { if (throwOnWrite) throw new Error('bloqueado'); map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
      _map: map,
    };
  }

  const montarJanela = (storage: any) => { (globalThis as any).window = { localStorage: storage }; };

  beforeEach(() => { vi.useRealTimers(); });
  afterEach(() => { delete (globalThis as any).window; vi.useRealTimers(); });

  it('a primeira aba ganha e a segunda desiste — é o cupom dobrado que isto evita', async () => {
    montarJanela(storageFalso());
    expect(await claimAutoPrint('pedido-1')).toBe(true);
    expect(await claimAutoPrint('pedido-1')).toBe(false);
    expect(await claimAutoPrint('pedido-1')).toBe(false);
  });

  it('cada pedido tem a sua reserva', async () => {
    montarJanela(storageFalso());
    expect(await claimAutoPrint('pedido-1')).toBe(true);
    expect(await claimAutoPrint('pedido-2')).toBe(true);
  });

  it('reserva velha (fora do TTL) não trava o pedido para sempre', async () => {
    const storage = storageFalso();
    montarJanela(storage);
    storage._map.set('autoprint:pedido-1', String(Date.now() - 11 * 60 * 1000));
    expect(await claimAutoPrint('pedido-1')).toBe(true);
  });

  it('varre reservas vencidas de outros pedidos em vez de acumular', async () => {
    const storage = storageFalso();
    montarJanela(storage);
    storage._map.set('autoprint:antigo', String(Date.now() - 60 * 60 * 1000));
    storage._map.set('nao-e-nosso', 'preservar');
    await claimAutoPrint('pedido-1');
    expect(storage._map.has('autoprint:antigo')).toBe(false);
    expect(storage._map.get('nao-e-nosso')).toBe('preservar');
  });

  it('com localStorage bloqueado, imprime: cupom repetido incomoda, pedido perdido custa', async () => {
    montarJanela(storageFalso(true));
    expect(await claimAutoPrint('pedido-1')).toBe(true);
    expect(await claimAutoPrint('pedido-1')).toBe(true);
  });

  it('sem id de pedido não reserva nada', async () => {
    montarJanela(storageFalso());
    expect(await claimAutoPrint('')).toBe(true);
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
