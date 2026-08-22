/**
 * O extrato de um produto: tudo que entrou, tudo que saiu, e onde a conta bate.
 *
 * Nasceu de uma pergunta que a tela não sabia responder: "o estoque do app não
 * bate com a bandeja". Ver o número de hoje não ajuda — o que resolve é a
 * linha do tempo, com o saldo depois de cada movimento, do jeito que um extrato
 * bancário mostra.
 *
 * O que esta lib faz além de listar: **confere**. Toda entrada e saída lançada
 * na mão grava quanto o produto tinha ANTES (`stockBefore`). Isso é um ponto de
 * checagem: o saldo que vinha caminhando pelas vendas tem que chegar nesse
 * número. Quando não chega, alguém tirou ou pôs unidade sem passar pelo app —
 * e o extrato aponta o dia exato em que isso aconteceu, em vez de deixar a dona
 * procurando no escuro.
 *
 * Função pura, sem Firestore e sem React.
 */

import { CSV_BOM, csvLine } from '@/lib/csv';

export type TipoDaLinha = 'entrada' | 'saida' | 'sem_controle' | 'ajuste' | 'venda';

export type LinhaDoExtrato = {
  id: string;
  quando: Date | null;
  tipo: TipoDaLinha;
  /** Positivo entra, negativo sai. */
  delta: number;
  /** Saldo depois desta linha, reconstruído a partir dos pontos de checagem. */
  saldoDepois: number | null;
  /** Só nas linhas lançadas na mão: o que o app gravou na hora. */
  saldoGravado: number | null;
  quem: string;
  observacao: string;
  pedido?: { id: string; codigo: string; canal: string; cliente: string };
  /**
   * Preenchido quando esta linha é um ponto de checagem que NÃO fechou: o
   * quanto o estoque real estava acima (+) ou abaixo (-) do esperado.
   */
  diferenca?: number;
};

export type ConferenciaDoExtrato = {
  /** Quantos pontos de checagem existem no período. */
  pontos: number;
  /** Quantos fecharam. */
  ok: number;
  /** A soma das diferenças encontradas (positiva = apareceu, negativa = sumiu). */
  totalDivergente: number;
};

export type ExtratoDoItem = {
  linhas: LinhaDoExtrato[];
  entradas: number;
  saidasManuais: number;
  vendido: number;
  /** O saldo que o extrato termina, para comparar com o do produto. */
  saldoFinal: number | null;
  /** O que está gravado no produto agora. */
  estoqueAtual: number | null;
  /** Diferença entre o que o extrato explica e o estoque de hoje. */
  diferencaFinal: number;
  conferencia: ConferenciaDoExtrato;
};

type MovimentoBruto = {
  id?: string;
  itemId?: string;
  type?: string;
  delta?: unknown;
  stockBefore?: unknown;
  stockAfter?: unknown;
  note?: string;
  userName?: string;
  createdAt?: any;
};

type PedidoBruto = {
  id?: string;
  status?: string;
  source?: string;
  customerName?: string;
  orderDateTime?: any;
  createdAt?: any;
  stockDeductedItems?: Record<string, unknown>;
  items?: Array<{ id?: string; quantity?: unknown; isCombo?: boolean; comboItems?: Array<{ itemId?: string }> }>;
};

