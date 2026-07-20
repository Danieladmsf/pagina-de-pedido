import {
  ok,
  requireOperationalEmpresa,
  requireOperationalIntegration,
  requireOperationalProfilePictureAccess,
  withAuth,
} from '@/app/wapi/_lib';
import { getWapiProfilePicture } from '@/lib/wapi/wapi.service';
import { normalizeWapiPhone } from '@/lib/wapi/operator-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Foto de perfil de um contato (proxy seguro da w-api). Recebe { empresaId, phone }.
 * A foto é cosmética: qualquer erro responde { link: null } para a UI cair na
 * inicial — nunca quebra a tela nem expõe erro.
 */
export async function POST(request: Request) {
  return withAuth(request, async (user) => {
    try {
      const body = await request.json();
      const access = await requireOperationalEmpresa(user, body.empresaId);
      requireOperationalProfilePictureAccess(access);
      const phone = normalizeWapiPhone(body.phone);
      if (!phone) return ok({ link: null });

      const { integration, token } = await requireOperationalIntegration(access, user);
      const data = await getWapiProfilePicture(integration.wapiInstanceId, token, phone);
      return ok({ link: data?.link || null });
    } catch {
      return ok({ link: null });
    }
  });
}
