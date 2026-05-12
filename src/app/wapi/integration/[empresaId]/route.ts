import { jsonError } from '@/lib/firebase-auth-rest';
import { ok, requireEmpresa, withAuth } from '@/app/wapi/_lib';
import { getWhatsAppIntegration, sanitizeIntegration } from '@/lib/wapi/integration-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /wapi/integration/{empresaId}
 * Retorna a integracao salva no Firestore SEM consultar a W-API ao vivo.
 * Usado no carregamento inicial da pagina para exibir os dados rapidamente.
 */
export async function GET(request: Request, { params }: { params: Promise<{ empresaId: string }> }) {
  return withAuth(request, async (user) => {
    try {
      const { empresaId: rawEmpresaId } = await params;
      const empresaId = requireEmpresa(user, rawEmpresaId);
      const integration = await getWhatsAppIntegration(empresaId, user.idToken);

      if (!integration?.wapiInstanceId) {
        return ok({ integration: null });
      }

      return ok({ integration: sanitizeIntegration(integration) });
    } catch (error) {
      return jsonError(error);
    }
  });
}
