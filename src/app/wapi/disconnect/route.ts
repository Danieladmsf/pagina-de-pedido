import { jsonError } from '@/lib/firebase-auth-rest';
import { ok, requireEmpresa, requireIntegration, withAuth } from '@/app/wapi/_lib';
import { disconnectWapiInstance } from '@/lib/wapi/wapi.service';
import { deleteWhatsAppIntegration } from '@/lib/wapi/integration-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return withAuth(request, async (user) => {
    try {
      const body = await request.json().catch(() => ({}));
      const empresaId = requireEmpresa(user, body.empresaId);
      const { integration, token } = await requireIntegration(empresaId, user.idToken);

      // Try to disconnect from W-API, but don't fail if it errors
      try {
        await disconnectWapiInstance(integration.wapiInstanceId, token);
      } catch (error) {
        console.warn('[W-API] Falha ao desconectar da W-API (instancia pode estar inativa):', error);
      }

      // Clear the integration from Firestore so user can create a new one
      await deleteWhatsAppIntegration(empresaId, user.idToken);

      return ok({ disconnected: true, cleared: true });
    } catch (error) {
      return jsonError(error);
    }
  });
}
