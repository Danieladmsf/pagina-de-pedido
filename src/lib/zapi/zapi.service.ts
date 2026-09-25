/**
 * Cliente da Z-API (https://developer.z-api.io).
 *
 * Entrou em 25/09/2026, no dia em que a W-API derrubou as duas lojas e nem o
 * painel dela gerava QR Code ("Erro ao conectar cliente"), enquanto a Z-API
 * gerava na hora. Cada loja escolhe o provedor pelo ID da instância que cadastra:
 * o da Z-API tem 32 caracteres hexadecimais, o da W-API é "LITE-..."/"PRO-...".
 *
 * As funções devolvem o MESMO formato das da W-API (`wapi.service.ts`), que
 * desvia para cá: status com `connected` e `phone`, QR em `qrcode`, envio com
 * `messageId`. Assim rotas, vigia, campanhas e telas seguem sem saber qual
 * provedor está do outro lado.
 */
import { ApiError } from '@/lib/firebase-auth-rest';
import { getOptionalAdminDb } from '@/lib/firebase-admin';
import { decryptSecret } from '@/lib/wapi/crypto';

const BASE_URL = 'https://api.z-api.io/instances';

/** Mesmo teto da W-API: fetch sem limite deixa a resposta automática presa. */
const ZAPI_TIMEOUT_MS = 20000;

/** ID de instância da Z-API: 32 caracteres hexadecimais. */
export function ehInstanciaZapi(instanceId: unknown) {
  return /^[0-9a-f]{32}$/i.test(String(instanceId || '').trim());
}

/**
 * Token de segurança da CONTA Z-API (cabeçalho `Client-Token`). A conta exige
 * ele em toda chamada: sem, a Z-API responde 400 "your client-token is not
 * configured". Vale para todas as instâncias da conta, então mora num lugar só:
 * a variável `ZAPI_CLIENT_TOKEN`, se existir na Vercel, ou `app_config/zapi`
 * (cifrado com a mesma chave dos tokens das instâncias; as regras do Firestore
 * não liberam essa coleção para o navegador). Lido no máximo a cada 5 min.
 */
const CLIENT_TOKEN_CACHE_MS = 5 * 60 * 1000;
let clientTokenCache: { valor: string; lidoEm: number } | null = null;

async function obterClientToken() {
  const doAmbiente = (process.env.ZAPI_CLIENT_TOKEN || '').trim();
  if (doAmbiente) return doAmbiente;
  if (clientTokenCache && Date.now() - clientTokenCache.lidoEm < CLIENT_TOKEN_CACHE_MS) return clientTokenCache.valor;

  let valor = '';
  try {
    const snap = await getOptionalAdminDb()?.collection('app_config').doc('zapi').get();
    const cifrado = snap?.data()?.clientTokenEncrypted;
    if (typeof cifrado === 'string' && cifrado) valor = decryptSecret(cifrado).trim();
  } catch (error) {
    console.warn('[Z-API] Nao consegui ler o token de seguranca da conta:', error);
  }
  clientTokenCache = { valor, lidoEm: Date.now() };
  return valor;
}

async function requestZapi<T>(
  instanceId: string,
  token: string,
  path: string,
  options: { method?: string; body?: Record<string, unknown>; timeoutMs?: number } = {},
): Promise<T> {
  if (!token) throw new ApiError(500, 'Token da Z-API nao configurado.');

  const url = `${BASE_URL}/${encodeURIComponent(instanceId.trim())}/token/${encodeURIComponent(token.trim())}${path}`;
  const clientToken = await obterClientToken();

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      cache: 'no-store',
      headers: {
        ...(clientToken ? { 'Client-Token': clientToken } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? ZAPI_TIMEOUT_MS),
    });
  } catch (error: any) {
    const expirou = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new ApiError(
      expirou ? 408 : 503,
      expirou ? 'A Z-API nao respondeu a tempo.' : `Nao foi possivel falar com a Z-API: ${String(error?.message || error)}`,
    );
  }

  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  // Na Z-API o campo `error` do status é descritivo ("You are not connected")
  // e vem com HTTP 200: só o código HTTP diz que a chamada falhou.
  if (!response.ok) {
    const mensagem =
      (typeof data?.message === 'string' && data.message) ||
      (typeof data?.error === 'string' && data.error) ||
      (typeof data === 'string' && !data.trim().startsWith('<') && data.trim()) ||
      `Erro na Z-API (HTTP ${response.status}).`;
    throw new ApiError(response.status || 502, mensagem, data);
  }

  return data as T;
}

/**
 * Status no formato que `isWapiConnectedStatus`/`getWapiConnectedPhone` leem.
 * O telefone não vem no /status; quando conectado, vem do /device (melhor
 * esforço: sem ele a tela só não mostra o número).
 */
export async function getZapiStatus(instanceId: string, token: string) {
  const status = await requestZapi<{ connected?: boolean; error?: string; smartphoneConnected?: boolean }>(
    instanceId,
    token,
    '/status',
  );
  let phone = '';
  if (status?.connected === true) {
    try {
      const device = await requestZapi<{ phone?: string }>(instanceId, token, '/device');
      phone = String(device?.phone || '').replace(/\D/g, '');
    } catch {
      /* só a exibição do número depende disto */
    }
  }
  return {
    instanceId,
    connected: status?.connected === true,
    smartphoneConnected: status?.smartphoneConnected,
    detalhe: status?.error || '',
    ...(phone ? { phone } : {}),
  };
}

