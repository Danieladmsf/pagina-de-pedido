import { jsonError } from '@/lib/firebase-auth-rest';
import { getWebhookUrl, ok, requireEmpresa, requireIntegration, withAuth } from '@/app/wapi/_lib';
import { configureWapiWebhooks, getWapiConnectedPhone, getWapiStatus, hasExplicitWapiConnectionState, isWapiConnectedStatus } from '@/lib/wapi/wapi.service';
import { patchWhatsAppIntegration, sanitizeIntegration, statusFromWapi } from '@/lib/wapi/integration-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ empresaId: string }> }) {
  return withAuth(request, async (user) => {
    try {
      const { empresaId: rawEmpresaId } = await params;
      const empresaId = requireEmpresa(user, rawEmpresaId);
      const { integration, token } = await requireIntegration(empresaId, user.idToken);
      const webhookUrl = getWebhookUrl(request, empresaId, token, integration.webhookUrl);
      let webhookConfigured = false;

      let rawStatus: any = null;
      let connected = integration.connected;
      let connectedPhone = integration.numeroWhatsapp || '';

      try {
        rawStatus = await getWapiStatus(integration.wapiInstanceId, token);
        const livePhone = getWapiConnectedPhone(rawStatus);

        // Só rebaixa para "desconectado" quando a W-API AFIRMA isso. Se a
        // resposta vier num formato que não reconhecemos, mantemos o que já
        // sabíamos (os webhooks de mensagem provam a conexão o tempo todo) —
        // antes, um formato inesperado zerava o estado a cada 15s e jogava a
        // tela no laço de QR Code, que é o que derrubava o WhatsApp.
        if (isWapiConnectedStatus(rawStatus) || livePhone) connected = true;
        else if (hasExplicitWapiConnectionState(rawStatus)) connected = false;
        else connected = integration.connected;

        connectedPhone = livePhone || integration.numeroWhatsapp || '';
      } catch (wapiError: any) {
        // Se a W-API nao respondeu, mantemos o status salvo em vez de marcar como desconectado
        console.warn('[W-API status] Falha ao consultar status ao vivo, mantendo estado salvo:', wapiError?.message);
        const updated = await patchWhatsAppIntegration(empresaId, {
          lastError: `Falha ao consultar W-API: ${wapiError?.message || 'timeout'}`,
          lastStatusAt: new Date().toISOString(),
        }, user.idToken);
        return ok({ integration: sanitizeIntegration(updated), raw: null, wapiError: wapiError?.message });
      }

      // Reconfigurar os 5 webhooks a CADA consulta de status significava ~24
      // chamadas por minuto na W-API para cada aba aberta, sem nenhum motivo: a
      // URL so muda quando o dominio ou o token mudam. So refaz quando mudou.
      if (integration.webhookUrl === webhookUrl) {
        webhookConfigured = true;
      } else {
        try {
          const webhookResult = await configureWapiWebhooks(integration.wapiInstanceId, token, webhookUrl);
          webhookConfigured = !webhookResult.failed.some((item) => item.endpoint === 'update-webhook-received');
        } catch (webhookError: any) {
          console.warn('[W-API status] Falha ao reconfigurar webhooks:', webhookError?.message || webhookError);
        }
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
