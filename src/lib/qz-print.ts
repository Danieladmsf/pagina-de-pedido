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

let qzPromise: Promise<any> | null = null;
let qzUnavailable = false;

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

/**
 * Devolve uma instância do QZ já conectada e configurada, ou null se o QZ Tray
 * não estiver disponível neste PC. O resultado é memorizado para a sessão.
 */
async function getConnectedQz(): Promise<any | null> {
  if (typeof window === 'undefined') return null;
  if (qzUnavailable) return null;

  if (!qzPromise) {
    qzPromise = (async () => {
      const qz = await loadQz();

      // Configura segurança apenas uma vez (promises são globais no qz).
      qz.security.setCertificatePromise((resolve: (v: string) => void) => resolve(QZ_CERTIFICATE));
      try { qz.security.setSignatureAlgorithm('SHA512'); } catch { /* versões antigas */ }
      qz.security.setSignaturePromise((toSign: string) => {
        return (resolve: (v: string) => void, reject: (e: any) => void) => {
          fetch('/api/qz-sign', {
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            body: toSign,
          })
            .then((r) => (r.ok ? r.text() : Promise.reject(new Error('sign-failed'))))
            .then(resolve)
            .catch(reject);
        };
      });

      if (!qz.websocket.isActive()) {
        await withTimeout(qz.websocket.connect({ retries: 0, delay: 0 }), 2000);
      }
      return qz;
    })();
  }

  try {
    return await qzPromise;
  } catch {
    qzUnavailable = true;
    qzPromise = null;
    return null;
  }
}

/**
 * Inicia (em background) a tentativa de conexão com o QZ Tray. Chamar uma vez
 * no carregamento do app. Nunca lança.
 */
export function warmupQz(): void {
  if (typeof window === 'undefined') return;
  void getConnectedQz().catch(() => {});
}

/** true se já sabemos (nesta sessão) que o QZ não está disponível. */
export function isQzKnownUnavailable(): boolean {
  return qzUnavailable;
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
 * Rasteriza um elemento já renderizado (ex.: o cupom em Tailwind do PrintReceipt)
 * para PNG e imprime via QZ. Retorna true se imprimiu pelo QZ.
 *
 * O elemento de cupom fica `display:none` (classe `hidden`); por isso clonamos,
 * tornamos visível fora da tela só para capturar, e removemos em seguida.
 */
async function printElementViaQz(el: HTMLElement, printerSize: PrinterSize): Promise<boolean> {
  const qz = await getConnectedQz();
  if (!qz) return false;

  const { toPng } = await import('html-to-image');

  const clone = el.cloneNode(true) as HTMLElement;
  clone.classList.remove('hidden');
  clone.style.display = 'block';
  clone.style.position = 'fixed';
  clone.style.left = '-10000px';
  clone.style.top = '0';
  clone.style.background = '#ffffff';
  document.body.appendChild(clone);

  let dataUrl: string;
  try {
    dataUrl = await toPng(clone, { pixelRatio: 2, backgroundColor: '#ffffff' });
  } finally {
    if (document.body.contains(clone)) document.body.removeChild(clone);
  }

  const base64 = dataUrl.split(',')[1];
  const cfg = await createConfig(qz, printerSize);
  await qz.print(cfg, [{ type: 'pixel', format: 'image', flavor: 'base64', data: base64 }]);
  return true;
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
    if (qzUnavailable) { fallback(); return; }
    const el = document.getElementById(elementId) as HTMLElement | null;
    if (!el) { fallback(); return; }
    const ok = await printElementViaQz(el, printerSize);
    if (!ok) fallback();
  } catch {
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
    if (qzUnavailable) { fallback(); return; }
    const ok = await printHtmlViaQz(html, printerSize);
    if (!ok) fallback();
  } catch {
    fallback();
  }
}
