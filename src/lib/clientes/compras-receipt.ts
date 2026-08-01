'use client';

/**
 * Cupom do HISTÓRICO DE COMPRAS do cliente — o papel que o dono entrega quando
 * o cliente pergunta "o que eu já comprei aqui?".
 *
 * Mesma divisão dos outros comprovantes: a tela apura, este módulo desenha, e a
 * caixa do cupom (58/80mm, fonte térmica) vem de `receipt-print.ts`. Imprime
 * exatamente o que está na lista — se a tela está filtrada por período ou forma
 * de pagamento, o papel sai igual, senão o cliente confere uma coisa e leva
 * outra.
 */

import { buildReceiptDocument, esc, printReceipt, resolvePrinterSize } from '@/lib/receipt-print';
import { brl } from '@/lib/utils';
import { getOrderCode } from '@/lib/order-code';
import {
  foiCancelada, resumoDeCompras, rotuloDaForma, rotuloDoCanal, type CompraDoCliente,
} from './resumo-compras';

const COMPRAS_CSS = `
  .header { text-align: center; margin-bottom: 4px; }
  .header h1 { font-size: 14px; font-weight: bold; text-transform: uppercase; }
  .sep { text-align: center; margin: 4px 0; letter-spacing: -1px; }
  .section { margin: 4px 0; }
  .row { display: flex; justify-content: space-between; padding: 1px 0; gap: 6px; }
  .bold { font-weight: bold; }
  .compra { padding: 2px 0; border-bottom: 1px dotted #999; }
  .compra .desc { display: flex; justify-content: space-between; gap: 6px; font-weight: bold; }
  .compra .meta { font-size: 10px; }
  .itens { font-size: 10px; padding-left: 6px; }
  .cancelada { text-decoration: line-through; }
  .total { text-align: center; padding: 8px 0; margin: 6px 0; border: 2px solid #000; }
  .total .label { font-size: 11px; text-transform: uppercase; }
  .total .valor { font-size: 18px; font-weight: bold; margin-top: 2px; }
  .footer { text-align: center; margin-top: 12px; font-size: 10px; }
`;

const SEP = '================================';
const SEP_DASH = '--------------------------------';

export type ComprasReceiptData = {
  storeInfo: any;
  cliente: { nome?: string; celular?: string };
  /** Já filtradas/ordenadas pela tela. */
  compras: CompraDoCliente[];
  /** Texto do filtro aplicado ("Tudo", "30 dias · Pix"), para o papel ser honesto. */
  filtro?: string;
};

const dataHora = (iso?: string) => {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

export function buildComprasHtml(opts: ComprasReceiptData): string {
  const { storeInfo, cliente, compras, filtro } = opts;
  const storeName = storeInfo?.general?.name || storeInfo?.storeName || 'Loja';
  const agora = new Date();
  const resumo = resumoDeCompras(compras);

  const linhas = compras.map((compra) => {
    const cancelada = foiCancelada(compra);
    const itens = (compra.items || []).map((item: any) => {
      const addons = (item?.addons || []).map((a: any) => a?.name).filter(Boolean).join(', ');
      return `<div>${esc(item?.quantity || 1)}x ${esc(item?.name || '')}${addons ? ` (${esc(addons)})` : ''}</div>`;
    }).join('');
    return `
      <div class="compra${cancelada ? ' cancelada' : ''}">
        <div class="desc">
          <span>#${esc(getOrderCode(compra).substring(0, 8))}</span>
          <span>${brl(Number(compra.totalAmount) || 0)}</span>
        </div>
        <div class="meta">${esc(dataHora(compra.orderDateTime))} · ${esc(rotuloDoCanal(compra))} · ${esc(rotuloDaForma(compra.paymentMethod))}${cancelada ? ' · CANCELADA' : ''}</div>
        ${itens ? `<div class="itens">${itens}</div>` : ''}
      </div>`;
  }).join('');

  const quebra = resumo.porForma
    .map((f) => `<div class="row"><span>${esc(f.chave)} (${f.quantidade})</span><span>${brl(f.total)}</span></div>`)
    .join('');

  const body = `
      <div class="header"><h1>${esc(storeName)}</h1></div>
      <p class="sep">${SEP}</p>
      <div style="text-align:center; padding:6px 0; border:2px solid #000; margin:4px 0; font-size:14px; font-weight:bold; letter-spacing:1px;">
        HISTORICO DE COMPRAS
      </div>
      <p class="sep">${SEP}</p>
      <div class="section">
        <div class="row"><span>Cliente</span><span class="bold">${esc(cliente.nome || '-')}</span></div>
        ${cliente.celular ? `<div class="row"><span>Telefone</span><span>${esc(cliente.celular)}</span></div>` : ''}
        ${filtro ? `<div class="row"><span>Periodo</span><span>${esc(filtro)}</span></div>` : ''}
        <div class="row"><span>Emitido em</span><span>${agora.toLocaleDateString('pt-BR')} ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></div>
      </div>
      <p class="sep">${SEP_DASH}</p>
      ${linhas || '<div class="section" style="text-align:center;">Nenhuma compra no periodo.</div>'}
      <div class="total">
        <div class="label">Total comprado (${resumo.quantidade} compras)</div>
        <div class="valor">${brl(resumo.total)}</div>
        <div class="label" style="margin-top:2px;">Ticket medio ${brl(resumo.ticketMedio)}</div>
      </div>
      ${resumo.canceladas > 0 ? `<div class="section" style="text-align:center; font-size:10px;">${resumo.canceladas} compra(s) cancelada(s) nao entram no total</div>` : ''}
      ${quebra ? `<p class="sep">${SEP_DASH}</p><div class="section"><div class="bold">Por forma de pagamento</div>${quebra}</div>` : ''}
      <div class="footer">
        <p>${SEP}</p>
        <p>Documento gerado automaticamente</p>
        <p>${esc(storeName)}</p>
      </div>`;

  return buildReceiptDocument({
    size: resolvePrinterSize(storeInfo),
    title: 'Historico de compras',
    lineHeight: '1.4',
    css: COMPRAS_CSS,
    body,
  });
}

export function printCompras(opts: ComprasReceiptData): void {
  printReceipt({
    html: buildComprasHtml(opts),
    printerSize: resolvePrinterSize(opts.storeInfo),
  });
}
