// "Links de pedido" = os endereços que a loja espalha por aí (mensagem
// automática do WhatsApp, campanha, bio do Instagram, panfleto).
//
// A combinação de opções mora DENTRO do link (?pedir=de), não numa config
// global. Isso é o que permite a loja ter vários links no ar ao mesmo tempo:
// no WhatsApp ela manda o link sem o card "Falar no WhatsApp" (o cliente já
// está falando com ela); no Instagram manda o link com os três.
//
// O store_profile guarda só UMA coisa: qual variante entra no {link} das
// mensagens automáticas. O resto o dono copia e cola onde quiser.
//
// Quem monta o endereço é o buildStoreLink (lib/whatsapp-messages), que chama o
// buildOrderLinkPath daqui — assim os 4 pontos que emitem {link} (webhook, PDV,
// campanhas e a prévia do admin) mudam juntos, sem cópia de regra.

export type OrderLinkCardId = 'menu' | 'encomendas' | 'whatsapp';

// Marca que o cardápio lê pra abrir a tela de escolha, e que carrega QUAIS
// opções mostrar. Só quem entra PELO link enviado pela loja recebe o parâmetro
// — quem já tem o app salvo continua caindo direto no cardápio.
export const ORDER_LINK_PARAM = 'pedir';

// Ordem em que os cards aparecem: primeiro o caminho que a loja quer que o
// cliente use, depois a encomenda e por último o atendimento humano.
export const ORDER_LINK_CARD_ORDER: OrderLinkCardId[] = ['menu', 'encomendas', 'whatsapp'];

// Titulo de cada card. Fonte unica: o cliente e o dono (na tela de links) tem
// que ler exatamente o mesmo nome.
export const ORDER_LINK_CARD_LABELS: Record<OrderLinkCardId, string> = {
  menu: 'Delivery',
  encomendas: 'Encomendas',
  whatsapp: 'Falar no WhatsApp',
};

// Versão curta, para compor o nome da variante ("Delivery + Encomendas").
export const ORDER_LINK_CARD_SHORT: Record<OrderLinkCardId, string> = {
  menu: 'Delivery',
  encomendas: 'Encomendas',
  whatsapp: 'WhatsApp',
};

const CARD_TO_CODE: Record<OrderLinkCardId, string> = { menu: 'd', encomendas: 'e', whatsapp: 'w' };
const CODE_TO_CARD: Record<string, OrderLinkCardId> = { d: 'menu', e: 'encomendas', w: 'whatsapp' };

// Variante padrão = cardápio direto, que é como o link sempre funcionou.
export const DEFAULT_VARIANT_CODE = 'd';

export function cardsToCode(cards: OrderLinkCardId[]): string {
  return ORDER_LINK_CARD_ORDER.filter((id) => cards.includes(id)).map((id) => CARD_TO_CODE[id]).join('');
}

export function codeToCards(code: string): OrderLinkCardId[] {
  const letters = new Set(String(code || '').toLowerCase().split(''));
  return ORDER_LINK_CARD_ORDER.filter((id) => letters.has(CARD_TO_CODE[id]));
}

// ── Elegibilidade: o que esta loja tem como oferecer ────────────────────────

// A modalidade fica no NÍVEL RAIZ do store_profile (é o que a AppearanceTab
// grava); general.theme é fallback de perfis antigos.
export function getStoreTheme(storeProfile: any): string {
  return storeProfile?.theme || storeProfile?.general?.theme || 'padrao';
}

// Encomendas só existem na modalidade confeitaria — é o "else" que esconde
// tanto o card do cliente quanto as variantes que o incluem.
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

export function isCardAvailable(id: OrderLinkCardId, storeProfile: any): boolean {
  if (id === 'encomendas') return storeHasEncomendas(storeProfile);
  if (id === 'whatsapp') return Boolean(storeWhatsappDigits(storeProfile));
  return true;
}

// ── Catálogo de variantes ───────────────────────────────────────────────────

export interface OrderLinkVariant {
  code: string;
  cards: OrderLinkCardId[];
  title: string;
  /** O que acontece quando o cliente toca. */
  opens: string;
  /** Onde faz sentido colar este link — a parte didática. */
  goodFor: string;
}

// Todas as combinações úteis. "Falar no WhatsApp" nunca aparece sozinho: um
// link de pedidos que só manda pro WhatsApp seria só um wa.me com passo a mais.
const VARIANT_SPECS: { cards: OrderLinkCardId[]; opens: string; goodFor: string }[] = [
  {
    cards: ['menu'],
    opens: 'Abre o cardápio direto, sem perguntar nada.',
    goodFor: 'O padrão. Use quando a loja só recebe pedido pelo cardápio.',
  },
  {
    cards: ['encomendas'],
    opens: 'Abre a página de encomendas direto.',
    goodFor: 'Divulgar só a agenda de encomendas, sem passar pelo cardápio.',
  },
  {
    cards: ['menu', 'encomendas'],
    opens: 'Pergunta ao cliente entre delivery e encomenda.',
    goodFor: 'Mensagens e campanhas do WhatsApp — o cliente já está falando com você, então não faz sentido oferecer o WhatsApp de novo.',
  },
  {
    cards: ['menu', 'whatsapp'],
    opens: 'Pergunta ao cliente entre delivery e falar no WhatsApp.',
    goodFor: 'Instagram, Google e panfleto, quando a loja não faz encomenda.',
  },
  {
    cards: ['encomendas', 'whatsapp'],
    opens: 'Pergunta ao cliente entre encomenda e falar no WhatsApp.',
    goodFor: 'Divulgar encomendas fora do WhatsApp, deixando o atendimento à mão.',
  },
  {
    cards: ['menu', 'encomendas', 'whatsapp'],
    opens: 'Pergunta ao cliente entre as três opções.',
    goodFor: 'Bio do Instagram, Google e panfleto — um link só que resolve tudo.',
  },
];

