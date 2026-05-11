import { jsonError } from '@/lib/firebase-auth-rest';
import { ok, requireEmpresa, requireIntegration, withAuth } from '@/app/wapi/_lib';
import { disconnectWapiInstance } from '@/lib/wapi/wapi.service';
import { deleteWhatsAppIntegration } from '@/lib/wapi/integration-store';
import { setFirestoreDocument } from '@/lib/firestore-rest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return withAuth(request, async (user) => {
    try {
      const body = await request.json().catch(() => ({}));
      const empresaId = requireEmpresa(user, body.empresaId);
      const { integration, token } = await requireIntegration(empresaId, user.idToken);

      // Try to disconnect from W-API, but don't fail if it errors (e.g. instance has no IP)
      try {
        await disconnectWapiInstance(integration.wapiInstanceId, token);
      } catch (error) {
        console.warn('[W-API] Falha ao desconectar da W-API (instancia pode estar inativa):', error);
      }

      // Libera a reserva da instância trial para que outra conta possa usá-la
      try {
        await setFirestoreDocument(`wapi_instance_claims/${integration.wapiInstanceId}`, {
          empresaId: null,
          instanceId: integration.wapiInstanceId,
          releasedAt: new Date().toISOString(),
        }, user.idToken);
      } catch (claimError) {
        console.warn('[W-API] Falha ao liberar claim da instancia:', claimError);
      }

      // Always clear the integration from Firestore so user can create a new one
      await deleteWhatsAppIntegration(empresaId, user.idToken);

      return ok({ disconnected: true, cleared: true });
    } catch (error) {
      return jsonError(error);
    }
  });
}

