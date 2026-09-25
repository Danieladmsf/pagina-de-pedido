/**
 * Servidor PRÓPRIO de WhatsApp: WuzAPI (github.com/asternic/wuzapi, Go sobre
 * whatsmeow) numa máquina nossa no Google Cloud. Montado em 25/09/2026, depois
 * da queda da W-API, para não depender de provedor pago.
 *
 * Cada loja é um "usuário" da WuzAPI, com token próprio. No nosso cadastro o ID
 * da instância é "WUZ-<nome>" (só um rótulo nosso; a WuzAPI identifica pela
 * chave) e o endereço do servidor vem de `WUZAPI_URL` ou `app_config/wuzapi`.
 *
 * Como na Z-API, as funções devolvem o MESMO formato das da W-API, que desvia
 * para cá pelo ID. Diferenças da WuzAPI tratadas aqui:
 * - imagem e documento só vão em base64: o link do logo é baixado e convertido;
 * - o QR só existe com a sessão aberta, então pedir QR abre a sessão antes;
 * - quem entra na assinatura de eventos decide o que chega no webhook.
 */
import { ApiError } from '@/lib/firebase-auth-rest';
import { getOptionalAdminDb } from '@/lib/firebase-admin';

const TIMEOUT_MS = 20000;

/** Eventos que o webhook recebe: mensagem, entrega e tudo o que diz se a loja caiu. */
export const EVENTOS_WUZAPI = [
  'Message',
  'ReadReceipt',
  'Connected',
  'PairSuccess',
  'LoggedOut',
  'ConnectFailure',
  'TemporaryBan',
  'ClientOutdated',
];

/** ID de instância do servidor próprio no nosso cadastro: "WUZ-...". */
export function ehInstanciaWuzapi(instanceId: unknown) {
  return /^WUZ-[A-Z0-9_-]+$/i.test(String(instanceId || '').trim());
}

const CONFIG_CACHE_MS = 5 * 60 * 1000;
let urlCache: { valor: string; lidoEm: number } | null = null;

/** Endereço do servidor: `WUZAPI_URL` na Vercel, ou `app_config/wuzapi.baseUrl`. */
async function obterUrlDoServidor() {
  const doAmbiente = (process.env.WUZAPI_URL || '').trim();
  if (doAmbiente) return doAmbiente.replace(/\/$/, '');
  if (urlCache && Date.now() - urlCache.lidoEm < CONFIG_CACHE_MS) return urlCache.valor;
  let valor = '';
  try {
    const snap = await getOptionalAdminDb()?.collection('app_config').doc('wuzapi').get();
    valor = String(snap?.data()?.baseUrl || '').trim().replace(/\/$/, '');
  } catch (error) {
    console.warn('[WuzAPI] Nao consegui ler o endereco do servidor:', error);
  }
  urlCache = { valor, lidoEm: Date.now() };
  return valor;
}

async function requestWuz<T>(
  token: string,
  path: string,
  options: { method?: string; body?: Record<string, unknown>; timeoutMs?: number } = {},
): Promise<T> {
  if (!token) throw new ApiError(500, 'Chave do servidor de WhatsApp nao configurada.');
  const base = await obterUrlDoServidor();
  if (!base) throw new ApiError(500, 'Endereco do servidor de WhatsApp nao configurado.');

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: options.method || 'GET',
      cache: 'no-store',
      headers: {
        token: token.trim(),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (error: any) {
    const expirou = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new ApiError(
      expirou ? 408 : 503,
      expirou ? 'O servidor de WhatsApp nao respondeu a tempo.' : `Nao foi possivel falar com o servidor de WhatsApp: ${String(error?.message || error)}`,
    );
  }

  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok || data?.success === false) {
    const mensagem =
      (typeof data?.error === 'string' && data.error) ||
      (typeof data?.data?.error === 'string' && data.data.error) ||
      (typeof data === 'string' && !data.trim().startsWith('<') && data.trim()) ||
      `Erro no servidor de WhatsApp (HTTP ${response.status}).`;
    throw new ApiError(response.ok ? 502 : response.status || 502, mensagem, data);
  }
  return (data?.data ?? data) as T;
}

