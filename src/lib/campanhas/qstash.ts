/**
 * Wrapper do Upstash QStash para o disparo de campanhas em segundo plano.
 * Server-only: usa segredos de env var; não importar de Client Components.
 *
 * Modelo event-driven (sem polling): a criação da campanha publica a 1ª mensagem
 * (com `delay` até o `scheduleAt`), e o `/api/cron/dispatch` se RE-ENFILEIRA ao
 * fim de cada chunk até terminar. Os segredos vivem só em env var (Vercel).
 */
import { Client, Receiver } from '@upstash/qstash';

/**
 * URL pública do endpoint que o QStash vai chamar. Deriva do PRÓPRIO request
 * (o domínio onde o app está sendo servido) — assim não depende de env var
 * possivelmente errada. Cai para env só fora do contexto de request/local.
 */
export function getDispatchUrl(request?: Request): string {
  let base = '';
  if (request) {
    try {
      const origin = new URL(request.url).origin;
      if (origin && !origin.includes('localhost')) base = origin;
    } catch { /* ignore */ }
  }
  if (!base) {
    base = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.WAPI_PUBLIC_BASE_URL || '');
  }
  base = base.replace(/\/+$/, '');
  if (!base) throw new Error('URL pública ausente (defina NEXT_PUBLIC_APP_URL/APP_URL).');
  return `${base}/api/cron/dispatch`;
}

function getClient(): Client {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN ausente.');
  return new Client({ token });
}

export function getReceiver(): Receiver {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) throw new Error('Signing keys do QStash ausentes.');
  return new Receiver({ currentSigningKey, nextSigningKey });
}

/**
 * Enfileira (ou agenda, via `delaySeconds`) uma execução do dispatcher para a
 * campanha. Retorna o messageId (guardado no doc p/ cancelamento opcional).
 */
export async function enqueueDispatch(campaignId: string, delaySeconds = 0, request?: Request): Promise<string> {
  const res = await getClient().publishJSON({
    url: getDispatchUrl(request),
    body: { campaignId },
    delay: Math.max(0, Math.floor(delaySeconds)),
  });
  return (res as any).messageId as string;
}
