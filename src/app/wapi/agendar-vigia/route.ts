import { jsonError } from '@/lib/firebase-auth-rest';
import { ok, requireEmpresa, withAuth } from '@/app/wapi/_lib';
import { agendarVigia, listarAgendamentosDoVigia } from '@/lib/wapi/agendar-vigia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liga o vigia do recebimento (agendamento no QStash), a pedido do dono.
 *
 * GET  — mostra o que está agendado hoje. Só leitura.
 * POST — deixa exatamente um agendamento no ar.
 *
 * Só o dono da loja: `requireEmpresa` já recusa operador. Nenhuma resposta
 * devolve o token — ele fica no ambiente do servidor, que é o único lugar onde
 * ele existe (a Vercel marca esse valor como "Sensitive" e não o entrega de
 * volta para ninguém).
 */
export async function GET(request: Request) {
  return withAuth(request, async (user) => {
    try {
      requireEmpresa(user, new URL(request.url).searchParams.get('empresaId') || user.uid);
      return ok({ agendamentos: await listarAgendamentosDoVigia() });
    } catch (error) {
      return jsonError(error);
    }
  });
}

export async function POST(request: Request) {
  return withAuth(request, async (user) => {
    try {
      const corpo = await request.json().catch(() => ({}));
      requireEmpresa(user, corpo?.empresaId || user.uid);
      const agendamento = await agendarVigia(new URL(request.url).origin);
      return ok({ agendamento });
    } catch (error) {
      return jsonError(error);
    }
  });
}
