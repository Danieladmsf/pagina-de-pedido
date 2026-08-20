/**
 * Balancete mensal: "em junho vendi X, em julho vendi Y".
 *
 * O Dashboard só sabe agrupar por hora ou por dia, então pedir seis meses lá
 * devolve ~180 barrinhas — que é gráfico, mas não é resposta. Aqui a barra é o
 * MÊS, que é como o dono da loja compara período com período.
 *
 * Duas decisões que valem comentário:
 *
 * 1. Mês sem venda nenhuma aparece com zero. Buraco na série é informação
 *    ("parei em janeiro"), e pular o mês mentiria sobre a linha do tempo.
 * 2. A série não começa antes da primeira venda. Uma loja com três meses de
 *    histórico pedindo "12 meses" veria nove colunas vazias que nunca
 *    existiram; ela enche sozinha com o tempo.
 * 3. O mês corrente vem marcado como `emAndamento`. Sem isso, no dia 20 a tela
 *    diz "-6% em relação ao mês passado" comparando 20 dias com 31 — e quem lê
 *    entende que caiu, quando pode estar subindo.
 *
 * Função pura, sem Firestore e sem React.
 */

import { emDinheiro } from '@/lib/dinheiro';
import type { VendaDoRelatorio } from './venda';
import { dataDaVenda, foiCancelada } from './venda';

export type MesDoBalancete = {
  /** 'AAAA-MM' — ordenável como texto. */
  chave: string;
  /** 'jun/26', para o eixo do gráfico. */
  rotulo: string;
  /** 'junho de 2026', para a tabela e o CSV. */
  rotuloLongo: string;
  faturamento: number;
  vendas: number;
  ticketMedio: number;
  /** Variação do faturamento sobre o mês anterior da série (0.12 = +12%). */
  variacao: number | null;
  /** É o mês que ainda está correndo: o número dele não fechou. */
  emAndamento: boolean;
};

export type Balancete = {
  meses: MesDoBalancete[];
  total: number;
  totalVendas: number;
  ticketMedio: number;
  melhor: MesDoBalancete | null;
  pior: MesDoBalancete | null;
  /** Média mensal considerando só os meses da série. */
  mediaMensal: number;
};

const chaveDoMes = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function rotulos(ano: number, mes: number): { curto: string; longo: string } {
  const d = new Date(ano, mes, 1);
  return {
    curto: d
      .toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
      .replace('.', '')
      .replace(' de ', '/'),
    longo: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  };
}

/**
 * @param meses quantos meses de calendário mostrar, contando o atual. `null` =
 *              todo o histórico.
 */
export function balanceteMensal(
  vendas: VendaDoRelatorio[] | null | undefined,
  opcoes: { meses: number | null; agora?: Date } = { meses: 12 },
): Balancete {
  const agora = opcoes.agora || new Date();
  const lista = Array.isArray(vendas) ? vendas : [];

  const porMes = new Map<string, { faturamento: number; vendas: number }>();
  let primeira: Date | null = null;

  for (const venda of lista) {
    if (foiCancelada(venda)) continue;
    const data = dataDaVenda(venda);
    if (!data) continue;
    if (!primeira || data < primeira) primeira = data;

    const chave = chaveDoMes(data);
    const atual = porMes.get(chave) || { faturamento: 0, vendas: 0 };
    atual.faturamento += Number(venda.totalAmount) || 0;
    atual.vendas += 1;
    porMes.set(chave, atual);
  }

  if (!primeira) {
    return { meses: [], total: 0, totalVendas: 0, ticketMedio: 0, melhor: null, pior: null, mediaMensal: 0 };
  }

  const fim = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const inicioPedido =
    opcoes.meses === null
      ? new Date(primeira.getFullYear(), primeira.getMonth(), 1)
      : new Date(agora.getFullYear(), agora.getMonth() - (opcoes.meses - 1), 1);
  const primeiroComVenda = new Date(primeira.getFullYear(), primeira.getMonth(), 1);
  const inicio = inicioPedido > primeiroComVenda ? inicioPedido : primeiroComVenda;

  const meses: MesDoBalancete[] = [];
  const cursor = new Date(inicio);
  let anterior: number | null = null;

  while (cursor <= fim) {
    const chave = chaveDoMes(cursor);
    const dados = porMes.get(chave) || { faturamento: 0, vendas: 0 };
    const faturamento = emDinheiro(dados.faturamento);
    const { curto, longo } = rotulos(cursor.getFullYear(), cursor.getMonth());

    meses.push({
      chave,
      rotulo: curto,
      rotuloLongo: longo,
      faturamento,
      vendas: dados.vendas,
      ticketMedio: dados.vendas > 0 ? emDinheiro(faturamento / dados.vendas) : 0,
      // Sem mês anterior, ou com mês anterior zerado, não existe "cresceu X%":
      // dividir por zero viraria infinito na tela.
      variacao: anterior !== null && anterior > 0 ? (faturamento - anterior) / anterior : null,
      emAndamento: chave === chaveDoMes(agora),
    });

    anterior = faturamento;
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const total = emDinheiro(meses.reduce((soma, m) => soma + m.faturamento, 0));
  const totalVendas = meses.reduce((soma, m) => soma + m.vendas, 0);
  // "Melhor mês" só faz sentido entre meses que existiram de verdade.
  const comVenda = meses.filter((m) => m.vendas > 0);
  // O mês em andamento pode ser o melhor (se já passou todos, passou mesmo),
  // mas não pode ser eleito o PIOR: ele ainda não terminou de acontecer.
  const fechados = comVenda.filter((m) => !m.emAndamento);

  return {
    meses,
    total,
    totalVendas,
    ticketMedio: totalVendas > 0 ? emDinheiro(total / totalVendas) : 0,
    melhor: comVenda.length ? comVenda.reduce((a, b) => (b.faturamento > a.faturamento ? b : a)) : null,
    pior: fechados.length ? fechados.reduce((a, b) => (b.faturamento < a.faturamento ? b : a)) : null,
    mediaMensal: meses.length ? emDinheiro(total / meses.length) : 0,
  };
}
