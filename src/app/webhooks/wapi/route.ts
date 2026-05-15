import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getOptionalAdminDb } from '@/lib/firebase-admin';
import { getFirestoreDocument, setFirestoreDocument } from '@/lib/firestore-rest';
import { decryptSecret } from '@/lib/wapi/crypto';
import { sendWapiTextMessage } from '@/lib/wapi/wapi.service';
import {
  buildStoreLink,
  formatWorkingHours,
  getStoreOpenState,
  getWhatsAppMessages,
  renderWhatsAppTemplate,
} from '@/lib/whatsapp-messages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fallbackAutoReplyContacts = new Map<string, { firstContactSentAt?: number; lastClosedReplyAt?: number }>();

function fallbackContactPath(empresaId: string, phone: string) {
  const hash = crypto.createHash('sha256').update(`${empresaId}:${phone}`).digest('hex').slice(0, 40);
  return `active_sessions/wapi_auto_reply_${hash}`;
}

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
  return payload?.connectedPhone || payload?.phone || payload?.number || payload?.instance?.connectedPhone || '';
}

function stateValues(payload: any, event: string) {
  return [
    event,
    payload?.status,
    payload?.state,
    payload?.connectionStatus,
    payload?.connected,
    payload?.isConnected,
    payload?.instance?.status,
    payload?.instance?.connected,
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

function extractIncomingMessage(payload: any, event: string) {
  const eventName = String(event || '').toLowerCase();
  if (eventName.includes('connect') || eventName.includes('status') || eventName.includes('delivery')) return null;

  const data = payload?.data || payload?.message || payload;
  const fromMe = Boolean(
    payload?.fromMe ||
    payload?.key?.fromMe ||
    payload?.message?.key?.fromMe ||
    data?.fromMe ||
    data?.key?.fromMe ||
    data?.message?.fromMe ||
    data?.message?.key?.fromMe,
  );
  if (fromMe) return null;

  const rawPhone = firstString(
    payload?.phone,
    payload?.from,
    payload?.sender,
    payload?.remoteJid,
    payload?.chatId,
    payload?.jid,
    payload?.key?.remoteJid,
    payload?.message?.key?.remoteJid,
    data?.phone,
    data?.from,
    data?.from?.id,
    data?.sender,
    data?.sender?.id,
    data?.contact?.id,
    data?.remoteJid,
    data?.chatId,
    data?.jid,
    data?.key?.remoteJid,
  );

  if (!rawPhone || rawPhone.includes('@g.us')) return null;

  const text = firstString(
    payload?.body,
    payload?.text,
    payload?.text?.message,
    payload?.message?.text,
    payload?.message?.conversation,
    payload?.message?.extendedTextMessage?.text,
    data?.body,
    data?.text,
    data?.text?.message,
    data?.message?.conversation,
    data?.message?.extendedTextMessage?.text,
  );

  const looksLikeMessageEvent = eventName.includes('received') || eventName.includes('message');
  const hasMessageShape = Boolean(text || payload?.body || payload?.text || payload?.message || data?.body || data?.text || data?.message);
  if (!looksLikeMessageEvent && !hasMessageShape) return null;

  return {
    phone: normalizePhone(rawPhone),
    text,
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
  contactData?: { firstContactSentAt?: string | number; lastClosedReplyAt?: string | number };
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

  if (!openState.isOpen) {
    if (lastClosedReplyAt && nowMs - lastClosedReplyAt <= 2 * 60 * 60 * 1000) {
      return null;
    }

    template = messages.storeClosed;
    type = 'store_closed_auto_reply';
  } else if (!params.contactData?.firstContactSentAt) {
    template = messages.firstContact;
    type = 'first_contact_auto_reply';
  }

  const message = renderWhatsAppTemplate(template, {
    loja: storeName,
    link: storeLink,
    horarios: formatWorkingHours(storeProfile?.workingHours),
    cliente: '',
    primeiro_nome: '',
    pedido: '',
    itens: '',
    total: '',
    pagamento: '',
    tempo_estimado: '',
  }).trim();

  if (!message || !type) return null;
  return { message, type };
}

async function maybeSendAutoReply(params: {
  adminDb: any;
  adminRef: any;
  empresaId: string;
  payload: any;
  event: string;
  requestOrigin: string;
  now: string;
}) {
  const incoming = extractIncomingMessage(params.payload, params.event);
  if (!incoming?.phone) return false;

  const adminSnap = await params.adminRef.get();
  const integration = adminSnap.data()?.whatsappIntegration;
  if (!integration?.connected || !integration?.wapiInstanceId || !integration?.wapiTokenEncrypted) return false;

  const storeSnap = await params.adminDb.collection('store_profiles').doc(params.empresaId).get();
  const storeProfile = storeSnap.exists ? storeSnap.data() : {};
  const contactRef = params.adminDb.collection('whatsapp_auto_reply_contacts').doc(`${params.empresaId}_${incoming.phone}`);
  const contactSnap = await contactRef.get();
  const contactData = contactSnap.exists ? contactSnap.data() || {} : {};
  const reply = buildAutoReply({
    storeProfile,
    empresaId: params.empresaId,
    incoming,
    requestOrigin: params.requestOrigin,
    contactData,
  });
  if (!reply) return false;

  const token = decryptSecret(integration.wapiTokenEncrypted);
  const result = await sendWapiTextMessage(integration.wapiInstanceId, token, {
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

async function maybeSendFallbackAutoReply(params: {
  empresaId: string;
  instanceId: string;
  instanceToken: string;
  payload: any;
  event: string;
  requestOrigin: string;
}) {
  const incoming = extractIncomingMessage(params.payload, params.event);
  if (!incoming?.phone) {
    console.log('[W-API webhook] Sem Firebase Admin: evento nao parece mensagem recebida.', {
      event: params.event,
      instanceId: params.instanceId,
      empresaId: params.empresaId,
    });
    return false;
  }

  const contactKey = `${params.empresaId}_${incoming.phone}`;
  const contactPath = fallbackContactPath(params.empresaId, incoming.phone);
  const memoryContactData = fallbackAutoReplyContacts.get(contactKey) || {};
  const persistedContactData = await getFirestoreDocument<Record<string, any>>(contactPath).catch(() => null);
  const contactData = persistedContactData || memoryContactData;
  const storeProfile = await getFirestoreDocument<Record<string, any>>(`store_profiles/${params.empresaId}`).catch((error) => {
    console.warn('[W-API webhook] Sem Firebase Admin: nao foi possivel ler perfil publico da loja:', {
      event: params.event,
      instanceId: params.instanceId,
      empresaId: params.empresaId,
      error,
    });
    return null;
  });

  const reply = buildAutoReply({
    storeProfile,
    empresaId: params.empresaId,
    incoming,
    requestOrigin: params.requestOrigin,
    contactData,
  });
  if (!reply) return false;

  const result = await sendWapiTextMessage(params.instanceId, params.instanceToken, {
    phone: incoming.phone,
    message: reply.message,
    delayMessage: 2,
  });

  fallbackAutoReplyContacts.set(contactKey, {
    ...contactData,
    ...(reply.type === 'first_contact_auto_reply' ? { firstContactSentAt: Date.now() } : {}),
    ...(reply.type === 'store_closed_auto_reply' ? { lastClosedReplyAt: Date.now() } : {}),
  });

  await setFirestoreDocument(contactPath, {
    ...contactData,
    empresaId: params.empresaId,
    phone: incoming.phone,
    ...(reply.type === 'first_contact_auto_reply' ? { firstContactSentAt: new Date().toISOString() } : {}),
    ...(reply.type === 'store_closed_auto_reply' ? { lastClosedReplyAt: new Date().toISOString() } : {}),
    updatedAt: new Date().toISOString(),
  }).catch((error) => {
    console.warn('[W-API webhook] Sem Firebase Admin: resposta enviada, mas marcador persistente falhou:', {
      event: params.event,
      instanceId: params.instanceId,
      empresaId: params.empresaId,
      error,
    });
  });

  console.log('[W-API webhook] Resposta automatica enviada sem Firebase Admin:', {
    event: params.event,
    instanceId: params.instanceId,
    empresaId: params.empresaId,
    type: reply.type,
    providerMessageId: result?.messageId || result?.insertedId || '',
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
  const empresaIdFromUrl = url.searchParams.get('empresaId') || '';
  const webhookAuth = getWebhookToken(url);
  const now = new Date().toISOString();
  const adminDb = getOptionalAdminDb();

  if (!adminDb) {
    let autoReplySent = false;

    if (empresaIdFromUrl && instanceId && webhookAuth.token) {
      try {
        autoReplySent = await maybeSendFallbackAutoReply({
          empresaId: empresaIdFromUrl,
          instanceId,
          instanceToken: webhookAuth.token,
          payload,
          event,
          requestOrigin: url.origin,
        });
      } catch (error) {
        console.warn('[W-API webhook] Sem Firebase Admin: falha ao enviar resposta automatica:', {
          event,
          instanceId,
          empresaId: empresaIdFromUrl,
          error,
        });
      }
    } else {
      console.log('[W-API webhook] recebido sem Firebase Admin e sem dados suficientes para resposta:', {
        event,
        instanceId,
        empresaId: empresaIdFromUrl,
        hasWebhookToken: Boolean(webhookAuth.token),
      });
    }

    return NextResponse.json({ ok: true, persisted: false, autoReplySent });
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
        requestOrigin: new URL(request.url).origin,
        now,
      });
    } catch (error) {
      console.warn('[W-API webhook] Falha ao enviar resposta automatica:', { event, empresaId, error });
    }
  }

  return NextResponse.json({ ok: true, persisted: true, empresaId, integrationUpdated, autoReplySent });
}
