/**
 * Classificacao dos webhooks da W-API: este evento diz que a loja CONECTOU ou
 * DESCONECTOU o WhatsApp?
 *
 * Mora aqui (e nao dentro da rota) porque foi a peca que ficou quebrada em
 * silencio: os avisos reais da W-API chegam em camelCase (`webhookConnected`,
 * `webhookDisconnected`) e a versao antiga quebrava o nome so em caracteres nao
 * alfanumericos. Sem separar o camelCase, `webhookDisconnected` virava o token
 * unico "webhookdisconnected", que nunca batia com 'disconnected' — nenhum aviso
 * de conexao ou desconexao jamais era aplicado, o app ficava preso em
 * `pending_qr` e caia no laco de QR Code, que derrubava a sessao do celular.
 *
 * Os testes fixam payloads REAIS colhidos em producao.
 */

/** Quebra em palavras, tratando camelCase: `webhookDisconnected` -> [webhook, disconnected]. */
export function words(value: unknown) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function stateValues(payload: any, event: string) {
  return [
    event,
    payload?.status,
    payload?.state,
    payload?.connectionStatus,
    payload?.instanceStatus,
    payload?.connected,
    payload?.isConnected,
    payload?.smartphoneConnected,
    payload?.instance?.status,
    payload?.instance?.instanceStatus,
    payload?.instance?.connected,
    payload?.data?.status,
    payload?.data?.instanceStatus,
    payload?.data?.connected,
    payload?.data?.isConnected,
    payload?.data?.instance?.status,
    payload?.data?.instance?.connected,
  ];
}

function normalizedStateValues(payload: any, event: string) {
  return stateValues(payload, event).map((value) => {
    if (typeof value === 'boolean') return value ? 'connected' : 'disconnected';
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  });
}

function stateTokens(payload: any, event: string) {
  return stateValues(payload, event).flatMap((value) => {
    if (typeof value === 'boolean') return [value ? 'connected' : 'disconnected'];
    return words(value);
  });
}

const DISCONNECT_WORDS = ['disconnected', 'disconnect', 'logout', 'loggedout', 'offline'];
const CONNECT_WORDS = ['connected', 'connect', 'open', 'online', 'ready'];

/**
 * Nomes genericos de evento que falam de conexao sem trazer 'connect' no nome.
 * Comparados palavra a palavra (`status_change`), e nao por `includes`, para nao
 * arrastar junto o `webhookStatus`, que e o ack de entrega de CADA mensagem —
 * 168 de cada 400 eventos em producao. Era assim que o status de um ack
 * ("DELIVERY", "READ", "ERROR") acabava mandando na conexao da loja inteira.
 */
const CONNECTION_EVENT_NAMES = new Set([
  'status_change',
  'connection_update',
  'connection_status',
  'connection_state',
]);

export function isConnectionEvent(event: string, hook?: string) {
  // O hook vem da querystring que NOS montamos ao registrar os webhooks, entao
  // quando existe ele e a fonte da verdade: `received`, `delivery` e
  // `message-status` sao mensagem, nunca conexao.
  if (hook) return hook === 'connected' || hook === 'disconnected';

  const eventWords = words(event);
  if ([...CONNECT_WORDS, ...DISCONNECT_WORDS, 'qr', 'qrcode'].some((w) => eventWords.includes(w))) return true;
  return CONNECTION_EVENT_NAMES.has(eventWords.join('_'));
}

export function isDisconnectedEvent(payload: any, event: string, hook?: string) {
  if (!isConnectionEvent(event, hook)) return false;

  // O hook vem da URL que NOS montamos, entao e a fonte mais confiavel.
  if (hook === 'disconnected') return true;

  // Payload real: {"event":"webhookDisconnected","disconnected":true}. O campo
  // `disconnected` nao era lido por stateValues (que so olha status/state/
  // connected/...), e um `true` ali chegava a ser lido AO CONTRARIO pelo
  // mapeamento booleano de normalizedStateValues.
  if (payload?.disconnected === true || payload?.data?.disconnected === true) return true;

  if (words(event).some((w) => DISCONNECT_WORDS.includes(w))) return true;

  const states = normalizedStateValues(payload, event);
  if (states.some((state) => state === 'not_connected' || state === 'false')) return true;

  return stateTokens(payload, event).some((token) => DISCONNECT_WORDS.includes(token));
}

export function isConnectedEvent(payload: any, event: string, hook?: string) {
  if (!isConnectionEvent(event, hook)) return false;
  if (isDisconnectedEvent(payload, event, hook)) return false;
  if (hook === 'connected') return true;
  if (payload?.connected === true || payload?.data?.connected === true) return true;
  if (words(event).some((w) => CONNECT_WORDS.includes(w))) return true;
  return stateTokens(payload, event).some((token) => CONNECT_WORDS.includes(token));
}

/**
 * Prova de vida: TODO webhook de mensagem carrega `connectedPhone` com o numero
 * logado na instancia. Se ele chegou, o WhatsApp esta conectado AGORA — e esse
 * sinal chega o tempo todo, o que conserta o estado sozinho caso algum aviso de
 * conexao se perca. So aceita numero BR plausivel (55 + DDD + 8/9 digitos).
 */
export function getLiveConnectedPhone(payload: any) {
  const digits = String(payload?.connectedPhone ?? payload?.data?.connectedPhone ?? '').replace(/\D/g, '');
  return digits.length >= 12 && digits.length <= 13 ? digits : '';
}
