import { ApiError } from '@/lib/firebase-auth-rest';

const DEFAULT_BASE_URL = 'https://api.w-api.app/v1';
const DEFAULT_CREATE_INSTANCE_PATH = '/integrator/create-instance';
const DEFAULT_QR_CODE_PATH = '/instance/qr-code';
const LEGACY_QR_CODE_PATH = '/instance/qrcode';

function getBaseUrl() {
  return (process.env.WAPI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

function getCreateInstancePath() {
  return process.env.WAPI_CREATE_INSTANCE_PATH || DEFAULT_CREATE_INSTANCE_PATH;
}

function getQrCodePath() {
  const configuredPath = process.env.WAPI_QR_CODE_PATH?.trim();
  if (!configuredPath || configuredPath === LEGACY_QR_CODE_PATH) return DEFAULT_QR_CODE_PATH;
  return configuredPath;
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
    context?: 'qrcode' | 'status' | 'disconnect' | 'restart' | 'webhook' | 'message';
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

  const data = await parseWapiResponse(response);

  if (!response.ok || data?.error === true) {
    throw buildWapiError(response, data, 'Erro na API W-API.', options.context);
  }

  return data as T;
}

async function parseWapiResponse(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function getProviderMessage(data: any) {
  if (typeof data === 'string') {
    const message = data.trim();
    return message.startsWith('<') ? '' : message;
  }
  if (typeof data?.message === 'string') return data.message;
  if (typeof data?.error === 'string') return data.error;
  if (typeof data?.data?.message === 'string') return data.data.message;
  if (typeof data?.data?.error === 'string') return data.data.error;
  return '';
}

function buildWapiError(
  response: Response,
  data: any,
  fallback: string,
  context?: 'create-instance' | 'qrcode' | 'status' | 'disconnect' | 'restart' | 'webhook' | 'message',
) {
  const status = response.ok ? 502 : response.status || 500;
  const providerMessage = getProviderMessage(data);

  if (status === 403 && context === 'create-instance') {
    return new ApiError(
      403,
      'A W-API recusou a criacao automatica da instancia. O token configurado no servidor precisa ser um token integrador com permissao para /integrator/create-instance. Se sua conta W-API nao tiver essa permissao, use "Conectar com dados existentes" com o codigo da conexao e a chave da instancia.',
      data,
    );
  }

  if (status === 403) {
    return new ApiError(
      403,
      providerMessage || 'A W-API recusou a operacao. Confira se o token da instancia esta correto e ativo.',
      data,
    );
  }

  if (status === 404 && (context === 'qrcode' || context === 'status')) {
    return new ApiError(
      404,
      providerMessage || 'A instancia W-API nao foi encontrada ou o token salvo nao pertence a ela. Desconecte e vincule o WhatsApp novamente.',
      data,
    );
  }

  return new ApiError(status, providerMessage || fallback, data);
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
  const qrCode = (
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

  return normalizeQrCodeImage(qrCode);
}

function normalizeQrCodeImage(value: unknown) {
  const qrCode = String(value || '').trim();
  if (!qrCode) return '';
  if (/^(data:image\/|https?:\/\/|blob:)/i.test(qrCode)) return qrCode;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(qrCode) && qrCode.length > 100) {
    return `data:image/png;base64,${qrCode}`;
  }
  return qrCode;
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
    const data = await parseWapiResponse(response);
    if (!response.ok || data?.error === true) {
      throw buildWapiError(response, data, 'Erro ao criar instancia na W-API.', 'create-instance');
    }
    return data as CreateWapiInstanceResponse;
  });
}

export function getWapiQrCode(instanceId: string, token: string) {
  return requestWapi<WapiQrCodeResponse>(getQrCodePath(), {
    token,
    query: { instanceId, image: 'enable', syncContacts: 'disable' },
    context: 'qrcode',
  });
}

export function getWapiStatus(instanceId: string, token: string) {
  return requestWapi<WapiStatusResponse>('/instance/status-instance', {
    token,
    query: { instanceId },
    context: 'status',
  });
}

export function disconnectWapiInstance(instanceId: string, token: string) {
  return requestWapi<{ error?: boolean; message?: string }>('/instance/disconnect', {
    token,
    query: { instanceId },
    context: 'disconnect',
  });
}

export function restartWapiInstance(instanceId: string, token: string) {
  return requestWapi<{ error?: boolean; message?: string }>('/instance/restart', {
    token,
    query: { instanceId },
    context: 'restart',
  });
}

export function updateWapiWebhook(instanceId: string, token: string, endpoint: string, webhookUrl: string) {
  return requestWapi<{ error?: boolean; message?: string }>(`/webhook/${endpoint}`, {
    method: 'PUT',
    token,
    query: { instanceId },
    body: { value: webhookUrl },
    context: 'webhook',
  });
}

const WEBHOOK_ENDPOINTS = [
  { endpoint: 'update-webhook-connected', hook: 'connected' },
  { endpoint: 'update-webhook-delivery', hook: 'delivery' },
  { endpoint: 'update-webhook-disconnected', hook: 'disconnected' },
  { endpoint: 'update-webhook-message-status', hook: 'message-status' },
  { endpoint: 'update-webhook-received', hook: 'received' },
] as const;

function buildWebhookUrlForHook(webhookUrl: string, hook: string) {
  const url = new URL(webhookUrl);
  url.searchParams.set('hook', hook);
  return url.toString();
}

export async function configureWapiWebhooks(instanceId: string, token: string, webhookUrl: string) {
  const results = await Promise.allSettled(
    WEBHOOK_ENDPOINTS.map(({ endpoint, hook }) =>
      updateWapiWebhook(instanceId, token, endpoint, buildWebhookUrlForHook(webhookUrl, hook)).then(() => endpoint),
    ),
  );

  const configured = results
    .map((result, index) => result.status === 'fulfilled' ? WEBHOOK_ENDPOINTS[index].endpoint : '')
    .filter(Boolean);
  const failed = results.flatMap((result, index) => {
    if (result.status !== 'rejected') return [];
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason || 'Falha desconhecida');
    return [{ endpoint: WEBHOOK_ENDPOINTS[index].endpoint, reason }];
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
    context: 'message',
    body: {
      phone: input.phone,
      message: input.message,
      ...(input.messageId ? { messageId: input.messageId } : {}),
      delayMessage: input.delayMessage ?? 3,
      linkPreview: true,
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
    context: 'message',
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
    context: 'message',
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
