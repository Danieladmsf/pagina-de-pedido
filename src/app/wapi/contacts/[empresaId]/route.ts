import { jsonError } from '@/lib/firebase-auth-rest';
import { ok, requireEmpresa, requireIntegration, withAuth } from '@/app/wapi/_lib';
import { fetchWapiChats } from '@/lib/wapi/wapi.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lista os contatos do WhatsApp da loja (a partir dos chats da instancia) para
 * importar na base de Campanhas. Normaliza o formato — que varia entre versoes
 * da W-API — para uma lista simples de { name, phone }, ignorando grupos,
 * listas de transmissao, status e numeros invalidos.
 */
export async function GET(request: Request, { params }: { params: Promise<{ empresaId: string }> }) {
  return withAuth(request, async (user) => {
    try {
      const { empresaId: rawEmpresaId } = await params;
      const empresaId = requireEmpresa(user, rawEmpresaId);
      const { integration, token } = await requireIntegration(empresaId, user.idToken);

      const raw = await fetchWapiChats(integration.wapiInstanceId, token);
      const list: any[] = Array.isArray(raw)
        ? raw
        : (raw?.chats || raw?.data || raw?.contacts || raw?.result || []);

      const seen = new Set<string>();
      const contacts: { name: string; phone: string }[] = [];

      for (const item of Array.isArray(list) ? list : []) {
        const jid = String(
          item?.id || item?.chatId || item?.jid || item?.phone || item?.wa_id || item?.number || '',
        );
        // Ignora grupos, broadcast e status — so contatos individuais.
        if (!jid || /@g\.us|@broadcast|status@|@newsletter/i.test(jid) || item?.isGroup === true) continue;

        const phone = jid.split('@')[0].replace(/\D/g, '');
        if (phone.length < 10 || phone.length > 15) continue;
        if (seen.has(phone)) continue;
        seen.add(phone);

        const name = String(
          item?.name || item?.contactName || item?.pushName || item?.notify ||
          item?.verifiedName || item?.formattedName || item?.shortName || '',
        ).trim();

        contacts.push({ name, phone });
      }

      // Diagnostico: se vieram chats mas nenhum contato saiu, o formato mudou —
      // loga as chaves do primeiro item para facilitar o ajuste.
      if (contacts.length === 0 && Array.isArray(list) && list.length > 0) {
        console.warn('[wapi/contacts] Nenhum contato extraido. Chaves do 1o item:', Object.keys(list[0] || {}));
      }

      return ok({ contacts, total: contacts.length });
    } catch (error) {
      return jsonError(error);
    }
  });
}
