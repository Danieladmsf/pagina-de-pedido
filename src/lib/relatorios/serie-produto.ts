/**
 * A curva de UM produto no tempo — "a semana que eu vendi mais coxinha".
 *
 * O ranking responde "quanto saiu no período". Esta é a outra pergunta: QUANDO
 * saiu. Por isso a série é por produto, e a granularidade é escolhida (dia,
 * semana ou mês) em vez de fixa: a mesma coxinha pede dia numa semana cheia e
 * mês num ano inteiro.
 *
 * Duas decisões herdadas do balancete, pelo mesmo motivo:
 *
 * 1. Período sem venda aparece com zero. A semana em que a coxinha não saiu é
 *    justamente o que ela quer enxergar.
 * 2. A série não começa antes da primeira venda DO PRODUTO, e o período
 *    corrente vem marcado como `emAndamento` — a semana que está no terceiro
 *    dia não pode ser comparada de igual para igual com as que fecharam.
 *
 * Semana começa na SEGUNDA: é como a loja fala ("essa semana"), e fechar no
 * domingo mantém o fim de semana — o pico de uma confeitaria — inteiro dentro
 * do mesmo balde.
 *
 * Função pura, sem Firestore e sem React.
 */

import { emDinheiro } from '@/lib/dinheiro';
import type { JanelaDoRelatorio } from './periodo';
import { chaveDoItem } from './ranking';
import type { VendaDoRelatorio } from './venda';
import { vendasNaJanela } from './venda';

export type Granularidade = 'dia' | 'semana' | 'mes';

export const GRANULARIDADES: { id: Granularidade; label: string; singular: string }[] = [
  { id: 'dia', label: 'Por dia', singular: 'dia' },
  { id: 'semana', label: 'Por semana', singular: 'semana' },
  { id: 'mes', label: 'Por mês', singular: 'mês' },
];

export type PontoDaSerie = {
  chave: string;
  /** Curto, para o eixo do gráfico. */
  rotulo: string;
  /** Por extenso, para o destaque e o tooltip. */
  rotuloLongo: string;
  inicio: Date;
  quantidade: number;
  gramas: number;
  valor: number;
  vendas: number;
  emAndamento: boolean;
};

export type SerieDoProduto = {
  pontos: PontoDaSerie[];
  /** O período em que mais saiu (entre os que tiveram venda). */
  melhor: PontoDaSerie | null;
  granularidade: Granularidade;
  totalQuantidade: number;
  totalGramas: number;
  totalValor: number;
  totalVendas: number;
  porPeso: boolean;
};

const DIA = 24 * 60 * 60 * 1000;

function inicioDoBalde(data: Date, granularidade: Granularidade): Date {
  if (granularidade === 'mes') return new Date(data.getFullYear(), data.getMonth(), 1);

  const x = new Date(data);
  x.setHours(0, 0, 0, 0);
  if (granularidade === 'semana') {
    // getDay(): 0 = domingo. Recuar até a segunda-feira.
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  }
  return x;
}

function proximoBalde(inicio: Date, granularidade: Granularidade): Date {
  const x = new Date(inicio);
  if (granularidade === 'mes') x.setMonth(x.getMonth() + 1);
  else if (granularidade === 'semana') x.setDate(x.getDate() + 7);
  else x.setDate(x.getDate() + 1);
  return x;
}

const ddmm = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

function chaveDoBalde(inicio: Date, granularidade: Granularidade): string {
  const ano = inicio.getFullYear();
  const mes = String(inicio.getMonth() + 1).padStart(2, '0');
  if (granularidade === 'mes') return `${ano}-${mes}`;
  return `${ano}-${mes}-${String(inicio.getDate()).padStart(2, '0')}`;
}

function rotulosDoBalde(inicio: Date, granularidade: Granularidade): { curto: string; longo: string } {
  if (granularidade === 'mes') {
    return {
      curto: inicio
        .toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
        .replace('.', '')
        .replace(' de ', '/'),
      longo: inicio.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
    };
  }
  if (granularidade === 'semana') {
    const fim = new Date(inicio.getTime() + 6 * DIA);
    return { curto: ddmm(inicio), longo: `semana de ${ddmm(inicio)} a ${ddmm(fim)}` };
  }
  return {
    curto: ddmm(inicio),
    longo: inicio.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }),
  };
}

/**
 * Granularidade que faz sentido para o tamanho da janela.
 *
 * Um mês em barras diárias ainda se lê; um ano, não. E a pergunta que motivou a
 * tela é semanal, então a semana é o meio-termo padrão assim que o período
 * passa de três semanas.
 */
