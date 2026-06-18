'use client';

/**
 * Gera o cupom de PEDIDO como HTML autossuficiente (estilos inline/embutidos),
 * espelhando o componente <PrintReceipt/>. Impressão segue o MESMO caminho
 * nativo da sangria (printHtmlViaQz → QZ format:'html'): o QZ pagina pelo
 * conteúdo e imprime o cupom inteiro, sem rasterizar imagem e sem "picar".
 */

import { printHtmlOrFallback, type PrinterSize } from './qz-print';

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(n: number): string {
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

function resolvePrinterSize(storeInfo: any): PrinterSize {
  return (storeInfo?.general?.printerSize || storeInfo?.printerSize) === '58mm' ? '58mm' : '80mm';
}

/** Monta a string HTML completa do cupom (igual em conteúdo ao PrintReceipt). */
export function buildOrderReceiptHtml(order: any, storeInfo: any, isKitchen = false): string {
  const printerSize = resolvePrinterSize(storeInfo);
  const is58 = printerSize === '58mm';
  const maxWidth = is58 ? '58mm' : '80mm';
  // Fonte POR tamanho de papel (independentes — cada conta usa só um). 58mm:
  // bobina pequena imprime fraco, então a fonte é maior (13px) e o cupom inteiro
  // sai em negrito, aproveitando o vertical do rolo já que a largura é apertada.
  // 80mm permanece intacto: 12px e peso normal. Mexer numa NÃO afeta a outra.
  const fontSize = is58 ? '13px' : '12px';
  const bodyWeight = is58 ? 'bold' : 'normal';
  // Adicionais ("> nome"): no 58mm a bobina imprime fraco, então sobe pra 14px
  // pra ficar legível. 80mm permanece em 10px (intacto).
  const addonFontSize = is58 ? '14px' : '10px';
  // Espaço vertical entre cada adicionário ("> nome") no 58mm. 80mm fica intacto.
  const addonGap = is58 ? '4px' : '0';
  const storeName = storeInfo?.general?.name || storeInfo?.storeName || 'Loja';

  const dt = new Date(order?.orderDateTime || Date.now());
  const dataStr = dt.toLocaleDateString('pt-BR');
  const horaStr = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const showPrevisao =
    !['delivered', 'canceled', 'completed', 'awaiting_payment'].includes(order?.status) &&
    order?.orderType === 'delivery';
  const previsaoStr = new Date(dt.getTime() + 50 * 60000).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const tipoLabel =
    order?.orderType === 'pickup'
      ? '*** RETIRADA NO LOCAL ***'
      : order?.orderType === 'dine_in'
      ? '*** COMER NO LOCAL ***'
      : '*** ENTREGA ***';

  const items: any[] = order?.items || [];
  const subtotal = items.reduce((acc, item) => acc + (item.unitPrice || 0) * (item.quantity || 0), 0);

  // Pagamento + troco (mesma lógica do PrintReceipt).
  let paymentText: string = order?.paymentMethod || 'Pagamento na Entrega/Retirada';
  let changeFor = 0;
  let changeAmount = 0;
  const trocoMatch = paymentText.match(/Troco para R\$\s*([\d.,]+)/i);
  if (trocoMatch) {
    const val = parseFloat(trocoMatch[1].replace(',', '.'));
    if (!isNaN(val)) {
      changeFor = val;
      changeAmount = val - (order?.totalAmount || 0);
      paymentText = paymentText.replace(/\s*\(Troco para.*?\)/i, '').trim();
    }
  }

  const itemsRows = items
    .map((item) => {
      const addonList: any[] = item.addons || [];
      const addonHtml = (a: any) =>
        `<div class="addon">&gt; ${esc(a.name)} ${
          !isKitchen && a.price ? `(+R$ ${money(a.price)})` : ''
        }</div>`;
      // 80mm (intacto): lista plana dos adicionais.
      const addons = addonList.map(addonHtml).join('');
      // 58mm: agrupa por grupo e mostra o título de cada um (Refogado, Farofa,
      // ...), igual ao carrinho. Mantém a ordem em que os grupos aparecem.
      const addonsGrouped = (() => {
        if (addonList.length === 0) return '';
        const groupOrder: string[] = [];
        const byGroup: Record<string, any[]> = {};
        for (const a of addonList) {
          const g = (a.group || '').trim() || 'Adicionais';
          if (!byGroup[g]) {
            byGroup[g] = [];
            groupOrder.push(g);
          }
          byGroup[g].push(a);
        }
        return groupOrder
          .map((g) => `<div class="addon-title">${esc(g)}</div>${byGroup[g].map(addonHtml).join('')}`)
          .join('');
      })();
      const notes = item.notes ? `<div class="obs">Obs: ${esc(item.notes)}</div>` : '';
      const valueCell = !isKitchen
        ? `<td class="val">R$ ${money((item.unitPrice || 0) * (item.quantity || 0))}</td>`
        : '';
      // 58mm: detalhes (título do grupo + adicionais + obs) numa linha de largura
      // total começando na margem esquerda — aproveita o espaço e não quebra
      // palavra. A linha do item (qtd/nome/valor) e o layout 80mm ficam intactos.
      if (is58) {
        const details =
          addonsGrouped || notes
            ? `<tr><td colspan="${isKitchen ? 2 : 3}" class="details">${addonsGrouped}${notes}</td></tr>`
            : '';
        return `<tr>
        <td class="qtd">${esc(item.quantity)}</td>
        <td><div class="item-name">${esc(item.name)}</div></td>
        ${valueCell}
      </tr>${details}`;
      }
      return `<tr>
        <td class="qtd">${esc(item.quantity)}</td>
        <td><div class="item-name">${esc(item.name)}</div>${addons}${notes}</td>
        ${valueCell}
      </tr>`;
    })
    .join('');

  const totaisBlock = isKitchen
    ? ''
    : `
      <div class="sec mb">
        <div class="row"><span>Subtotal</span><span>R$ ${money(subtotal)}</span></div>
        ${
          order?.orderType === 'delivery'
            ? `<div class="row"><span>Taxa de entrega</span><span>${
                order?.deliveryFee > 0 ? `R$ ${money(order.deliveryFee)}` : 'Grátis'
              }</span></div>`
            : ''
        }
        <div class="t-dash mt2 pt2">
          <div class="row total-row"><span>TOTAL</span><span>R$ ${money(order?.totalAmount || 0)}</span></div>
        </div>
        ${
          changeFor > 0 && changeAmount > 0
            ? `<div class="pay sec">
                 <div class="row"><span>PAGAMENTO</span><span>R$ ${money(changeFor)}</span></div>
                 <div class="row"><span>TROCO</span><span>R$ ${money(changeAmount)}</span></div>
               </div>`
            : ''
        }
        <div class="forma b-dash pb">Forma: ${esc(paymentText)}</div>
      </div>
      <div class="footer">
        <p>Obrigado pela preferência!</p>
        <p>${esc(storeName)}</p>
      </div>`;

  const css = `
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Courier New',Courier,monospace; color:#000; background:#fff; font-size:${fontSize}; font-weight:${bodyWeight}; line-height:1.25; padding:16px; max-width:${maxWidth}; margin:0 auto; }
    .center { text-align:center; }
    .bold { font-weight:bold; }
    .upper { text-transform:uppercase; }
    .lg { font-size:18px; }
    .b-dash { border-bottom:1px dashed #000; }
    .t-dash { border-top:1px dashed #000; }
    .pb { padding-bottom:16px; }
    .mb { margin-bottom:16px; }
    .mb1 { margin-bottom:4px; }
    .mt2 { margin-top:8px; }
    .pt2 { padding-top:8px; }
    .row { display:flex; justify-content:space-between; }
    .sec > * + * { margin-top:4px; }
    table { width:100%; border-collapse:collapse; text-align:left; }
    th { font-weight:bold; padding:4px 0; border-bottom:1px solid #000; }
    td { padding:4px 0; vertical-align:top; }
    .qtd { width:32px; }
    .val { width:64px; text-align:right; white-space:nowrap; }
    .item-name { font-weight:bold; font-size:13px; }
    .addon { font-size:${addonFontSize}; font-weight:bold; padding-left:8px; margin-bottom:${addonGap}; }
    .obs { font-size:12px; font-weight:bold; padding-left:8px; font-style:italic; }
    .details .addon, .details .obs { padding-left:0; }
    .addon-title { font-weight:bold; text-transform:uppercase; font-size:11px; margin-top:3px; }
    .total-row { font-weight:bold; font-size:13px; text-transform:uppercase; }
    .pay { margin-top:16px; text-transform:uppercase; font-weight:bold; font-size:14px; }
    .forma { margin-top:16px; text-transform:uppercase; font-size:13px; }
    .footer { margin-top:32px; text-align:center; font-size:10px; }
    @media print { body { padding:0; width:${maxWidth} !important; max-width:${maxWidth} !important; } @page { size:${maxWidth} auto !important; margin:0 !important; } }
  `;

  const body = `
    <div class="center mb b-dash pb">
      <h1 class="bold lg upper">${isKitchen ? '*** PRODUÇÃO COZINHA ***' : esc(storeName)}</h1>
      ${!isKitchen ? `<p>Pedido: #${esc(String(order?.id || '').substring(0, 5))} (${esc(order?.id)})</p>` : ''}
      <p>Data: ${dataStr} ${horaStr}</p>
      ${showPrevisao ? `<p>Previsão: ${previsaoStr}</p>` : ''}
    </div>

    <div class="center bold mb upper">${tipoLabel}</div>

    ${
      order?.orderType === 'dine_in'
        ? `<div class="center bold mb b-dash pb upper lg">${
            order?.tableNumber ? `MESA: ${esc(order.tableNumber)}` : 'MESA: ____________'
          }</div>`
        : ''
    }

    <div class="mb b-dash pb">
      <p class="bold upper mb1">Dados do Cliente</p>
      <p>Nome: ${esc(order?.customerName)}</p>
      <p>Celular: ${esc(order?.customerPhone)}</p>
      ${order?.deliveryAddress ? `<p>Endereço: ${esc(order.deliveryAddress)}</p>` : ''}
    </div>

    <div class="mb b-dash pb">
      <table>
        <thead>
          <tr>
            <th class="qtd">Qtd</th>
            <th>Item</th>
            ${!isKitchen ? '<th class="val">Valor</th>' : ''}
          </tr>
        </thead>
        <tbody>${itemsRows}</tbody>
      </table>
    </div>

    ${totaisBlock}
  `;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Pedido</title><style>${css}</style></head><body>${body}</body></html>`;
}

/** Fallback do navegador: imprime o HTML num iframe oculto (igual à sangria). */
function printHtmlInIframe(html: string): void {
  if (typeof document === 'undefined') return;
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.write(html);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
    }, 2000);
  }, 500);
}

/**
 * Imprime o cupom do pedido pelo QZ (HTML nativo). Se o QZ não estiver
 * disponível, executa `fallback` (default: iframe do navegador). Passe um
 * `fallback` no-op para impressão automática em PC de monitoramento sem
 * impressora (não abrir o modal do navegador).
 */
export function printOrderReceipt(opts: {
  order: any;
  storeInfo: any;
  isKitchen?: boolean;
  printerSize?: PrinterSize;
  fallback?: () => void;
}): void {
  const { order, storeInfo, isKitchen = false } = opts;
  if (!order) return;
  const html = buildOrderReceiptHtml(order, storeInfo, isKitchen);
  const printerSize = opts.printerSize ?? resolvePrinterSize(storeInfo);
  const fallback = opts.fallback ?? (() => printHtmlInIframe(html));
  void printHtmlOrFallback({ html, printerSize, fallback });
}
