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

async function getInitialWapiState(instanceId: string, token: string) {
  let qrCode = '';
  let connected = false;
  let status = statusFromWapi(false);
  let numeroWhatsapp = '';

  const [qrResult, statusResult] = await Promise.allSettled([
    getWapiQrCode(instanceId, token),
    getWapiStatus(instanceId, token),
  ]);

  if (qrResult.status === 'fulfilled') {
    qrCode = extractWapiQrCode(qrResult.value);
  } else {
    console.warn('[W-API] Falha ao buscar QR Code inicial:', qrResult.reason);
  }

  if (statusResult.status === 'fulfilled') {
    connected = isWapiConnectedStatus(statusResult.value);
    status = statusFromWapi(connected);
    numeroWhatsapp = getWapiConnectedPhone(statusResult.value);
  } else {
    console.warn('[W-API] Falha ao buscar status inicial:', statusResult.reason);
  }

  return { qrCode, connected, status, numeroWhatsapp };
}

export async function POST(request: Request) {
  return withAuth(request, async (user) => {
    try {
      const body = await request.json().catch(() => ({}));
      const empresaId = requireEmpresa(user, body.empresaId);

      const existing = await getWhatsAppIntegration(empresaId, user.idToken);
      const hasBlockedSharedInstance = isBlockedSharedWapiInstance(existing?.wapiInstanceId);
      const hasUsableExistingInstance = Boolean(existing?.wapiInstanceId && existing?.wapiTokenEncrypted);

      if (existing && hasUsableExistingInstance && !body.force && !hasBlockedSharedInstance) {
        return ok({
          integration: sanitizeIntegration(existing),
          alreadyConfigured: true,
        });
      }

      if (existing?.wapiInstanceId && !existing?.wapiTokenEncrypted) {
        console.warn('[W-API] Substituindo registro sem token por uma nova instancia.', {
          empresaId,
          oldInstanceId: existing.wapiInstanceId,
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

      if (!getWapiMainToken()) {
        return ok({
          error: 'WAPI_API_KEY nao configurada no servidor. Para usar uma instancia ja paga, clique em "Usar instancia ja paga" e informe o ID/token da loja.',
        }, 500);
      }

      const created = await createWapiInstance({ instanceName });
      if (!created.instanceId || !created.token) {
        throw new ApiError(502, 'A W-API nao retornou instanceId/token para a nova instancia.', created);
      }

      const webhookUrl = getWebhookUrl(request, empresaId, created.token);
      await configureWapiWebhooks(created.instanceId, created.token, webhookUrl);

      const { qrCode, connected, status, numeroWhatsapp } = await getInitialWapiState(created.instanceId, created.token);

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
