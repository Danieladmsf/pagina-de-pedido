import { ApiError, jsonError } from '@/lib/firebase-auth-rest';
import { getWebhookUrl, ok, requireEmpresa, withAuth } from '@/app/wapi/_lib';
import {
  configureWapiWebhooks,
  createWapiInstance,
  extractWapiQrCode,
  getWapiConnectedPhone,
  getWapiMainToken,
  getWapiQrCode,
  getWapiStatus,
  isWapiConnectedStatus,
} from '@/lib/wapi/wapi.service';
import {
  encryptWapiToken,
  getWhatsAppIntegration,
  isBlockedSharedWapiInstance,
  sanitizeIntegration,
  saveWhatsAppIntegration,
  statusFromWapi,
} from '@/lib/wapi/integration-store';
import { WhatsAppIntegration } from '@/lib/wapi/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildInstanceName(inputName: unknown, empresaId: string) {
  const baseName = String(inputName || `Loja ${empresaId}`)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${baseName || 'Loja'} - ${empresaId.slice(0, 10)}`.slice(0, 80);
}

export async function POST(request: Request) {
  return withAuth(request, async (user) => {
    try {
      const body = await request.json().catch(() => ({}));
      const empresaId = requireEmpresa(user, body.empresaId);

      if (!getWapiMainToken()) {
        return ok({ error: 'WAPI_API_KEY nao configurada no servidor.' }, 500);
      }

      const existing = await getWhatsAppIntegration(empresaId, user.idToken);
      const hasBlockedSharedInstance = isBlockedSharedWapiInstance(existing?.wapiInstanceId);

      if (existing?.wapiInstanceId && !body.force && !hasBlockedSharedInstance) {
        return ok({
          integration: sanitizeIntegration(existing),
          alreadyConfigured: true,
        });
      }

      if (hasBlockedSharedInstance) {
        console.warn('[W-API] Substituindo instancia compartilhada antiga por uma instancia exclusiva.', {
          empresaId,
          oldInstanceId: existing?.wapiInstanceId,
        });
      }

      const now = new Date().toISOString();
      const instanceName = buildInstanceName(body.instanceName || body.storeName, empresaId);
      const created = await createWapiInstance({ instanceName });
      if (!created.instanceId || !created.token) {
        throw new ApiError(502, 'A W-API nao retornou instanceId/token para a nova instancia.', created);
      }

      const webhookUrl = getWebhookUrl(request, empresaId, created.token);
      await configureWapiWebhooks(created.instanceId, created.token, webhookUrl);

      let qrCode = '';
      let connected = false;
      let status = statusFromWapi(false);
      let numeroWhatsapp = '';

      try {
        const [qr, liveStatus] = await Promise.all([
          getWapiQrCode(created.instanceId, created.token),
          getWapiStatus(created.instanceId, created.token),
        ]);
        qrCode = extractWapiQrCode(qr);
        connected = isWapiConnectedStatus(liveStatus);
        status = statusFromWapi(connected);
        numeroWhatsapp = getWapiConnectedPhone(liveStatus);
      } catch (error) {
        console.warn('[W-API] Instancia criada, mas QR/status inicial falhou:', error);
      }

      const integration: WhatsAppIntegration = {
        ownerId: user.uid,
        clienteId: user.uid,
        empresaId,
        provider: 'wapi',
        wapiInstanceId: created.instanceId,
        wapiTokenEncrypted: encryptWapiToken(created.token),
        instanceName,
        status,
        connected,
        numeroWhatsapp,
        qrCode,
        webhookUrl,
        lastStatusAt: now,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };

      await saveWhatsAppIntegration(empresaId, integration, user.idToken);

      return ok({
        integration: sanitizeIntegration(integration),
        qrCode,
        replacedSharedInstance: hasBlockedSharedInstance,
      }, 201);
    } catch (error) {
      return jsonError(error);
    }
  });
}
