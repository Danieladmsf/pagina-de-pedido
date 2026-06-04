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
