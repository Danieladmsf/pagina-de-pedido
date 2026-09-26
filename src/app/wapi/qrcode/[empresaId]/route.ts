import { jsonError } from '@/lib/firebase-auth-rest';
import { ok, requireEmpresa, requireIntegration, withAuth } from '@/app/wapi/_lib';
import { getWuzQrCode } from '@/lib/wuzapi/wuzapi.service';
import { patchWhatsAppIntegration, sanitizeIntegration } from '@/lib/wapi/integration-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ empresaId: string }> }) {
  return withAuth(request, async (user) => {
    try {
      const { empresaId: rawEmpresaId } = await params;
      const empresaId = requireEmpresa(user, rawEmpresaId);
      const { integration, token } = await requireIntegration(empresaId, user.idToken);
      const { qrcode: qrCode } = await getWuzQrCode(integration.wapiInstanceId, token);

      const updated = await patchWhatsAppIntegration(empresaId, {
        qrCode,
        status: integration.connected ? 'connected' : 'pending_qr',
        lastError: '',
        lastStatusAt: new Date().toISOString(),
      }, user.idToken);

      return ok({
        qrCode,
        integration: sanitizeIntegration(updated),
      });
    } catch (error) {
      return jsonError(error);
    }
  });
}
