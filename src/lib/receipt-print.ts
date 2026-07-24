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

import { isQzKnownUnavailable, printHtmlViaQz, type PrinterSize } from './qz-print';

export type { PrinterSize };

/** Escapa texto do usuário para interpolar no HTML do cupom. */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Dinheiro no cupom, em português: `R$ 1.500,00`.
 *
 * Fonte única dos três cupons. Antes cada um formatava do seu jeito e o da
 * encomenda era o único certo: pedido e caixa saíam com PONTO decimal
 * (`R$ 150.00`, formato americano) e sem separador de milhar.
 *
 * O `replace` troca o espaço não-quebrável que o ICU põe entre "R$" e o número
 * por um espaço comum — o cupom é monoespaçado e impresso por dois motores
 * diferentes (QZ e navegador); espaço normal é previsível nos dois.
 */
export function brl(n: number): string {
  return (Number.isFinite(n) ? n : 0)
    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    .replace(/\s/g, ' ');
}

/** Tamanho de papel da loja (58mm ou 80mm). Aceita o formato novo e o legado. */
export function resolvePrinterSize(storeInfo: any): PrinterSize {
  return (storeInfo?.general?.printerSize || storeInfo?.printerSize) === '58mm' ? '58mm' : '80mm';
}

/** Como a loja quer receber pedido novo. */
export type PrintMode = 'auto_silent' | 'auto_sound' | 'manual';

const PRINT_MODES: PrintMode[] = ['auto_silent', 'auto_sound', 'manual'];

/**
 * Modo de impressão da loja — FONTE ÚNICA. Todo mundo que precisa saber se
 * imprime sozinho, se apita ou se espera o operador clicar deve chamar isto.
 *
 * Existiam dois campos decidindo a mesma coisa: o antigo `manualPrint`
 * (booleano) e o novo `printMode`. Pior: no mesmo `useEffect` o som olhava um e
 * a impressão olhava o outro. Só não dava divergência porque a tela do perfil
 * gravava os dois espelhados — um espelho é fácil de esquecer de manter.
 *
 * Agora a conversão do legado acontece SÓ aqui, na leitura: perfil antigo que
 * nunca foi salvo de novo continua funcionando sem migração de dados, e o
 * `manualPrint` que ficou gravado é ignorado assim que existe um `printMode`.
 */
export function resolvePrintMode(storeInfo: any): PrintMode {
  const raw = storeInfo?.general?.printMode || storeInfo?.printMode;
  if (PRINT_MODES.includes(raw)) return raw;
  const legadoManual = !!(storeInfo?.general?.manualPrint || storeInfo?.manualPrint);
  return legadoManual ? 'manual' : 'auto_silent';
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
 *
 * Exportado para o teste que guarda essa simetria (o `buildReceiptDocument` já
 * chama por dentro; nenhum cupom precisa usar direto).
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
 *
 * INTERNO de propósito: só o `printReceipt` chama, e só depois de o QZ Tray
 * ter recusado. Exportar isto seria abrir a mesma porta do antigo
 * `printHtmlOrFallback` — dava pra imprimir pulando o QZ sem perceber.
 */
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

const AUTOPRINT_PREFIX = 'autoprint:';
const AUTOPRINT_TTL_MS = 10 * 60 * 1000;

/** Limpa reservas velhas para o localStorage não crescer sem fim. */
function pruneAutoPrintClaims(now: number): void {
  for (let i = window.localStorage.length - 1; i >= 0; i--) {
    const k = window.localStorage.key(i);
    if (!k?.startsWith(AUTOPRINT_PREFIX)) continue;
    const t = Number(window.localStorage.getItem(k));
    if (!t || now - t > AUTOPRINT_TTL_MS) window.localStorage.removeItem(k);
  }
}

/**
 * Reserva a impressão automática de um pedido NESTA MÁQUINA. Devolve `true`
 * para quem ganhou a reserva e deve imprimir.
 *
 * O alerta de pedido novo mora no layout compartilhado, então PDV e Retaguarda
 * abertos em duas abas do mesmo PC viam o mesmo pedido chegar e mandavam dois
 * cupons para a mesma impressora — cada aba com seu próprio controle de "já
 * vi este pedido", em memória. A reserva é de máquina porque a impressora é de
 * máquina (o QZ manda sempre para a padrão do Windows): duas lojas, ou dois PCs
 * com impressoras diferentes, continuam imprimindo cada um o seu.
 *
 * `navigator.locks` é o que torna isto realmente atômico entre abas; sem ele
 * (navegador antigo) sobra a checagem simples no localStorage, que fecha o caso
 * comum. E se o localStorage estiver bloqueado, a decisão é IMPRIMIR: cupom
 * repetido incomoda, pedido que não sai vira venda perdida.
 */
export async function claimAutoPrint(orderId: string): Promise<boolean> {
  if (typeof window === 'undefined' || !orderId) return true;

  const key = `${AUTOPRINT_PREFIX}${orderId}`;
  const tentar = (): boolean => {
    try {
      const now = Date.now();
      const anterior = Number(window.localStorage.getItem(key));
      if (anterior && now - anterior < AUTOPRINT_TTL_MS) return false;
      window.localStorage.setItem(key, String(now));
      pruneAutoPrintClaims(now);
      return true;
    } catch {
      return true;
    }
  };

  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined;
  if (!locks?.request) return tentar();
  try {
    return await locks.request('autoprint-claim', tentar);
  } catch {
    return tentar();
  }
}

/**
 * ÚNICO ponto de entrada de impressão do app: QZ Tray se estiver rodando,
 * senão navegador. Todo cupom passa por aqui.
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
  void (async () => {
    try {
      if (isQzKnownUnavailable()) {
        console.warn('[QZ] indisponível → impressão pelo navegador');
        fallback();
        return;
      }
      const ok = await printHtmlViaQz(html, printerSize);
      if (ok) console.info('[QZ] HTML enviado ao QZ Tray com sucesso');
      else {
        console.warn('[QZ] não conectado no momento da impressão → impressão pelo navegador');
        fallback();
      }
    } catch (e) {
      console.error('[QZ] FALHA ao imprimir via QZ → impressão pelo navegador. Motivo:', e);
      fallback();
    }
  })();
}
