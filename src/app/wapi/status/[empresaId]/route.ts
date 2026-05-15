import { jsonError } from '@/lib/firebase-auth-rest';
import { getWebhookUrl, ok, requireEmpresa, requireIntegration, withAuth } from '@/app/wapi/_lib';
import { configureWapiWebhooks, getWapiConnectedPhone, getWapiStatus, isWapiConnectedStatus } from '@/lib/wapi/wapi.service';
import { patchWhatsAppIntegration, sanitizeIntegration, statusFromWapi } from '@/lib/wapi/integration-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ empresaId: string }> }) {
  return withAuth(request, async (user) => {
    try {
      const { empresaId: rawEmpresaId } = await params;
      const empresaId = requireEmpresa(user, rawEmpresaId);
      const { integration, token } = await requireIntegration(empresaId, user.idToken);
      const webhookUrl = getWebhookUrl(request, empresaId);
      let webhookConfigured = false;

      let rawStatus: any = null;
      let connected = integration.connected;
      let connectedPhone = integration.numeroWhatsapp || '';

      try {
        rawStatus = await getWapiStatus(integration.wapiInstanceId, token);
        connected = isWapiConnectedStatus(rawStatus);
        connectedPhone = getWapiConnectedPhone(rawStatus) || integration.numeroWhatsapp || '';
      } catch (wapiError: any) {
        // Se a W-API nao respondeu, mantemos o status salvo em vez de marcar como desconectado
        console.warn('[W-API status] Falha ao consultar status ao vivo, mantendo estado salvo:', wapiError?.message);
        const updated = await patchWhatsAppIntegration(empresaId, {
          lastError: `Falha ao consultar W-API: ${wapiError?.message || 'timeout'}`,
          lastStatusAt: new Date().toISOString(),
        }, user.idToken);
        return ok({ integration: sanitizeIntegration(updated), raw: null, wapiError: wapiError?.message });
      }

      try {
        const webhookResult = await configureWapiWebhooks(integration.wapiInstanceId, token, webhookUrl);
        webhookConfigured = !webhookResult.failed.some((item) => item.endpoint === 'update-webhook-received');
      } catch (webhookError: any) {
        console.warn('[W-API status] Falha ao reconfigurar webhooks:', webhookError?.message || webhookError);
      }

      const updated = await patchWhatsAppIntegration(empresaId, {
        connected,
        status: statusFromWapi(connected),
        numeroWhatsapp: connectedPhone,
        webhookUrl,
        lastError: '',
        lastStatusAt: new Date().toISOString(),
      }, user.idToken);

      return ok({ integration: sanitizeIntegration(updated), raw: rawStatus, webhookConfigured });
    } catch (error) {
      return jsonError(error);
    }
  });
}
