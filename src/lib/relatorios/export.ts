/**
 * Os relatórios em CSV, para abrir na planilha.
 *
 * Reaproveita as primitivas de `lib/csv` (BOM, ponto-e-vírgula e número com
 * vírgula) — são elas que fazem o arquivo abrir certo no Excel em português, e
 * repetir isso aqui seria repetir a decisão no lugar errado.
 *
 * Funções puras: devolvem o texto do arquivo, quem baixa é a tela.
 */

import { csvArquivo, csvDate, csvLine, csvNumber } from '@/lib/csv';
import type { Balancete } from './balancete';
import type { RankingDeProdutos } from './ranking';

type Contexto = { loja?: string; periodo?: string };

function cabecalho(titulo: string, ctx: Contexto, linhasExtras: string[] = []): string[] {
  const { data, hora } = csvDate(new Date().toISOString());
  return [
    csvLine([titulo]),
    csvLine(['Loja', ctx.loja || '']),
    ...(ctx.periodo ? [csvLine(['Período', ctx.periodo])] : []),
    ...linhasExtras,
    csvLine(['Gerado em', `${data} ${hora}`]),
    '',
  ];
}

const dataBR = (d: Date | null) => (d ? csvDate(d.toISOString()).data : '');

export function csvDoRanking(ranking: RankingDeProdutos, ctx: Contexto): string {
  const linhas: string[] = cabecalho('Ranking de produtos vendidos', ctx, [
    csvLine(['Vendas no período', String(ranking.vendasConsideradas)]),
    csvLine(['Produtos diferentes vendidos', String(ranking.produtosDiferentes)]),
  ]);

  linhas.push(
    csvLine([
      '#',
      'Produto',
      'Categoria',
      'Quantidade',
      'Peso (kg)',
      'Faturamento',
      '% do faturamento',
      'Vendas',
      'Última venda',
    ]),
  );

  ranking.linhas.forEach((linha, indice) => {
    linhas.push(
      csvLine([
        indice + 1,
        linha.nome,
        linha.categoria,
        linha.quantidade,
        linha.porPeso ? csvNumber(linha.gramas / 1000) : '',
        csvNumber(linha.valor),
        csvNumber(linha.participacao * 100),
        linha.vendas,
        dataBR(linha.ultimaVenda),
      ]),
    );
  });

  linhas.push(
    csvLine(['', 'TOTAL', '', ranking.totalQuantidade, '', csvNumber(ranking.totalValor), csvNumber(100), '', '']),
  );

  // O outro lado da pergunta: o que ficou parado. Vai no mesmo arquivo porque na
  // cabeça de quem pediu é um relatório só ("o que vendo mais e o que vendo menos").
  if (ranking.semVenda.length) {
    linhas.push('', csvLine(['Produtos do cardápio sem nenhuma venda no período']));
    linhas.push(csvLine(['Produto', 'Categoria', 'Última venda']));
    for (const produto of ranking.semVenda) {
      linhas.push(
        csvLine([produto.nome, produto.categoria, produto.ultimaVenda ? dataBR(produto.ultimaVenda) : 'nunca vendeu']),
      );
    }
  }

  return csvArquivo(linhas);
}

export function csvDoBalancete(balancete: Balancete, ctx: Contexto): string {
  const linhas: string[] = cabecalho('Balancete mensal', ctx);

  linhas.push(csvLine(['Mês', 'Faturamento', 'Vendas', 'Ticket médio', 'Variação (%)']));
  for (const mes of balancete.meses) {
    linhas.push(
      csvLine([
        // O mês corrente vai marcado: na planilha, sem a marca, ele é lido como
        // mês fechado e a comparação com o anterior mente.
        mes.emAndamento ? `${mes.rotuloLongo} (em andamento)` : mes.rotuloLongo,
        csvNumber(mes.faturamento),
        mes.vendas,
        csvNumber(mes.ticketMedio),
        mes.variacao === null ? '' : csvNumber(mes.variacao * 100),
      ]),
    );
  }

  linhas.push(
    csvLine(['TOTAL', csvNumber(balancete.total), balancete.totalVendas, csvNumber(balancete.ticketMedio), '']),
    csvLine(['Média mensal', csvNumber(balancete.mediaMensal), '', '', '']),
  );

  return csvArquivo(linhas);
}

/** Nome de arquivo previsível: sem acento, sem espaço, com a data de hoje. */
export function nomeDoArquivo(prefixo: string, loja?: string): string {
  const slug =
    (loja || 'loja')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'loja';
  return `${prefixo}-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
}