/** Só os dígitos do usuário de um JID ("5516...:12@s.whatsapp.net" → "5516..."). */
function digitosDoJid(jid: unknown) {
  const usuario = String(jid || '').split('@')[0].split(':')[0].split('.')[0];
  return usuario.replace(/\D/g, '');
}

/**
 * Status no formato que `isWapiConnectedStatus` lê. `LoggedIn` é a sessão
 * pareada; `Connected` é o socket, que cai e volta sozinho. Conta como conectada
 * a loja com sessão válida: o socket oscilando não pede QR de novo.
 */
export async function getWuzStatus(instanceId: string, token: string) {
  const data = await requestWuz<any>(token, '/session/status');
  const logado = data?.LoggedIn === true || data?.loggedIn === true;
  const phone = digitosDoJid(data?.jid || data?.Jid || data?.JID);
  return {
    instanceId,
    connected: logado,
    socketConectado: data?.Connected === true || data?.connected === true,
    ...(phone.length >= 10 ? { phone } : {}),
  };
}

async function abrirSessao(token: string) {
  try {
    await requestWuz(token, '/session/connect', { method: 'POST', body: { Subscribe: EVENTOS_WUZAPI, Immediate: true } });
  } catch (error: any) {
    // Sessão já aberta não é problema: o que interessa é ela estar aberta.
    if (!/already connected/i.test(String(error?.message || ''))) throw error;
  }
}

/**
 * QR em `qrcode`. A WuzAPI só gera o QR com a sessão aberta e leva um instante
 * para ele sair, então abre a sessão e pergunta algumas vezes.
 */
