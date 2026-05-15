import { ApiError } from '@/lib/firebase-auth-rest';

const DEFAULT_BASE_URL = 'https://api.w-api.app/v1';
const DEFAULT_CREATE_INSTANCE_PATH = '/integrator/create-instance';
const DEFAULT_QR_CODE_PATH = '/instance/qrcode';

function getBaseUrl() {
  return (process.env.WAPI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

function getCreateInstancePath() {
  return process.env.WAPI_CREATE_INSTANCE_PATH || DEFAULT_CREATE_INSTANCE_PATH;
}

function getQrCodePath() {
  return process.env.WAPI_QR_CODE_PATH || DEFAULT_QR_CODE_PATH;
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
  lite?: boolean;
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
  qrCode?: string;
  qr_code?: string;
  base64?: string;
  image?: string;
  data?: {
    qrcode?: string;
    qrCode?: string;
    qr_code?: string;
    base64?: string;
    image?: string;
  };
}

export interface WapiStatusResponse {
  instanceId: string;
  connected?: boolean | string;
  isConnected?: boolean | string;
  status?: string;
  state?: string;
  connectionStatus?: string;
  connectedPhone?: string;
  phone?: string;
  number?: string;
  instance?: {
    connected?: boolean | string;
    status?: string;
    connectedPhone?: string;
    phone?: string;
    number?: string;
  };
}

export function extractWapiQrCode(response: WapiQrCodeResponse | any) {
  return (
    response?.qrcode ||
    response?.qrCode ||
    response?.qr_code ||
    response?.base64 ||
    response?.image ||
    response?.data?.qrcode ||
    response?.data?.qrCode ||
    response?.data?.qr_code ||
    response?.data?.base64 ||
    response?.data?.image ||
    ''
  );
}

function normalizeStatus(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function statusMeansConnected(value: unknown) {
  const status = normalizeStatus(value);
  return ['connected', 'open', 'online', 'ready'].includes(status);
}

export function isWapiConnectedStatus(response: WapiStatusResponse | any) {
  const rawConnected = response?.connected ?? response?.isConnected ?? response?.instance?.connected;

  if (typeof rawConnected === 'boolean') return rawConnected;
  if (typeof rawConnected === 'string') return statusMeansConnected(rawConnected) || rawConnected.toLowerCase() === 'true';

  return (
    statusMeansConnected(response?.status) ||
    statusMeansConnected(response?.state) ||
    statusMeansConnected(response?.connectionStatus) ||
    statusMeansConnected(response?.instance?.status)
  );
}

function normalizePhoneCandidate(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const raw = String(value || '').trim();
  if (!raw) return '';

  const jidMatch = raw.match(/(\d{10,15})(?=@|:|$)/);
  const digits = (jidMatch?.[1] || raw.replace(/\D/g, '')).trim();
  return digits.length >= 10 && digits.length <= 15 ? digits : '';
}

export function getWapiConnectedPhone(response: WapiStatusResponse | any) {
  const candidates = [
    response?.connectedPhone,
    response?.phone,
    response?.number,
    response?.instance?.connectedPhone,
    response?.instance?.phone,
    response?.instance?.number,
    response?.data?.connectedPhone,
    response?.data?.phone,
    response?.data?.number,
    response?.data?.instance?.connectedPhone,
    response?.data?.instance?.phone,
    response?.data?.instance?.number,
    response?.user?.id,
    response?.user?.phone,
    response?.me?.id,
    response?.me?.jid,
    response?.me?.user,
    response?.profile?.id,
    response?.profile?.phone,
    response?.session?.wid,
    response?.session?.user,
    response?.account?.id,
    response?.account?.phone,
    response?.instance?.user?.id,
    response?.instance?.user?.phone,
    response?.instance?.me?.id,
    response?.instance?.me?.jid,
    response?.instance?.me?.user,
    response?.instance?.profile?.id,
    response?.instance?.profile?.phone,
    response?.instance?.session?.wid,
    response?.instance?.session?.user,
    response?.instance?.account?.id,
    response?.instance?.account?.phone,
    response?.data?.user?.id,
    response?.data?.user?.phone,
    response?.data?.me?.id,
    response?.data?.me?.jid,
    response?.data?.me?.user,
    response?.data?.profile?.id,
    response?.data?.profile?.phone,
    response?.data?.session?.wid,
    response?.data?.session?.user,
    response?.data?.account?.id,
    response?.data?.account?.phone,
    response?.data?.instance?.user?.id,
    response?.data?.instance?.user?.phone,
    response?.data?.instance?.me?.id,
    response?.data?.instance?.me?.jid,
    response?.data?.instance?.me?.user,
    response?.data?.instance?.profile?.id,
    response?.data?.instance?.profile?.phone,
    response?.data?.instance?.session?.wid,
    response?.data?.instance?.session?.user,
    response?.data?.instance?.account?.id,
    response?.data?.instance?.account?.phone,
  ];

  for (const candidate of candidates) {
    const phone = normalizePhoneCandidate(candidate);
    if (phone) return phone;
  }

  return '';
}

export function createWapiInstance(input: CreateWapiInstanceInput) {
  const apiKey = getWapiMainToken();
  const instancePlan = (process.env.WAPI_INSTANCE_PLAN || '').trim().toLowerCase();
  const lite = input.lite ?? instancePlan !== 'pro';

  if (!apiKey) {
    throw new ApiError(500, 'WAPI_API_KEY nao configurada no servidor.');
  }

  return fetch(`${getBaseUrl()}${getCreateInstancePath()}`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      instanceName: input.instanceName,
      lite,
      rejectCalls: true,
      callMessage: 'Nao estamos disponiveis para chamadas. Envie uma mensagem por texto.',
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
  return requestWapi<WapiQrCodeResponse>(getQrCodePath(), {
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
    endpoints.map((endpoint) => updateWapiWebhook(instanceId, token, endpoint, webhookUrl).then(() => endpoint)),
  );

  const configured = results
    .map((result, index) => result.status === 'fulfilled' ? endpoints[index] : '')
    .filter(Boolean);
  const failed = results.flatMap((result, index) => {
    if (result.status !== 'rejected') return [];
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason || 'Falha desconhecida');
    return [{ endpoint: endpoints[index], reason }];
  });

  if (failed.length > 0) {
    console.warn('[W-API] Alguns webhooks nao foram configurados:', failed);
  }

  return { configured, failed, webhookUrl };
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
