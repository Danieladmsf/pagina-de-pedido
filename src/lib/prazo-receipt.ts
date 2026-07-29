'use client';

/**
 * Cupom do EXTRATO DO PRAZO (Conta da Casa) — o papel que o dono entrega na
 * mão do cliente para ele conferir a conta.
 *
 * Segue a mesma divisão dos outros comprovantes (pedido, caixa, encomenda): a
 * tela apura os números e este módulo só desenha; a caixa do cupom (largura,
 * padding, papel 58/80mm) vem inteira de `receipt-print.ts`.
 */

import {
  buildReceiptDocument,
  esc,
  printReceipt,
  resolvePrinterSize,
} from './receipt-print';
import { brl } from '@/lib/utils';
import type { StatementRow } from './prazo-statement';

const PRAZO_CSS = `
  .header { text-align: center; margin-bottom: 4px; }
  .header h1 { font-size: 14px; font-weight: bold; text-transform: uppercase; }
  .header p { font-size: 11px; }
  .sep { text-align: center; margin: 4px 0; letter-spacing: -1px; }
  .section { margin: 4px 0; }
  .row { display: flex; justify-content: space-between; padding: 1px 0; gap: 6px; }
  .bold { font-weight: bold; }
  .lanc { padding: 2px 0; border-bottom: 1px dotted #999; }
  .lanc .desc { display: flex; justify-content: space-between; gap: 6px; font-weight: bold; }
  .lanc .meta { font-size: 10px; }
  .itens { font-size: 10px; padding-left: 6px; }
  .saldo { text-align: center; padding: 8px 0; margin: 6px 0; border: 2px solid #000; }
  .saldo .label { font-size: 11px; text-transform: uppercase; }
  .saldo .valor { font-size: 18px; font-weight: bold; margin-top: 2px; }
  .pix { margin-top: 4px; padding: 4px; border: 1px dashed #000; font-size: 11px; word-break: break-all; }
  .footer { text-align: center; margin-top: 12px; font-size: 10px; }
`;

const SEP = '================================';
const SEP_DASH = '--------------------------------';

export type ExtratoPrazoData = {
  storeInfo: any;
  cliente: { nome?: string; celular?: string };
  /** Já filtrado/ordenado pela tela — o cupom imprime exatamente o que está na lista. */
  rows: StatementRow[];
  saldo: number;
  /** Texto pronto do vencimento ("vence 10/08" / "vencida desde 10/07"). */
  vencimento?: string;
  pixKey?: string;
  pixName?: string;
};

const dataHora = (iso?: string) => {
  const time = Date.parse(iso || '');
  if (Number.isNaN(time)) return '';
  const date = new Date(time);
  return `${date.toLocaleDateString('pt-BR')} ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

export function buildExtratoPrazoHtml(opts: ExtratoPrazoData): string {
  const { storeInfo, cliente, rows, saldo, vencimento, pixKey, pixName } = opts;
  const storeName = storeInfo?.general?.name || storeInfo?.storeName || 'Loja';
  const agora = new Date();
  // Saldo negativo é crédito do cliente, não dívida: o papel não pode entregar
  // "Saldo devedor -R$ 96,00" nem pedir PIX de uma conta já quitada.
  const temDivida = saldo > 0.009;
  const creditoAFavor = saldo < -0.009 ? -saldo : 0;

  const lancamentos = rows.map(({ tx, order }) => {
    const isDebit = tx.type === 'debit';
    const itens = isDebit
      ? (order?.items || []).map((item: any) => {
          const addons = (item?.addons || []).map((addon: any) => addon?.name).filter(Boolean).join(', ');
          return `<div>${esc(item?.quantity || 1)}x ${esc(item?.name || '')}${addons ? ` (${esc(addons)})` : ''}</div>`;
        }).join('')
      : '';
    return `
      <div class="lanc">
        <div class="desc">
          <span>${esc(tx.description || (isDebit ? 'Compra' : 'Pagamento'))}</span>
          <span>${isDebit ? '+' : '-'} ${brl(tx.amount)}</span>
        </div>
        <div class="meta">${esc(dataHora(tx.date))}</div>
        ${itens ? `<div class="itens">${itens}</div>` : ''}
      </div>`;
  }).join('');

  const body = `
      <div class="header">
        <h1>${esc(storeName)}</h1>
      </div>
      <p class="sep">${SEP}</p>
      <div style="text-align:center; padding:6px 0; border:2px solid #000; margin:4px 0; font-size:14px; font-weight:bold; letter-spacing:1px;">
        EXTRATO DA CONTA (PRAZO)
      </div>
      <p class="sep">${SEP}</p>
      <div class="section">
        <div class="row"><span>Cliente</span><span class="bold">${esc(cliente.nome || '-')}</span></div>
        ${cliente.celular ? `<div class="row"><span>Telefone</span><span>${esc(cliente.celular)}</span></div>` : ''}
        <div class="row"><span>Emitido em</span><span>${agora.toLocaleDateString('pt-BR')} ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></div>
      </div>
      <p class="sep">${SEP_DASH}</p>
      ${lancamentos || '<div class="section" style="text-align:center;">Nenhum lancamento no periodo.</div>'}
      <div class="saldo">
        <div class="label">${temDivida ? 'Saldo devedor' : (creditoAFavor > 0 ? 'Credito a favor' : 'Conta quitada')}</div>
        <div class="valor">${brl(creditoAFavor > 0 ? creditoAFavor : saldo)}</div>
        ${temDivida && vencimento ? `<div class="label" style="margin-top:2px;">${esc(vencimento)}</div>` : ''}
        ${creditoAFavor > 0 ? '<div class="label" style="margin-top:2px;">A loja deve este valor</div>' : ''}
      </div>
      ${(temDivida && (pixKey || pixName)) ? `
      <div class="pix">
        <div class="bold">Pague via PIX</div>
        ${pixKey ? `<div>Chave: ${esc(pixKey)}</div>` : ''}
        ${pixName ? `<div>${esc(pixName)}</div>` : ''}
      </div>` : ''}
      <div class="footer">
        <p>${SEP}</p>
        <p>Documento gerado automaticamente</p>
        <p>${esc(storeName)}</p>
      </div>`;

  return buildReceiptDocument({
    size: resolvePrinterSize(storeInfo),
    title: 'Extrato do Prazo',
    lineHeight: '1.4',
    css: PRAZO_CSS,
    body,
  });
}

export function printExtratoPrazo(opts: ExtratoPrazoData): void {
  printReceipt({
    html: buildExtratoPrazoHtml(opts),
    printerSize: resolvePrinterSize(opts.storeInfo),
  });
}
