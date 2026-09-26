import { jsonError } from '@/lib/firebase-auth-rest';
import { ok, requireEmpresa, requireIntegration, withAuth } from '@/app/wapi/_lib';
import { sanitizeIntegration } from '@/lib/wapi/integration-store';
import { desconectarCelular } from '@/lib/wapi/desconexao';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Desconecta só o CELULAR da loja: a sessão no servidor e o cadastro ficam, e
 * religar é ler o QR Code de novo (ver `lib/wapi/desconexao`).
 */
export async function POST(request: Request) {
  return withAuth(request, async (user) => {
    try {
      const body = await request.json().catch(() => ({}));
      const empresaId = requireEmpresa(user, body.empresaId);
      const { integration, token } = await requireIntegration(empresaId, user.idToken);

      const atualizada = await desconectarCelular({ empresaId, integration, token, idToken: user.idToken });

      return ok({ disconnected: true, integration: sanitizeIntegration(atualizada) });
    } catch (error) {
      return jsonError(error);
    }
  });
}
