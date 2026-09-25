/**
 * Leitura dos webhooks do servidor próprio (WuzAPI) para a mesma mensagem que o
 * robô entende (`IncomingMessage`).
 *
 * A WuzAPI manda `{ "type": "Message", "event": <evento cru do whatsmeow> }`.
 * O evento de mensagem traz `Info` (Chat, Sender, SenderAlt, IsFromMe, IsGroup,
 * PushName, Timestamp) e `Message` (o protobuf em JSON: `conversation`,
 * `extendedTextMessage.text`, `reactionMessage.key.remoteJID`...). JIDs chegam
 * como texto: "5516...@s.whatsapp.net", "8189...@lid", "status@broadcast".
 *
 * Regras, as mesmas da W-API e da Z-API: grupo, canal, lista de transmissão e
 * story de contato não respondem; reação só no story da loja; mensagem editada
 * ou de protocolo não é mensagem nova; contato fora da agenda é respondido pelo
 * `@lid`; o que a loja digita no celular cala o robô naquele contato.
 */
import type { IncomingMessage } from '@/lib/wapi/incoming-message';

export type EventoWuzapi = {
  event: string;
  connected: boolean;
  disconnected: boolean;
  livePhone: string;
  incoming: IncomingMessage | null;
  saidaDaLoja: { chatId: string } | null;
};

const TIPOS_WUZAPI = new Set([
  'Message', 'ReadReceipt', 'Receipt', 'Connected', 'Disconnected', 'PairSuccess', 'PairError', 'LoggedOut',
  'ConnectFailure', 'TemporaryBan', 'ClientOutdated', 'StreamReplaced', 'QR', 'QRTimeout', 'Presence',
  'ChatPresence', 'HistorySync', 'UndecryptableMessage', 'CallOffer', 'CallOfferNotice', 'KeepAliveTimeout',
  'KeepAliveRestored', 'AppStateSyncComplete', 'PushNameSetting',
]);

/** Evento da WuzAPI: `type` conhecido e `event` em objeto (na W-API `event` é texto). */
export function ehEventoWuzapi(payload: any) {
  return (
    typeof payload?.type === 'string' &&
    TIPOS_WUZAPI.has(payload.type) &&
    payload?.event !== null &&
    typeof payload?.event === 'object'
  );
}

type Jid = { user: string; server: string };

function jid(valor: unknown): Jid {
  const texto = String(valor || '').trim().toLowerCase();
  const arroba = texto.indexOf('@');
  if (arroba < 0) return { user: '', server: '' };
  // "5516...:12@s.whatsapp.net" e "5516....0:12@..." → só o usuário.
  const user = texto.slice(0, arroba).split(':')[0].split('.')[0];
  return { user, server: texto.slice(arroba + 1) };
}

function telefoneDe(j: Jid) {
  if (j.server !== 's.whatsapp.net' && j.server !== 'c.us') return '';
  const d = j.user.replace(/\D/g, '');
  const tel = d.startsWith('55') ? d : `55${d}`;
  return tel.length >= 12 && tel.length <= 13 ? tel : '';
}

function lidDe(j: Jid) {
  if (j.server !== 'lid') return '';
  const d = j.user.replace(/\D/g, '');
  return d.length >= 8 && d.length <= 20 ? `${d}@lid` : '';
}

/** Destino que nunca é conversa com cliente: grupo, canal, story, transmissão. */
function destinoBloqueado(j: Jid) {
  return (
    j.server === 'g.us' ||
    j.server === 'newsletter' ||
    j.server === 'broadcast' ||
    j.user === 'status'
  );
}

const CONTEUDO = [
  'conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage', 'documentMessage',
  'documentWithCaptionMessage', 'stickerMessage', 'locationMessage', 'liveLocationMessage', 'contactMessage',
  'contactsArrayMessage', 'buttonsResponseMessage', 'listResponseMessage', 'templateButtonReplyMessage',
  'interactiveResponseMessage', 'pollUpdateMessage', 'ptvMessage',
];

