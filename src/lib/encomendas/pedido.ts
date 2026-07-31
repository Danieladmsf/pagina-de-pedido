import type { Encomenda } from './types';

/**
 * Encomenda vista como "pedido", para as telas que listam o que foi comprado
 * (extrato do Prazo, caixa). Não é conversão de dados: a encomenda continua na
 * coleção dela, com a forma dela. É só uma leitura em cima — a encomenda tem
 * bolo/tortas/docinhos em campos separados, e essas telas falam `items[]`.
 *
 * O bolo vira UMA linha com o nome que o cliente reconhece (sabor ou recheio +
 * peso/tamanho), porque no papel e na conferência ele é um item só, mesmo tendo
 * massa, cobertura e plaquinha somados dentro do total.
 */
export type PedidoDeEncomenda = {
  id: string;
  items: { name: string; quantity: number; unitPrice: number }[];
  totalAmount: number;
  customerName?: string;
  orderDateTime?: string;
  /** Marca a origem para a tela poder dizer "Encomenda" em vez de "Pedido". */
  origem: 'encomenda';
};

function nomeDoBolo(bolo: NonNullable<Encomenda['bolo']>): string {
  const sabor = bolo.flavor || bolo.filling || 'Bolo';
  const medida = bolo.weight || bolo.size || '';
  return ['Bolo', sabor, medida].filter(Boolean).join(' ');
}

export function encomendaComoPedido(enc: any): PedidoDeEncomenda | null {
  if (!enc?.id) return null;

  const items: PedidoDeEncomenda['items'] = [];

  if (enc.bolo) {
    items.push({
      name: nomeDoBolo(enc.bolo),
      quantity: 1,
      unitPrice: Number(enc.bolo.total) || 0,
    });
  }

  for (const lista of [enc.especialItems, enc.tortasItems, enc.docinhosItems]) {
    for (const item of Array.isArray(lista) ? lista : []) {
      if (!item?.name) continue;
      items.push({
        name: String(item.name),
        quantity: Number(item.qty) || 1,
        unitPrice: Number(item.unitPrice) || 0,
      });
    }
  }

  return {
    id: enc.id,
    items,
    totalAmount: Number(enc.total) || 0,
    customerName: enc.customerName,
    orderDateTime: enc.orderDateTime,
    origem: 'encomenda',
  };
}
