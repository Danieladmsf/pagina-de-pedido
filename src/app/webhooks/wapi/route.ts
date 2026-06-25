import { NextResponse } from 'next/server';
import { getOptionalAdminDb } from '@/lib/firebase-admin';
import { decryptSecret } from '@/lib/wapi/crypto';
import { getWapiConnectedPhone, sendWapiTextMessage, sendWapiImageMessage } from '@/lib/wapi/wapi.service';
import {
  buildStoreLink,
  formatWorkingHours,
  getStoreOpenState,
  getWhatsAppMessages,
  renderWhatsAppTemplate,
  formatNextOpeningTime,
} from '@/lib/whatsapp-messages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(request: Request) {
  const expected = process.env.WAPI_WEBHOOK_SECRET;
  if (!expected) return true;

  const url = new URL(request.url);
  const received = url.searchParams.get('secret') || request.headers.get('x-wapi-secret');
  return received === expected;
}

function getInstanceId(payload: any) {
  return payload?.instanceId || payload?.instance_id || payload?.instance?.id || '';
}

function getWebhookToken(url: URL) {
  const encryptedToken = url.searchParams.get('wt');
  if (!encryptedToken) return { present: false, token: '' };

  try {
    return { present: true, token: decryptSecret(encryptedToken) };
  } catch (error) {
    console.warn('[W-API webhook] Token do webhook invalido ou expirado:', error);
    return { present: true, token: '' };
  }
}

function getConnectedPhone(payload: any) {
  return getWapiConnectedPhone(payload);
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
    return String(value || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  });
}

// Eventos que realmente indicam mudanca de conexao
const CONNECTION_EVENTS = new Set([
  'status_change', 'connection_update', 'connection_status',
  'disconnected', 'disconnect', 'logout', 'loggedout',
  'connected', 'open', 'ready',
  'qr_code', 'qrcode',
]);

function isConnectionEvent(event: string) {
  const normalized = String(event || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return CONNECTION_EVENTS.has(normalized) || normalized.includes('status') || normalized.includes('connect');
}

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

function isReceivedWebhook(event: string, hook?: string) {
  if (hook) return hook === 'received';
  return String(event || '').trim().toLowerCase().includes('received') || String(event || '').trim().toLowerCase() === 'message';
}

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
      if (deepHasBlockedTarget(obj[key], depth + 1)) return true;
    }
  }
  return false;
}

