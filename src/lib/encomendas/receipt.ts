'use client';

// Cupom da ENCOMENDA como HTML autossuficiente (estilos inline), impresso pelo
// MESMO caminho dos pedidos: printHtmlOrFallback (QZ Tray silencioso, com
// fallback total para impressão pelo navegador). Ver [[qz-tray-silent-printing]].

import { printHtmlOrFallback, type PrinterSize } from '@/lib/qz-print';
import type { Encomenda } from './types';
import { ENCOMENDA_STATUS_LABEL } from './types';

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function money(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function dateBR(iso?: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}
function resolvePrinterSize(storeInfo: any): PrinterSize {
  return (storeInfo?.general?.printerSize || storeInfo?.printerSize) === '58mm' ? '58mm' : '80mm';
}

// Fallback de impressão pelo navegador (iframe oculto) — usado quando o QZ Tray
// não está rodando. Mesmo princípio do resto do app.
function printHtmlInIframe(html: string): void {
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

export function buildEncomendaReceiptHtml(enc: Encomenda, storeInfo: any): string {
  const is58 = resolvePrinterSize(storeInfo) === '58mm';
  const maxWidth = is58 ? '58mm' : '80mm';
  const fontSize = is58 ? '13px' : '12px';
  const bodyWeight = is58 ? 'bold' : 'normal';
  const ink = is58 ? '-webkit-text-stroke:0.4px #000;' : '-webkit-text-stroke:0.3px #000;';
  const storeName = storeInfo?.general?.name || storeInfo?.storeName || 'Confeitaria';

  const lineRows = (title: string, items: any[]) => (items && items.length) ? `
    <div class="sec">${esc(title)}</div>
    ${items.map((l) => `<div class="row"><span>${l.qty}x ${esc(l.name)}</span><span>${money(l.total)}</span></div>`).join('')}
  ` : '';

  const boloBlock = enc.bolo ? `
    <div class="sec">BOLO</div>
    <div>Tamanho: ${esc(enc.bolo.size)}</div>
    <div>Massa: ${esc(enc.bolo.dough)}</div>
    <div>Recheio: ${esc(enc.bolo.filling)}</div>
    <div>Cobertura: ${esc(enc.bolo.cover)}</div>
    ${enc.bolo.plate?.on ? `<div>Plaquinha: ${esc([enc.bolo.plate.name, enc.bolo.plate.age && `${enc.bolo.plate.age} anos`, enc.bolo.plate.theme].filter(Boolean).join(', ') || 'sim')}</div>` : ''}
    <div class="row"><span>Subtotal bolo</span><span>${money(enc.bolo.total)}</span></div>
  ` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'Courier New',monospace;width:${maxWidth};max-width:${maxWidth};font-size:${fontSize};font-weight:${bodyWeight};${ink}color:#000;line-height:1.35;padding:4px 6px;}
    .center{text-align:center;}.b{font-weight:bold;}
    .hr{border-top:1px dashed #000;margin:5px 0;}
    .title{font-size:${is58 ? '16px' : '15px'};font-weight:bold;}
    .sec{font-weight:bold;margin-top:5px;text-transform:uppercase;}
    .row{display:flex;justify-content:space-between;gap:8px;}
    .big{font-size:${is58 ? '15px' : '14px'};font-weight:bold;}
  </style></head><body>
    <div class="center title">${esc(storeName)}</div>
    <div class="center">** ENCOMENDA **</div>
    <div class="center b">#${esc(enc.id)}</div>
    <div class="hr"></div>
    <div>Cliente: ${esc(enc.customerName)}</div>
    <div>WhatsApp: ${esc(enc.customerPhone)}</div>
    ${enc.isEmpresa ? `<div class="b">** EMITIR NF-e **</div>` : ''}
    <div class="hr"></div>
    <div class="b">ENTREGA</div>
    <div>Data: ${dateBR(enc.delivery?.date)} ${esc(enc.delivery?.time || '')}</div>
    <div>Forma: ${enc.delivery?.type === 'delivery' ? 'Entrega' : 'Retirada no local'}</div>
    <div class="hr"></div>
    ${boloBlock}
    ${lineRows('Especial da casa', enc.especialItems || [])}
    ${lineRows('Tortas', enc.tortasItems || [])}
    ${lineRows('Docinhos', enc.docinhosItems || [])}
    <div class="hr"></div>
    <div class="row big"><span>TOTAL</span><span>${money(enc.total)}</span></div>
    <div class="row"><span>Sinal (${esc(enc.sinalPercent)}%)</span><span>${money(enc.sinal)}</span></div>
    <div class="row"><span>Saldo na entrega</span><span>${money(enc.saldo)}</span></div>
    ${enc.orderNotes ? `<div class="hr"></div><div>Obs: ${esc(enc.orderNotes)}</div>` : ''}
    <div class="hr"></div>
    <div class="center">Status: ${esc(ENCOMENDA_STATUS_LABEL[enc.status] || enc.status)}</div>
  </body></html>`;
}

export function printEncomendaReceipt(opts: { enc: Encomenda; storeInfo: any }): void {
  if (!opts.enc) return;
  const html = buildEncomendaReceiptHtml(opts.enc, opts.storeInfo);
  void printHtmlOrFallback({ html, printerSize: resolvePrinterSize(opts.storeInfo), fallback: () => printHtmlInIframe(html) });
}
