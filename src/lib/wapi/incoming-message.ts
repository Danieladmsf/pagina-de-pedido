/**
 * Decide se um evento do webhook da W-API e uma mensagem de cliente que merece
 * resposta automatica — e, se for, extrai telefone/texto dela.
 *
 * Este filtro ja quebrou de tres jeitos diferentes em producao, sempre pelo
 * mesmo motivo: uma regra escrita para barrar status/grupo acabou barrando
 * conversa de verdade. Por isso ele mora aqui, isolado da rota, com testes em
 * cima de payloads reais (`incoming-message.test.ts`). Antes de apertar
 * qualquer regra, acrescente o payload real ao teste.
 *
 * A regra de ouro: bloqueio olha o DESTINO da mensagem (chat.id/remoteJid),
 * nunca o que ela cita nem de onde o cliente veio.
 */

export type IncomingMessage = {
  /**
   * Telefone real do cliente. Vem VAZIO quando o contato nao esta salvo na
   * agenda da loja: nesse caso a W-API so entrega o @lid, e o WhatsApp nao
   * deixa converter LID em telefone (e privacidade, por design).
   */
  phone: string;
  /**
   * Para onde responder — o telefone ou `"<lid>@lid"`. Nunca vazio. A W-API
   * aceita o @lid no lugar do telefone no campo `phone` do envio, entao da pra
   * responder um contato novo sem nunca saber o numero dele.
   */
  address: string;
  text: string;
  timestamp: number;
  /**
   * Nome que a pessoa usa no WhatsApp, quando o provedor manda. E o unico nome
   * disponivel para contato fora da agenda da loja — sem ele, quem chega pelo
   * codigo do cardapio aparece so como um numero no painel.
   */
  pushName: string;
  /**
   * O `@lid` de quem escreveu, quando o provedor manda. E o unico identificador
   * que aparece nos dois lados da mesma pessoa: na DM (ao lado do telefone) e na
   * reacao ao story (onde telefone nao vem). E o que costura as duas.
   */
  senderLid: string;
};

function normalizePhone(phone: string) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  return `55${digits}`;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function stringId(value: any) {
  if (typeof value === 'string') return value;
  return firstString(value?.id, value?._serialized, value?.remoteJid, value?.jid);
}

function messageIdentifiers(payload: any, data: any) {
  return [
    payload?.from,
    payload?.sender,
    payload?.remoteJid,
    payload?.chatId,
    payload?.jid,
    payload?.participant,
    payload?.author,
    payload?.key?.remoteJid,
    payload?.key?.participant,
    payload?.message?.key?.remoteJid,
    payload?.message?.key?.participant,
    payload?.id?.remote,
    data?.from,
    data?.from?.id,
    data?.sender,
    data?.sender?.id,
    data?.contact,
    data?.contact?.id,
    data?.remoteJid,
    data?.chatId,
    data?.jid,
    data?.participant,
    data?.author,
    data?.key?.remoteJid,
    data?.key?.participant,
    data?.message?.key?.remoteJid,
    data?.message?.key?.participant,
    data?.id?.remote,
  ].map(stringId).filter(Boolean);
}

function hasBlockedChatTarget(identifiers: string[]) {
  return identifiers.some((identifier) => {
    const value = identifier.toLowerCase();
    return (
      // Formato novo da W-API: stories chegam com chat.id = "status" (sem o
      // sufixo @broadcast). NAO bloquear @lid aqui: DMs reais chegam com
      // chat.id = "<lid>@lid" e o telefone verdadeiro em sender.id — o guarda
      // contra LID virar telefone corrompido e a checagem de 12-13 digitos.
      value === 'status' ||
      value.includes('@g.us') ||
      value.includes('status@broadcast') ||
      value.includes('@broadcast') ||
      value.includes('@newsletter') ||
      value.includes('broadcast') ||
      value.includes('newsletter') ||
      value.includes('group')
    );
  });
}

function isBlockedChatTarget(value: string) {
  return hasBlockedChatTarget([value]);
}

function hasBlockedMessageType(payload: any, data: any, eventName: string) {
  const type = firstString(
    payload?.messageType,
    payload?.typeMessage,
    payload?.message?.messageType,
    payload?.message?.type,
    data?.messageType,
    data?.typeMessage,
    data?.message?.messageType,
    data?.message?.type,
  ).toLowerCase();

  return (
    eventName.includes('status') ||
    eventName.includes('delivery') ||
    eventName.includes('presence') ||
    type.includes('status') ||
    type.includes('story') ||
    type.includes('broadcast') ||
    type.includes('newsletter') ||
    type.includes('reaction') ||
    type.includes('protocol') ||
    type === 'revoked' ||
    type === 'gp2' ||
    type === 'notification'
  );
}

