/**
 * Leitura dos webhooks da Z-API para o mesmo resultado que o robô já entende
 * (`IncomingMessage`, de `lib/wapi/incoming-message.ts`).
 *
 * Não é tradução do formato da W-API: a Z-API manda um JSON plano por evento
 * (`type: "ReceivedCallback"`, `phone`, `fromMe`, `isGroup`, `text.message`...),
 * então as regras são escritas direto sobre ele. As regras de fundo são as
 * mesmas que já quebraram em produção na W-API: grupo, canal, lista de
 * transmissão, story dos contatos e mensagem da própria loja nunca respondem;
 * comentário no story da loja é conversa; reação só no story da loja; contato
 * fora da agenda chega só com `@lid` e é respondido por ele.
 *
 * Payloads de referência: https://developer.z-api.io/webhooks/on-message-received-examples
 */
import type { IncomingMessage } from '@/lib/wapi/incoming-message';

export type EventoZapi = {
  /** O `type` do evento (ReceivedCallback, ConnectedCallback...). */
  event: string;
  connected: boolean;
  disconnected: boolean;
  /** Telefone da loja que veio no evento: prova de vida da conexão. */
  livePhone: string;
  /** Mensagem de cliente que merece resposta automática. */
  incoming: IncomingMessage | null;
  /**
   * Mensagem que a LOJA mandou pelo celular (não pela API). É o que cala o robô
   * enquanto a dona está atendendo; o destino vai em `chatId`.
   */
  saidaDaLoja: { chatId: string } | null;
};

/** Evento da Z-API: `type` terminado em "Callback". A W-API usa `event`. */
export function ehEventoZapi(payload: any) {
  return typeof payload?.type === 'string' && /Callback$/.test(payload.type);
}

function texto(...valores: unknown[]) {
  for (const valor of valores) {
    if (typeof valor === 'string' && valor.trim()) return valor.trim();
  }
  return '';
}

function digitos(valor: unknown) {
  return String(valor || '').replace(/\D/g, '');
}

function telefoneBr(valor: unknown) {
  const d = digitos(valor);
  if (!d) return '';
  return d.startsWith('55') ? d : `55${d}`;
}

/** O `@lid` de quem escreveu, normalizado para `<digitos>@lid`. */
function lidDoRemetente(payload: any) {
  for (const candidato of [payload?.senderLid, payload?.chatLid, payload?.phone]) {
    const valor = texto(candidato).toLowerCase();
    if (!valor.endsWith('@lid')) continue;
    const d = digitos(valor.slice(0, -'@lid'.length));
    if (d.length >= 8 && d.length <= 20) return `${d}@lid`;
  }
  return '';
}

/** Destino que nunca é conversa com cliente: grupo, canal, story, transmissão. */
function destinoBloqueado(valor: string) {
  const v = valor.toLowerCase();
  return (
    v === 'status' ||
    v.includes('@g.us') ||
    v.includes('-group') ||
    v.includes('@broadcast') ||
    v.includes('broadcast') ||
    v.includes('@newsletter') ||
    v.includes('newsletter')
  );
}

function textoDaMensagem(payload: any) {
  return texto(
    payload?.text?.message,
    payload?.image?.caption,
    payload?.video?.caption,
    payload?.document?.caption,
    payload?.buttonsResponseMessage?.message,
    payload?.listResponseMessage?.message,
    payload?.listResponseMessage?.title,
    payload?.buttonReply?.message,
  );
}

/**
 * Reação (o coraçãozinho) no story DA LOJA: a mensagem reagida é da loja
 * (`fromMe`) e é um status. Reação a mensagem comum não é pergunta nenhuma e
 * fica sem resposta, como na W-API.
 */
function reacaoNoStoryDaLoja(payload: any) {
  const reacao = payload?.reaction;
  if (!reacao) return null;
  const citada = reacao?.referencedMessage || {};
  const ehStory = /status|broadcast/i.test(texto(citada?.phone, citada?.participant));
  if (citada?.fromMe !== true || !ehStory) return null;
  const emoji = texto(reacao?.value);
  return emoji || null;
}

export function lerEventoZapi(payload: any): EventoZapi {
  const event = texto(payload?.type) || 'unknown';
  const livePhone = digitos(event === 'ConnectedCallback' ? payload?.phone : payload?.connectedPhone);
  const resultado: EventoZapi = {
    event,
    connected: event === 'ConnectedCallback' && payload?.connected !== false,
    disconnected: event === 'DisconnectedCallback' || (event === 'ConnectedCallback' && payload?.connected === false),
    livePhone: livePhone.length >= 10 ? livePhone : '',
    incoming: null,
    saidaDaLoja: null,
  };

  if (event !== 'ReceivedCallback') return resultado;

  const chat = texto(payload?.phone);
  const bloqueado =
    payload?.isGroup === true ||
    payload?.isNewsletter === true ||
    payload?.broadcast === true ||
    destinoBloqueado(chat) ||
    // Aviso de ligação, entrada em grupo e afins: não é mensagem de ninguém.
    Boolean(payload?.notification);
  if (bloqueado) return resultado;

  if (payload?.fromMe === true) {
    // O que o robô mandou volta aqui com `fromApi: true` e não conta como a dona
    // atendendo, senão ele se calaria sozinho.
    if (payload?.fromApi !== true && chat) resultado.saidaDaLoja = { chatId: chat };
    return resultado;
  }

  // Mensagem editada não é mensagem nova.
  if (payload?.isEdit === true) return resultado;

  const lid = lidDoRemetente(payload);
  const telefone = chat.toLowerCase().endsWith('@lid') ? '' : telefoneBr(chat);
  // Só número BR plausível (55 + DDD + 8 ou 9 dígitos); o que tem os dígitos do
  // próprio LID não é telefone (ver `ehOProprioLid` na W-API).
  const temTelefone =
    telefone.length >= 12 && telefone.length <= 13 && telefone !== digitos(lid) && digitos(chat) !== digitos(lid);
  if (!temTelefone && !lid) return resultado;

  const pushName = texto(payload?.senderName, payload?.chatName).slice(0, 80);
  const timestamp = Number(payload?.momment) || 0;
  const base = {
    phone: temTelefone ? telefone : '',
    address: temTelefone ? telefone : lid,
    timestamp,
    pushName,
    senderLid: lid,
  };

  if (payload?.reaction) {
    const emoji = reacaoNoStoryDaLoja(payload);
    if (emoji) resultado.incoming = { ...base, text: emoji, timestamp: 0, isStoryReaction: true };
    return resultado;
  }

  resultado.incoming = { ...base, text: textoDaMensagem(payload) };
  return resultado;
}
