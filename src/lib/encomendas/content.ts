// Conteúdo editável da página de encomendas (textos + fotos da LANDING).
// Persistido em store_profiles.{uid}.encomendas.content pelo editor visual.
// Quando ausente, a página usa estes DEFAULTS. O catálogo de PRODUTOS (wizard)
// é uma etapa seguinte (ver catalog.ts).

export interface EncomendaContent {
  logoUrl: string;         // logo específica da página (senão usa general.logoUrl)
  subtitleLabel: string;   // sublabel do cabeçalho ("Confeitaria artesanal")
  heroBadge: string;       // "Encomendas online"
  heroTitle: string;       // título do hero
  heroEmphasis: string;    // palavra do título destacada (itálico + cor primária)
  heroSubtitle: string;
  ctaLabel: string;        // rótulo do botão principal
  heroImageUrl: string;    // foto real do hero (se vazio, usa o grid de emojis)
  whatTitle: string;       // título da seção "O que fazemos"
  aboutTitle: string;      // título da seção "Sobre"
  aboutText: string;
  ctaTitle: string;        // título da faixa final
  ctaSubtitle: string;     // aceita {sinal} → substituído pelo % configurado
}

export const DEFAULT_CONTENT: EncomendaContent = {
  logoUrl: '',
  subtitleLabel: 'Confeitaria artesanal',
  heroBadge: 'Encomendas online',
  heroTitle: 'Doces que emocionam em cada fatia.',
  heroEmphasis: 'emocionam',
  heroSubtitle: 'Bolos, tortas e docinhos artesanais, montados sob encomenda e entregues na data que você escolher. Tudo em um único pedido.',
  ctaLabel: 'Montar meu pedido',
  heroImageUrl: '',
  whatTitle: 'Uma mesa de doces inteira, em um só pedido.',
  aboutTitle: 'Da nossa cozinha para o seu momento.',
  aboutText: 'Nascemos do amor por receitas de família e do prazer de criar momentos doces. Cada bolo é único, feito com massas leves, recheios cremosos e um cuidado que se sente em cada fatia.',
  ctaTitle: 'Pronto para encomendar?',
  ctaSubtitle: 'Monte seu pedido em poucos passos. Pagamento por PIX com {sinal}% de entrada e confirmação no WhatsApp.',
};

export function mergeContent(partial: any): EncomendaContent {
  return { ...DEFAULT_CONTENT, ...(partial || {}) };
}