export async function getWuzQrCode(instanceId: string, token: string) {
  await abrirSessao(token);
  for (let tentativa = 0; tentativa < 6; tentativa += 1) {
    const data = await requestWuz<any>(token, '/session/qr').catch(() => null);
    const qrcode = String(data?.QRCode || data?.qrcode || '').trim();
    if (qrcode) return { instanceId, qrcode };
    if (data?.passkeyPending) {
      throw new ApiError(409, 'Este celular pediu chave de acesso em vez de QR Code. Tente conectar pelo codigo de telefone.');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { instanceId, qrcode: '' };
}

/** Deslogar o celular: o próximo pareamento pede QR. O usuário continua no servidor. */
export function logoutWuz(_instanceId: string, token: string) {
  return requestWuz<any>(token, '/session/logout', { method: 'POST' });
}

/** Reiniciar: fecha o socket (a sessão fica) e abre de novo. */
export async function restartWuz(_instanceId: string, token: string) {
  await requestWuz(token, '/session/disconnect', { method: 'POST' }).catch(() => {});
  await abrirSessao(token);
  return { value: true };
}

/**
 * Webhook da loja. O retorno segue o `configureWapiWebhooks`, que rotas e vigia
 * conferem pelo nome `update-webhook-received`.
 */
export async function configureWuzWebhooks(_instanceId: string, token: string, webhookUrl: string) {
  try {
    await requestWuz(token, '/webhook', {
      method: 'POST',
      body: { webhook: webhookUrl, events: EVENTOS_WUZAPI, WebhookURL: webhookUrl, Events: EVENTOS_WUZAPI },
    });
    // Assinatura de eventos também vale na sessão: sem ela a WuzAPI não manda
    // os avisos de conexão.
    await abrirSessao(token).catch(() => {});
    return { configured: ['update-webhook-received'], failed: [] as Array<{ endpoint: string; reason: string }>, webhookUrl };
  } catch (error: any) {
    const reason = String(error?.message || error || 'Falha desconhecida');
    console.warn('[WuzAPI] Webhook nao foi configurado:', reason);
    return { configured: [] as string[], failed: [{ endpoint: 'update-webhook-received', reason }], webhookUrl };
  }
}

type ResultadoDeEnvio = { instanceId: string; messageId: string; insertedId?: string };

export async function sendWuzText(
  instanceId: string,
  token: string,
  input: { phone: string; message: string },
): Promise<ResultadoDeEnvio> {
  const data = await requestWuz<any>(token, '/chat/send/text', {
    method: 'POST',
    body: { Phone: input.phone, Body: input.message },
  });
  return { instanceId, messageId: String(data?.Id || '') };
}

/** Link ou base64 → data URL. Imagem da WuzAPI só aceita PNG e JPEG. */
async function paraDataUrl(valor: string, tipoPadrao: string, aceitos?: RegExp) {
  const bruto = String(valor || '').trim();
  if (/^data:/i.test(bruto)) return bruto;
  if (!/^https?:\/\//i.test(bruto)) return `data:${tipoPadrao};base64,${bruto}`;

  const resposta = await fetch(bruto, { signal: AbortSignal.timeout(10000) });
  if (!resposta.ok) throw new ApiError(502, `Nao consegui baixar o arquivo para enviar (HTTP ${resposta.status}).`);
  const tipo = (resposta.headers.get('content-type') || tipoPadrao).split(';')[0].trim().toLowerCase();
  if (aceitos && !aceitos.test(tipo)) return null;
  const buffer = Buffer.from(await resposta.arrayBuffer());
  return `data:${aceitos ? tipo : tipoPadrao};base64,${buffer.toString('base64')}`;
}

export async function sendWuzImage(
  instanceId: string,
  token: string,
  input: { phone: string; image: string; caption?: string },
): Promise<ResultadoDeEnvio> {
  const imagem = await paraDataUrl(input.image, 'image/jpeg', /^image\/(png|jpe?g)$/);
  if (!imagem) {
    // Logo em WEBP/SVG não passa na WuzAPI: a mensagem vale mais que a imagem.
    console.warn('[WuzAPI] Imagem em formato nao aceito (so PNG/JPEG); enviando so o texto.');
    if (input.caption) return sendWuzText(instanceId, token, { phone: input.phone, message: input.caption });
    throw new ApiError(415, 'Imagem em formato nao aceito pelo servidor de WhatsApp (use PNG ou JPEG).');
  }
  const data = await requestWuz<any>(token, '/chat/send/image', {
    method: 'POST',
    body: { Phone: input.phone, Image: imagem, ...(input.caption ? { Caption: input.caption } : {}) },
    timeoutMs: 30000,
  });
  return { instanceId, messageId: String(data?.Id || '') };
}

export async function sendWuzDocument(
  instanceId: string,
  token: string,
  input: { phone: string; document: string; extension: string; fileName?: string; caption?: string },
): Promise<ResultadoDeEnvio> {
  const extensao = String(input.extension || 'pdf').replace(/^\./, '').toLowerCase() || 'pdf';
  const documento = await paraDataUrl(input.document, 'application/octet-stream');
  const data = await requestWuz<any>(token, '/chat/send/document', {
    method: 'POST',
    body: { Phone: input.phone, Document: documento, FileName: input.fileName || `documento.${extensao}` },
    timeoutMs: 30000,
  });
  // O documento da WuzAPI não tem legenda: ela vai logo depois, em texto.
  if (input.caption) await sendWuzText(instanceId, token, { phone: input.phone, message: input.caption }).catch(() => {});
  return { instanceId, messageId: String(data?.Id || '') };
}

/** Nunca lança: sem foto, a tela cai no avatar de iniciais. */
export async function getWuzProfilePicture(_instanceId: string, token: string, phone: string) {
  try {
    const data = await requestWuz<any>(token, '/user/avatar', {
      method: 'POST',
      body: { Phone: String(phone || '').replace(/\D/g, ''), Preview: true },
    });
    return { link: data?.URL || data?.url || null };
  } catch {
    return { link: null };
  }
}
