/**
 * De onde veio a venda, no vocabulário de quem opera a loja.
 *
 * `orderType` sozinho não responde a pergunta que as telas fazem: "pickup" é
 * tanto o cliente que pediu no cardápio e vem buscar quanto a venda batida no
 * balcão do PDV, e "dine_in" é tanto a comanda de mesa aberta no salão quanto o
 * pedido feito pelo cardápio para comer ali. Quem separa os dois é a ORIGEM
 * (`source`), gravada desde junho/2026 — `cardapio` no checkout público e `pdv`
 * no Novo Pedido e nas Mesas.
 *
 * Função pura, sem Firestore e sem React: a tela só escolhe cor e ícone.
 */

export type CanalDaVenda =
  | 'delivery_entrega'
  | 'delivery_retirada'
  | 'delivery_local'
  | 'balcao'
  | 'mesa'
  | 'encomenda';

export type PedidoParaCanal = {
  orderType?: string;
  source?: string;
  /** Marca de `encomendaComoPedido` — encomenda lida como pedido. */
  origem?: string;
  tableNumber?: any;
  customerUid?: string;
  customerIdentifier?: string;
};

export const CANAL_LABELS: Record<CanalDaVenda, string> = {
  delivery_entrega: 'Delivery · Entrega',
  delivery_retirada: 'Delivery · Retirada',
  delivery_local: 'Delivery · Comer no local',
  balcao: 'Balcão',
  mesa: 'Mesa',
  encomenda: 'Encomenda',
};

/** Ordem fixa nas telas: primeiro o que o cliente pediu sozinho, depois a loja. */
export const CANAIS_EM_ORDEM: CanalDaVenda[] = [
  'delivery_entrega',
  'delivery_retirada',
  'delivery_local',
  'balcao',
  'mesa',
  'encomenda',
];

/**
 * O pedido foi feito pelo cliente no cardápio (e não batido no PDV).
 *
 * `source` só existe em pedido de junho/2026 para cá. Nos mais antigos a marca
 * que sobra é do checkout público: o uid anônimo do cliente (`customerUid`) e o
 * telefone de identificação (`customerIdentifier`), que o PDV não grava. Sem
 * nenhuma das três, o pedido é tratado como interno — é o lado em que errar
 * conta menos, porque não inventa um pedido de cliente que nunca existiu.
 */
function veioDoCardapio(pedido: PedidoParaCanal): boolean {
  const source = String(pedido?.source || '').trim();
  if (source) return source === 'cardapio';
  return !!pedido?.customerUid || !!pedido?.customerIdentifier;
}

export function canalDaVenda(pedido: PedidoParaCanal): CanalDaVenda {
  if (pedido?.origem === 'encomenda') return 'encomenda';

  // Mesmo fallback que o Dashboard já usava: pedido sem tipo com mesa é comanda,
  // sem mesa é retirada/balcão.
  const tipo = String(pedido?.orderType || '') || (pedido?.tableNumber ? 'dine_in' : 'pickup');

  // Entrega é entrega, tenha vindo do cardápio ou digitada no PDV — é assim que
  // a aba Delivery já trata, e o que muda na operação é o motoboy sair.
  if (tipo === 'delivery') return 'delivery_entrega';

  const doCardapio = veioDoCardapio(pedido);
  if (tipo === 'dine_in') return doCardapio ? 'delivery_local' : 'mesa';
  return doCardapio ? 'delivery_retirada' : 'balcao';
}

export const rotuloDoCanalDaVenda = (pedido: PedidoParaCanal): string =>
  CANAL_LABELS[canalDaVenda(pedido)];
