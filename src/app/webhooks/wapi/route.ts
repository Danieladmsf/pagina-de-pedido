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

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Webhook nao autorizado.' }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({}));
  const instanceId = payload?.instanceId || payload?.instance_id || '';
  const event = payload?.event || 'unknown';
  const now = new Date().toISOString();
  const adminDb = getOptionalAdminDb();

  if (!adminDb) {
    console.log('[W-API webhook] recebido sem Firebase Admin configurado:', { event, instanceId });
    return NextResponse.json({ ok: true, persisted: false });
  }

  await adminDb.collection('whatsapp_webhook_events').add({
    provider: 'wapi',
    event,
    instanceId,
    payload,
    createdAt: now,
  });

  if (instanceId) {
    const snap = await adminDb
      .collection('whatsapp_integrations')
      .where('wapiInstanceId', '==', instanceId)
      .limit(1)
      .get();

    if (!snap.empty) {
      const ref = snap.docs[0].ref;
      const patch: Record<string, unknown> = {
        updatedAt: now,
        lastStatusAt: now,
      };

      if (/connected/i.test(event)) {
        patch.connected = true;
        patch.status = 'connected';
        patch.numeroWhatsapp = payload?.connectedPhone || payload?.phone || '';
        patch.qrCode = '';
      }

      if (/disconnected/i.test(event)) {
        patch.connected = false;
        patch.status = 'disconnected';
      }

      await ref.set(patch, { merge: true });
    }
  }

  return NextResponse.json({ ok: true, persisted: true });
}