export function granularidadeSugerida(janela: JanelaDoRelatorio, agora: Date = new Date()): Granularidade {
  const fim = janela.fim && janela.fim < agora ? janela.fim : agora;
  if (!janela.inicio) return 'mes';
  const dias = (fim.getTime() - janela.inicio.getTime()) / DIA;
  if (dias <= 21) return 'dia';
  if (dias <= 180) return 'semana';
  return 'mes';
}

export function serieDoProduto(
  vendas: VendaDoRelatorio[] | null | undefined,
  opcoes: {
    /** A mesma chave que o ranking usou para agrupar a linha. */
    chave: string;
    janela: JanelaDoRelatorio;
    granularidade: Granularidade;
    agora?: Date;
  },
): SerieDoProduto {
  const { chave, janela, granularidade } = opcoes;
  const agora = opcoes.agora || new Date();

  const acumulado = new Map<string, { quantidade: number; gramas: number; valor: number; vendas: number }>();
  let primeira: Date | null = null;
  let ultima: Date | null = null;
  let porPeso = false;

  for (const { venda, data } of vendasNaJanela(vendas, janela)) {
    let apareceu = false;
    for (const item of Array.isArray(venda.items) ? venda.items : []) {
      if (chaveDoItem(item) !== chave) continue;

      const inicio = inicioDoBalde(data, granularidade);
      const k = chaveDoBalde(inicio, granularidade);
      const atual = acumulado.get(k) || { quantidade: 0, gramas: 0, valor: 0, vendas: 0 };
      atual.quantidade += Number(item?.quantity) || 0;
      atual.gramas += Number(item?.weightGrams) || 0;
      atual.valor += (Number(item?.unitPrice) || 0) * (Number(item?.quantity) || 0);
      acumulado.set(k, atual);

      porPeso = porPeso || item?.saleUnit === 'kg' || (Number(item?.weightGrams) || 0) > 0;
      apareceu = true;
    }

    if (!apareceu) continue;
    // Uma venda com o produto repetido em duas linhas continua sendo uma venda.
    const k = chaveDoBalde(inicioDoBalde(data, granularidade), granularidade);
    acumulado.get(k)!.vendas += 1;
    if (!primeira || data < primeira) primeira = data;
    if (!ultima || data > ultima) ultima = data;
  }

  if (!primeira) {
    return {
      pontos: [],
      melhor: null,
      granularidade,
      totalQuantidade: 0,
      totalGramas: 0,
      totalValor: 0,
      totalVendas: 0,
      porPeso: false,
    };
  }

  // A série vai da primeira venda do produto até o balde de hoje (ou até o fim
  // da janela, quando ela termina no passado). Antes da primeira venda seriam
  // colunas vazias de um tempo em que o produto nem existia.
  const limite = janela.fim && janela.fim.getTime() - 1 < agora.getTime() ? new Date(janela.fim.getTime() - 1) : agora;
  const fim = inicioDoBalde(limite < (ultima as Date) ? (ultima as Date) : limite, granularidade);
  const baldeDeAgora = chaveDoBalde(inicioDoBalde(agora, granularidade), granularidade);

  const pontos: PontoDaSerie[] = [];
  let cursor = inicioDoBalde(primeira, granularidade);

  while (cursor <= fim) {
    const k = chaveDoBalde(cursor, granularidade);
    const dados = acumulado.get(k) || { quantidade: 0, gramas: 0, valor: 0, vendas: 0 };
    const { curto, longo } = rotulosDoBalde(cursor, granularidade);
    pontos.push({
      chave: k,
      rotulo: curto,
      rotuloLongo: longo,
      inicio: new Date(cursor),
      quantidade: dados.quantidade,
      gramas: dados.gramas,
      valor: emDinheiro(dados.valor),
      vendas: dados.vendas,
      emAndamento: k === baldeDeAgora,
    });
    cursor = proximoBalde(cursor, granularidade);
  }

  const comVenda = pontos.filter((p) => p.quantidade > 0);
  const referencia = (p: PontoDaSerie) => (porPeso ? p.gramas : p.quantidade);

  return {
    pontos,
    // Entre empates fica o mais recente: é a leitura útil ("voltou a vender").
    melhor: comVenda.length ? comVenda.reduce((a, b) => (referencia(b) >= referencia(a) ? b : a)) : null,
    granularidade,
    totalQuantidade: pontos.reduce((s, p) => s + p.quantidade, 0),
    totalGramas: pontos.reduce((s, p) => s + p.gramas, 0),
    totalValor: emDinheiro(pontos.reduce((s, p) => s + p.valor, 0)),
    totalVendas: pontos.reduce((s, p) => s + p.vendas, 0),
    porPeso,
  };
}
