/**
 * Lógica de público-alvo, tokens de personalização e render de preview.
 * Funções puras (sem React, sem rede) — fáceis de testar e reaproveitar quando
 * ligarmos o disparo real pela w-api.
 */
import type { AudienceId, AudiencePreset, CampaignDraft, MessageToken } from './types';

/** Cliente (subset) usado para resolver públicos. */
export interface ClientLike {
  id: string;
  nome?: string;
  celular?: string;
  totalPedidos?: number;
  ticketMedio?: number;
  ultimoPedido?: string;
  clienteDesde?: string;
}

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

/**
 * Frequência real de compra: pedidos por mês desde que virou cliente
 * (`clienteDesde`). Retorna 0 quando não dá para calcular (sem pedidos ou sem
 * data de cadastro). A janela tem piso de 1 mês para não inflar clientes muito
 * recentes (ex.: 3 pedidos em 5 dias não viram "18/mês").
 */
export function ordersPerMonth(c: ClientLike): number {
  const pedidos = c.totalPedidos || 0;
  if (pedidos <= 0) return 0;
  const since = parseDateBR(c.clienteDesde);
  if (!since) return 0;
  const days = (Date.now() - since) / 86400000;
  const months = Math.max(days / 30, 1);
  return pedidos / months;
}

/**
 * Intervalo ALEATÓRIO entre envios (anti-bloqueio): cada mensagem espera um
 * tempo sorteado nesta faixa, para o ritmo não ficar robótico/previsível.
 */
export const DELAY_MIN_SECONDS = 6;
export const DELAY_MAX_SECONDS = 18;
/** Média da faixa — usada só para estimar o tempo total. */
export const DELAY_AVG_SECONDS = (DELAY_MIN_SECONDS + DELAY_MAX_SECONDS) / 2;
/** Sorteia um intervalo (em ms) dentro da faixa anti-bloqueio. */
export function randomDelayMs(min = DELAY_MIN_SECONDS, max = DELAY_MAX_SECONDS): number {
  return Math.round((min + Math.random() * (max - min)) * 1000);
}

/** Estimativa de tempo total do disparo, dado o tamanho do público e o delay. */
export function estimateMinutes(audienceCount: number, delaySeconds: number): number {
  if (audienceCount <= 0) return 0;
  return Math.ceil((audienceCount * delaySeconds) / 60);
}

/** Telefone com WhatsApp plausível (>= 10 dígitos). */
export function hasValidWhatsapp(c: ClientLike): boolean {
  return (c.celular || '').replace(/\D/g, '').length >= 10;
}

/** Converte "DD/MM/AAAA"(+hora) ou ISO em timestamp; vazio/inválido = 0. */
export function parseDateBR(value?: string): number {
  if (!value) return 0;
  const t = value.trim();
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
  const parsed = Date.parse(t);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Resolve o público real a partir da base de clientes. Sempre exige WhatsApp
 * válido (é uma campanha por WhatsApp).
 */
export function resolveAudience(clients: ClientLike[], audienceId: AudienceId): ClientLike[] {
  const withPhone = (clients || []).filter(hasValidWhatsapp);
  const now = Date.now();
  const DAY = 86400000;

  switch (audienceId) {
    case 'recent':
      return withPhone.filter(c => {
        const t = parseDateBR(c.ultimoPedido);
        return t > 0 && now - t <= 30 * DAY;
      });
    case 'inactive':
      return withPhone.filter(c => {
        const t = parseDateBR(c.ultimoPedido);
        return t > 0 && now - t > 60 * DAY;
      });
    case 'vip': {
      const scored = withPhone
        .map(c => ({ c, spent: (c.totalPedidos || 0) * (c.ticketMedio || 0) }))
        .filter(x => x.spent > 0)
        .sort((a, b) => b.spent - a.spent);
      const topN = Math.max(1, Math.ceil(scored.length * 0.2));
      return scored.slice(0, topN).map(x => x.c);
    }
    default:
      return withPhone; // all
  }
}

export const EMPTY_DRAFT: CampaignDraft = {
  name: '',
  message: '',
  imageUrl: null,
  audienceId: 'all',
  delaySeconds: 8,
};
