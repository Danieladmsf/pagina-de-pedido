import { jsonError } from '@/lib/firebase-auth-rest';
import { ok, requireEmpresa, withAuth } from '@/app/wapi/_lib';
import { disconnectWapiInstance } from '@/lib/wapi/wapi.service';
import {
  decryptWapiToken,
  deleteWhatsAppIntegration,
  getWhatsAppIntegration,
  isBlockedSharedWapiInstance,
} from '@/lib/wapi/integration-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return withAuth(request, async (user) => {
    try {
      const body = await request.json().catch(() => ({}));
      const empresaId = requireEmpresa(user, body.empresaId);
      const integration = await getWhatsAppIntegration(empresaId, user.idToken);

      if (integration?.wapiInstanceId && !isBlockedSharedWapiInstance(integration.wapiInstanceId)) {
        try {
          const token = decryptWapiToken(integration);
          await disconnectWapiInstance(integration.wapiInstanceId, token);
        } catch (error) {
          console.warn('[W-API] Falha ao desconectar da W-API (a instancia pode estar inativa ou o token pode ter mudado):', error);
        }
      }

      await deleteWhatsAppIntegration(empresaId, user.idToken);

      return ok({ disconnected: true, cleared: true });
    } catch (error) {
      return jsonError(error);
    }
  });
}
