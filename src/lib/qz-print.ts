'use client';

/**
 * Impressão silenciosa via QZ Tray, com FALLBACK total para o comportamento
 * atual (window.print / iframe).
 *
 * Princípio de segurança: se o QZ Tray NÃO estiver rodando no PC, nada muda —
 * todas as funções caem no `fallback` recebido (exatamente o que o app faz hoje).
 * O QZ só entra em ação quando há uma conexão de fato estabelecida em
 * `wss://localhost` (o serviço local do QZ Tray).
 *
 * A conexão é "esquentada" uma vez por sessão (warmupQz) para que, na hora de
 * imprimir, já saibamos instantaneamente se o QZ está disponível — evitando
 * qualquer atraso/race com a limpeza do elemento de impressão.
 */

import { QZ_CERTIFICATE } from './qz-cert';

export type PrinterSize = '58mm' | '80mm';

let qzLib: any = null;
let qzConfigured = false;
let qzLoadFailed = false;
let qzConnecting: Promise<any> | null = null;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('qz-timeout')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function loadQz(): Promise<any> {
  const mod: any = await import('qz-tray');
  return mod?.default ?? mod;
}

/** Carrega a lib do qz e configura a segurança (certificado + assinatura) uma vez. */
async function loadAndConfigure(): Promise<any> {
  if (!qzLib) qzLib = await loadQz();
  const qz = qzLib;
  if (!qzConfigured) {
    qz.security.setCertificatePromise((resolve: (v: string) => void) => resolve(QZ_CERTIFICATE));
    try { qz.security.setSignatureAlgorithm('SHA512'); } catch { /* versões antigas */ }
    qz.security.setSignaturePromise((toSign: string) => {
      return (resolve: (v: string) => void, reject: (e: any) => void) => {
        fetch('/api/qz-sign', {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: toSign,
        })
          .then((r) => (r.ok ? r.text() : Promise.reject(new Error('sign-failed:' + r.status))))
          .then(resolve)
          .catch(reject);
      };
    });
    qzConfigured = true;
  }
  return qz;
}

/**
 * Devolve uma instância do QZ CONECTADA, ou null se o QZ Tray não estiver
 * disponível. Diferente da versão anterior: verifica a conexão a CADA chamada e
 * RECONECTA se ela tiver caído (o QZ fecha conexões ociosas). Não memoriza
 * "indisponível" para sempre — só desiste quando nem a lib do qz carrega.
 */
async function getConnectedQz(): Promise<any | null> {
  if (typeof window === 'undefined') return null;
  if (qzLoadFailed) return null;

  try {
    const qz = await loadAndConfigure();

    if (qz.websocket.isActive()) return qz;

    // Evita corridas: uma única tentativa de conexão por vez.
    if (!qzConnecting) {
      qzConnecting = withTimeout(qz.websocket.connect({ retries: 0, delay: 0 }), 3000)
        .finally(() => { qzConnecting = null; });
    }
    await qzConnecting;
    return qz;
  } catch (e) {
    if (!qzLib) {
      // Nem a lib carregou (caso raro): não adianta tentar de novo nesta sessão.
      qzLoadFailed = true;
    }
    console.warn('[QZ] não foi possível conectar ao QZ Tray:', e);
    return null;
  }
}

/**
 * Inicia (em background) a tentativa de conexão com o QZ Tray. Chamar uma vez
 * no carregamento do app. Nunca lança.
 */
export function warmupQz(): void {
  if (typeof window === 'undefined') return;
  void getConnectedQz()
    .then((qz) => { if (qz) console.info('[QZ] conexão pronta (warmup)'); })
    .catch(() => {});
}

/** true se nem a lib do qz carregou (QZ realmente fora). */
export function isQzKnownUnavailable(): boolean {
  return qzLoadFailed;
}

function widthMm(printerSize: PrinterSize): number {
  return printerSize === '58mm' ? 58 : 80;
}

async function createConfig(qz: any, printerSize: PrinterSize) {
  const printer = await qz.printers.getDefault();
  return qz.configs.create(printer, {
    size: { width: widthMm(printerSize), height: null },
    units: 'mm',
    margins: 0,
    scaleContent: true,
    rasterize: true,
  });
}

/**
 * Imprime um HTML autossuficiente (com estilos inline) via QZ.
 * Retorna true se imprimiu pelo QZ; false se o QZ não está disponível.
 */
async function printHtmlViaQz(html: string, printerSize: PrinterSize): Promise<boolean> {
  const qz = await getConnectedQz();
  if (!qz) return false;
  const cfg = await createConfig(qz, printerSize);
  await qz.print(cfg, [{ type: 'pixel', format: 'html', flavor: 'plain', data: html }]);
  return true;
}

/**
 * Copia TODOS os estilos computados de cada nó para o atributo `style` inline,
 * e remove as classes. Assim o HTML fica autossuficiente (não depende do CSS
 * do app) e o QZ consegue renderizá-lo como HTML nativo — igual ao cupom da
 * sangria, que imprime inteiro. Lê os computados de um snapshot ANTES de
 * escrever (escrever inline muda a cascata/herança dos filhos).
 */