function extractIncomingMessage(payload: any, event: string, hook?: string) {
  const eventName = String(event || '').toLowerCase();
  if (!isReceivedWebhook(event, hook)) return null;
  if (eventName.includes('connect')) return null;

  const data = payload?.data || payload?.message || payload;
  
  // ── Layer 1: Explicit boolean flags from W-API ──
  if (payload?.isGroup || payload?.isGroupMsg || data?.isGroup || data?.isGroupMsg) return null;
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

  const fromMe = Boolean(
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
  if (fromMe) return null;

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

  const phone = normalizePhone(rawPhone);
  if (phone.length < 10 || phone.length > 15) return null;

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

  return {
    phone,
    text,
    timestamp,
  };
}

function isDisconnectedEvent(payload: any, event: string) {
  // Ignora eventos de mensagem/delivery para decisoes de conexao
  if (!isConnectionEvent(event)) return false;

  const states = normalizedStateValues(payload, event);
  if (states.some((state) => state === 'not_connected' || state === 'false')) return true;

  const tokens = stateTokens(payload, event);
  return tokens.some((token) => ['disconnected', 'disconnect', 'logout', 'loggedout', 'offline'].includes(token));
}

function isConnectedEvent(payload: any, event: string) {
  if (!isConnectionEvent(event)) return false;
  if (isDisconnectedEvent(payload, event)) return false;
  const tokens = stateTokens(payload, event);
  return tokens.some((token) => ['connected', 'connect', 'open', 'online', 'ready'].includes(token));
}

function buildAutoReply(params: {
  storeProfile: any;
  empresaId: string;
  incoming: { phone: string; text?: string };
  requestOrigin: string;
  contactData?: { firstInboundAt?: string | number; lastInboundAt?: string | number; firstContactSentAt?: string | number; lastClosedReplyAt?: string | number };
  hasPriorContact?: boolean;
}) {
  const storeProfile = params.storeProfile || {};
  const messages = getWhatsAppMessages(storeProfile?.whatsappMessages);
  const storeName = storeProfile?.general?.name || storeProfile?.storeName || 'Minha loja';
  const storeLink = buildStoreLink(storeProfile, params.empresaId, process.env.NEXT_PUBLIC_APP_URL || params.requestOrigin);
  const openState = getStoreOpenState(storeProfile);

  let template = '';
  let type = '';
  const nowMs = Date.now();
  const lastClosedReplyAt = params.contactData?.lastClosedReplyAt
    ? new Date(params.contactData.lastClosedReplyAt).getTime()
    : 0;

  const lastInboundMs = params.contactData?.lastInboundAt
    ? new Date(params.contactData.lastInboundAt).getTime()
    : 0;

  if (!openState.isOpen) {
    if (lastClosedReplyAt && nowMs - lastClosedReplyAt <= 2 * 60 * 60 * 1000) {
      return null;
    }

    template = messages.storeClosed;
    type = 'store_closed_auto_reply';
  } else if (!params.contactData?.firstContactSentAt || (lastInboundMs > 0 && nowMs - lastInboundMs > 12 * 60 * 60 * 1000)) {
    template = messages.firstContact;
    type = 'first_contact_auto_reply';
  }

  const message = renderWhatsAppTemplate(template, {
    loja: storeName,
    link: storeLink,
    horarios: formatWorkingHours(storeProfile?.workingHours),
    proxima_abertura: formatNextOpeningTime(storeProfile?.workingHours, storeProfile?.plannedClosures, storeProfile?.general?.timezone),
    cliente: '',
    primeiro_nome: '',
    pedido: '',
    itens: '',
    total: '',
    pagamento: '',
    tempo_estimado: '',
  }).trim();

  if (!message || !type) return null;

  // A W-API envia texto puro e nao gera o cartao de preview de link (o WhatsApp
  // so monta o preview quando o proprio app faz o scrape das og tags, o que nao
  // ocorre via API). Por isso, nas respostas automaticas com link mandamos a
  // logo da loja como imagem e o texto/link na legenda — assim a marca sempre
  // aparece junto do link. Sem imagem salva, cai no texto puro.
  const imageUrl =
    storeProfile?.general?.logoUrl ||
    storeProfile?.general?.ogImageUrl ||
    storeProfile?.general?.bannerUrl ||
    '';

  return { message, type, imageUrl: imageUrl || undefined };
}

async function maybeSendAutoReply(params: {
  adminDb: any;
  adminRef: any;
  empresaId: string;
  payload: any;
  event: string;
  hook?: string;
  requestOrigin: string;
  now: string;
}) {
  const incoming = extractIncomingMessage(params.payload, params.event, params.hook);
  if (!incoming?.phone) return false;

  // Proteção contra sincronização de histórico: 
  // Se a mensagem for mais velha que 5 minutos, ignorar para não responder mensagens antigas.
  if (incoming.timestamp) {
    const msgTimeMs = incoming.timestamp > 9999999999 ? incoming.timestamp : incoming.timestamp * 1000;
    const nowMs = Date.now();
    if (nowMs - msgTimeMs > 5 * 60 * 1000) {
      console.log('[W-API webhook] Ignorando mensagem antiga (sincronização de histórico):', { phone: incoming.phone, ageMs: nowMs - msgTimeMs });
      return false;
    }
  }

  const adminSnap = await params.adminRef.get();
  const integration = adminSnap.data()?.whatsappIntegration;
  if (!integration?.connected || !integration?.wapiInstanceId || !integration?.wapiTokenEncrypted) return false;

  const storeSnap = await params.adminDb.collection('store_profiles').doc(params.empresaId).get();
  const storeProfile = storeSnap.exists ? storeSnap.data() : {};
  const contactRef = params.adminDb.collection('whatsapp_auto_reply_contacts').doc(`${params.empresaId}_${incoming.phone}`);
  const contactSnap = await contactRef.get();
  const contactData = contactSnap.exists ? contactSnap.data() || {} : {};
  const hasPriorContact = Boolean(
    contactData.firstInboundAt ||
    contactData.firstContactSentAt ||
    contactData.lastClosedReplyAt,
  );

  await contactRef.set({
    empresaId: params.empresaId,
    phone: incoming.phone,
    ...(!hasPriorContact ? { firstInboundAt: params.now } : {}),
    lastInboundAt: params.now,
    updatedAt: params.now,
  }, { merge: true });

  const reply = buildAutoReply({
    storeProfile,
    empresaId: params.empresaId,
    incoming,
    requestOrigin: params.requestOrigin,
    contactData,
    hasPriorContact,
  });
  if (!reply) return false;

  const token = decryptSecret(integration.wapiTokenEncrypted);
  const result = reply.imageUrl
    ? await sendWapiImageMessage(integration.wapiInstanceId, token, {
        phone: incoming.phone,
        image: reply.imageUrl,
        caption: reply.message,
        delayMessage: 2,
      })
    : await sendWapiTextMessage(integration.wapiInstanceId, token, {
        phone: incoming.phone,
        message: reply.message,
        delayMessage: 2,
      });

  await contactRef.set({
    empresaId: params.empresaId,
    phone: incoming.phone,
    ...(reply.type === 'first_contact_auto_reply' ? { firstContactSentAt: params.now } : {}),
    ...(reply.type === 'store_closed_auto_reply' ? { lastClosedReplyAt: params.now } : {}),
    updatedAt: params.now,
  }, { merge: true });

  await params.adminDb.collection('whatsapp_auto_replies').add({
    empresaId: params.empresaId,
    phone: incoming.phone,
    type: reply.type,
    message: reply.message.slice(0, 500),
    providerMessageId: result?.messageId || result?.insertedId || '',
    incomingText: incoming.text || '',
    createdAt: params.now,
  });

  return true;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Webhook nao autorizado.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const payload = await request.json().catch(() => ({}));
  const instanceId = getInstanceId(payload);
  const event = payload?.event || payload?.type || 'unknown';
  const hook = url.searchParams.get('hook') || '';
  const empresaIdFromUrl = url.searchParams.get('empresaId') || '';
  const webhookAuth = getWebhookToken(url);
  const now = new Date().toISOString();
  const adminDb = getOptionalAdminDb();

  if (!adminDb) {
    console.warn('[W-API webhook] Firebase Admin indisponivel; evento ignorado sem envio automatico:', {
      event,
      instanceId,
      empresaId: empresaIdFromUrl,
    });
    return NextResponse.json({ ok: true, persisted: false, autoReplySent: false });
  }

  let empresaId = empresaIdFromUrl;
  let adminRef = empresaId ? adminDb.collection('roles_admin').doc(empresaId) : null;

  if (instanceId) {
    const snap = await adminDb
      .collection('roles_admin')
      .where('whatsappIntegration.wapiInstanceId', '==', instanceId)
      .limit(1)
      .get();

    if (!snap.empty) {
      adminRef = snap.docs[0].ref;
      empresaId = snap.docs[0].id;
    }
  }

  if (adminRef && webhookAuth.present) {
    const adminSnap = await adminRef.get();
    const integration = adminSnap.data()?.whatsappIntegration;
    let tokenMatches = false;

    try {
      tokenMatches = Boolean(integration?.wapiTokenEncrypted && decryptSecret(integration.wapiTokenEncrypted) === webhookAuth.token);
    } catch (error) {
      console.warn('[W-API webhook] Nao foi possivel validar o token da integracao:', { event, instanceId, empresaId, error });
    }

    if (!tokenMatches) {
      console.warn('[W-API webhook] Ignorando atualizacao por token divergente:', { event, instanceId, empresaId });
      adminRef = null;
      empresaId = '';
    }
  }

  await adminDb.collection('whatsapp_webhook_events').add({
    provider: 'wapi',
    event,
    hook,
    instanceId,
    empresaId,
    payload,
    createdAt: now,
  });

  let integrationUpdated = false;
  const connected = isConnectedEvent(payload, event);
  const disconnected = isDisconnectedEvent(payload, event);

  console.log('[W-API webhook] processando:', { event, instanceId, empresaId, connected, disconnected, isConnEvt: isConnectionEvent(event) });

  if (adminRef && (connected || disconnected)) {
    const patch: Record<string, unknown> = {
      'whatsappIntegration.updatedAt': now,
      'whatsappIntegration.lastStatusAt': now,
    };

    if (connected) {
      patch['whatsappIntegration.connected'] = true;
      patch['whatsappIntegration.status'] = 'connected';
      patch['whatsappIntegration.numeroWhatsapp'] = getConnectedPhone(payload);
      patch['whatsappIntegration.qrCode'] = '';
      patch['whatsappIntegration.lastError'] = '';
    } else if (disconnected) {
      // Antes de marcar como desconectado, verifica se realmente estava conectado
      // para evitar falsos positivos de eventos transitórios
      const currentDoc = await adminRef.get();
      const currentIntegration = currentDoc.data()?.whatsappIntegration;
      if (currentIntegration?.connected) {
        console.log('[W-API webhook] Marcando como desconectado:', { event, instanceId, empresaId });
        patch['whatsappIntegration.connected'] = false;
        patch['whatsappIntegration.status'] = 'disconnected';
      } else {
        console.log('[W-API webhook] Ignorando disconnect - ja estava desconectado:', { event, instanceId, empresaId });
      }
    }

    try {
      await adminRef.update(patch);
      integrationUpdated = true;
    } catch (error) {
      console.warn('[W-API webhook] Evento persistido, mas integracao nao foi atualizada:', {
        event,
        instanceId,
        empresaId,
        error,
      });
    }
  }

  let autoReplySent = false;
  if (adminRef && empresaId) {
    try {
      autoReplySent = await maybeSendAutoReply({
        adminDb,
        adminRef,
        empresaId,
        payload,
        event,
        hook,
        requestOrigin: new URL(request.url).origin,
        now,
      });
    } catch (error) {
      console.warn('[W-API webhook] Falha ao enviar resposta automatica:', { event, empresaId, error });
    }
  }

  return NextResponse.json({ ok: true, persisted: true, empresaId, integrationUpdated, autoReplySent });
}
