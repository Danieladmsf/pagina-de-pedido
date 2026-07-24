'use client';

/**
 * Gera o cupom de PEDIDO. O corpo/estilo específico do pedido mora aqui; a
 * caixa do cupom (papel, fonte térmica, reforço de tinta) e a impressão em si
 * vêm da base compartilhada em `receipt-print.ts`, a mesma usada pelo caixa e
 * pelas encomendas.
 */

import {
  buildReceiptDocument,
  printReceipt,
  resolvePrinterSize,
  thermalTokens,
  esc,
  type PrinterSize,
} from './receipt-print';

function money(n: number): string {
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

/** Monta a string HTML completa do cupom do pedido. */
export function buildOrderReceiptHtml(order: any, storeInfo: any, isKitchen = false): string {
  const printerSize = resolvePrinterSize(storeInfo);
  const { is58 } = thermalTokens(printerSize);
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
  if (paymentText === 'conta_casa') paymentText = 'Prazo';
  // Frete a Prazo é acerto direto cliente→motoboy: não entra na nota.
  paymentText = paymentText.replace(/\s*\(Taxa de entrega paga direto ao motoboy\)/i, '').trim();
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
      // Item vendido por peso: a coluna Qtd mostra as gramas e uma linha
      // "485 g × R$ X/kg" fica sob o nome. O valor (unitPrice × quantity) e o
      // subtotal já saem corretos porque unitPrice guarda o valor pesado.
      const isWeight = item.saleUnit === 'kg';
      const grams = Number(item.weightGrams) || 0;
      const pricePerKg = Number(item.pricePerKg) || (grams > 0 ? (Number(item.unitPrice) || 0) * 1000 / grams : 0);
      const qtyLabel = isWeight ? `${grams}g` : esc(item.quantity);
      const weightLine = isWeight
        ? `<div class="wline">${grams} g${pricePerKg ? ` &times; R$ ${money(pricePerKg)}/kg` : ''}</div>`
        : '';
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
        <td class="qtd">${qtyLabel}</td>
        <td><div class="item-name">${esc(item.name)}</div>${weightLine}</td>
        ${valueCell}
      </tr>${details}`;
      }
      return `<tr>
        <td class="qtd">${qtyLabel}</td>
        <td><div class="item-name">${esc(item.name)}</div>${weightLine}${addons}${notes}</td>
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
          order?.orderType === 'delivery' && order?.payDeliveryToMotoboy !== true
            ? `<div class="row"><span>Taxa de entrega</span><span>${
                order?.deliveryFee > 0 ? `R$ ${money(order.deliveryFee)}` : 'Grátis'
              }</span></div>`
            : ''
        }
        ${order?.discount > 0 ? `<div class="row"><span>Desconto</span><span>- R$ ${money(order.discount)}</span></div>` : ''}
        ${order?.surcharge > 0 ? `<div class="row"><span>Acréscimo</span><span>+ R$ ${money(order.surcharge)}</span></div>` : ''}
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
    .wline { font-size:11px; font-weight:bold; }
    .obs { font-size:12px; font-weight:bold; padding-left:8px; font-style:italic; }
    .details .addon, .details .obs { padding-left:0; }
    .addon-title { font-weight:bold; text-transform:uppercase; font-size:11px; margin-top:3px; }
    .total-row { font-weight:bold; font-size:13px; text-transform:uppercase; }
    .pay { margin-top:16px; text-transform:uppercase; font-weight:bold; font-size:14px; }
    .forma { margin-top:16px; text-transform:uppercase; font-size:13px; }
    .footer { margin-top:32px; text-align:center; font-size:10px; }
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

  return buildReceiptDocument({ size: printerSize, title: 'Pedido', css, body });
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
  printReceipt({ html, printerSize, fallback: opts.fallback });
}
