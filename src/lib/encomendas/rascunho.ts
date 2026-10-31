// Rascunho da tela de configuração de Encomendas: TODOS os campos editáveis num
// objeto só, lidos do perfil da loja (store_profiles/{uid}.encomendas) e gravados
// de uma vez. Funções puras — a tela só segura o estado e chama estas.
//
// Regra de ouro da gravação: campo que a dona não mexeu NÃO é regravado. Senão os
// defaults (ex.: o 30% de sinal, a chave PIX emprestada do cartão) virariam dado
// salvo sem ninguém ter pedido.

import { buildEncomendaConfig } from './config';
import { type EncomendaContent, mergeContent } from './content';
import { type EncomendaCatalog, type LinkedProduct, applyProductLinks, mergeCatalog } from './catalog';
import { type DayHours, mergeWeekHours } from './schedule';

export interface RascunhoEncomendas {
  enabled: boolean;
  showInApp: boolean;
  pickupOnly: boolean;
  sinalPercent: number;
  pixKey: string;
  minDays: number;
  weekDays: number[];
  scheduleMode: 'text' | 'week' | 'store';
  daysLabel: string;
  hours: string;
  weekHours: DayHours[];
  content: EncomendaContent;
  catalog: EncomendaCatalog;
}

export type Gravacao = Partial<RascunhoEncomendas>;

export type AbaDeEncomendas = 'agenda' | 'produtos' | 'pagamento' | 'pagina';

// Mesmas leituras e defaults da tela antiga (AdminTab + Editor + CatalogEditor).
export function rascunhoDoPerfil(storeProfile: any): RascunhoEncomendas {
  const e = storeProfile?.encomendas || {};
  const c = buildEncomendaConfig(storeProfile);
  // No modo 'week' o daysLabel do config é derivado; o campo de texto livre precisa
  // do valor CRU, senão trocar de modo sobrescreve o que a dona digitou.
  const raw = e.daysLabel;
  return {
    enabled: e.enabled !== false,
    showInApp: e.showInApp === true,
    pickupOnly: e.pickupOnly === true,
    sinalPercent: typeof e.sinalPercent === 'number' ? e.sinalPercent : 30,
    pixKey: e.pixKey || storeProfile?.creditPixKey || '',
    minDays: typeof e.minDays === 'number' ? e.minDays : 3,
    weekDays: Array.isArray(e.weekDays) ? e.weekDays : [],
    scheduleMode: c.scheduleMode,
    daysLabel: typeof raw === 'string' && raw ? raw : (c.scheduleMode === 'text' ? c.daysLabel : 'Terça a Sábado'),
    hours: c.hours,
    // A cópia SALVA, não a derivada: no modo 'store' o config troca o horário pelo da
    // loja, e comparar contra isso esconderia a mudança ao sair desse modo.
    weekHours: mergeWeekHours(e.weekHours),
    content: mergeContent(e.content),
    catalog: mergeCatalog(e.catalog),
  };
}

// Comparação profunda que ignora a ordem das chaves (o Firestore devolve na ordem
// dele) e trata `undefined` como ausente. Com JSON.stringify a barra de salvar
// ficaria presa depois de salvar.
export function igual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => igual(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const oa = a as Record<string, unknown>;
    const ob = b as Record<string, unknown>;
    const chaves = new Set([...Object.keys(oa), ...Object.keys(ob)]);
    for (const k of chaves) {
      if (!igual(oa[k], ob[k])) return false;
    }
    return true;
  }
  // number x number: NaN nunca é igual a si mesmo; aqui tanto faz.
  return false;
}

// Catálogo como vai para o Firestore: sem undefined (o Firestore rejeita; o
// mergeCatalog recompõe os defaults na leitura) e sem horários de entrega vazios.
function catalogoLimpo(cat: EncomendaCatalog, menuProducts: LinkedProduct[]): EncomendaCatalog {
  const limpo = JSON.parse(JSON.stringify(applyProductLinks(cat, menuProducts))) as EncomendaCatalog;
  limpo.deliveryTimes = (limpo.deliveryTimes || []).filter((t) => typeof t === 'string' && t.trim() !== '');
  return limpo;
}

const CAMPOS: (keyof RascunhoEncomendas)[] = [
  'enabled', 'showInApp', 'pickupOnly', 'sinalPercent', 'pixKey', 'minDays', 'weekDays',
  'scheduleMode', 'daysLabel', 'hours', 'weekHours', 'content', 'catalog',
];

// Devolve SÓ o que mudou em relação ao salvo, já normalizado para gravar.
export function montarGravacao(atual: RascunhoEncomendas, salvo: RascunhoEncomendas, menuProducts: LinkedProduct[] = []): Gravacao {
  const out: Record<string, unknown> = {};
  for (const k of CAMPOS) {
    if (igual(atual[k], salvo[k])) continue;
    switch (k) {
      case 'sinalPercent': {
        const v = Math.min(100, Math.max(0, Number(atual.sinalPercent) || 0));
        if (v !== salvo.sinalPercent) out[k] = v;
        break;
      }
      case 'minDays': {
        const v = Math.max(0, Math.floor(Number(atual.minDays) || 0));
        if (v !== salvo.minDays) out[k] = v;
        break;
      }
      case 'catalog': {
        const v = catalogoLimpo(atual.catalog, menuProducts);
        if (!igual(v, salvo.catalog)) out[k] = v;
        break;
      }
      case 'weekHours':
      case 'weekDays':
      case 'content':
        out[k] = JSON.parse(JSON.stringify(atual[k]));
        break;
      default:
        out[k] = atual[k];
    }
  }
  return out as Gravacao;
}

// O rascunho depois de gravar: o que o Firestore vai devolver (catálogo passa pelo
// mergeCatalog), para `igual` dar verdadeiro e a barra de salvar sumir.
export function aposGravar(atual: RascunhoEncomendas, gravacao: Gravacao): RascunhoEncomendas {
  const prox: RascunhoEncomendas = { ...atual, ...gravacao } as RascunhoEncomendas;
  prox.sinalPercent = Math.min(100, Math.max(0, Number(prox.sinalPercent) || 0));
  prox.minDays = Math.max(0, Math.floor(Number(prox.minDays) || 0));
  if (gravacao.catalog) prox.catalog = mergeCatalog(gravacao.catalog);
  else prox.catalog = { ...atual.catalog, deliveryTimes: (atual.catalog.deliveryTimes || []).filter((t) => t.trim() !== '') };
  return prox;
}

// Quais abas têm mudança não salva. `enabled` não pertence a nenhuma aba (mora no cabeçalho).
export function abasComMudanca(atual: RascunhoEncomendas, salvo: RascunhoEncomendas): Record<AbaDeEncomendas, boolean> {
  const diff = (...ks: (keyof RascunhoEncomendas)[]) => ks.some((k) => !igual(atual[k], salvo[k]));
  const semHorarios = (c: EncomendaCatalog) => ({ ...c, deliveryTimes: undefined });
  return {
    agenda: diff('scheduleMode', 'daysLabel', 'hours', 'weekHours', 'minDays', 'weekDays')
      || !igual(atual.catalog.deliveryTimes, salvo.catalog.deliveryTimes),
    produtos: !igual(semHorarios(atual.catalog), semHorarios(salvo.catalog)),
    pagamento: diff('sinalPercent', 'pixKey', 'pickupOnly'),
    pagina: diff('content', 'showInApp'),
  };
}
