import { NextResponse } from 'next/server';
import { getOptionalAdminDb } from '@/lib/firebase-admin';

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

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Webhook nao autorizado.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const payload = await request.json().catch(() => ({}));
  const instanceId = getInstanceId(payload);
  const event = payload?.event || payload?.type || 'unknown';
  const empresaIdFromUrl = url.searchParams.get('empresaId') || '';
  const now = new Date().toISOString();
  const adminDb = getOptionalAdminDb();

  if (!adminDb) {
    console.log('[W-API webhook] recebido sem Firebase Admin configurado:', { event, instanceId, empresaId: empresaIdFromUrl });
    return NextResponse.json({ ok: true, persisted: false });
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

  return NextResponse.json({ ok: true, persisted: true, empresaId, integrationUpdated });
}
