'use client';

/**
 * Base ÚNICA de todo cupom térmico do sistema (pedido, caixa e encomenda).
 *
 * Antes isto existia em três cópias — cada tela montava seu próprio CSS
 * térmico, seu próprio `resolvePrinterSize` e seu próprio iframe de fallback.
 * As cópias divergiram: a da encomenda nem tinha `@page`, então o fallback do
 * navegador saía em folha A4; a do caixa e a do pedido limpavam o iframe com
 * um timer fixo em vez de `onafterprint`.
 *
 * REGRA DESTE ARQUIVO: o cupom tem que sair igual pelos dois caminhos.
 *
 *   - QZ Tray → renderiza o HTML como TELA e rasteriza na largura do config
 *     (`qz-print.ts`). Aqui `@media print` e `@page` são IGNORADOS.
 *   - Navegador (fallback) → aí sim `@media print`/`@page` valem.
 *
 * Por isso o que define a caixa do cupom (largura e padding) mora no `body`,
 * que os dois leem, e o bloco de impressão apenas REPETE essa mesma medida em
 * vez de contradizê-la. Era essa contradição (`@media print { body{padding:0} }`
 * por cima de `body{padding:16px}`) que fazia ajuste no `@media print` não
 * surtir efeito nenhum na impressora de verdade.
 */

import { printHtmlOrFallback, type PrinterSize } from './qz-print';

export type { PrinterSize };

/** Escapa texto do usuário para interpolar no HTML do cupom. */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Tamanho de papel da loja (58mm ou 80mm). Aceita o formato novo e o legado. */
export function resolvePrinterSize(storeInfo: any): PrinterSize {
  return (storeInfo?.general?.printerSize || storeInfo?.printerSize) === '58mm' ? '58mm' : '80mm';
}

export type ThermalTokens = {
  is58: boolean;
  maxWidth: string;
  fontSize: string;
  bodyWeight: string;
  inkBoost: string;
};

/**
 * Medidas por tamanho de papel. 58mm e 80mm são independentes: mexer numa NÃO
 * afeta a outra.
 *
 * 58mm: bobina pequena imprime fraco, então a fonte é maior (13px) e o cupom
 * inteiro sai em negrito, aproveitando o vertical do rolo já que a largura é
 * apertada. 80mm fica em 12px e peso normal.
 *
 * inkBoost: impressão térmica sai apagada; o text-stroke engrossa cada letra no
 * render do QZ (Chromium) e escurece sem aumentar a fonte. Propriedade herdada
 * → pega o cupom inteiro.
 */
export function thermalTokens(size: PrinterSize): ThermalTokens {
  const is58 = size === '58mm';
  return {
    is58,
    maxWidth: is58 ? '58mm' : '80mm',
    fontSize: is58 ? '13px' : '12px',
    bodyWeight: is58 ? 'bold' : 'normal',
    inkBoost: is58 ? '-webkit-text-stroke:0.4px #000;' : '-webkit-text-stroke:0.3px #000;',
  };
}

/**
 * CSS base do cupom: reset, corpo térmico e a regra de papel. É a única parte
 * que precisa ser idêntica entre QZ e navegador — o resto do visual cada cupom
 * monta como quiser e passa em `css`.
 */
export function baseReceiptCss(
  size: PrinterSize,
  opts: { padding?: string; lineHeight?: string } = {},
): string {
  const { maxWidth, fontSize, bodyWeight, inkBoost } = thermalTokens(size);
  const padding = opts.padding ?? '16px';
  const lineHeight = opts.lineHeight ?? '1.25';
  return `
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family:'Courier New',Courier,monospace; color:#000; background:#fff;
      font-size:${fontSize}; font-weight:${bodyWeight}; ${inkBoost}
      line-height:${lineHeight};
      width:${maxWidth}; max-width:${maxWidth}; margin:0 auto; padding:${padding};
    }
    @page { size:${maxWidth} auto; margin:0; }
    @media print { body { width:${maxWidth}; max-width:${maxWidth}; padding:${padding}; } }
  `;
}

/** Monta o documento HTML autossuficiente do cupom. */
export function buildReceiptDocument(opts: {
  size: PrinterSize;
  body: string;
  css?: string;
  title?: string;
  padding?: string;
  lineHeight?: string;
}): string {
  const { size, body, css = '', title = 'Cupom', padding, lineHeight } = opts;
  const style = baseReceiptCss(size, { padding, lineHeight }) + css;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${style}</style></head><body>${body}</body></html>`;
}

/**
 * Fallback do navegador: imprime o HTML num iframe fora da tela.
 *
 * Não usa `display:none` (navegador pode pular iframe oculto na impressão) e
 * limpa por `onafterprint`, não por timer no escuro.
 */
export function printHtmlInIframe(html: string): void {
  if (typeof document === 'undefined') return;
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) { iframe.remove(); return; }
  doc.open(); doc.write(html); doc.close();
  const win = iframe.contentWindow!;
  const cleanup = () => setTimeout(() => iframe.remove(), 1000);
  win.onafterprint = cleanup;
  setTimeout(() => { try { win.focus(); win.print(); } catch { /* ignore */ } cleanup(); }, 250);
}

/**
 * Imprime um cupom: QZ Tray se estiver rodando, senão navegador.
 *
 * Passe um `fallback` no-op para impressão automática em PC de monitoramento
 * sem impressora (não abrir o modal do navegador a cada pedido).
 */
export function printReceipt(opts: {
  html: string;
  printerSize: PrinterSize;
  fallback?: () => void;
}): void {
  const { html, printerSize } = opts;
  const fallback = opts.fallback ?? (() => printHtmlInIframe(html));
  void printHtmlOrFallback({ html, printerSize, fallback });
}
