import { jsonError } from '@/lib/firebase-auth-rest';
import { getWebhookUrl, ok, requireEmpresa, requireIntegration, withAuth } from '@/app/wapi/_lib';
import { configureWapiWebhooks } from '@/lib/wapi/wapi.service';
import { patchWhatsAppIntegration, sanitizeIntegration } from '@/lib/wapi/integration-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return withAuth(request, async (user) => {
    try {
      const body = await request.json().catch(() => ({}));
      const empresaId = requireEmpresa(user, body.empresaId);
      const { integration, token } = await requireIntegration(empresaId, user.idToken);
      const webhookUrl = getWebhookUrl(request, empresaId);

      await configureWapiWebhooks(integration.wapiInstanceId, token, webhookUrl);

      const updated = await patchWhatsAppIntegration(empresaId, {
        webhookUrl,
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