/**
 * Acha o @lid do remetente. So serve de endereco quando NAO veio telefone: o
 * numero de verdade e sempre preferido, porque e ele que casa com o cadastro
 * do cliente no resto do sistema.
 */
function extractSenderLid(payload: any, data: any) {
  const candidates = [
    payload?.sender?.senderLid,
    data?.sender?.senderLid,
    payload?.sender?.lid,
    data?.sender?.lid,
    payload?.senderLid,
    data?.senderLid,
    // Em conversa 1:1 o chat e o proprio contato, entao o chat.id serve de
    // ultimo recurso. Grupo e status ja foram barrados muito antes daqui.
    payload?.chat?.id,
    data?.chat?.id,
  ];

  for (const candidate of candidates) {
    const value = firstString(candidate).toLowerCase();
    if (!value.endsWith('@lid')) continue;
    const digits = value.slice(0, -'@lid'.length).replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 20) return `${digits}@lid`;
  }

  return '';
}

/**
 * O `sender.id` as vezes repete o proprio LID em vez do telefone. Uns poucos
 * LIDs comecam com 55 e tem 13 digitos — a cara de um celular brasileiro — e
 * passavam batido pela checagem de tamanho: a resposta ia para um numero que
 * nao e de ninguem, ou pior, e de outra pessoa. Em producao sao 3 contatos
 * assim. Quando o provedor diz que aquilo e o LID, aquilo nao e telefone.
 */
function ehOProprioLid(rawPhone: string, phone: string, lid: string) {
  const digitosDoLid = lid.replace(/\D/g, '');
  if (!digitosDoLid) return false;
  const digitosCrus = String(rawPhone || '').replace(/\D/g, '');
  return digitosCrus === digitosDoLid || phone === digitosDoLid;
}

function isFromMe(payload: any, data: any) {
  return Boolean(
    payload?.fromMe ||
    payload?.key?.fromMe ||
    payload?.message?.key?.fromMe ||
    payload?.id?.fromMe ||
    data?.fromMe ||
    data?.key?.fromMe ||
    data?.message?.fromMe ||
    data?.message?.key?.fromMe ||
    data?.id?.fromMe
  );
}

/**
 * A reacao — o coracaozinho — no story DA LOJA.
 *
 * Ela chega com `chat.id = "status"`, o mesmo carimbo dos stories alheios que a
 * instancia recebe o dia inteiro, e por isso morria na camada que barra status.
 * So que isto nao e um story: e uma pessoa levantando a mao para a loja, e ficar
 * calado ali e a queixa de quem usa o WhatsApp para vender.
 *
 * O que separa uma coisa da outra e o ALVO da reacao, em
 * `reactionMessage.key.participant`: quem publicou o story reagido. So passa
 * quando esse alguem e a propria loja, pelo `connectedLid` ou, no formato
 * antigo, pelo `connectedPhone` em `<telefone>@s.whatsapp.net`.
 */
function extractStoryReaction(payload: any, data: any): IncomingMessage | null {
  const reaction = payload?.msgContent?.reactionMessage || data?.msgContent?.reactionMessage;
  if (!reaction) return null;

  // Reacao a mensagem comum tem o chat do contato como destino e segue o caminho
  // normal; aqui so interessa a que aponta para um story.
  const citado = firstString(reaction?.key?.remoteJID, reaction?.key?.remoteJid).toLowerCase();
  if (!citado.includes('status@broadcast')) return null;

  const autorDoStory = firstString(reaction?.key?.participant).toLowerCase();
  if (!autorDoStory) return null;

  const nossoLid = firstString(payload?.connectedLid, data?.connectedLid).toLowerCase();
  const nossoTelefone = normalizePhone(firstString(payload?.connectedPhone, data?.connectedPhone));
  const storyEhDaLoja =
    (Boolean(nossoLid) && autorDoStory === nossoLid) ||
    (Boolean(nossoTelefone) &&
      /@(s.whatsapp.net|c.us)$/.test(autorDoStory) &&
      normalizePhone(autorDoStory.replace(/D/g, '')) === nossoTelefone);
  if (!storyEhDaLoja) return null;

  // Tirar a reacao nao e levantar a mao: sem emoji nao ha o que responder.
  const emoji = firstString(reaction?.text);
  if (!emoji) return null;

  // Na reacao o provedor nunca entregou telefone (135 de 135 em producao vieram
  // so com LID), mas o envio aceita o `@lid` no lugar do numero.
  const lid = extractSenderLid(payload, data);
  const bruto = firstString(payload?.sender?.id, data?.sender?.id);
  const telefone = normalizePhone(bruto);
  const temTelefone =
    telefone.length >= 12 && telefone.length <= 13 && !ehOProprioLid(bruto, telefone, lid);
  if (!temTelefone && !lid) return null;

  const pushName = firstString(
    payload?.sender?.pushName,
    payload?.sender?.name,
    payload?.pushName,
    data?.sender?.pushName,
    data?.sender?.name,
    data?.pushName,
  );

  return {
    phone: temTelefone ? telefone : '',
    address: temTelefone ? telefone : lid,
    text: emoji,
    timestamp: 0,
    pushName: String(pushName || '').trim().slice(0, 80),
    senderLid: lid,
  };
}

