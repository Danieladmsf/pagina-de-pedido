/**
 * Ranking completo dos produtos vendidos num período.
 *
 * O Dashboard já mostrava "Top Produtos", mas cortado em 5 — numa loja que vende
 * ~55 produtos diferentes por mês, isso responde "o que vende mais" e nunca "o
 * que vende menos". Aqui a lista sai inteira, e junto vem o outro lado da
 * pergunta: os produtos do cardápio que **não venderam nada** no período, com a
 * data da última vez que saíram.
 *
 * O agrupamento é pelo **ID do produto** (a regra do projeto: vínculo é por ID,
 * texto é só para humano). O nome só vira chave quando a linha antiga não tem ID
 * — fallback de leitura de legado, explícito, e que nunca escolhe um destino: o
 * nome vira uma chave própria em vez de ser casado por aproximação com um
 * produto do cardápio.
 *
 * Função pura, sem Firestore e sem React.
 */

import { emDinheiro } from '@/lib/dinheiro';
import type { JanelaDoRelatorio } from './periodo';
import type { ItemDaVenda, VendaDoRelatorio } from './venda';
import { dataDaVenda, foiCancelada, vendasNaJanela } from './venda';

export type ProdutoDoCardapio = {
  id: string;
  name?: string;
  categoryId?: string;
  saleUnit?: string;
  isCombo?: boolean;
};

export type CategoriaDoCardapio = { id: string; name?: string };

export type LinhaDeProduto = {
  /** Chave do agrupamento: o ID do produto, ou `nome:<texto>` no legado. */
  chave: string;
  /** ID do documento do produto; null quando a venda antiga só tinha o nome. */
  produtoId: string | null;
  nome: string;
  categoria: string;
  /** Unidades vendidas. Em produto por peso é o número de pesagens — veja `gramas`. */
  quantidade: number;
  /** Peso total vendido, em gramas (0 em produto por unidade). */
  gramas: number;
  valor: number;
  /** Em quantas vendas diferentes o produto apareceu. */
  vendas: number;
  /** Fatia do faturamento de produtos do período, de 0 a 1. */
  participacao: number;
  porPeso: boolean;
  ehCombo: boolean;
  /** De qual catálogo o produto veio. */
  origem: 'cardapio' | 'encomenda';
  /**
   * Vendeu no período mas o produto não existe mais em `menuItems`. Só faz
   * sentido para item de cardápio — encomenda tem catálogo próprio e nunca
   * esteve lá.
   */
  foraDoCardapio: boolean;
  ultimaVenda: Date | null;
};

export type ProdutoSemVenda = {
  produtoId: string;
  nome: string;
  categoria: string;
  /** Última venda em TODO o histórico — não só na janela. */
  ultimaVenda: Date | null;
};

export type RankingDeProdutos = {
  /** Todos os produtos vendidos no período, do mais vendido para o menos. */
  linhas: LinhaDeProduto[];
  /** Produtos do cardápio que não venderam nenhuma unidade no período. */
  semVenda: ProdutoSemVenda[];
  totalQuantidade: number;
  /**
   * Soma de preço × quantidade dos produtos. NÃO é o faturamento do período:
   * adicionais, taxa de entrega, desconto e acréscimo ficam de fora, porque
   * nenhum deles pertence a um produto específico.
   */
  totalValor: number;
  /** Quantas vendas válidas entraram na conta. */
  vendasConsideradas: number;
  produtosDiferentes: number;
};

const SEM_CATEGORIA = 'Sem categoria';
const FORA_DO_CARDAPIO = 'Fora do cardápio';

/** Só para agrupar linha de legado sem ID: sem acento, sem caixa, sem espaço extra. */
function normalizarNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * A chave de agrupamento de uma linha de venda. Exportada porque a curva do
 * produto precisa reconhecer exatamente o mesmo item que o ranking agrupou —
 * duas regras de chave seriam duas respostas para a mesma pergunta.
 */
export function chaveDoItem(item: ItemDaVenda): string | null {
  const id = String(item?.id || '').trim();
  if (id) return id;
  const nome = normalizarNome(String(item?.name || ''));
  return nome ? `nome:${nome}` : null;
}

