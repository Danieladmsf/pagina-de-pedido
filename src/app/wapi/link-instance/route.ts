import { ApiError, jsonError } from '@/lib/firebase-auth-rest';
import { getWebhookUrl, ok, requireEmpresa, withAuth } from '@/app/wapi/_lib';
import {
  configureWapiWebhooks,
  extractWapiQrCode,
  getWapiConnectedPhone,
  getWapiQrCode,
  getWapiStatus,
  isWapiConnectedStatus,
} from '@/lib/wapi/wapi.service';
import {
  encryptWapiToken,
  getWhatsAppIntegration,
  sanitizeIntegration,
  saveWhatsAppIntegration,
  statusFromWapi,
} from '@/lib/wapi/integration-store';
import { WhatsAppIntegration } from '@/lib/wapi/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return withAuth(request, async (user) => {
    try {
      const body = await request.json().catch(() => ({}));
      const empresaId = requireEmpresa(user, body.empresaId);
      
      const { wapiInstanceId, token, instanceName } = body;
      
      if (!wapiInstanceId || !token) {
        throw new ApiError(400, 'ID e Token da instancia sao obrigatorios.');
      }

      const existing = await getWhatsAppIntegration(empresaId, user.idToken);
      const now = new Date().toISOString();
      const webhookUrl = getWebhookUrl(request, empresaId, token);

      // Tenta configurar os webhooks para validar o token e vincular a loja
      await configureWapiWebhooks(wapiInstanceId, token, webhookUrl);

      let qrCode = '';
      let connected = false;
      let status = statusFromWapi(false);
      let numeroWhatsapp = '';

      const [qrResult, statusResult] = await Promise.allSettled([
        getWapiQrCode(wapiInstanceId, token),
        getWapiStatus(wapiInstanceId, token),
      ]);

      if (qrResult.status === 'fulfilled') {
        qrCode = extractWapiQrCode(qrResult.value);
      } else {
        console.warn('[W-API] Link manual: QR inicial falhou:', qrResult.reason);
      }

      if (statusResult.status === 'fulfilled') {
        connected = isWapiConnectedStatus(statusResult.value);
        status = statusFromWapi(connected);
        numeroWhatsapp = getWapiConnectedPhone(statusResult.value);
      } else {
        console.warn('[W-API] Link manual: status inicial falhou:', statusResult.reason);
      }

      const finalInstanceName = instanceName || `Loja vinculada - ${empresaId.slice(0, 10)}`;

      const integration: WhatsAppIntegration = {
        ownerId: user.uid,
        clienteId: user.uid,
        empresaId,
        provider: 'wapi',
        wapiInstanceId,
        wapiTokenEncrypted: encryptWapiToken(token),
        instanceName: finalInstanceName,
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
      }, 201);
    } catch (error) {
      return jsonError(error);
    }
  });
}
