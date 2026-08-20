/**
 * O que os relatórios entendem por "uma venda", e de onde sai a data dela.
 *
 * Compartilhado pelo ranking de produtos e pelo balancete mensal: os dois
 * precisam decidir a MESMA coisa sobre cancelamento e sobre data, senão o total
 * do balancete não bate com a soma do ranking na mesma tela.
 *
 * Puro de propósito — sem Firestore e sem React.
 */

import type { JanelaDoRelatorio } from './periodo';
import { dentroDaJanela } from './periodo';

export type ItemDaVenda = {
  /** ID do documento do produto — é por ele que o ranking agrupa. */
  id?: string;
  name?: string;
  quantity?: number;
  unitPrice?: number;
  isCombo?: boolean;
  /** 'kg' = vendido por peso; a linha vale o peso, não a unidade. */
  saleUnit?: string;
  weightGrams?: number | null;
  /**
   * De qual catálogo o item veio. Encomenda tem catálogo próprio (bolo por
   * sabor, docinho por slug), então o produto dela não pode ser procurado em
   * `menuItems` nem marcado como "fora do cardápio" por não estar lá.
   */
  origem?: 'encomenda';
  /** Seção do catálogo de encomenda ('Bolos', 'Docinhos', ...). */
  grupo?: string;
};

export type VendaDoRelatorio = {
  id?: string;
  status?: string;
  orderDateTime?: string;
  createdAt?: any;
  totalAmount?: number;
  items?: ItemDaVenda[];
};

/**
 * A data da venda, com o fallback que o histórico exige.
 *
 * Pedido do PDV criado até 29/07/2026 **não tem `createdAt`** — só o
 * `orderDateTime` em texto. Filtrar só por `createdAt` descarta em silêncio mais
 * da metade das vendas de um dia real da loja, então `orderDateTime` vem
 * primeiro e `createdAt` (Timestamp do Firestore ou Date) é a reserva.
 */
export function dataDaVenda(venda: VendaDoRelatorio | null | undefined): Date | null {
  const texto = Date.parse(venda?.orderDateTime || '');
  if (!Number.isNaN(texto)) return new Date(texto);

  const bruto: any = venda?.createdAt;
  if (!bruto) return null;
  const convertido: unknown = typeof bruto?.toDate === 'function' ? bruto.toDate() : bruto;
  if (convertido instanceof Date) return Number.isNaN(convertido.getTime()) ? null : convertido;

  const numero = Date.parse(String(convertido));
  return Number.isNaN(numero) ? null : new Date(numero);
}

/**
 * Cancelada não entra em nenhum total — nem de faturamento, nem de produto.
 *
 * As duas grafias existem no banco: `orders` grava `canceled` e `encomendas`
 * grava `cancelada`. Reconhecer só uma deixava 6 das 11 encomendas da loja
 * (mais da metade) somando faturamento que nunca aconteceu.
 */
export const foiCancelada = (venda: VendaDoRelatorio | null | undefined): boolean =>
  venda?.status === 'canceled' || venda?.status === 'cancelada';

/** As vendas válidas que caem na janela, já com a data resolvida. */
export function vendasNaJanela(
  vendas: VendaDoRelatorio[] | null | undefined,
  janela: JanelaDoRelatorio,
): { venda: VendaDoRelatorio; data: Date }[] {
  const lista = Array.isArray(vendas) ? vendas : [];
  const dentro: { venda: VendaDoRelatorio; data: Date }[] = [];

  for (const venda of lista) {
    if (foiCancelada(venda)) continue;
    const data = dataDaVenda(venda);
    if (!dentroDaJanela(data, janela)) continue;
    dentro.push({ venda, data: data as Date });
  }
  return dentro;
}
