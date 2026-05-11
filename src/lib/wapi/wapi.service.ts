import { ApiError } from '@/lib/firebase-auth-rest';

const DEFAULT_BASE_URL = 'https://api.w-api.app/v1';

function getBaseUrl() {
  return (process.env.WAPI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

export function getWapiMainToken() {
  return process.env.WAPI_API_KEY || process.env.WAPI_INTEGRATOR_TOKEN || '';
}

async function requestWapi<T>(
  path: string,
  options: {
    method?: string;
    token: string;
    query?: Record<string, string | number | boolean | undefined>;
    body?: Record<string, unknown>;
  },
): Promise<T> {
  if (!options.token) {
    throw new ApiError(500, 'Token da W-API nao configurado no servidor.');
  }

  const url = new URL(`${getBaseUrl()}${path}`);
  Object.entries(options.query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  });

  const response = await fetch(url.toString(), {
    method: options.method || 'GET',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${options.token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok || data?.error === true) {
    throw new ApiError(response.status || 500, data?.message || data?.error || 'Erro na API W-API.', data);
  }

  return data as T;
}

export interface CreateWapiInstanceInput {
  instanceName: string;
  webhookUrl?: string;
}

export interface CreateWapiInstanceResponse {
  error: boolean;
  message: string;
  instanceId: string;
  token: string;
}

export interface WapiQrCodeResponse {
  error?: boolean;
  instanceId: string;
  qrcode?: string;
}

export interface WapiStatusResponse {
  instanceId: string;
  connected: boolean;
  connectedPhone?: string;
}

export function createWapiInstance(input: CreateWapiInstanceInput) {
  const webhookFields = input.webhookUrl
    ? {
        webhookConnectedUrl: input.webhookUrl,
        webhookDeliveryUrl: input.webhookUrl,
        webhookDisconnectedUrl: input.webhookUrl,
        webhookStatusUrl: input.webhookUrl,
        webhookPresenceUrl: input.webhookUrl,
        webhookReceivedUrl: input.webhookUrl,
      }
    : {};

  const apiKey = getWapiMainToken();
  const baseUrl = (process.env.WAPI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');

  return fetch(`${baseUrl}/client/create-instance`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      instanceName: input.instanceName,
      lite: true,
      rejectCalls: true,
      callMessage: 'Nao estamos disponiveis para chamadas. Envie uma mensagem por texto.',
      ...webhookFields,
    }),
  }).then(async (response) => {
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.error === true) {
      throw new ApiError(response.status || 500, data?.message || data?.error || 'Erro ao criar instancia na W-API.', data);
    }
    return data as CreateWapiInstanceResponse;
  });
}

export function getWapiQrCode(instanceId: string, token: string) {
  return requestWapi<WapiQrCodeResponse>('/instance/qr-code', {
    token,
    query: { instanceId, syncContacts: 'disable' },
  });
}

export function getWapiStatus(instanceId: string, token: string) {
  return requestWapi<WapiStatusResponse>('/instance/status-instance', {
    token,
    query: { instanceId },
  });
}

export function disconnectWapiInstance(instanceId: string, token: string) {
  return requestWapi<{ error?: boolean; message?: string }>('/instance/disconnect', {
    token,
    query: { instanceId },
  });
}

export function restartWapiInstance(instanceId: string, token: string) {
  return requestWapi<{ error?: boolean; message?: string }>('/instance/restart', {
    token,
    query: { instanceId },
  });
}

export function updateWapiWebhook(instanceId: string, token: string, endpoint: string, webhookUrl: string) {
  return requestWapi<{ error?: boolean; message?: string }>(`/webhook/${endpoint}`, {
    method: 'PUT',
    token,
    query: { instanceId },
    body: { value: webhookUrl },
  });
}

export async function configureWapiWebhooks(instanceId: string, token: string, webhookUrl: string) {
  const endpoints = [
    'update-webhook-connected',
    'update-webhook-delivery',
    'update-webhook-disconnected',
    'update-webhook-message-status',
    'update-webhook-received',
  ];

  const results = await Promise.allSettled(
    endpoints.map((endpoint) => updateWapiWebhook(instanceId, token, endpoint, webhookUrl)),
  );

  const failed = results.filter((result) => result.status === 'rejected');
  if (failed.length > 0) {
    console.warn('[W-API] Alguns webhooks nao foram configurados:', failed);
  }
}

export function sendWapiTextMessage(
  instanceId: string,
  token: string,
  input: { phone: string; message: string; delayMessage?: number; messageId?: string },
) {
  return requestWapi<{ instanceId: string; messageId: string; insertedId?: string }>('/message/send-text', {
    method: 'POST',
    token,
    query: { instanceId },
    body: {
      phone: input.phone,
      message: input.message,
      ...(input.messageId ? { messageId: input.messageId } : {}),
      delayMessage: input.delayMessage ?? 3,
    },
  });
}

export function sendWapiImageMessage(
  instanceId: string,
  token: string,
  input: { phone: string; image: string; caption?: string; delayMessage?: number },
) {
  return requestWapi<{ instanceId: string; messageId: string; insertedId?: string }>('/message/send-image', {
    method: 'POST',
    token,
    query: { instanceId },
    body: {
      phone: input.phone,
      image: input.image,
      ...(input.caption ? { caption: input.caption } : {}),
      delayMessage: input.delayMessage ?? 3,
    },
  });
}

export function sendWapiDocumentMessage(
  instanceId: string,
  token: string,
  input: { phone: string; document: string; extension: string; fileName?: string; caption?: string; delayMessage?: number },
) {
  return requestWapi<{ instanceId: string; messageId: string; insertedId?: string }>('/message/send-document', {
    method: 'POST',
    token,
    query: { instanceId },
    body: {
      phone: input.phone,
      document: input.document,
      extension: input.extension,
      ...(input.fileName ? { fileName: input.fileName } : {}),
      ...(input.caption ? { caption: input.caption } : {}),
      delayMessage: input.delayMessage ?? 3,
    },
  });
}
