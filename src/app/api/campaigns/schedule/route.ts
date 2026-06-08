import { withAuth, requireEmpresa, ok } from '@/app/wapi/_lib';
import { getOptionalAdminDb } from '@/lib/firebase-admin';
import { enqueueDispatch } from '@/lib/campanhas/qstash';
import type { CampaignRecipient, ScheduledCampaign } from '@/lib/campanhas/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cria uma campanha agendada (coleção `scheduled_campaigns`) e publica a 1ª
 * execução no QStash (com `delay` até o `scheduleAt`). O envio acontece no
 * servidor (`/api/cron/dispatch`), independente do navegador.
 */
export async function POST(request: Request) {
  return withAuth(request, async (user) => {
    const body = await request.json().catch(() => ({} as any));
    const empresaId = requireEmpresa(user, body.empresaId); // = user.uid

    const db = getOptionalAdminDb();
    if (!db) return ok({ error: 'Servico indisponivel (Admin nao configurado).' }, 500);

    const recipients: CampaignRecipient[] = (Array.isArray(body.recipients) ? body.recipients : [])
      .map((r: any) => ({ id: String(r?.id || ''), nome: String(r?.nome || ''), celular: String(r?.celular || '') }))
      .filter((r: CampaignRecipient) => r.id && r.celular);

    const message = String(body.message || '');
    const imageUrl = body.imageUrl ? String(body.imageUrl) : null;

    if (recipients.length === 0) return ok({ error: 'Nenhum destinatario valido.' }, 400);
    if (!message.trim() && !imageUrl) return ok({ error: 'Mensagem ou imagem obrigatoria.' }, 400);

    const nowIso = new Date().toISOString();
    const scheduleAt = body.scheduleAt ? String(body.scheduleAt) : nowIso;
    const ref = db.collection('scheduled_campaigns').doc();

    const doc: ScheduledCampaign = {
      id: ref.id,
      ownerId: empresaId,
      name: String(body.name || '').trim() || 'Campanha',
      message,
      imageUrl,
      loja: String(body.loja || ''),
      link: String(body.link || ''),
      recipients,
      delayMin: Number(body.delayMin) || 6,
      delayMax: Number(body.delayMax) || 18,
      status: 'scheduled',
      scheduleAt,
      cursor: 0,
      sent: 0,
      failed: 0,
      currentId: null,
      results: [],
      lockedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await ref.set(doc);

    const delaySeconds = Math.max(0, Math.floor((Date.parse(scheduleAt) - Date.now()) / 1000));
    try {
      const messageId = await enqueueDispatch(ref.id, delaySeconds, request);
      await ref.update({ lastQstashMessageId: messageId });
    } catch (e: any) {
      await ref.update({ status: 'error', error: `Falha ao enfileirar (QStash): ${e?.message || ''}` });
      return ok({ error: 'Nao foi possivel agendar o disparo (QStash).' }, 502);
    }

    return ok({ id: ref.id });
  });
}
