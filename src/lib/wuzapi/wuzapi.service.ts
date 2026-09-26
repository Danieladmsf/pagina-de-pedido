/**
 * Cliente do servidor de WhatsApp das lojas: WuzAPI (github.com/asternic/wuzapi,
 * Go sobre whatsmeow) numa máquina nossa no Google Cloud, no ar desde
 * 25/09/2026. É o único provedor do sistema; o manual está em
 * docs/wapi/servidor-proprio-wuzapi.md.
 *
 * Cada loja é um "usuário" da WuzAPI, com chave própria (cabeçalho `token`). No
 * nosso cadastro o ID da instância é "WUZ-<...>", só um rótulo nosso: o servidor
 * reconhece a loja pela chave. O endereço do servidor e a chave de admin (que
 * cria a sessão de loja nova) vêm de `WUZAPI_URL`/`WUZAPI_ADMIN_TOKEN` ou de
 * `app_config/wuzapi`.
 *
 * Particularidades da WuzAPI tratadas aqui:
 * - imagem e documento só vão em base64: o link do logo é baixado e convertido;
 * - o QR só existe com a sessão aberta, então pedir QR abre a sessão antes;
 * - quem entra na assinatura de eventos decide o que chega no webhook.
 */
import crypto from 'crypto';
import { ApiError } from '@/lib/firebase-auth-rest';
import { getOptionalAdminDb } from '@/lib/firebase-admin';
import { decryptSecret } from '@/lib/wapi/crypto';

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

const CONFIG_CACHE_MS = 5 * 60 * 1000;
let configCache: { baseUrl: string; adminTokenEncrypted: string; lidoEm: number } | null = null;

async function lerConfig() {
  if (configCache && Date.now() - configCache.lidoEm < CONFIG_CACHE_MS) return configCache;
  let dados: Record<string, unknown> = {};
  try {
    const snap = await getOptionalAdminDb()?.collection('app_config').doc('wuzapi').get();
    dados = snap?.data() || {};
  } catch (error) {
    console.warn('[WuzAPI] Nao consegui ler app_config/wuzapi:', error);
  }
  configCache = {
    baseUrl: String(dados.baseUrl || '').trim().replace(/\/$/, ''),
    adminTokenEncrypted: String(dados.adminTokenEncrypted || ''),
    lidoEm: Date.now(),
  };
  return configCache;
}

/** Endereço do servidor: `WUZAPI_URL` na Vercel, ou `app_config/wuzapi.baseUrl`. */
async function obterUrlDoServidor() {
  const doAmbiente = (process.env.WUZAPI_URL || '').trim();
  if (doAmbiente) return doAmbiente.replace(/\/$/, '');
  return (await lerConfig()).baseUrl;
}

/** Chave de admin: `WUZAPI_ADMIN_TOKEN` na Vercel, ou a cifrada em `app_config/wuzapi`. */
async function obterChaveDeAdmin() {
  const doAmbiente = (process.env.WUZAPI_ADMIN_TOKEN || '').trim();
  if (doAmbiente) return doAmbiente;
  const cifrada = (await lerConfig()).adminTokenEncrypted;
  if (!cifrada) return '';
  try {
    return decryptSecret(cifrada);
  } catch (error) {
    console.warn('[WuzAPI] Nao consegui abrir a chave de admin salva:', error);
    return '';
  }
}