function isReceivedWebhook(event: string, hook?: string) {
  if (hook) return hook === 'received';
  return String(event || '').trim().toLowerCase().includes('received') || String(event || '').trim().toLowerCase() === 'message';
}

// Campos que descrevem a mensagem CITADA, nao o destino desta mensagem. Quando
// o cliente responde a um story da loja, a DM chega com
// `contextInfo.remoteJID = "status@broadcast"` — o status e o que ele esta
// citando, e a conversa e um 1:1 normal. Varrer esse ramo fazia o deep scan ler
// "isso e um status" e engolir justamente o comentario que a loja quer
// responder. O destino real (chat.id/remoteJid) fica fora daqui e continua
// sendo checado nas camadas 3 e 4.
const QUOTE_CONTEXT_KEYS = new Set(['contextinfo', 'quotedmessage', 'quotedmsg', 'quotedparticipant']);

// Deep scan: check if ANY string value in the payload contains a blocked target
// This catches status@broadcast and @g.us even in unexpected/nested fields
function deepHasBlockedTarget(obj: any, depth = 0): boolean {
  if (depth > 6 || !obj) return false;
  if (typeof obj === 'string') {
    const lower = obj.toLowerCase();
    return (
      lower.includes('@g.us') ||
      lower.includes('status@broadcast') ||
      lower.includes('@broadcast') ||
      lower.includes('@newsletter')
    );
  }
  if (Array.isArray(obj)) {
    return obj.some((item) => deepHasBlockedTarget(item, depth + 1));
  }
  if (typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      // Only scan identifier-like keys, skip large content fields
      const lk = key.toLowerCase();
      if (lk === 'body' || lk === 'content' || lk === 'caption' || lk === 'text' || lk === 'messagebody' || lk === 'textmessage' || lk === 'conversation') continue;
      if (QUOTE_CONTEXT_KEYS.has(lk)) continue;
      if (deepHasBlockedTarget(obj[key], depth + 1)) return true;
    }
  }
  return false;
}