function inlineComputedStyles(root: HTMLElement): void {
  const nodes = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
  const snapshots = nodes.map((n) => {
    const cs = window.getComputedStyle(n);
    let css = '';
    for (let i = 0; i < cs.length; i++) {
      const prop = cs[i];
      css += `${prop}:${cs.getPropertyValue(prop)};`;
    }
    return css;
  });
  nodes.forEach((n, i) => {
    n.style.cssText = snapshots[i];
    n.removeAttribute('class');
  });
}

/**
 * Imprime um elemento já renderizado (ex.: o cupom do PrintReceipt) via QZ
 * como HTML NATIVO (não como imagem). Retorna true se imprimiu pelo QZ.
 *
 * Por que HTML e não imagem (PNG): o cupom rasterizado saía "picado" — a
 * impressora térmica fatiava a imagem comprida. O caminho HTML é o mesmo da
 * sangria (que imprime inteiro): o QZ pagina pelo conteúdo, sem cortar.
 *
 * O elemento de cupom fica `display:none` (classe `hidden`); por isso clonamos,
 * tornamos visível fora da tela para obter o layout real, congelamos os estilos
 * inline e removemos o clone em seguida.
 */
async function printElementViaQz(el: HTMLElement, printerSize: PrinterSize): Promise<boolean> {
  const qz = await getConnectedQz();
  if (!qz) return false;

  const clone = el.cloneNode(true) as HTMLElement;
  clone.classList.remove('hidden');
  clone.removeAttribute('id'); // evita id duplicado no DOM
  Object.assign(clone.style, {
    display: 'block',
    position: 'fixed',
    left: '-10000px',
    top: '0',
    visibility: 'visible',
    opacity: '1',
    background: '#ffffff',
  });
  document.body.appendChild(clone);

  let html: string;
  try {
    // Sem esperar layout + fontes, os estilos computados saem incompletos.
    try { await (document as any).fonts?.ready; } catch { /* navegador antigo */ }
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

    inlineComputedStyles(clone);
    // O root não pode herdar o posicionamento offscreen no HTML final.
    Object.assign(clone.style, {
      position: 'static',
      left: 'auto',
      top: 'auto',
      transform: 'none',
      margin: '0 auto',
    });

    const w = `${widthMm(printerSize)}mm`;
    html =
      `<!doctype html><html><head><meta charset="utf-8">` +
      `<style>*{box-sizing:border-box}@page{size:${w} auto;margin:0}html,body{margin:0;padding:0;background:#fff;width:${w}}</style>` +
      `</head><body>${clone.outerHTML}</body></html>`;
  } finally {
    if (document.body.contains(clone)) document.body.removeChild(clone);
  }

  return printHtmlViaQz(html, printerSize);
}

/**
 * Imprime o cupom renderizado (PrintReceipt) pelo QZ; se o QZ não estiver
 * disponível ou der erro, executa `fallback` (o window.print() de sempre).
 *
 * `elementId` default = 'qz-receipt-area' (id no root do PrintReceipt).
 */
export async function printReceiptElementOrFallback(opts: {
  fallback: () => void;
  printerSize?: PrinterSize;
  elementId?: string;
}): Promise<void> {
  const { fallback, printerSize = '80mm', elementId = 'qz-receipt-area' } = opts;
  try {
    if (isQzKnownUnavailable()) { console.warn('[QZ] indisponível → window.print()'); fallback(); return; }
    const el = document.getElementById(elementId) as HTMLElement | null;
    if (!el) { console.warn('[QZ] elemento do cupom não encontrado (#' + elementId + ') → window.print()'); fallback(); return; }
    const ok = await printElementViaQz(el, printerSize);
    if (!ok) { console.warn('[QZ] não conectado no momento da impressão → window.print()'); fallback(); }
    else { console.info('[QZ] cupom enviado (imagem) ao QZ Tray com sucesso'); }
  } catch (e) {
    console.error('[QZ] FALHA ao imprimir via QZ → window.print(). Motivo:', e);
    fallback();
  }
}

/**
 * Imprime um HTML autossuficiente pelo QZ; se indisponível/erro, chama `fallback`.
 */
export async function printHtmlOrFallback(opts: {
  html: string;
  fallback: () => void;
  printerSize?: PrinterSize;
}): Promise<void> {
  const { html, fallback, printerSize = '80mm' } = opts;
  try {
    if (isQzKnownUnavailable()) { console.warn('[QZ] indisponível → impressão pelo navegador'); fallback(); return; }
    const ok = await printHtmlViaQz(html, printerSize);
    if (!ok) { console.warn('[QZ] não conectado no momento da impressão → impressão pelo navegador'); fallback(); }
    else { console.info('[QZ] HTML enviado ao QZ Tray com sucesso'); }
  } catch (e) {
    console.error('[QZ] FALHA ao imprimir via QZ → impressão pelo navegador. Motivo:', e);
    fallback();
  }
}
