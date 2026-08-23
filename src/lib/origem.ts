/**
 * De onde a pessoa veio.
 *
 * O cardápio é o mesmo para todo mundo; o que muda é o endereço que a loja
 * espalhou. Cada link que sai da tela de links pode levar uma marca de origem
 * (`?via=instagram`), e é ela que transforma "441 visitas" em "o Instagram
 * trouxe 120 pessoas e o panfleto trouxe 4".
 *
 * O que a origem NÃO é: identidade. Ela diz por onde a pessoa entrou, nunca
 * quem é — isso continua vindo só de quem se apresenta (ver `contato-link.ts`).
 *
 * Formato: `canal` ou `canal-campanha` (`instagram`, `instagram-bio`,
 * `instagram-post-dia-das-maes`). O canal é uma lista fechada porque é por ele
 * que a loja soma; a campanha é livre porque só a dona sabe o nome do post que
 * ela fez. Normalizar na entrada é o que evita "Teste 1" e "teste1" virarem
 * duas origens diferentes na tabela.
 *
 * Arquivo puro de propósito (sem Firestore, sem React): roda no cardápio, na
 * tela do dono e nos testes.
 */

/** Parâmetro que carrega a origem. Curto porque o cliente vê o link inteiro. */
export const ORIGEM_PARAM = 'via';

/** Tamanho máximo gravado — a regra do Firestore valida o mesmo limite. */
export const ORIGEM_TAMANHO_MAX = 40;

export type CanalOrigem =
  | 'instagram'
  | 'facebook'
  | 'whatsapp'
  | 'google'
  | 'tiktok'
  | 'site'
  | 'panfleto'
  | 'embalagem'
  | 'qr'
  | 'indicacao';

/**
 * Os canais que a loja escolhe na tela de links. `embalagem` e `qr` existem
 * porque o mesmo mecanismo cobre papel: QR na caixa do bolo mede recompra sem
 * depender de rede social nenhuma.
 */
export const CANAIS: CanalOrigem[] = [
  'instagram',
  'facebook',
  'whatsapp',
  'google',
  'tiktok',
  'site',
  'panfleto',
  'embalagem',
  'qr',
  'indicacao',
];

export const CANAL_LABEL: Record<CanalOrigem, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  google: 'Google',
  tiktok: 'TikTok',
  site: 'Site',
  panfleto: 'Panfleto',
  embalagem: 'Embalagem',
  qr: 'QR Code',
  indicacao: 'Indicação',
};

/** Quem chegou sem marca: link salvo, digitado, favorito, encaminhado. */
export const ORIGEM_DIRETA = 'direto';
export const ORIGEM_DIRETA_LABEL = 'Direto ou sem marca';

/**
 * Deixa o texto no formato que vai para o link e para o banco: minúsculas, sem
 * acento, só letras, números e hífen. É a função que impede a tabela da dona de
 * encher de variações da mesma coisa.
 */
export function normalizarOrigem(valor: string | null | undefined): string {
  return String(valor || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, ORIGEM_TAMANHO_MAX)
    .replace(/-+$/g, '');
}

/** Monta a marca a partir do que a loja escolheu na tela. */
export function montarOrigem(canal: string, campanha?: string | null): string {
  const base = normalizarOrigem(canal);
  if (!base) return '';
  const extra = normalizarOrigem(campanha);
  if (!extra) return base;
  return normalizarOrigem(`${base}-${extra}`);
}

/**
 * O canal por trás da marca. Marca desconhecida (ou inventada por alguém
 * mexendo no link) não vira canal novo: cai como `outro`, e a loja continua
 * somando por canal sem lixo no meio.
 */
export function canalDaOrigem(origem: string | null | undefined): CanalOrigem | 'outro' | '' {
  const limpa = normalizarOrigem(origem);
  if (!limpa) return '';
  const prefixo = limpa.split('-')[0] as CanalOrigem;
  return CANAIS.includes(prefixo) ? prefixo : 'outro';
}

/** A parte livre da marca (o nome do post, do panfleto, do parceiro). */
export function campanhaDaOrigem(origem: string | null | undefined): string {
  const limpa = normalizarOrigem(origem);
  if (!limpa) return '';
  const canal = canalDaOrigem(limpa);
  if (canal === 'outro' || canal === '') return limpa;
  return limpa.slice(canal.length + 1);
}

