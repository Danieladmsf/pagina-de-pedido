import { jsonError } from '@/lib/firebase-auth-rest';
import { ok, requireEmpresa, requireIntegration, withAuth } from '@/app/wapi/_lib';
import { getWapiConnectedPhone, getWapiStatus, isWapiConnectedStatus } from '@/lib/wapi/wapi.service';
import { patchWhatsAppIntegration, sanitizeIntegration, statusFromWapi } from '@/lib/wapi/integration-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ empresaId: string }> }) {
  return withAuth(request, async (user) => {
    try {
      const { empresaId: rawEmpresaId } = await params;
      const empresaId = requireEmpresa(user, rawEmpresaId);
      const { integration, token } = await requireIntegration(empresaId, user.idToken);
      const rawStatus = await getWapiStatus(integration.wapiInstanceId, token);
      const connected = isWapiConnectedStatus(rawStatus);
      const connectedPhone = getWapiConnectedPhone(rawStatus);

      const updated = await patchWhatsAppIntegration(empresaId, {
        connected,
        status: statusFromWapi(connected),
        numeroWhatsapp: connectedPhone || integration.numeroWhatsapp || '',
        lastError: '',
        lastStatusAt: new Date().toISOString(),
      }, user.idToken);

      return ok({ integration: sanitizeIntegration(updated), raw: rawStatus });
    } catch (error) {
      return jsonError(error);
    }
  });
}