/** QR em `qrcode`, como o `extractWapiQrCode` espera. */
export async function getZapiQrCode(instanceId: string, token: string) {
  const data = await requestZapi<any>(instanceId, token, '/qr-code/image');
  const valor = typeof data === 'string' ? data : data?.value;
  if (data?.challenge) {
    // Aparelhos que exigem "chave de acesso" não usam QR: o caminho é a
    // extensão da Z-API, pelo painel dela.
    throw new ApiError(409, 'Este celular pede a chave de acesso do WhatsApp: conecte pela extensão da Z-API, no painel da Z-API.');
  }
  const qrcode = String(valor || '').trim();
  return {
    instanceId,
    qrcode: qrcode && !/^(data:image\/|https?:\/\/)/i.test(qrcode) ? `data:image/png;base64,${qrcode}` : qrcode,
  };
}

export function disconnectZapiInstance(instanceId: string, token: string) {
  return requestZapi<{ value?: boolean }>(instanceId, token, '/disconnect');
}

export function restartZapiInstance(instanceId: string, token: string) {
  return requestZapi<{ value?: boolean }>(instanceId, token, '/restart');
}

/**
 * Leitura automática desligada nas duas frentes: mensagens e status. Ligada, a
 * conta "visualiza" o status de todos os contatos sozinha (mesmo motivo do
 * `setWapiAutoRead`).
 */
export async function setZapiAutoRead(instanceId: string, token: string, enabled: boolean) {
  await requestZapi(instanceId, token, '/update-auto-read-message', { method: 'PUT', body: { value: enabled } });
  await requestZapi(instanceId, token, '/update-auto-read-status', { method: 'PUT', body: { value: enabled } }).catch(() => {});
  return { value: enabled };
}

/**
 * Todos os webhooks para a mesma URL, de uma vez. `notifySentByMe` faz chegar
 * também o que a loja digita no celular: é o que cala o robô enquanto a dona
 * está atendendo. O formato de retorno é o do `configureWapiWebhooks`, que as
 * rotas e o vigia conferem pelo nome `update-webhook-received`.
 */
export async function configureZapiWebhooks(instanceId: string, token: string, webhookUrl: string) {
  try {
    await requestZapi(instanceId, token, '/update-every-webhooks', {
      method: 'PUT',
      body: { value: webhookUrl, notifySentByMe: true },
    });
    return { configured: ['update-webhook-received'], failed: [] as Array<{ endpoint: string; reason: string }>, webhookUrl };
  } catch (error: any) {
    const reason = String(error?.message || error || 'Falha desconhecida');
    console.warn('[Z-API] Webhooks nao foram configurados:', reason);
    return { configured: [] as string[], failed: [{ endpoint: 'update-webhook-received', reason }], webhookUrl };
  }
}

type ResultadoDeEnvio = { instanceId: string; messageId: string; insertedId?: string };

function resultadoDeEnvio(instanceId: string, data: any): ResultadoDeEnvio {
  return { instanceId, messageId: String(data?.messageId || data?.id || ''), insertedId: String(data?.zaapId || '') };
}

export async function sendZapiText(
  instanceId: string,
  token: string,
  input: { phone: string; message: string; delayMessage?: number },
) {
  const data = await requestZapi<any>(instanceId, token, '/send-text', {
    method: 'POST',
    body: { phone: input.phone, message: input.message, delayMessage: input.delayMessage ?? 3 },
  });
  return resultadoDeEnvio(instanceId, data);
}

export async function sendZapiImage(
  instanceId: string,
  token: string,
  input: { phone: string; image: string; caption?: string; delayMessage?: number },
) {
  const data = await requestZapi<any>(instanceId, token, '/send-image', {
    method: 'POST',
    body: {
      phone: input.phone,
      image: input.image,
      ...(input.caption ? { caption: input.caption } : {}),
      delayMessage: input.delayMessage ?? 3,
    },
  });
  return resultadoDeEnvio(instanceId, data);
}

export async function sendZapiDocument(
  instanceId: string,
  token: string,
  input: { phone: string; document: string; extension: string; fileName?: string; caption?: string; delayMessage?: number },
) {
  const extensao = String(input.extension || 'pdf').replace(/^\./, '').toLowerCase() || 'pdf';
  const data = await requestZapi<any>(instanceId, token, `/send-document/${encodeURIComponent(extensao)}`, {
    method: 'POST',
    body: {
      phone: input.phone,
      document: input.document,
      ...(input.fileName ? { fileName: input.fileName } : {}),
      ...(input.caption ? { caption: input.caption } : {}),
      delayMessage: input.delayMessage ?? 3,
    },
  });
  return resultadoDeEnvio(instanceId, data);
}

/** Nunca lança: sem foto, a tela cai no avatar de iniciais. */
export async function getZapiProfilePicture(instanceId: string, token: string, phone: string) {
  try {
    const data = await requestZapi<{ link?: string }>(
      instanceId,
      token,
      `/profile-picture?phone=${encodeURIComponent(String(phone || '').replace(/\D/g, ''))}`,
    );
    return { link: data?.link || null };
  } catch {
    return { link: null };
  }
}
