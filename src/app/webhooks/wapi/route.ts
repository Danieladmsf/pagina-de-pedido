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

function isDisconnectedEvent(payload: any, event: string) {
  const states = normalizedStateValues(payload, event);
  if (states.some((state) => state === 'not_connected' || state === 'false')) return true;

  const tokens = stateTokens(payload, event);
  return tokens.some((token) => ['disconnected', 'disconnect', 'closed', 'close', 'logout', 'offline'].includes(token));
}

function isConnectedEvent(payload: any, event: string) {
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

  if (adminRef) {
    const patch: Record<string, unknown> = {
      'whatsappIntegration.updatedAt': now,
      'whatsappIntegration.lastStatusAt': now,
    };

    if (isConnectedEvent(payload, event)) {
      patch['whatsappIntegration.connected'] = true;
      patch['whatsappIntegration.status'] = 'connected';
      patch['whatsappIntegration.numeroWhatsapp'] = getConnectedPhone(payload);
      patch['whatsappIntegration.qrCode'] = '';
      patch['whatsappIntegration.lastError'] = '';
    }

    if (isDisconnectedEvent(payload, event)) {
      patch['whatsappIntegration.connected'] = false;
      patch['whatsappIntegration.status'] = 'disconnected';
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
