/**
 * Tipos centrais do módulo de Campanhas (marketing via WhatsApp).
 *
 * A lógica de negócio (públicos, render de preview e — no futuro — o disparo
 * pela w-api) fica concentrada em src/lib/campanhas/* para NÃO inflar a UI nem
 * o page.tsx. Os componentes em src/components/campanhas/* só consomem isto.
 */

export type AudienceId = 'all' | 'recent' | 'inactive' | 'vip';

export interface AudiencePreset {
  id: AudienceId;
  label: string;
  description: string;
  /** Dias de referência para o filtro (quando aplicável). */
  windowDays?: number;
}

export interface MessageToken {
  token: string;
  label: string;
  example: string;
}

export interface CampaignDraft {
  name: string;
  message: string;
  /** URL/objeto local da imagem anexada (preview). */
  imageUrl: string | null;
  audienceId: AudienceId;
  /** Espaçamento entre envios (anti-bloqueio). */
  delaySeconds: number;
}

export interface CampaignStatsView {
  audienceCount: number;
  estimatedMinutes: number;
}
