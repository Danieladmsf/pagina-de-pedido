'use client';

// Cupom da ENCOMENDA. O corpo é próprio daqui; a caixa do cupom e a impressão
// vêm da base compartilhada `receipt-print.ts` — a mesma do pedido e do caixa
// (QZ Tray silencioso, com fallback total para o navegador).
// Ver [[qz-tray-silent-printing]].

import {
  buildReceiptDocument,
  printReceipt,
  resolvePrinterSize,
  thermalTokens,
  esc,
} from '@/lib/receipt-print';
import type { Encomenda } from './types';
import { ENCOMENDA_STATUS_LABEL } from './types';

function money(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function dateBR(iso?: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}
export function buildEncomendaReceiptHtml(enc: Encomenda, storeInfo: any): string {
  const printerSize = resolvePrinterSize(storeInfo);
  const { is58 } = thermalTokens(printerSize);
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

  const css = `
    .center{text-align:center;}.b{font-weight:bold;}
    .hr{border-top:1px dashed #000;margin:5px 0;}
    .title{font-size:${is58 ? '16px' : '15px'};font-weight:bold;}
    .sec{font-weight:bold;margin-top:5px;text-transform:uppercase;}
    .row{display:flex;justify-content:space-between;gap:8px;}
    .big{font-size:${is58 ? '15px' : '14px'};font-weight:bold;}
  `;

  const body = `
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
    ${enc.delivery?.type === 'delivery' ? [
      [enc.delivery.street, enc.delivery.number, enc.delivery.complement].filter(Boolean).length
        ? `<div>End: ${esc([enc.delivery.street, enc.delivery.number, enc.delivery.complement].filter(Boolean).join(', '))}</div>` : '',
      enc.delivery.neighborhood ? `<div>Bairro: ${esc([enc.delivery.neighborhood, enc.delivery.city].filter(Boolean).join(' - '))}</div>` : '',
      `<div>Taxa: ${enc.delivery.feeStatus === 'a_combinar' ? 'a combinar' : money(enc.deliveryFee || 0)}</div>`,
    ].join('') : ''}
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
  `;

  // Margem menor que a do cupom de pedido: a encomenda é um corpo mais longo e
  // aproveita melhor a largura da bobina.
  return buildReceiptDocument({
    size: printerSize,
    title: 'Encomenda',
    padding: '4px 6px',
    lineHeight: '1.35',
    css,
    body,
  });
}

export function printEncomendaReceipt(opts: { enc: Encomenda; storeInfo: any }): void {
  if (!opts.enc) return;
  const html = buildEncomendaReceiptHtml(opts.enc, opts.storeInfo);
  printReceipt({ html, printerSize: resolvePrinterSize(opts.storeInfo) });
}
