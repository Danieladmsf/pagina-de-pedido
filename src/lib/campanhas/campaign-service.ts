'use client';

/**
 * Disparo de campanha de WhatsApp.
 *
 * Lógica isolada (sem React) para a UI só orquestrar. Envia SEQUENCIALMENTE,
 * respeitando um intervalo entre mensagens (anti-bloqueio), com callback de
 * progresso e suporte a cancelamento. Cada destinatário recebe a mensagem com
 * os tokens já personalizados ({primeiro_nome}, etc.).
 */
import { renderMessage } from './audience';
import type { ClientLike } from './audience';

export interface SendProgress {
  total: number;
  sent: number;
  failed: number;
  current?: string;
  done: boolean;
}

export interface SendCampaignParams {
  empresaId: string;
  getToken: () => Promise<string>;
  targets: ClientLike[];
  message: string;
  imageUrl?: string | null;
  loja: string;
  link: string;
  delaySeconds: number;
  onProgress?: (p: SendProgress) => void;
  shouldCancel?: () => boolean;
}

export interface SendCampaignResult {
  total: number;
  sent: number;
  failed: number;
  canceled: boolean;
  errors: Array<{ id: string; nome?: string; reason: string }>;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function firstName(nome?: string) {
  return (nome || '').trim().split(/\s+/)[0] || 'Cliente';
}

export async function sendCampaign(params: SendCampaignParams): Promise<SendCampaignResult> {
  const { empresaId, getToken, targets, message, imageUrl, loja, link, delaySeconds, onProgress, shouldCancel } = params;
  const total = targets.length;
  let sent = 0;
  let failed = 0;
  let canceled = false;
  const errors: SendCampaignResult['errors'] = [];

  const token = await getToken();

  for (let i = 0; i < targets.length; i++) {
    if (shouldCancel?.()) { canceled = true; break; }

    const t = targets[i];
    onProgress?.({ total, sent, failed, current: t.nome, done: false });

    const rendered = renderMessage(message, {
      primeiro_nome: firstName(t.nome),
      nome: (t.nome || '').trim() || 'Cliente',
      loja,
      link,
    });

    try {
      const body: Record<string, unknown> = {
        empresaId,
        phone: t.celular,
        type: 'campaign',
      };
      if (imageUrl) {
        body.imageUrl = imageUrl;
        if (rendered.trim()) body.caption = rendered;
      } else {
        body.message = rendered;
      }

      const res = await fetch('/wapi/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        failed++;
        errors.push({ id: t.id, nome: t.nome, reason: data?.error || `HTTP ${res.status}` });
      } else {
        sent++;
      }
    } catch (err) {
      failed++;
      errors.push({ id: t.id, nome: t.nome, reason: err instanceof Error ? err.message : 'Falha de rede' });
    }

    onProgress?.({ total, sent, failed, current: t.nome, done: false });

    // Intervalo anti-bloqueio (não espera após o último).
    if (i < targets.length - 1 && !shouldCancel?.()) {
      await sleep(Math.max(0, delaySeconds * 1000));
    }
  }

  onProgress?.({ total, sent, failed, done: true });
  return { total, sent, failed, canceled, errors };
}
