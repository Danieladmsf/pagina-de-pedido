import { jsonError } from '@/lib/firebase-auth-rest';
import { ok, requireEmpresa, requireIntegration, withAuth } from '@/app/wapi/_lib';
import { getWapiStatus } from '@/lib/wapi/wapi.service';
import { patchWhatsAppIntegration, sanitizeIntegration, statusFromWapi } from '@/lib/wapi/integration-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ empresaId: string }> }) {
  return withAuth(request, async (user) => {
    try {
      const { empresaId: rawEmpresaId } = await params;
      const empresaId = requireEmpresa(user, rawEmpresaId);
      const { integration, token } = await requireIntegration(empresaId, user.idToken);
      const status = await getWapiStatus(integration.wapiInstanceId, token);

      const updated = await patchWhatsAppIntegration(empresaId, {
        connected: Boolean(status.connected),
        status: statusFromWapi(Boolean(status.connected)),
        numeroWhatsapp: status.connectedPhone || integration.numeroWhatsapp || '',
        lastError: '',
        lastStatusAt: new Date().toISOString(),
      }, user.idToken);

      return ok({ integration: sanitizeIntegration(updated), raw: status });
    } catch (error) {
      return jsonError(error);
    }
  });
}
