/**
 * Três perguntas que o movimento do cardápio responde e que não são sobre
 * divulgação — são sobre o que a loja faz na segunda-feira de manhã:
 *
 * 1. **O que estão procurando e não existe?** Busca sem resultado é pedido de
 *    produto com as palavras do cliente. Vinte pessoas procurando "brigadeiro"
 *    numa confeitaria que não cadastrou brigadeiro é decisão de cardápio, não
 *    de marketing.
 * 2. **Quantos bateram na porta fechada?** Visita fora do horário é demanda que
 *    a loja nunca viu. Com hora e dia, vira decisão de escala.
 * 3. **Quanto vale cada carrinho parado?** A fila de "para chamar agora" já
 *    existe; o que faltava era saber onde está o dinheiro dela — ligar para
 *    quem deixou R$ 120 na sacola não é a mesma coisa que ligar para quem
 *    deixou R$ 12.
 *
 * Puro de propósito (sem Firestore, sem React).
 */

import { getStoreOpenState } from './whatsapp-messages';
import { paraMillis, type Visitante } from './visitantes';

// ── 1. Procuraram e não acharam ────────────────────────────────────────────

export interface BuscaSemResultado {
  termo: string;
  /** Quantas pessoas diferentes procuraram isso. */
  pessoas: number;
  /** Quantas vezes ao todo (a mesma pessoa pode ter insistido). */
  vezes: number;
}

/**
 * Agrupa por termo, contando GENTE e não digitação: a mesma pessoa tentando
 * "brigadeiro" quatro vezes é uma pessoa querendo brigadeiro, não quatro.
 */
export function buscasSemResultado(visitantes: Visitante[]): BuscaSemResultado[] {
  const mapa = new Map<string, BuscaSemResultado & { _pessoas: Set<string> }>();

  for (const v of visitantes) {
    for (const evento of v.linhaDoTempo || []) {
      if (evento.tipo !== 'busca') continue;
      const termo = String(evento.termo || '').trim().toLowerCase();
      if (!termo) continue;

      let linha = mapa.get(termo);
      if (!linha) {
        linha = { termo, pessoas: 0, vezes: 0, _pessoas: new Set() };
        mapa.set(termo, linha);
      }
      linha.vezes += 1;
      linha._pessoas.add(v.id);
    }
  }

  return [...mapa.values()]
    .map(({ _pessoas, ...linha }) => ({ ...linha, pessoas: _pessoas.size }))
    .sort((a, b) => b.pessoas - a.pessoas || b.vezes - a.vezes || a.termo.localeCompare(b.termo));
}

// ── 2. Bateram na porta fechada ────────────────────────────────────────────

export interface VisitaComHora {
  at?: unknown;
  visitorId?: string;
}

export interface PortaFechada {
  /** Visitas que aconteceram fora do horário de funcionamento. */
  visitas: number;
  /** Quanto isso representa do movimento do período, em %. */
  fatia: number;
  /** As horas com mais gente batendo na porta fechada, da maior para a menor. */
  horas: { hora: number; visitas: number }[];
  /** Os dias da semana com mais gente (0 = domingo). */
  dias: { dia: number; visitas: number }[];
}

const NOME_DO_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function nomeDoDia(dia: number): string {
  return NOME_DO_DIA[dia] ?? '';
}

/**
 * Quantas visitas caíram com a loja fechada.
 *
 * Usa o horário de funcionamento de HOJE para julgar o passado — é uma
 * aproximação, e é a honesta: a loja que mudou de horário na semana passada não
 * guarda o horário antigo em lugar nenhum. O caixa fechado é ignorado de
 * propósito (`isCaixaAberto`): senão, consultar a tela fora do expediente
 * carimbaria o dia inteiro como "porta fechada".
 */
export function visitasNaPortaFechada(
  visitas: VisitaComHora[],
  storeProfile: any,
): PortaFechada {
  const horarioApenas = {
    workingHours: storeProfile?.workingHours,
    plannedClosures: storeProfile?.plannedClosures,
    general: { timezone: storeProfile?.general?.timezone },
  };
  const fuso = storeProfile?.general?.timezone || 'America/Sao_Paulo';

  const porHora = new Map<number, number>();
  const porDia = new Map<number, number>();
  let fechada = 0;
  let total = 0;

  for (const visita of visitas) {
    const ms = paraMillis(visita.at);
    if (ms === null) continue;
    total += 1;

    const quando = new Date(ms);
    if (getStoreOpenState(horarioApenas, quando).isOpen) continue;

    fechada += 1;
    // A hora que interessa é a do relógio da loja, não a do servidor.
    const local = new Date(quando.toLocaleString('en-US', { timeZone: fuso }));
    porHora.set(local.getHours(), (porHora.get(local.getHours()) || 0) + 1);
    porDia.set(local.getDay(), (porDia.get(local.getDay()) || 0) + 1);
  }

  return {
    visitas: fechada,
    fatia: total > 0 ? Math.round((fechada / total) * 100) : 0,
    horas: [...porHora.entries()]
      .map(([hora, visitas]) => ({ hora, visitas }))
      .sort((a, b) => b.visitas - a.visitas || a.hora - b.hora),
    dias: [...porDia.entries()]
      .map(([dia, visitas]) => ({ dia, visitas }))
      .sort((a, b) => b.visitas - a.visitas || a.dia - b.dia),
  };
}

// ── 3. Onde está o dinheiro parado ─────────────────────────────────────────

export interface FaixaDeCarrinho {
  rotulo: string;
  minimo: number;
  pessoas: number;
  valor: number;
}

/** Faixas em reais. A última é aberta para cima. */
const FAIXAS: { rotulo: string; minimo: number; maximo: number }[] = [
  { rotulo: 'até R$ 30', minimo: 0, maximo: 30 },
  { rotulo: 'R$ 30 a R$ 60', minimo: 30, maximo: 60 },
  { rotulo: 'R$ 60 a R$ 120', minimo: 60, maximo: 120 },
  { rotulo: 'acima de R$ 120', minimo: 120, maximo: Infinity },
];

/**
 * Divide os carrinhos parados por valor, da faixa mais alta para a mais baixa —
 * a ordem em que vale a pena ligar. Só entra quem tem sacola de verdade
 * (itens E valor), a mesma regra do resto da tela.
 */
export function faixasDeCarrinhoParado(visitantes: Visitante[]): FaixaDeCarrinho[] {
  const contagem = FAIXAS.map((faixa) => ({ ...faixa, pessoas: 0, valor: 0 }));

  for (const v of visitantes) {
    const itens = v.carrinho?.itens?.length ?? 0;
    const valor = v.carrinho?.valor ?? 0;
    if (itens === 0 || valor <= 0) continue;

    const faixa = contagem.find((f) => valor >= f.minimo && valor < f.maximo);
    if (!faixa) continue;
    faixa.pessoas += 1;
    faixa.valor += valor;
  }

  return contagem
    .filter((faixa) => faixa.pessoas > 0)
    .map(({ maximo, ...faixa }) => ({ ...faixa, valor: Math.round(faixa.valor * 100) / 100 }))
    .sort((a, b) => b.minimo - a.minimo);
}
