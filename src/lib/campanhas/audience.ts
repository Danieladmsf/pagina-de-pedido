/**
 * Lógica de público-alvo, tokens de personalização e render de preview.
 * Funções puras (sem React, sem rede) — fáceis de testar e reaproveitar quando
 * ligarmos o disparo real pela w-api.
 */
import type { AudiencePreset, CampaignDraft, MessageToken } from './types';

export const AUDIENCE_PRESETS: AudiencePreset[] = [
  { id: 'all', label: 'Todos os clientes', description: 'Toda a base com WhatsApp válido' },
  { id: 'recent', label: 'Ativos (últimos 30 dias)', description: 'Compraram recentemente', windowDays: 30 },
  { id: 'inactive', label: 'Inativos (60+ dias)', description: 'Reativação — "sentimos sua falta"', windowDays: 60 },
  { id: 'vip', label: 'VIP (maiores compradores)', description: 'Top clientes por volume gasto' },
];

export const MESSAGE_TOKENS: MessageToken[] = [
  { token: '{primeiro_nome}', label: 'Primeiro nome', example: 'Maria' },
  { token: '{nome}', label: 'Nome completo', example: 'Maria Silva' },
  { token: '{loja}', label: 'Nome da loja', example: 'Minha Loja' },
  { token: '{link}', label: 'Link do cardápio', example: 'https://...' },
];

/** Substitui os tokens por valores (usado no preview e, futuramente, no envio). */
export function renderMessage(
  message: string,
  vars: { primeiro_nome: string; nome: string; loja: string; link: string },
): string {
  return message
    .split('{primeiro_nome}').join(vars.primeiro_nome)
    .split('{nome}').join(vars.nome)
    .split('{loja}').join(vars.loja)
    .split('{link}').join(vars.link);
}

/** Estimativa de tempo total do disparo, dado o tamanho do público e o delay. */
export function estimateMinutes(audienceCount: number, delaySeconds: number): number {
  if (audienceCount <= 0) return 0;
  return Math.ceil((audienceCount * delaySeconds) / 60);
}

export const EMPTY_DRAFT: CampaignDraft = {
  name: '',
  message: '',
  imageUrl: null,
  audienceId: 'all',
  delaySeconds: 8,
};
