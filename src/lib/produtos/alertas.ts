/**
 * O que está errado com cada produto — uma lista só, para virar etiqueta.
 *
 * Os avisos nasceram um a um e cada um ocupava um lugar diferente da tela: uma
 * tarja vermelha no topo para o estoque parado, um parágrafo de duas linhas em
 * cima do nome para "não aparece no cardápio", um badge para esgotado. Três
 * vocabulários para a mesma pergunta ("o que precisa de mim aqui?"), e nenhum
 * deles filtrava a lista.
 *
 * Aqui todos viram o mesmo objeto: tipo, rótulo curto e o detalhe. A tela
 * mostra como etiqueta na linha e como filtro no topo — a mesma contagem nos
 * dois lugares, porque sai da mesma função.
 *
 * As regras de visibilidade e de estoque NÃO são reimplementadas: vêm de
 * `lib/menu-visibility` e `lib/inventory`, que continuam donas delas.
 *
 * Função pura, sem Firestore e sem React.
 */

import {
  getMotivosOcultoNoCardapio,
  isEstoqueParado,
  pareceLigadoMasNaoAparece,
  MOTIVO_OCULTO_LABEL,
  type MotivoOculto,
} from '@/lib/menu-visibility';

export type TipoDeAlerta = 'esgotado' | 'parado' | 'nao_aparece' | 'sem_preco';

export type AlertaDoProduto = {
  tipo: TipoDeAlerta;
  /** Complemento do rótulo na etiqueta: "4 un. paradas", "a categoria está desligada". */
  detalhe: string;
};

/** Como cada alerta se chama para quem é dono da loja. */
export const ALERTA_LABEL: Record<TipoDeAlerta, string> = {
  esgotado: 'Esgotado',
  parado: 'Parado',
  nao_aparece: 'Não aparece',
  sem_preco: 'Sem preço',
};

/** O mesmo rótulo no plural, para a barra de contagem ("11 parados"). */
export const ALERTA_LABEL_PLURAL: Record<TipoDeAlerta, string> = {
  esgotado: 'esgotados',
  parado: 'parados',
  nao_aparece: 'não aparecem',
  sem_preco: 'sem preço',
};

/** A frase que explica o alerta quando há espaço (filtro, tooltip). */
export const ALERTA_EXPLICACAO: Record<TipoDeAlerta, string> = {
  esgotado: 'o estoque zerou',
  parado: 'desligado, mas com estoque esperando',
  nao_aparece: 'está ligado, mas o cliente não vê',
  sem_preco: 'sai por R$ 0,00',
};

/** Ordem fixa: primeiro o que trava a venda, depois o que atrapalha. */
export const ALERTAS_EM_ORDEM: TipoDeAlerta[] = ['parado', 'nao_aparece', 'esgotado', 'sem_preco'];

export type ProdutoParaAlerta = {
  item: any;
  /** A categoria do produto, quando existe (a regra precisa dela). */
  categoria?: any;
  /** Estoque efetivo, já vindo de `lib/inventory`. `null` = sem controle. */
  estoque?: number | null;
};

/**
 * Os alertas de UM produto.
 *
 * `esgotado` e `nao_aparece` convivem de propósito quando o motivo de sumir é
 * justamente o estoque zerado: são duas ações diferentes (repor, e conferir se
 * era para estar no ar), e juntar as duas numa etiqueta só esconderia uma.
 */
export function alertasDoProduto({ item, categoria, estoque }: ProdutoParaAlerta): AlertaDoProduto[] {
  if (!item) return [];
  const alertas: AlertaDoProduto[] = [];
  const esgotado = estoque === 0;

  if (isEstoqueParado(item, { estoque, category: categoria })) {
    alertas.push({ tipo: 'parado', detalhe: `${estoque} un. sem poder vender` });
  }

  const motivos = getMotivosOcultoNoCardapio(item, { category: categoria, esgotado });
  if (pareceLigadoMasNaoAparece(motivos)) {
    alertas.push({ tipo: 'nao_aparece', detalhe: frasesDosMotivos(motivos) });
  }

  if (esgotado) alertas.push({ tipo: 'esgotado', detalhe: '' });

  // Combo tem preço próprio calculado noutro lugar; produto normal sem preço
  // entra no carrinho por R$ 0,00.
  if (!item.isCombo && !(Number(item.price) > 0)) {
    alertas.push({ tipo: 'sem_preco', detalhe: '' });
  }

  return alertas;
}

function frasesDosMotivos(motivos: MotivoOculto[]): string {
  return motivos.map((motivo) => MOTIVO_OCULTO_LABEL[motivo]).join(' e ');
}

export type ContagemDeAlerta = {
  tipo: TipoDeAlerta;
  quantidade: number;
  /** Só no estoque parado: quantas unidades e quanto dinheiro estão presos. */
  unidades: number;
  valor: number;
};

/**
 * Quantos produtos caem em cada alerta, na ordem em que a tela mostra.
 *
 * Devolve só os que têm alguém: etiqueta zerada é ruído, e o dono de loja lê a
 * barra como "o que preciso resolver hoje".
 */
export function contarAlertas(produtos: ProdutoParaAlerta[]): ContagemDeAlerta[] {
  const mapa = new Map<TipoDeAlerta, ContagemDeAlerta>();

  for (const produto of Array.isArray(produtos) ? produtos : []) {
    for (const alerta of alertasDoProduto(produto)) {
      const atual = mapa.get(alerta.tipo) || { tipo: alerta.tipo, quantidade: 0, unidades: 0, valor: 0 };
      atual.quantidade += 1;
      if (alerta.tipo === 'parado') {
        const unidades = Number(produto.estoque) || 0;
        atual.unidades += unidades;
        atual.valor += unidades * (Number(produto.item?.price) || 0);
      }
      mapa.set(alerta.tipo, atual);
    }
  }

  return ALERTAS_EM_ORDEM.map((tipo) => mapa.get(tipo)).filter(Boolean) as ContagemDeAlerta[];
}

/** Este produto tem o alerta escolhido? É o que o filtro da barra usa. */
export function temAlerta(produto: ProdutoParaAlerta, tipo: TipoDeAlerta): boolean {
  return alertasDoProduto(produto).some((alerta) => alerta.tipo === tipo);
}