type Acumulado = {
  chave: string;
  produtoId: string | null;
  nome: string;
  nomeEm: Date | null;
  quantidade: number;
  gramas: number;
  valor: number;
  vendas: number;
  porPeso: boolean;
  ehCombo: boolean;
  origem: 'cardapio' | 'encomenda';
  grupo: string;
  ultimaVenda: Date | null;
};

export function rankingDeProdutos(
  vendas: VendaDoRelatorio[] | null | undefined,
  opcoes: {
    janela: JanelaDoRelatorio;
    catalogo?: ProdutoDoCardapio[] | null;
    categorias?: CategoriaDoCardapio[] | null;
  },
): RankingDeProdutos {
  const { janela } = opcoes;
  const catalogo = Array.isArray(opcoes.catalogo) ? opcoes.catalogo : [];
  const categorias = Array.isArray(opcoes.categorias) ? opcoes.categorias : [];

  const nomeDaCategoria = new Map<string, string>();
  for (const categoria of categorias) {
    if (categoria?.id) nomeDaCategoria.set(categoria.id, String(categoria.name || '').trim() || SEM_CATEGORIA);
  }

  const produtoPorId = new Map<string, ProdutoDoCardapio>();
  for (const produto of catalogo) {
    if (produto?.id) produtoPorId.set(produto.id, produto);
  }

  const categoriaDoProduto = (produtoId: string | null): string => {
    if (!produtoId) return FORA_DO_CARDAPIO;
    const produto = produtoPorId.get(produtoId);
    if (!produto) return FORA_DO_CARDAPIO;
    return nomeDaCategoria.get(String(produto.categoryId || '')) || SEM_CATEGORIA;
  };

  const dentro = vendasNaJanela(vendas, janela);
  const porChave = new Map<string, Acumulado>();

  for (const { venda, data } of dentro) {
    // Um produto repetido em duas linhas da mesma venda (peso diferente, adicional
    // diferente) continua sendo UMA venda para ele.
    const jaContadoNestaVenda = new Set<string>();

    for (const item of Array.isArray(venda.items) ? venda.items : []) {
      const chave = chaveDoItem(item);
      if (!chave) continue;

      const produtoId = chave.startsWith('nome:') ? null : chave;
      const quantidade = Number(item?.quantity) || 0;
      const unitario = Number(item?.unitPrice) || 0;
      const gramas = Number(item?.weightGrams) || 0;

      const atual: Acumulado = porChave.get(chave) || {
        chave,
        produtoId,
        nome: '',
        nomeEm: null,
        quantidade: 0,
        gramas: 0,
        valor: 0,
        vendas: 0,
        porPeso: false,
        ehCombo: false,
        origem: item?.origem === 'encomenda' ? 'encomenda' : 'cardapio',
        grupo: String(item?.grupo || ''),
        ultimaVenda: null,
      };

      atual.quantidade += quantidade;
      atual.gramas += gramas;
      atual.valor += unitario * quantidade;
      atual.porPeso = atual.porPeso || item?.saleUnit === 'kg' || gramas > 0;
      atual.ehCombo = atual.ehCombo || item?.isCombo === true;
      if (!atual.ultimaVenda || data > atual.ultimaVenda) atual.ultimaVenda = data;

      // Produto renomeado: vale o nome da venda mais recente, não o da primeira.
      const nome = String(item?.name || '').trim();
      if (nome && (!atual.nomeEm || data >= atual.nomeEm)) {
        atual.nome = nome;
        atual.nomeEm = data;
      }

      if (!jaContadoNestaVenda.has(chave)) {
        atual.vendas += 1;
        jaContadoNestaVenda.add(chave);
      }

      porChave.set(chave, atual);
    }
  }

  const totalValor = emDinheiro([...porChave.values()].reduce((soma, a) => soma + a.valor, 0));
  const totalQuantidade = [...porChave.values()].reduce((soma, a) => soma + a.quantidade, 0);

  const linhas: LinhaDeProduto[] = [...porChave.values()]
    .map((a) => {
      const deEncomenda = a.origem === 'encomenda';
      // Produto de encomenda nunca é procurado no `menuItems`: o catálogo dele
      // é outro, e "não achei lá" não significa que saiu do cardápio.
      const doCardapio = !deEncomenda && a.produtoId ? produtoPorId.get(a.produtoId) : undefined;
      const valor = emDinheiro(a.valor);
      return {
        chave: a.chave,
        produtoId: a.produtoId,
        // O nome de hoje é o do cardápio; o da venda é a reserva para o que já
        // saiu do cardápio (ou nunca teve ID).
        nome: String(doCardapio?.name || '').trim() || a.nome || 'Produto sem nome',
        categoria: deEncomenda
          ? `Encomenda · ${a.grupo || 'Itens'}`
          : categoriaDoProduto(a.produtoId),
        quantidade: a.quantidade,
        gramas: a.gramas,
        valor,
        vendas: a.vendas,
        participacao: totalValor > 0 ? valor / totalValor : 0,
        porPeso: a.porPeso || doCardapio?.saleUnit === 'kg',
        ehCombo: a.ehCombo || doCardapio?.isCombo === true,
        origem: a.origem,
        foraDoCardapio: !deEncomenda && !doCardapio,
        ultimaVenda: a.ultimaVenda,
      };
    })
    .sort(ordenarPorQuantidade);

  // Para "não vendeu no período", a última venda tem que vir de TODO o histórico:
  // é ela que diferencia o produto que parou de sair do que nunca saiu.
  const ultimaVendaHistorica = new Map<string, Date>();
  for (const venda of Array.isArray(vendas) ? vendas : []) {
    if (foiCancelada(venda)) continue;
    const data = dataDaVenda(venda);
    if (!data) continue;
    for (const item of Array.isArray(venda.items) ? venda.items : []) {
      const id = String(item?.id || '').trim();
      if (!id) continue;
      const anterior = ultimaVendaHistorica.get(id);
      if (!anterior || data > anterior) ultimaVendaHistorica.set(id, data);
    }
  }

  const semVenda: ProdutoSemVenda[] = catalogo
    .filter((produto) => produto?.id && !porChave.has(produto.id))
    .map((produto) => ({
      produtoId: produto.id,
      nome: String(produto.name || '').trim() || 'Produto sem nome',
      categoria: categoriaDoProduto(produto.id),
      ultimaVenda: ultimaVendaHistorica.get(produto.id) || null,
    }))
    .sort((a, b) => {
      // Quem nunca vendeu primeiro; depois, do que parou há mais tempo.
      const ta = a.ultimaVenda ? a.ultimaVenda.getTime() : -1;
      const tb = b.ultimaVenda ? b.ultimaVenda.getTime() : -1;
      if (ta !== tb) return ta - tb;
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });

  return {
    linhas,
    semVenda,
    totalQuantidade,
    totalValor,
    vendasConsideradas: dentro.length,
    produtosDiferentes: linhas.length,
  };
}

