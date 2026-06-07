import { ok, requireEmpresa, requireIntegration, withAuth } from '@/app/wapi/_lib';
import { getWapiProfilePicture } from '@/lib/wapi/wapi.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizePhone(phone: string) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('55') ? digits : `55${digits}`;
}

/**
 * Foto de perfil de um contato (proxy seguro da w-api). Recebe { empresaId, phone }.
 * A foto é cosmética: qualquer erro responde { link: null } para a UI cair na
 * inicial — nunca quebra a tela nem expõe erro.
 */
export async function POST(request: Request) {
  return withAuth(request, async (user) => {
    try {
      const body = await request.json();
      const empresaId = requireEmpresa(user, body.empresaId);
      const phone = normalizePhone(body.phone);
      if (!phone) return ok({ link: null });

      const { integration, token } = await requireIntegration(empresaId, user.idToken);
      const data = await getWapiProfilePicture(integration.wapiInstanceId, token, phone);
      return ok({ link: data?.link || null });
    } catch {
      return ok({ link: null });
    }
  });
}
