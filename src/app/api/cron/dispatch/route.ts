import { NextResponse } from 'next/server';
import { getOptionalAdminDb } from '@/lib/firebase-admin';
import { getReceiver, getDispatchUrl, enqueueDispatch } from '@/lib/campanhas/qstash';
import { requireIntegrationService } from '@/app/wapi/_lib';
import { sendWapiImageMessage, sendWapiTextMessage } from '@/lib/wapi/wapi.service';
import { renderMessage, randomDelayMs } from '@/lib/campanhas/audience';
import type { ScheduledCampaign } from '@/lib/campanhas/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Tunáveis (ver §4 do plano): chunk curto p/ retornar antes do timeout do QStash.
const MAX_PER_CHUNK = 6;       // envios por entrega
const BUDGET_MS = 90_000;      // teto de trabalho por entrega
const LOCK_TTL_MS = 120_000;   // > BUDGET — destrava sozinho se a função morrer

const COLL = 'scheduled_campaigns';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const firstName = (nome?: string) => (nome || '').trim().split(/\s+/)[0] || 'Cliente';
function normalizePhone(phone: string) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('55') ? d : `55${d}`;
}

export async function POST(request: Request) {
  // 1) Autenticidade: a requisição PRECISA vir assinada pelo QStash.
  const body = await request.text();
  const signature = request.headers.get('upstash-signature') || '';
  try {
    const valid = await getReceiver().verify({ signature, body, url: getDispatchUrl() });
    if (!valid) return NextResponse.json({ error: 'Assinatura invalida.' }, { status: 401 });
  } catch (err) {
    return NextResponse.json({ error: 'Falha ao verificar assinatura.' }, { status: 401 });
  }

  let campaignId = '';
  try { campaignId = String(JSON.parse(body)?.campaignId || ''); } catch { /* ignore */ }
  if (!campaignId) return NextResponse.json({ error: 'campaignId ausente.' }, { status: 400 });

  const db = getOptionalAdminDb();
  if (!db) return NextResponse.json({ error: 'Admin indisponivel.' }, { status: 500 });
  const ref = db.collection(COLL).doc(campaignId);

  // 2) Lock cooperativo (transação) — evita que retries/execuções concorrentes dupliquem.
  let camp: ScheduledCampaign | null = null;
  const locked = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const data = snap.data() as ScheduledCampaign;
    if (data.status === 'done' || data.status === 'canceled') return false;
    const lockedAtMs = data.lockedAt ? Date.parse(data.lockedAt) : 0;
    if (lockedAtMs && Date.now() - lockedAtMs < LOCK_TTL_MS) return false; // alguém está processando
    tx.update(ref, { lockedAt: new Date().toISOString(), status: 'running', updatedAt: new Date().toISOString() });
    camp = data;
    return true;
  });
  if (!locked || !camp) return NextResponse.json({ ok: true, skipped: true });

  const campaign = camp as ScheduledCampaign;

  // 3) Instância w-api do tenant (via Admin, sem token de usuário).
  let integration: { wapiInstanceId: string }; let token: string;
  try {
    const resolved = await requireIntegrationService(campaign.ownerId);
    integration = resolved.integration; token = resolved.token;
  } catch (err: any) {
    await ref.update({
      status: 'error', lockedAt: null, currentId: null,
      error: err?.message || 'Instancia w-api indisponivel.', updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, error: 'integration' });
  }

  // 4) Envia um chunk com espaçamento real; persiste o cursor A CADA envio.
  const recipients = campaign.recipients || [];
  let { cursor, sent, failed } = campaign;
  const results = Array.isArray(campaign.results) ? [...campaign.results] : [];
  const startedAt = Date.now();
  let n = 0;
  try {
    while (cursor < recipients.length && n < MAX_PER_CHUNK && Date.now() - startedAt < BUDGET_MS) {
      const r = recipients[cursor];
      await ref.update({ currentId: r.id });
      const phone = normalizePhone(r.celular);
      const rendered = renderMessage(campaign.message || '', {
        primeiro_nome: firstName(r.nome),
        nome: (r.nome || '').trim() || 'Cliente',
        loja: campaign.loja || '',
        link: campaign.link || '',
      });

      try {
        if (!phone) throw new Error('Telefone invalido');
        if (campaign.imageUrl) {
          await sendWapiImageMessage(integration.wapiInstanceId, token, {
            phone, image: campaign.imageUrl, caption: rendered.trim() || undefined, delayMessage: 1,
          });
        } else {
          await sendWapiTextMessage(integration.wapiInstanceId, token, { phone, message: rendered, delayMessage: 1 });
        }
        sent++; results.push({ id: r.id, status: 'sent' });
      } catch (sendErr: any) {
        failed++; results.push({ id: r.id, status: 'failed', reason: sendErr?.message || 'falha' });
      }

      cursor++; n++;
      await ref.update({ cursor, sent, failed, results, updatedAt: new Date().toISOString() }); // idempotência: antes do sleep
      if (cursor < recipients.length && n < MAX_PER_CHUNK) await sleep(randomDelayMs(campaign.delayMin, campaign.delayMax));
    }
  } catch (loopErr) {
    // Erro inesperado: libera o lock e deixa o QStash reentregar (cursor já salvo).
    await ref.update({ lockedAt: null, currentId: null, updatedAt: new Date().toISOString() });
    return NextResponse.json({ error: 'falha no envio' }, { status: 500 });
  }

  // 5) Acabou? marca done. Senão, libera o lock e SE RE-ENFILEIRA no QStash.
  if (cursor >= recipients.length) {
    await ref.update({ status: 'done', currentId: null, lockedAt: null, updatedAt: new Date().toISOString() });
    return NextResponse.json({ ok: true, done: true, sent, failed });
  }

  await ref.update({ currentId: null, lockedAt: null, updatedAt: new Date().toISOString() });
  try {
    const messageId = await enqueueDispatch(campaignId, 0);
    await ref.update({ lastQstashMessageId: messageId });
  } catch (enqErr) {
    // Se o re-enqueue falhar, devolve 500 → o QStash reentrega esta mesma mensagem.
    return NextResponse.json({ error: 're-enqueue falhou' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, progress: { cursor, total: recipients.length, sent, failed } });
}
