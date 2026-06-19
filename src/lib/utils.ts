import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
export function removeAccents(str: string): string {
  if (!str) return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Normaliza texto para busca: remove acentos e ignora mai\u00fasculas/min\u00fasculas.
// Ex.: normalizeSearch('\u00c1gua') === normalizeSearch('agua') === 'agua'
export function normalizeSearch(str: string | null | undefined): string {
  return removeAccents(String(str ?? '')).toLowerCase();
}

// Abreviações de logradouro/bairro que o cliente e o atendente digitam.
const NEIGHBORHOOD_ABBR: Record<string, string> = {
  jd: 'jardim', jardin: 'jardim', pq: 'parque', vl: 'vila',
  res: 'residencial', resid: 'residencial', cj: 'conjunto', conj: 'conjunto',
  cjto: 'conjunto', cond: 'condominio', hab: 'habitacional',
};

// Normaliza um nome de bairro para CASAR/FILTRAR: remove acento+caixa (normalizeSearch)
// e expande abreviações token a token (jd->jardim, pq->parque...). Usado tanto no match
// da taxa (api/delivery-fee) quanto nos dropdowns de sugestão, pra ficarem idênticos.
// Ex.: normalizeNeighborhood('Jd Primavera') === normalizeNeighborhood('Jardim Primavera').
export function normalizeNeighborhood(str: string | null | undefined): string {
  return normalizeSearch(str)
    .split(/[^a-z0-9]+/)
    .map((w) => NEIGHBORHOOD_ABBR[w] || w)
    .join(' ')
    .trim();
}

// Tokens normalizados (acento+abreviação) de um nome de bairro/endereço.
const nbTokens = (s: string | null | undefined): string[] =>
  normalizeNeighborhood(s).split(' ').filter(Boolean);

// Filtro do dropdown de sugestões: cada palavra digitada precisa casar (como
// substring) com alguma palavra do bairro — independente de ordem e de palavras
// puladas. Ex.: "cj joao ber" acha "Conjunto Habitacional João Berbel".
export function neighborhoodMatchesQuery(
  keyword: string | null | undefined,
  query: string | null | undefined
): boolean {
  const q = nbTokens(query);
  if (q.length === 0) return true;
  const kw = nbTokens(keyword);
  return q.every((qt) => kw.some((kt) => kt.includes(qt)));
}

// Distância de Levenshtein (tolerância a erro de grafia na detecção de bairro).
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// Palavras genéricas/numerais que não contam como token distintivo do bairro.
const NB_STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii']);

// Detecta, com ALTA precisão, qual bairro cadastrado aparece no texto do endereço,
// em qualquer posição. Exige TODOS os tokens distintivos do bairro presentes (exato
// ou fuzzy p/ erro de grafia). Mais específico vence; empate entre bairros diferentes
// => '' (deixa vazio p/ o usuário escolher). Retorna o keyword cadastrado ou ''.
export function detectNeighborhood(
  address: string | null | undefined,
  keywords: string[],
  cityNames: string[] = []
): string {
  if (!address || !Array.isArray(keywords) || keywords.length === 0) return '';
  const addr = nbTokens(address);
  // Remove a ÚLTIMA ocorrência de cada token de cidade (não confundir cidade com
  // bairro, mas preservar nomes como "Nova Cravinhos").
  for (const city of cityNames) {
    for (const ct of nbTokens(city)) {
      const i = addr.lastIndexOf(ct);
      if (i >= 0) addr.splice(i, 1);
    }
  }
  const tokenIn = (bt: string): boolean =>
    addr.some((at) => at === bt || (bt.length >= 4 && at.length >= 4 && 1 - levenshtein(bt, at) / Math.max(bt.length, at.length) >= 0.8));

  let best: { keyword: string; n: number } | null = null;
  let tie = false;
  for (const keyword of keywords) {
    if (!keyword) continue;
    const bt = nbTokens(keyword).filter((t) => !NB_STOP.has(t));
    if (bt.length === 0) continue;
    if (!bt.every(tokenIn)) continue;
    if (!best || bt.length > best.n) { best = { keyword, n: bt.length }; tie = false; }
    else if (bt.length === best.n && keyword !== best.keyword) { tie = true; }
  }
  return best && !tie ? best.keyword : '';
}
