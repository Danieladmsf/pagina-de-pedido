'use client';

// Cupom da ENCOMENDA. O corpo é próprio daqui; a caixa do cupom e a impressão
// vêm da base compartilhada `receipt-print.ts` — a mesma do pedido e do caixa
// (QZ Tray silencioso, com fallback total para o navegador).
// Ver [[qz-tray-silent-printing]].
//
// O cupom é a ordem de produção: o que não sai aqui, a confeiteira não faz.
// Por isso ele acompanha os DOIS modelos de bolo do catálogo — o por quilo
// (sabor/peso/formato/adicionais) e o antigo (tamanho/recheio/cobertura) — e
// nunca imprime rótulo de campo vazio.

import {
  buildReceiptDocument,
  printReceipt,
  resolvePrinterSize,
  thermalTokens,
  esc,
} from '@/lib/receipt-print';
import { brl } from '@/lib/utils';
import type { Encomenda } from './types';
import { ENCOMENDA_STATUS_LABEL } from './types';
import { saldoAReceber, valorRecebido } from './pagamento';

function dateBR(iso?: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/** Data e hora em que a encomenda foi tirada. */
function emitidoEm(iso?: string): string {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function buildEncomendaReceiptHtml(enc: Encomenda, storeInfo: any): string {
  const printerSize = resolvePrinterSize(storeInfo);
  const { is58 } = thermalTokens(printerSize);
  const storeName = storeInfo?.general?.name || storeInfo?.storeName || 'Confeitaria';

  const linha = (rotulo: string, valor?: string | number | null) =>
    (valor === 0 || valor) ? `<div>${esc(rotulo)}: ${esc(valor)}</div>` : '';

  const lineRows = (title: string, items: any[]) => (items && items.length) ? `
    <div class="sec">${esc(title)}</div>
    ${items.map((l) => `<div class="row"><span>${l.qty}x ${esc(l.name)}</span><span>${brl(l.total)}</span></div>`).join('')}
  ` : '';

  const bolo = enc.bolo;
  // Bolo por quilo: o peso e o sabor vêm nos campos próprios. Sem eles é o
  // modelo antigo (tamanho + recheio + cobertura).
  const boloPorKg = !!(bolo && (bolo.weight || bolo.flavor || bolo.pricePerKg));
  const plaquinha = bolo?.plate;

  const boloBlock = !bolo ? '' : `
    <div class="sec">BOLO</div>
    ${boloPorKg ? `
      ${linha('Sabor', bolo.flavor || bolo.filling)}
      ${linha('Peso', [bolo.weight || bolo.size, bolo.pricePerKg ? `(${brl(bolo.pricePerKg)}/kg)` : ''].filter(Boolean).join(' '))}
      ${linha('Formato', bolo.shape)}
      ${linha('Massa', bolo.dough)}
      ${(bolo.extras && bolo.extras.length) ? `
        <div class="sub">Adicionais</div>
        ${bolo.extras.map((x: any) => `<div class="row"><span>+ ${esc(x.name)}</span><span>${brl(x.price)}</span></div>`).join('')}
      ` : ''}
    ` : `
      ${linha('Tamanho', bolo.size)}
      ${linha('Massa', bolo.dough)}
      ${linha('Recheio', bolo.filling)}
      ${linha('Cobertura', bolo.cover)}
    `}
    ${plaquinha?.on ? `
      <div class="sub">Plaquinha</div>
      ${linha('Nome', plaquinha.name)}
      ${linha('Idade', plaquinha.age ? `${plaquinha.age} anos` : '')}
      ${linha('Tema', plaquinha.theme)}
      ${linha('Recado', plaquinha.notes)}
      ${plaquinha.imageUrl ? '<div>** tem foto de referencia **</div>' : ''}
    ` : ''}
    <div class="row"><span>Subtotal bolo</span><span>${brl(bolo.total)}</span></div>
  `;

  const recebido = valorRecebido(enc);
  const falta = saldoAReceber(enc);
  const emitido = emitidoEm(enc.orderDateTime);

  const css = `
    .center{text-align:center;}.b{font-weight:bold;}
    .hr{border-top:1px dashed #000;margin:5px 0;}
    .title{font-size:${is58 ? '16px' : '15px'};font-weight:bold;}
    .sec{font-weight:bold;margin-top:5px;text-transform:uppercase;}
    .sub{font-weight:bold;margin-top:3px;}
    .row{display:flex;justify-content:space-between;gap:8px;}
    .big{font-size:${is58 ? '15px' : '14px'};font-weight:bold;}
    .box{border:1px solid #000;padding:3px 4px;margin-top:4px;text-align:center;font-weight:bold;}
  `;

  const body = `
    <div class="center title">${esc(storeName)}</div>
    <div class="center">** ENCOMENDA **</div>
    <div class="center b">#${esc(enc.id)}</div>
    ${emitido ? `<div class="center">Pedido em ${esc(emitido)}</div>` : ''}
    <div class="hr"></div>
    <div>Cliente: ${esc(enc.customerName)}</div>
    <div>WhatsApp: ${esc(enc.customerPhone)}</div>
    ${enc.isEmpresa ? '<div class="b">** EMITIR NF-e **</div>' : ''}
    <div class="hr"></div>
    <div class="b">${enc.delivery?.type === 'delivery' ? 'ENTREGA' : 'RETIRADA'}</div>
    <div>Data: ${dateBR(enc.delivery?.date)} ${esc(enc.delivery?.time || '')}</div>
    ${enc.delivery?.type === 'delivery' ? [
      [enc.delivery.street, enc.delivery.number, enc.delivery.complement].filter(Boolean).length
        ? `<div>End: ${esc([enc.delivery.street, enc.delivery.number, enc.delivery.complement].filter(Boolean).join(', '))}</div>` : '',
      enc.delivery.neighborhood ? `<div>Bairro: ${esc([enc.delivery.neighborhood, enc.delivery.city].filter(Boolean).join(' - '))}</div>` : '',
      `<div>Taxa: ${enc.delivery.feeStatus === 'a_combinar' ? 'a combinar' : brl(enc.deliveryFee || 0)}</div>`,
    ].join('') : ''}
    <div class="hr"></div>
    ${boloBlock}
    ${lineRows('Especial da casa', enc.especialItems || [])}
    ${lineRows('Tortas', enc.tortasItems || [])}
    ${lineRows('Docinhos', enc.docinhosItems || [])}
    <div class="hr"></div>
    ${(enc.deliveryFee || 0) > 0 ? `<div class="row"><span>Subtotal</span><span>${brl(enc.subtotal)}</span></div>
    <div class="row"><span>Taxa de entrega</span><span>${brl(enc.deliveryFee)}</span></div>` : ''}
    <div class="row big"><span>TOTAL</span><span>${brl(enc.total)}</span></div>
    ${enc.sinal > 0 ? `<div class="row"><span>Entrada combinada (${esc(enc.sinalPercent)}%)</span><span>${brl(enc.sinal)}</span></div>` : ''}
    <div class="row"><span>Ja pago</span><span>${brl(recebido)}</span></div>
    ${falta > 0
      ? `<div class="box">FALTA ${brl(falta)}${enc.delivery?.type === 'delivery' ? ' NA ENTREGA' : ' NA RETIRADA'}</div>`
      : '<div class="box">PAGO POR INTEIRO</div>'}
    ${enc.orderNotes ? `<div class="hr"></div><div class="b">OBSERVACAO</div><div>${esc(enc.orderNotes)}</div>` : ''}
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