function paraData(valor: any): Date | null {
  if (!valor) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (typeof valor?.toDate === 'function') return paraData(valor.toDate());
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

const numeroOuNulo = (valor: unknown): number | null =>
  typeof valor === 'number' && Number.isFinite(valor) ? valor : null;

/** Quantas unidades deste item o pedido reservou (combo já expandido na gravação). */
function reservadoNoPedido(pedido: PedidoBruto, itemId: string): number {
  return Number(pedido?.stockDeductedItems?.[itemId]) || 0;
}

/**
 * Monta o extrato do item, do mais antigo para o mais novo.
 *
 * O saldo é reconstruído para a frente a partir de cada ponto de checagem: o
 * primeiro `stockAfter` conhecido vira a base, e dali as vendas descontam. Um
 * ponto de checagem seguinte reancora a conta — assim uma diferença antiga não
 * contamina o resto do extrato, e cada divergência fica no dia em que nasceu.
 */
export function montarExtratoDoItem(dados: {
  itemId: string;
  estoqueAtual?: unknown;
  movimentos?: MovimentoBruto[] | null;
  pedidos?: PedidoBruto[] | null;
}): ExtratoDoItem {
  const { itemId } = dados;
  const estoqueAtual = numeroOuNulo(dados.estoqueAtual);
  const linhas: LinhaDoExtrato[] = [];

  for (const movimento of Array.isArray(dados.movimentos) ? dados.movimentos : []) {
    if (movimento?.itemId !== itemId) continue;
    linhas.push({
      id: String(movimento.id || ''),
      quando: paraData(movimento.createdAt),
      tipo: (movimento.type as TipoDaLinha) || 'ajuste',
      delta: Number(movimento.delta) || 0,
      saldoDepois: null,
      saldoGravado: numeroOuNulo(movimento.stockAfter),
      quem: movimento.userName || '',
      observacao: movimento.note || '',
    });
  }

  for (const pedido of Array.isArray(dados.pedidos) ? dados.pedidos : []) {
    if (String(pedido?.status) === 'canceled') continue;
    const quantidade = reservadoNoPedido(pedido, itemId);
    if (quantidade <= 0) continue;
    linhas.push({
      id: `${pedido.id}:${itemId}`,
      quando: paraData(pedido.orderDateTime) || paraData(pedido.createdAt),
      tipo: 'venda',
      delta: -quantidade,
      saldoDepois: null,
      saldoGravado: null,
      quem: pedido.source === 'pdv' ? 'PDV' : 'Cardápio',
      observacao: '',
      pedido: {
        id: String(pedido.id || ''),
        codigo: String(pedido.id || '').substring(0, 5).toUpperCase(),
        canal: pedido.source === 'pdv' ? 'PDV' : 'Cardápio',
        cliente: pedido.customerName || '',
      },
    });
  }

  // Sem data não dá para posicionar na linha do tempo: vai para o fim, sem
  // participar da reconstrução de saldo.
  linhas.sort((a, b) => (a.quando?.getTime() ?? Infinity) - (b.quando?.getTime() ?? Infinity));

  const conferencia: ConferenciaDoExtrato = { pontos: 0, ok: 0, totalDivergente: 0 };
  let saldo: number | null = null;

  for (const linha of linhas) {
    const ehPontoDeChecagem = linha.tipo !== 'venda' && linha.saldoGravado !== null;

    if (ehPontoDeChecagem) {
      // O que o app tinha antes deste lançamento, segundo o próprio lançamento.
      const antesGravado = linha.saldoGravado! - linha.delta;
      if (saldo !== null) {
        conferencia.pontos += 1;
        const diferenca = antesGravado - saldo;
        if (diferenca === 0) {
          conferencia.ok += 1;
        } else {
          linha.diferenca = diferenca;
          conferencia.totalDivergente += diferenca;
        }
      }
      saldo = linha.saldoGravado;
      linha.saldoDepois = saldo;
      continue;
    }

    if (saldo === null) {
      // Antes do primeiro ponto de checagem não há saldo conhecido: a venda
      // aconteceu quando o produto ainda não era contado.
      linha.saldoDepois = null;
      continue;
    }
    saldo += linha.delta;
    linha.saldoDepois = saldo;
  }

  const entradas = linhas.filter((l) => l.delta > 0 && l.tipo !== 'venda').reduce((s, l) => s + l.delta, 0);
  const saidasManuais = linhas.filter((l) => l.delta < 0 && l.tipo !== 'venda').reduce((s, l) => s + Math.abs(l.delta), 0);
  const vendido = linhas.filter((l) => l.tipo === 'venda').reduce((s, l) => s + Math.abs(l.delta), 0);

  return {
    linhas,
    entradas,
    saidasManuais,
    vendido,
    saldoFinal: saldo,
    estoqueAtual,
    diferencaFinal: saldo !== null && estoqueAtual !== null ? estoqueAtual - saldo : 0,
    conferencia,
  };
}

/** O extrato do mais recente para o mais antigo, que é como a tela mostra. */
export function doMaisNovoParaOMaisVelho(linhas: LinhaDoExtrato[]): LinhaDoExtrato[] {
  return [...linhas].reverse();
}

/**
 * Linha a linha em CSV, para conferir fora do app.
 *
 * Usa as primitivas de `lib/csv` (ponto-e-vírgula e BOM): é o que faz o
 * arquivo abrir com as colunas certas e sem comer acento no Excel brasileiro.
 */
export function csvDoExtrato(extrato: ExtratoDoItem, nomeDoProduto: string): string {
  const linhas = [
    csvLine([`Extrato de estoque - ${nomeDoProduto}`]),
    csvLine([`Estoque hoje`, extrato.estoqueAtual ?? 'sem controle']),
    csvLine([`Entradas`, extrato.entradas, `Saidas`, extrato.saidasManuais, `Vendido`, extrato.vendido]),
    '',
    csvLine(['Quando', 'Tipo', 'Quantidade', 'Ficou com', 'Quem', 'Pedido', 'Cliente', 'Observacao']),
  ];

  for (const linha of doMaisNovoParaOMaisVelho(extrato.linhas)) {
    linhas.push(csvLine([
      linha.quando ? linha.quando.toLocaleString('pt-BR') : '',
      rotuloDoTipo(linha.tipo),
      `${linha.delta > 0 ? '+' : ''}${linha.delta}`,
      linha.saldoDepois === null ? '' : linha.saldoDepois,
      linha.quem,
      linha.pedido ? `#${linha.pedido.codigo}` : '',
      linha.pedido?.cliente || '',
      linha.diferenca
        ? `Diferenca de ${linha.diferenca > 0 ? '+' : ''}${linha.diferenca} ate aqui`
        : linha.observacao,
    ]));
  }

  return CSV_BOM + linhas.join('\n');
}

export const ROTULOS_DO_TIPO: Record<TipoDaLinha, string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  sem_controle: 'Parou de contar',
  ajuste: 'Ajuste',
  venda: 'Venda',
};

export function rotuloDoTipo(tipo: TipoDaLinha): string {
  return ROTULOS_DO_TIPO[tipo] || tipo;
}
