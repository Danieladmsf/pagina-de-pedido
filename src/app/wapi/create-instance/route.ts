import { jsonError } from '@/lib/firebase-auth-rest';
import { getWebhookUrl, ok, requireEmpresa, withAuth } from '@/app/wapi/_lib';
import { configureWapiWebhooks, createWapiInstance, getWapiMainToken, getWapiQrCode, getWapiStatus } from '@/lib/wapi/wapi.service';
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

      if (!getWapiMainToken()) {
        return ok({ error: 'WAPI_API_KEY nao configurada no servidor.' }, 500);
      }

      const existing = await getWhatsAppIntegration(empresaId, user.idToken);
      if (existing?.wapiInstanceId && !body.force) {
        return ok({
          integration: sanitizeIntegration(existing),
          alreadyConfigured: true,
        });
      }

      const now = new Date().toISOString();
      const webhookUrl = getWebhookUrl(request);
      const instanceName = String(body.instanceName || body.storeName || `Loja ${empresaId}`).slice(0, 80);
      
      // TEMPORÁRIO PARA TESTES: Usando a sua instância Trial Gratuita já existente
      // Como a sua conta na W-API não tem pagamento ativo, criar novas instâncias não funciona (ficam com status PENDING).
      // Quando você assinar um plano na W-API, basta voltar o código original aqui:
      // const created = await createWapiInstance({ instanceName, webhookUrl });
      const created = {
        instanceId: 'LITE-JMDANG-I3824S',
        token: 'OrO1JglDjZBmsgQk2C8fnYQ4soclm228O',
      };

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
        qrCode = qr.qrcode || '';
        connected = Boolean(liveStatus.connected);
        status = statusFromWapi(connected);
        numeroWhatsapp = liveStatus.connectedPhone || '';
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
        createdAt: now,
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