/** Como a origem aparece para a dona: "Instagram · bio". */
export function rotuloDaOrigem(origem: string | null | undefined): string {
  const limpa = normalizarOrigem(origem);
  if (!limpa) return ORIGEM_DIRETA_LABEL;
  const canal = canalDaOrigem(limpa);
  const campanha = campanhaDaOrigem(limpa).replace(/-/g, ' ');
  const nome = canal === 'outro' || canal === '' ? limpa.replace(/-/g, ' ') : CANAL_LABEL[canal];
  return campanha ? `${nome} · ${campanha}` : nome;
}

/** Lê a marca de um endereço aberto (o cardápio chama com os parâmetros da URL). */
export function extrairOrigem(params: URLSearchParams | null | undefined): string {
  return normalizarOrigem(params?.get(ORIGEM_PARAM));
}

/**
 * Acrescenta a marca a um endereço, respeitando o que já estiver na query
 * (`?pedir=de` continua valendo). Marca vazia devolve o endereço intocado — é
 * assim que o link "sem origem" continua existindo.
 */
export function adicionarOrigem(url: string, origem: string): string {
  const marca = normalizarOrigem(origem);
  if (!url || !marca) return url;
  if (new RegExp(`[?&]${ORIGEM_PARAM}=`).test(url)) return url;
  const [semHash, hash] = url.split('#');
  const separador = semHash.includes('?') ? '&' : '?';
  const marcado = `${semHash}${separador}${ORIGEM_PARAM}=${marca}`;
  return hash ? `${marcado}#${hash}` : marcado;
}

export interface LinhaDeOrigem {
  origem: string;
  rotulo: string;
  canal: CanalOrigem | 'outro' | '';
  pessoas: number;
  olharam: number;
  carrinhos: number;
  pedidos: number;
  /** Pedidos dividido por pessoas, em %. */
  conversao: number;
}

/**
 * Agrupa pessoas por origem para a tela da dona.
 *
 * Conta pela PRIMEIRA origem de cada pessoa, não pela última: quem descobriu a
 * loja no Instagram e voltou pelo link do WhatsApp foi trazido pelo Instagram.
 * Contar pelo último clique faz o WhatsApp levar o crédito de tudo — e a loja
 * desligar justamente a divulgação que está funcionando.
 */
export function agruparPorOrigem<T extends {
  origemPrimeira?: string;
  origemUltima?: string;
  linhaDoTempo?: { tipo: string }[];
  carrinho?: { itens?: unknown[]; valor?: number };
  pedidos?: number;
}>(pessoas: T[]): LinhaDeOrigem[] {
  const mapa = new Map<string, LinhaDeOrigem>();

  for (const p of pessoas) {
    const origem = normalizarOrigem(p.origemPrimeira || p.origemUltima) || ORIGEM_DIRETA;
    let linha = mapa.get(origem);
    if (!linha) {
      linha = {
        origem,
        rotulo: origem === ORIGEM_DIRETA ? ORIGEM_DIRETA_LABEL : rotuloDaOrigem(origem),
        canal: origem === ORIGEM_DIRETA ? '' : canalDaOrigem(origem),
        pessoas: 0,
        olharam: 0,
        carrinhos: 0,
        pedidos: 0,
        conversao: 0,
      };
      mapa.set(origem, linha);
    }
    linha.pessoas += 1;
    if ((p.linhaDoTempo || []).some((e) => e.tipo === 'viu')) linha.olharam += 1;
    if ((p.carrinho?.itens?.length ?? 0) > 0 && (p.carrinho?.valor ?? 0) > 0) linha.carrinhos += 1;
    if ((p.pedidos ?? 0) > 0) linha.pedidos += 1;
  }

  return [...mapa.values()]
    .map((linha) => ({
      ...linha,
      conversao: linha.pessoas > 0 ? Math.round((linha.pedidos / linha.pessoas) * 100) : 0,
    }))
    .sort((a, b) => b.pedidos - a.pedidos || b.pessoas - a.pessoas);
}
