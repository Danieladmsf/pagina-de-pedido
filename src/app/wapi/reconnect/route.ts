import { jsonError } from '@/lib/firebase-auth-rest';
import { ok, requireEmpresa, requireIntegration, withAuth } from '@/app/wapi/_lib';
import { extractWapiQrCode, getWapiQrCode, restartWapiInstance } from '@/lib/wapi/wapi.service';
import { patchWhatsAppIntegration, sanitizeIntegration } from '@/lib/wapi/integration-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return withAuth(request, async (user) => {
    try {
      const body = await request.json().catch(() => ({}));
      const empresaId = requireEmpresa(user, body.empresaId);
      const { integration, token } = await requireIntegration(empresaId, user.idToken);

      await restartWapiInstance(integration.wapiInstanceId, token);
      const qr = await getWapiQrCode(integration.wapiInstanceId, token);
      const qrCode = extractWapiQrCode(qr);
      const updated = await patchWhatsAppIntegration(empresaId, {
        connected: false,
        status: 'pending_qr',
        qrCode,
        lastError: '',
        lastStatusAt: new Date().toISOString(),
      }, user.idToken);

      return ok({ reconnected: true, qrCode, integration: sanitizeIntegration(updated) });
    } catch (error) {
      return jsonError(error);
    }
  });
}
