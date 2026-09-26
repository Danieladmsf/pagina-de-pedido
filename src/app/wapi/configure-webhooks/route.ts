import { ApiError, jsonError } from '@/lib/firebase-auth-rest';
import { getWebhookUrl, ok, requireEmpresa, requireIntegration, withAuth } from '@/app/wapi/_lib';
import { configurarWebhook } from '@/lib/wuzapi/wuzapi.service';
import { patchWhatsAppIntegration, sanitizeIntegration } from '@/lib/wapi/integration-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Registra de novo o webhook da loja no servidor. O PDV chama ao abrir. */
export async function POST(request: Request) {
  return withAuth(request, async (user) => {
    try {
      const body = await request.json().catch(() => ({}));
      const empresaId = requireEmpresa(user, body.empresaId);
      const { integration, token } = await requireIntegration(empresaId, user.idToken);
      const webhookUrl = getWebhookUrl(request, empresaId, token, integration.webhookUrl);

      try {
        await configurarWebhook(token, webhookUrl);
      } catch (error: any) {
        throw new ApiError(502, `O servidor de WhatsApp nao aceitou o webhook: ${error?.message || 'sem resposta'}`);
      }

      const updated = await patchWhatsAppIntegration(empresaId, {
        webhookUrl,
        lastError: '',
        updatedAt: new Date().toISOString(),
      }, user.idToken);

      return ok({
        integration: sanitizeIntegration(updated),
        webhookUrl,
      });
    } catch (error) {
      return jsonError(error);
    }
  });
}