function ordenarPorQuantidade(a: LinhaDeProduto, b: LinhaDeProduto): number {
  if (b.quantidade !== a.quantidade) return b.quantidade - a.quantidade;
  if (b.valor !== a.valor) return b.valor - a.valor;
  return a.nome.localeCompare(b.nome, 'pt-BR');
}

export type OrdemDoRanking = 'quantidade' | 'valor' | 'nome';

/** Reordena sem recalcular — a tela troca a ordem sem varrer os pedidos de novo. */
export function ordenarRanking(linhas: LinhaDeProduto[], ordem: OrdemDoRanking): LinhaDeProduto[] {
  const copia = [...linhas];
  if (ordem === 'nome') return copia.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  if (ordem === 'valor') {
    return copia.sort((a, b) => {
      if (b.valor !== a.valor) return b.valor - a.valor;
      return b.quantidade - a.quantidade;
    });
  }
  return copia.sort(ordenarPorQuantidade);
}

/** Filtro por texto do produto ou da categoria (sem acento, sem caixa). */
export function filtrarRanking(linhas: LinhaDeProduto[], busca: string): LinhaDeProduto[] {
  const alvo = normalizarNome(busca || '');
  if (!alvo) return linhas;
  return linhas.filter(
    (linha) =>
      normalizarNome(linha.nome).includes(alvo) || normalizarNome(linha.categoria).includes(alvo),
  );
}
