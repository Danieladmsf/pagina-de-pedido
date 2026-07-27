import { NextResponse } from 'next/server';
import { getOptionalAdminDb } from '@/lib/firebase-admin';
import { decryptSecret } from '@/lib/wapi/crypto';
import { getWapiConnectedPhone, sendWapiTextMessage, sendWapiImageMessage, setWapiAutoRead } from '@/lib/wapi/wapi.service';
import {
  getLiveConnectedPhone,
  isConnectedEvent,
  isDisconnectedEvent,
} from '@/lib/wapi/connection-events';
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
  // So numero BR plausivel: 55 + DDD + 8-9 digitos = 12-13. LIDs numericos
  // (13-15 digitos) passam de 15 com o prefixo 55 e ficam de fora.
  if (phone.length < 12 || phone.length > 13) return null;

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

  // Claim atomico ANTES do envio (mesmo padrao do whatsapp_send_claims):
  // decidir e gravar o carimbo na mesma transacao faz webhooks concorrentes
  // (rajada de mensagens, retries da W-API) relerem o doc ja carimbado e
  // desistirem. Se o envio falhar, o claim e devolvido no catch abaixo.
  const CLAIM_FIELD: Record<string, string> = {
    first_contact_auto_reply: 'firstContactSentAt',
    store_closed_auto_reply: 'lastClosedReplyAt',
  };

  const claimed = await params.adminDb.runTransaction(async (txn: any) => {
    const contactSnap = await txn.get(contactRef);
    const contactData = contactSnap.exists ? contactSnap.data() || {} : {};
    const hasPriorContact = Boolean(
      contactData.firstInboundAt ||
      contactData.firstContactSentAt ||
      contactData.lastClosedReplyAt,
    );

    const reply = buildAutoReply({
      storeProfile,
      empresaId: params.empresaId,
      incoming,
      requestOrigin: params.requestOrigin,
      contactData,
      hasPriorContact,
    });

    const claimField = reply ? CLAIM_FIELD[reply.type] || '' : '';
    txn.set(contactRef, {
      empresaId: params.empresaId,
      phone: incoming.phone,
      ...(!hasPriorContact ? { firstInboundAt: params.now } : {}),
      lastInboundAt: params.now,
      updatedAt: params.now,
      ...(claimField ? { [claimField]: params.now } : {}),
    }, { merge: true });

    if (!reply || !claimField) return null;
    return { reply, claimField, previousClaim: contactData[claimField] ?? null };
  });

  if (!claimed) return false;
  const { reply, claimField, previousClaim } = claimed;

  const token = decryptSecret(integration.wapiTokenEncrypted);
  let result: any;
  try {
    result = reply.imageUrl
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
  } catch (error) {
    await contactRef.set({ [claimField]: previousClaim, updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
    throw error;
  }

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

  let empresaId = '';
  let adminRef: FirebaseFirestore.DocumentReference | null = null;
  let integration: any = null;

  // A loja indicada na URL do webhook tem prioridade, desde que ela realmente
  // use esta instancia. A busca por instanceId com `.limit(1)` escolhia sempre a
  // primeira loja na ordem do indice: com duas lojas apontando para a mesma
  // instancia (ja aconteceu em producao), a segunda ficava permanentemente muda.
  if (empresaIdFromUrl) {
    const ref = adminDb.collection('roles_admin').doc(empresaIdFromUrl);
    const data = (await ref.get()).data()?.whatsappIntegration;
    if (data && (!instanceId || data.wapiInstanceId === instanceId)) {
      adminRef = ref;
      empresaId = empresaIdFromUrl;
      integration = data;
    }
  }

  if (!adminRef && instanceId) {
    const snap = await adminDb
      .collection('roles_admin')
      .where('whatsappIntegration.wapiInstanceId', '==', instanceId)
      .limit(2)
      .get();

    if (snap.size > 1) {
      console.warn('[W-API webhook] Instancia usada por mais de uma loja; evento atribuido a primeira:', {
        instanceId,
        lojas: snap.docs.map((doc) => doc.id),
      });
    }
    if (!snap.empty) {
      adminRef = snap.docs[0].ref;
      empresaId = snap.docs[0].id;
      integration = snap.docs[0].data()?.whatsappIntegration;
    }
  }

  if (adminRef && webhookAuth.present) {
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
      integration = null;
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
    // Basta ligar a politica de TTL neste campo (console do Firestore) para a
    // colecao parar de crescer sozinha: sao alguns milhares de documentos por
    // dia, com o payload inteiro de cada mensagem.
    expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  let integrationUpdated = false;
  const connected = isConnectedEvent(payload, event, hook);
  const disconnected = isDisconnectedEvent(payload, event, hook);
  const livePhone = disconnected ? '' : getLiveConnectedPhone(payload);

  console.log('[W-API webhook] processando:', { event, hook, instanceId, empresaId, connected, disconnected, livePhone: Boolean(livePhone) });

  if (adminRef && integration && (connected || disconnected || livePhone)) {
    const patch: Record<string, unknown> = {};

    if (disconnected) {
      // So marca desconectado quem estava conectado, para nao reagir a eventos
      // transitorios repetidos.
      if (integration.connected) {
        console.log('[W-API webhook] Marcando como desconectado:', { event, instanceId, empresaId });
        patch['whatsappIntegration.connected'] = false;
        patch['whatsappIntegration.status'] = 'disconnected';
      }
    } else if (connected || livePhone) {
      const phone = livePhone || getConnectedPhone(payload) || integration.numeroWhatsapp || '';
      // `livePhone` chega junto de TODA mensagem, entao so gravamos quando algo
      // realmente mudou — senao seria uma escrita no Firestore por mensagem
      // recebida (milhares por dia).
      if (!integration.connected || (phone && integration.numeroWhatsapp !== phone)) {
        patch['whatsappIntegration.connected'] = true;
        patch['whatsappIntegration.status'] = 'connected';
        patch['whatsappIntegration.numeroWhatsapp'] = phone;
        patch['whatsappIntegration.qrCode'] = '';
        patch['whatsappIntegration.lastError'] = '';
      }
    }

    if (Object.keys(patch).length > 0) {
      patch['whatsappIntegration.updatedAt'] = now;
      patch['whatsappIntegration.lastStatusAt'] = now;

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
  }

  // A cada conexao, reforca o desligamento da "Leitura automatica" do W-API.
  // Sem isso a instancia marca status/stories como lidos e a conta passa a
  // "visualizar" o status de todos os contatos sozinha. O `wt` do webhook ja
  // carrega o token da instancia, entao corrige lojas existentes no proximo
  // reconnect sem acao manual. Best-effort: nao afeta o restante do webhook.
  if (connected && instanceId && webhookAuth.token) {
    setWapiAutoRead(instanceId, webhookAuth.token, false).catch((error) => {
      console.warn('[W-API webhook] Falha ao desligar leitura automatica no connect:', { instanceId, empresaId, error });
    });
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
