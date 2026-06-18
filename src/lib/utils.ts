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
