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
