import { jsonError } from '@/lib/firebase-auth-rest';
import { ok, requireEmpresa, withAuth } from '@/app/wapi/_lib';
import { removerIntegracao } from '@/lib/wapi/desconexao';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Remove a integração: desloga o celular e APAGA do sistema o ID e a chave da
 * instância. Para conectar de novo, a loja precisa pedir esses dados ao
 * suporte. Só a tela de remoção, com aviso e confirmação, chama esta rota.
 */
export async function POST(request: Request) {
  return withAuth(request, async (user) => {
    try {
      const body = await request.json().catch(() => ({}));
      const empresaId = requireEmpresa(user, body.empresaId);

      await removerIntegracao(empresaId, user.idToken);

      return ok({ removed: true });
    } catch (error) {
      return jsonError(error);
    }
  });
}
