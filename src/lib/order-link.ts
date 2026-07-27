// "Link de pedidos" = o endereço que a loja manda pro cliente (mensagens
// automáticas do WhatsApp, campanhas, bio do Instagram). Até aqui ele sempre
// abria o cardápio; agora o dono escolhe o destino em Mensagens automáticas.
//
// Quem monta o endereço é o buildStoreLink (lib/whatsapp-messages), que chama o
// buildOrderLinkPath daqui — assim os 4 pontos que emitem {link} (webhook, PDV,
// campanhas e a prévia do admin) mudam juntos, sem cópia de regra.

export type OrderLinkMode = 'menu' | 'choice' | 'encomendas';
export type OrderLinkCardId = 'menu' | 'encomendas' | 'whatsapp';

export interface OrderLinkConfig {
  mode: OrderLinkMode;
  cards: Record<OrderLinkCardId, boolean>;
}

// Marca que o cardápio lê pra abrir a tela de escolha. Só quem entra PELO link
// enviado pela loja recebe o parâmetro — quem já tem o app salvo continua caindo
// direto no cardápio, como sempre foi.
export const ORDER_LINK_PARAM = 'pedir';

export const DEFAULT_ORDER_LINK: OrderLinkConfig = {
  mode: 'menu',
  cards: { menu: true, encomendas: true, whatsapp: true },
};

// Ordem em que os cards aparecem: primeiro o caminho que a loja quer que o
// cliente use (o app), depois a encomenda e por último o atendimento humano.
export const ORDER_LINK_CARD_ORDER: OrderLinkCardId[] = ['menu', 'encomendas', 'whatsapp'];

export const ORDER_LINK_CARD_LABELS: Record<OrderLinkCardId, string> = {
  menu: 'Fazer pedido pelo app',
  encomendas: 'Fazer uma encomenda',
  whatsapp: 'Falar no WhatsApp',
};

export function getOrderLinkConfig(storeProfile: any): OrderLinkConfig {
  const saved = storeProfile?.orderLink || {};
  const mode: OrderLinkMode =
    saved.mode === 'choice' || saved.mode === 'encomendas' ? saved.mode : 'menu';

  return {
    mode,
    cards: {
      menu: saved.cards?.menu !== false,
      encomendas: saved.cards?.encomendas !== false,
      whatsapp: saved.cards?.whatsapp !== false,
    },
  };
}

// A modalidade fica no NÍVEL RAIZ do store_profile (é o que a AppearanceTab
// grava); general.theme é fallback de perfis antigos.
export function getStoreTheme(storeProfile: any): string {
  return storeProfile?.theme || storeProfile?.general?.theme || 'padrao';
}

// Encomendas só existem na modalidade confeitaria — é o "else" que esconde tanto
// o card do cliente quanto a opção no admin.
export function storeHasEncomendas(storeProfile: any): boolean {
  if (getStoreTheme(storeProfile) !== 'confeitaria') return false;
  return storeProfile?.encomendas?.enabled !== false;
}

// Telefone público da loja normalizado pro wa.me (DDI 55 + DDD + número).
export function storeWhatsappDigits(storeProfile: any): string {
  const raw = storeProfile?.general?.whatsapp || storeProfile?.general?.phone || '';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

// Cards marcados pelo dono E que a loja realmente tem como oferecer.
export function getOrderLinkCards(storeProfile: any): OrderLinkCardId[] {
  const { cards } = getOrderLinkConfig(storeProfile);

  return ORDER_LINK_CARD_ORDER.filter((id) => {
    if (!cards[id]) return false;
    if (id === 'encomendas') return storeHasEncomendas(storeProfile);
    if (id === 'whatsapp') return Boolean(storeWhatsappDigits(storeProfile));
    return true;
  });
}

// Destino efetivo do link. Uma tela de escolha com um card só não é escolha
// nenhuma: nesse caso o link volta a abrir o cardápio direto.
export function resolveOrderLink(storeProfile: any): { mode: OrderLinkMode; cards: OrderLinkCardId[] } {
  const { mode } = getOrderLinkConfig(storeProfile);

  if (mode === 'encomendas') {
    return storeHasEncomendas(storeProfile) ? { mode: 'encomendas', cards: [] } : { mode: 'menu', cards: [] };
  }

  if (mode === 'choice') {
    const cards = getOrderLinkCards(storeProfile);
    return cards.length >= 2 ? { mode: 'choice', cards } : { mode: 'menu', cards: [] };
  }

  return { mode: 'menu', cards: [] };
}

// `basePath` é o caminho da loja já montado ("/minha-loja-a1b2").
export function buildOrderLinkPath(basePath: string, storeProfile: any): string {
  const { mode } = resolveOrderLink(storeProfile);
  if (mode === 'encomendas') return `${basePath}/encomendas`;
  if (mode === 'choice') return `${basePath}?${ORDER_LINK_PARAM}=1`;
  return basePath;
}
