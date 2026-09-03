import { NextResponse } from 'next/server';
import { getReceiver } from '@/lib/campanhas/qstash';
import { getWebhookUrl } from '@/app/wapi/_lib';
import { vigiarRecebimentoDeTodasAsLojas } from '@/lib/wapi/webhook-watchdog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * O vigia do recebimento de mensagens, rodando no SERVIDOR — sem depender de
 * navegador aberto.
 *
 * Aceita dois gatilhos porque nenhum dos dois é garantido sozinho:
 *  - POST assinado pelo QStash (o agendamento de verdade, criado por
 *    `scripts/agendar-vigia-webhook.mjs`);
 *  - GET com `Authorization: Bearer <CRON_SECRET>` — Vercel Cron ou chamada
 *    manual para conferir na hora.
 *
 * A varredura é idempotente e barata quando está tudo bem (lê os documentos das
 * lojas conectadas e para por aí); só fala com a W-API quando alguma instância
 * está muda de verdade.
 */

function autorizadoPorSegredo(request: Request) {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) return false;

  const url = new URL(request.url);
  const header = request.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  return bearer === esperado || url.searchParams.get('secret') === esperado;
}

async function varrer(request: Request) {
  const resultado = await vigiarRecebimentoDeTodasAsLojas((integration, token) =>
    getWebhookUrl(request, integration.empresaId, token, integration.webhookUrl),
  );

  if (resultado.mudas > 0) {
    console.warn('[vigia-webhook] Instancias mudas encontradas:', {
      mudas: resultado.mudas,
      reRegistradas: resultado.reRegistradas,
      falhas: resultado.falhas,
      lojas: resultado.lojas.filter((l) => l.estado === 'mudo').map((l) => ({
        empresaId: l.empresaId,
        instanceId: l.instanceId,
        silencioMin: Math.round(l.silencioMs / 60000),
        registroConfirmado: l.registroConfirmado,
        erro: l.erro,
      })),
    });
  }

  return NextResponse.json({ ok: true, ...resultado }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get('upstash-signature') || '';

  if (signature) {
    try {
      // Igual ao dispatcher: a assinatura autentica, sem amarrar à URL (a env
      // do domínio pode divergir do host real que serviu a requisição).
      const valido = await getReceiver().verify({ signature, body });
      if (!valido) return NextResponse.json({ error: 'Assinatura invalida.' }, { status: 401 });
    } catch {
      return NextResponse.json({ error: 'Falha ao verificar assinatura.' }, { status: 401 });
    }
  } else if (!autorizadoPorSegredo(request)) {
    return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });
  }

  return varrer(request);
}

export async function GET(request: Request) {
  if (!autorizadoPorSegredo(request)) {
    return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });
  }

  return varrer(request);
}