export function extractIncomingMessage(payload: any, event: string, hook?: string): IncomingMessage | null {
  const eventName = String(event || '').toLowerCase();
  if (!isReceivedWebhook(event, hook)) return null;
  if (eventName.includes('connect')) return null;

  const data = payload?.data || payload?.message || payload;

  // Grupo e mensagem nossa nunca respondem — nem em forma de reacao.
  if (payload?.isGroup || payload?.isGroupMsg || data?.isGroup || data?.isGroupMsg) return null;
  if (isFromMe(payload, data)) return null;

  // Unica excecao ao bloqueio de status, e ela vem ANTES das camadas justamente
  // por ser um `chat.id = "status"` legitimo. Ver `extractStoryReaction`.
  const storyReaction = extractStoryReaction(payload, data);
  if (storyReaction) return storyReaction;

  // ── Layer 1: Explicit boolean flags from W-API ──
  if (payload?.isStatus || payload?.isStatusMsg || data?.isStatus || data?.isStatusMsg) return null;
  if (payload?.isStatusV3 || data?.isStatusV3) return null;
  if (payload?.isViewOnce || data?.isViewOnce) return null;
  if (payload?.isForwarded || data?.isForwarded) return null;

  // ── Layer 2: Check message type strings ──
  if (hasBlockedMessageType(payload, data, eventName)) return null;

  // ── Layer 3: Check all known identifier fields ──
  const identifiers = messageIdentifiers(payload, data);
  if (hasBlockedChatTarget(identifiers)) return null;

  // ── Layer 4: Deep-check remoteJid / chatId in ALL possible locations ──
  // W-API sometimes puts status@broadcast or @g.us in unexpected nested fields
  const allJids = [
    payload?.remoteJid, payload?.chatId, payload?.chat, payload?.chat?.id,
    payload?.key?.remoteJid, payload?.message?.key?.remoteJid,
    payload?.id?.remote, payload?.id?.participant,
    data?.remoteJid, data?.chatId, data?.chat, data?.chat?.id,
    data?.key?.remoteJid, data?.message?.key?.remoteJid,
    data?.id?.remote, data?.id?.participant,
    // W-API specific nested structures
    payload?.message?.remoteJid, payload?.message?.chatId,
    data?.message?.remoteJid, data?.message?.chatId,
  ].map(v => String(v || '')).filter(v => v && v !== 'undefined');

  if (hasBlockedChatTarget(allJids)) {
    console.log('[W-API webhook] Bloqueado por JID (status/grupo):', { jids: allJids.filter(j => j.includes('@')) });
    return null;
  }

  // ── Layer 5: Deep payload scan as last resort ──
  // Catches edge cases where status@broadcast or @g.us appears in any nested field
  if (deepHasBlockedTarget(payload)) {
    console.log('[W-API webhook] Bloqueado por deep scan (status/grupo detectado no payload)');
    return null;
  }

  const rawPhone = firstString(
    payload?.phone,
    payload?.phoneNumber,
    payload?.senderNumber,
    payload?.fromNumber,
    stringId(payload?.from),
    stringId(payload?.sender),
    payload?.remoteJid,
    payload?.chatId,
    payload?.jid,
    payload?.key?.remoteJid,
    payload?.message?.key?.remoteJid,
    data?.phone,
    data?.phoneNumber,
    data?.senderNumber,
    data?.fromNumber,
    stringId(data?.from),
    data?.from?.id,
    stringId(data?.sender),
    data?.sender?.phone,
    data?.sender?.number,
    data?.sender?.id,
    data?.contact?.id,
    data?.remoteJid,
    data?.chatId,
    data?.jid,
    data?.key?.remoteJid,
  );

  if (!rawPhone || isBlockedChatTarget(rawPhone)) return null;

  const text = firstString(
    payload?.body,
    payload?.messageBody,
    payload?.content,
    payload?.caption,
    payload?.text,
    payload?.text?.message,
    payload?.textMessage,
    payload?.textMessageData?.textMessage,
    payload?.extendedTextMessageData?.text,
    payload?.msgContent?.conversation,
    payload?.msgContent?.extendedTextMessage?.text,
    payload?.message?.body,
    payload?.message?.messageBody,
    payload?.message?.content,
    payload?.message?.caption,
    payload?.message?.text,
    payload?.message?.conversation,
    payload?.message?.textMessage,
    payload?.message?.textMessageData?.textMessage,
    payload?.message?.extendedTextMessageData?.text,
    payload?.message?.extendedTextMessage?.text,
    data?.body,
    data?.messageBody,
    data?.content,
    data?.caption,
    data?.text,
    data?.text?.message,
    data?.textMessage,
    data?.textMessageData?.textMessage,
    data?.extendedTextMessageData?.text,
    data?.msgContent?.conversation,
    data?.msgContent?.extendedTextMessage?.text,
    data?.message?.body,
    data?.message?.messageBody,
    data?.message?.content,
    data?.message?.caption,
    data?.message?.conversation,
    data?.message?.text,
    data?.message?.textMessage,
    data?.message?.textMessageData?.textMessage,
    data?.message?.extendedTextMessageData?.text,
    data?.message?.extendedTextMessage?.text,
  );

  const looksLikeMessageEvent = eventName.includes('received') || hook === 'received';
  const hasMessageShape = Boolean(text || payload?.body || payload?.text || payload?.message || data?.body || data?.text || data?.message);
  if (!looksLikeMessageEvent && !hasMessageShape) return null;

  // Contato novo, fora da agenda da loja: a W-API entrega so o @lid, sem
  // telefone nenhum. Antes a mensagem morria aqui — era justamente o cliente
  // novo que clicou no link da loja e mandou "oi" que ficava sem resposta.
  const lid = extractSenderLid(payload, data);

  const phone = normalizePhone(rawPhone);
  // So numero BR plausivel: 55 + DDD + 8-9 digitos = 12-13. LIDs numericos
  // (13-15 digitos) passam de 15 com o prefixo 55 e ficam de fora — o que cai
  // aqui NAO e telefone, e tratar como se fosse manda mensagem pra estranho.
  // Os poucos que cabem na faixa sao pegos por `ehOProprioLid`.
  const hasPhone =
    phone.length >= 12 && phone.length <= 13 && !ehOProprioLid(rawPhone, phone, lid);
  if (!hasPhone && !lid) return null;

  const timestamp = Number(
    firstString(
      payload?.messageTimestamp,
      payload?.timestamp,
      payload?.t,
      data?.messageTimestamp,
      data?.timestamp,
      data?.t
    ) || 0
  );

  const pushName = firstString(
    payload?.pushName,
    payload?.notifyName,
    payload?.senderName,
    payload?.sender?.pushName,
    payload?.sender?.name,
    payload?.contact?.name,
    payload?.chat?.name,
    data?.pushName,
    data?.notifyName,
    data?.senderName,
    data?.sender?.pushName,
    data?.sender?.name,
    data?.contact?.name,
    data?.chat?.name,
  );

  return {
    phone: hasPhone ? phone : '',
    address: hasPhone ? phone : lid,
    text,
    timestamp,
    pushName: String(pushName || '').trim().slice(0, 80),
    senderLid: lid,
  };
}