async function chamarServidor<T>(
  cabecalhos: Record<string, string>,
  path: string,
  options: { method?: string; body?: Record<string, unknown>; timeoutMs?: number } = {},
): Promise<T> {
  const base = await obterUrlDoServidor();
  if (!base) throw new ApiError(500, 'Endereco do servidor de WhatsApp nao configurado.');

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: options.method || 'GET',
      cache: 'no-store',
      headers: {
        ...cabecalhos,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (error: any) {
    // 408 é o sinal de "vale tentar de novo" para quem chamou.
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

/** Chamada em nome de uma loja, com a chave dela. */
async function requestWuz<T>(
  token: string,
  path: string,
  options: { method?: string; body?: Record<string, unknown>; timeoutMs?: number } = {},
): Promise<T> {
  if (!token) throw new ApiError(500, 'Chave do servidor de WhatsApp nao configurada.');
  return chamarServidor<T>({ token: token.trim() }, path, options);
}

/**
 * Sessão da loja no servidor, criada se ainda não existir. Idempotente pelo
 * nome: pedir de novo devolve a chave da sessão que já existe, em vez de criar
 * uma segunda (duas sessões para a mesma loja disputariam o mesmo celular).
 *
 * O nome é o ID que fica no cadastro da loja ("WUZ-<empresaId>"); as sessões
 * criadas à mão antes disso levam o nome da loja depois do ID
 * ("WUZ-GOSTINHO Gostinho de Ceu"), e também são reconhecidas.
 */
export async function criarSessaoDaLoja(nome: string) {
  const admin = await obterChaveDeAdmin();
  if (!admin) throw new ApiError(500, 'Chave de admin do servidor de WhatsApp nao configurada.');

  const usuarios = await chamarServidor<any[]>({ Authorization: admin }, '/admin/users');
  const existente = (Array.isArray(usuarios) ? usuarios : []).find((usuario) => {
    const nomeSalvo = String(usuario?.name || '');
    return nomeSalvo === nome || nomeSalvo.startsWith(`${nome} `);
  });
  if (existente?.token) return { token: String(existente.token), criada: false };

  const token = crypto.randomBytes(24).toString('hex');
  await chamarServidor({ Authorization: admin }, '/admin/users', {
    method: 'POST',
    body: { name: nome, token, events: EVENTOS_WUZAPI.join(',') },
  });
  return { token, criada: true };
}

/** Só os dígitos do usuário de um JID ("5516...:12@s.whatsapp.net" → "5516..."). */
function digitosDoJid(jid: unknown) {
  const usuario = String(jid || '').split('@')[0].split(':')[0].split('.')[0];
  return usuario.replace(/\D/g, '');
}

/**
 * `LoggedIn` é a sessão pareada; `Connected` é o socket, que cai e volta
 * sozinho. Conta como conectada a loja com sessão válida: o socket oscilando
 * não pede QR de novo.
 */
export async function getWuzStatus(instanceId: string, token: string) {
  const data = await requestWuz<any>(token, '/session/status');
  const logado = data?.LoggedIn === true || data?.loggedIn === true;
  const phone = digitosDoJid(data?.jid || data?.Jid || data?.JID);
  return {
    instanceId,
    connected: logado,
    socketConectado: data?.Connected === true || data?.connected === true,
    phone: phone.length >= 10 ? phone : '',
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
 * QR em data URL (`qrcode`). A WuzAPI só gera o QR com a sessão aberta e leva
 * um instante para ele sair, então abre a sessão e pergunta algumas vezes.
 * Sessão já pareada devolve QR vazio: pedir QR não derruba celular conectado.
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

/** Deslogar o celular: o próximo pareamento pede QR. A sessão continua no servidor. */
export function logoutWuz(_instanceId: string, token: string) {
  return requestWuz<any>(token, '/session/logout', { method: 'POST' });
}

/**
 * Registra o webhook da loja e abre a sessão com a assinatura de eventos (sem
 * ela a WuzAPI não manda os avisos de conexão). Lança se o servidor recusar o
 * webhook; a abertura da sessão é tentativa.
 */
export async function configurarWebhook(token: string, webhookUrl: string) {
  await requestWuz(token, '/webhook', {
    method: 'POST',
    body: { webhook: webhookUrl, events: EVENTOS_WUZAPI, WebhookURL: webhookUrl, Events: EVENTOS_WUZAPI },
  });
  await abrirSessao(token).catch(() => {});
}

type ResultadoDeEnvio = { instanceId: string; messageId: string };

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
    return { link: (data?.URL || data?.url || null) as string | null };
  } catch {
    return { link: null };
  }
}