function texto(...valores: unknown[]) {
  for (const valor of valores) {
    if (typeof valor === 'string' && valor.trim()) return valor.trim();
  }
  return '';
}

function textoDaMensagem(m: any) {
  return texto(
    m?.conversation,
    m?.extendedTextMessage?.text,
    m?.imageMessage?.caption,
    m?.videoMessage?.caption,
    m?.documentMessage?.caption,
    m?.documentWithCaptionMessage?.message?.documentMessage?.caption,
    m?.buttonsResponseMessage?.selectedDisplayText,
    m?.listResponseMessage?.title,
    m?.templateButtonReplyMessage?.selectedDisplayText,
  );
}

export function lerEventoWuzapi(payload: any): EventoWuzapi {
  const event = String(payload?.type || 'unknown');
  const evt = payload?.event || {};
  const resultado: EventoWuzapi = {
    event,
    connected: event === 'Connected' || event === 'PairSuccess',
    // `Disconnected` é o socket, que a WuzAPI religa sozinha: não derruba a loja.
    disconnected: event === 'LoggedOut',
    livePhone: event === 'PairSuccess' ? telefoneDe(jid(evt?.ID)) : '',
    incoming: null,
    saidaDaLoja: null,
  };
  if (event !== 'Message') return resultado;

  const info = evt?.Info || {};
  const mensagem = evt?.Message || {};
  const chat = jid(info?.Chat);
  const pessoas = [jid(info?.Sender), jid(info?.SenderAlt), chat];
  const telefone = pessoas.map(telefoneDe).find(Boolean) || '';
  const lid = pessoas.map(lidDe).find(Boolean) || '';

  // Reação no story DA LOJA: a mensagem reagida é um status
  // (`key.remoteJID = "status@broadcast"`). A chave é montada por quem reagiu,
  // então `key.fromMe` vem FALSO (o story não é dele) e o autor do story vai em
  // `key.participant`. O WhatsApp só entrega reação de story a quem publicou,
  // então toda reação de story que chega aqui é num story nosso: nas 3 reações
  // reais da W-API em 25/09, `participant` era sempre o LID da própria loja.
  // Reação a mensagem comum (sem status) não é pergunta e fica sem resposta.
  const reacao = mensagem?.reactionMessage;
  if (reacao) {
    const citada = String(reacao?.key?.remoteJID || reacao?.key?.remoteJid || '').toLowerCase();
    const emoji = texto(reacao?.text);
    if (info?.IsFromMe !== true && citada.includes('status@broadcast') && emoji && (telefone || lid)) {
      resultado.incoming = {
        phone: telefone,
        address: telefone || lid,
        text: emoji,
        timestamp: 0,
        pushName: texto(info?.PushName).slice(0, 80),
        senderLid: lid,
        isStoryReaction: true,
      };
    }
    return resultado;
  }

  if (info?.IsGroup === true || destinoBloqueado(chat)) return resultado;

  if (info?.IsFromMe === true) {
    // Mensagem que a loja mandou pelo celular. O que o próprio servidor envia
    // não volta como evento, então tudo aqui é gente atendendo.
    const destino = telefoneDe(chat) || lidDe(chat);
    if (destino) resultado.saidaDaLoja = { chatId: destino };
    return resultado;
  }

  // Edição, apagar e avisos de protocolo não são mensagem nova.
  if (mensagem?.protocolMessage || mensagem?.editedMessage || texto(info?.Edit)) return resultado;
  if (!CONTEUDO.some((chave) => mensagem?.[chave])) return resultado;
  if (!telefone && !lid) return resultado;

  const timestamp = Date.parse(String(info?.Timestamp || '')) || 0;
  resultado.incoming = {
    phone: telefone,
    address: telefone || lid,
    text: textoDaMensagem(mensagem),
    timestamp,
    pushName: texto(info?.PushName).slice(0, 80),
    senderLid: lid,
  };
  return resultado;
}
