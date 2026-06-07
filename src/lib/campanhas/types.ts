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

/* ── Disparo agendado / em segundo plano (server-side, coleção scheduled_campaigns) ── */

export type ScheduledCampaignStatus = 'scheduled' | 'running' | 'done' | 'canceled' | 'error';

/** Snapshot do destinatário no momento do agendamento (não depende de `clientes` mudar). */
export interface CampaignRecipient {
  id: string;
  nome: string;
  celular: string;
}

export interface CampaignSendResult {
  id: string;
  status: 'sent' | 'failed';
  reason?: string;
}

/**
 * Documento da coleção `scheduled_campaigns`. Criado pela UI; processado pelo
 * `/api/cron/dispatch` (gatilhado pelo QStash). A UI lê em realtime para mostrar
 * o progresso. Campos de envio (`cursor/sent/failed/currentId/...`) são escritos
 * SOMENTE pelo servidor (Admin SDK).
 */
export interface ScheduledCampaign {
  id: string;
  /** Tenant dono (= empresaId / uid). */
  ownerId: string;
  name: string;
  message: string;
  /** Imagem JÁ hospedada (URL pública) — a UI faz o upload antes de agendar. */
  imageUrl: string | null;
  /** Congelados no agendamento para o `renderMessage` no servidor. */
  loja: string;
  link: string;
  recipients: CampaignRecipient[];
  /** Faixa do intervalo aleatório anti-bloqueio (segundos). */
  delayMin: number;
  delayMax: number;

  status: ScheduledCampaignStatus;
  /** Quando começar (ISO). Imediato = agora. */
  scheduleAt: string;
  /** Índice do próximo destinatário a enviar (idempotência/resume). */
  cursor: number;
  sent: number;
  failed: number;
  /** Contato sendo enviado agora — anima a lista na UI. */
  currentId: string | null;
  results?: CampaignSendResult[];

  /** Lock cooperativo anti-overlap (ISO) — escrito pelo servidor. */
  lockedAt: string | null;
  /** Id da última mensagem QStash enfileirada (p/ cancelar a entrega pendente). */
  lastQstashMessageId?: string;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}