export const ORDER_LINK_VARIANTS: OrderLinkVariant[] = VARIANT_SPECS.map((spec) => ({
  ...spec,
  code: cardsToCode(spec.cards),
  title: spec.cards.map((id) => ORDER_LINK_CARD_SHORT[id]).join(' + '),
}));

export function getVariantByCode(code: string): OrderLinkVariant | undefined {
  const normalized = cardsToCode(codeToCards(code));
  return ORDER_LINK_VARIANTS.find((variant) => variant.code === normalized);
}

// Variantes que esta loja consegue oferecer de verdade.
export function getAvailableVariants(storeProfile: any): OrderLinkVariant[] {
  return ORDER_LINK_VARIANTS.filter((variant) => variant.cards.every((id) => isCardAvailable(id, storeProfile)));
}

// ── Variante usada nas mensagens automáticas ────────────────────────────────

export function getMessageVariantCode(storeProfile: any): string {
  const saved = storeProfile?.orderLink || {};

  // Formato atual.
  let code: string = typeof saved.messageVariant === 'string' ? saved.messageVariant : '';

  // Compatibilidade com o primeiro formato ({ mode, cards }), de antes das
  // variantes existirem.
  if (!code && saved.mode) {
    if (saved.mode === 'encomendas') code = 'e';
    else if (saved.mode === 'choice') {
      code = cardsToCode(ORDER_LINK_CARD_ORDER.filter((id) => saved.cards?.[id] !== false));
    } else code = 'd';
  }

  const cards = codeToCards(code).filter((id) => isCardAvailable(id, storeProfile));

  // Sobrou só o WhatsApp (ou nada)? Vira cardápio direto: um link de pedidos
  // precisa levar a algum lugar dentro da loja.
  if (cards.length === 0 || (cards.length === 1 && cards[0] === 'whatsapp')) return DEFAULT_VARIANT_CODE;
  return cardsToCode(cards);
}

// ── Montagem do endereço ────────────────────────────────────────────────────

// `basePath` é o caminho da loja já montado ("/minha-loja-a1b2").
// Uma opção só não é escolha nenhuma: o link vai direto ao destino, sem tela.
export function buildOrderLinkPathForCode(basePath: string, code: string, storeProfile: any): string {
  const cards = codeToCards(code).filter((id) => isCardAvailable(id, storeProfile));

  if (cards.length >= 2) return `${basePath}?${ORDER_LINK_PARAM}=${cardsToCode(cards)}`;
  if (cards.length === 1 && cards[0] === 'encomendas') return `${basePath}/encomendas`;
  return basePath;
}

export function buildOrderLinkPath(basePath: string, storeProfile: any): string {
  return buildOrderLinkPathForCode(basePath, getMessageVariantCode(storeProfile), storeProfile);
}

// Cards que a tela de escolha deve mostrar para um endereço já aberto. Menos de
// dois = não abre tela nenhuma (o cliente vê o cardápio, como sempre).
export function resolveCardsFromParam(param: string | null | undefined, storeProfile: any): OrderLinkCardId[] {
  if (!param) return [];

  // "1" era o formato da primeira versão (todas as opções disponíveis).
  const code = param === '1' ? cardsToCode(ORDER_LINK_CARD_ORDER) : param;
  const cards = codeToCards(code).filter((id) => isCardAvailable(id, storeProfile));
  return cards.length >= 2 ? cards : [];
}

// ── Pedido de contato: o link que pergunta quem é quem ──────────────────────
//
// Nenhum site lê o telefone de quem abre a página. O que existe é a pessoa
// PEDIR o cardápio pelo WhatsApp: a mensagem sai do aparelho dela com o código
// da visita, e é assim que a loja fica sabendo o número — com consentimento, e
// confirmado (melhor que a marca do link, que é só provável).
//
// Fica no link, e não numa configuração da loja, pela mesma razão que a
// combinação de cards: a loja tem vários links no ar ao mesmo tempo. O link do
// Instagram pode pedir contato; o que ela manda para quem já é cliente, não.
export const IDENT_PARAM = 'ident';

export function adicionarPedidoDeContato(url: string, pedir: boolean): string {
  if (!url || !pedir) return url;
  if (new RegExp(`[?&]${IDENT_PARAM}=`).test(url)) return url;
  const [semHash, hash] = url.split('#');
  const marcado = `${semHash}${semHash.includes('?') ? '&' : '?'}${IDENT_PARAM}=1`;
  return hash ? `${marcado}#${hash}` : marcado;
}

export function pedeContato(params: URLSearchParams | null | undefined): boolean {
  return params?.get(IDENT_PARAM) === '1';
}

// Os cards do link SEM o corte de dois: quando o link pede contato, a tela
// aparece mesmo com uma opção só — é ela que leva ao WhatsApp.
export function cardsDoParam(param: string | null | undefined, storeProfile: any): OrderLinkCardId[] {
  if (!param) return [];
  const code = param === '1' ? cardsToCode(ORDER_LINK_CARD_ORDER) : param;
  return codeToCards(code).filter((id) => isCardAvailable(id, storeProfile));
}
