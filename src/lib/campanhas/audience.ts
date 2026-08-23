/**
 * Lógica de público-alvo, tokens de personalização e render de preview.
 * Funções puras (sem React, sem rede) — fáceis de testar e reaproveitar quando
 * ligarmos o disparo real pela w-api.
 */
import type { AudienceId, AudiencePreset, CampaignDraft, CampaignRecipient, MessageToken } from './types';

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

/**
 * Quantos pedidos fazem alguém "fiel". Três é o menor número que separa hábito
 * de acaso: uma compra é experimento, duas podem ser coincidência.
 */
export const FIEL_MINIMO_DE_PEDIDOS = 3;
/** A partir de quantos dias sem comprar o cliente fiel conta como sumido. */
export const FIEL_SUMIDO_DIAS = 30;

export const AUDIENCE_PRESETS: AudiencePreset[] = [
  { id: 'all', label: 'Todos os clientes', description: 'Toda a base com WhatsApp válido' },
  { id: 'recent', label: 'Ativos (últimos 30 dias)', description: 'Compraram recentemente', windowDays: 30 },
  { id: 'inactive', label: 'Inativos (60+ dias)', description: 'Reativação — "sentimos sua falta"', windowDays: 60 },
  { id: 'vip', label: 'VIP (maiores compradores)', description: 'Top clientes por volume gasto' },
  {
    id: 'fiel_sumido',
    label: 'Fiéis que sumiram',
    description: 'Compravam sempre e pararam — quem mais dói perder',
    windowDays: FIEL_SUMIDO_DIAS,
  },
  {
    id: 'interessado',
    label: 'Olharam e não pediram',
    description: 'Abriram o cardápio agora há pouco e não fecharam',
  },
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

/**
 * Telefone no formato que a w-api recebe (país + DDD + número, só dígitos) —
 * e, por tabela, a chave que identifica a PESSOA num disparo: é por ela que o
 * mesmo número cadastrado duas vezes vira um envio só.
 *
 * O "55" da frente só é código do país quando o número fica com 12-13 dígitos:
 * sem essa checagem, quem tem DDD 55 (Santa Maria, Uruguaiana e região) seria
 * tratado como se já tivesse o país e a mensagem sairia para o número errado.
 * Mesma regra do CartDrawer e do normalizeCreditPhone.
 */
export function normalizeCampaignPhone(phone?: string): string {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return `55${d}`;
}

/**
 * Um número = uma mensagem. O mesmo cliente cadastrado duas vezes (troca de
 * nome, pedido pelo balcão + delivery) faria a pessoa receber a campanha
 * repetida, às vezes em sequência — ruim para ela e para o anti-bloqueio.
 *
 * Vence o primeiro da lista; se ele estiver sem nome e o repetido tiver, o nome
 * é aproveitado (senão o `{primeiro_nome}` cairia em "Cliente"). Só junta quem
 * dá no MESMO número normalizado: "(11) 3333-4444" e "(11) 93333-4444" seguem
 * sendo dois contatos, porque adivinhar o nono dígito casaria fixo com celular.
 */
export function dedupeRecipientsByPhone(recipients: CampaignRecipient[]): CampaignRecipient[] {
  const porTelefone = new Map<string, CampaignRecipient>();
  for (const r of recipients) {
    const chave = normalizeCampaignPhone(r.celular);
    if (!chave) continue;
    const atual = porTelefone.get(chave);
    if (!atual) porTelefone.set(chave, { ...r });
    else if (!atual.nome.trim() && r.nome.trim()) atual.nome = r.nome;
  }
  return [...porTelefone.values()];
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
 * O que o cardápio sabe e o cadastro não: quem está olhando AGORA.
 *
 * Vem da tela de visitantes (`store_visitors`), e é por telefone porque é o que
 * existe dos dois lados. A comparação usa o mesmo normalizador do disparo, para
 * "(16) 99164-4249" no cadastro e "16991644249" na visita serem a mesma pessoa.
 */
export interface ContextoDoPublico {
  /** Telefones de quem abriu o cardápio no período e NÃO fechou pedido. */
  telefonesInteressados?: string[];
}

/**
 * Resolve o público real a partir da base de clientes. Sempre exige WhatsApp
 * válido (é uma campanha por WhatsApp).
 */
export function resolveAudience(
  clients: ClientLike[],
  audienceId: AudienceId,
  contexto?: ContextoDoPublico,
): ClientLike[] {
  const withPhone = (clients || []).filter(hasValidWhatsapp);
  const now = Date.now();
  const DAY = 86400000;

  switch (audienceId) {
    case 'fiel_sumido':
      // Diferente de "inativo": aqui não entra quem comprou uma vez e nunca
      // mais. Fiel que some é a perda que dá para reverter com uma mensagem.
      return withPhone.filter(c => {
        if ((c.totalPedidos || 0) < FIEL_MINIMO_DE_PEDIDOS) return false;
        const t = parseDateBR(c.ultimoPedido);
        return t > 0 && now - t > FIEL_SUMIDO_DIAS * DAY;
      });
    case 'interessado': {
      const alvos = new Set(
        (contexto?.telefonesInteressados || [])
          .map(normalizeCampaignPhone)
          .filter(Boolean),
      );
      if (alvos.size === 0) return [];
      return withPhone.filter(c => alvos.has(normalizeCampaignPhone(c.celular)));
    }
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
