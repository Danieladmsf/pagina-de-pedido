export type CashSaleLink = {
  tipo?: string;
  titulo?: string;
  orderId?: string;
  encomendaId?: string;
  data?: unknown;
};

/** Converte Date, Timestamp do Firestore ou texto ISO para milissegundos. */
export function valueToMillis(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'string') {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') return null;

  const timestamp = value as {
    toMillis?: () => number;
    toDate?: () => Date;
    seconds?: number;
    nanoseconds?: number;
  };
  if (typeof timestamp.toMillis === 'function') {
    const time = timestamp.toMillis();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof timestamp.toDate === 'function') {
    return valueToMillis(timestamp.toDate());
  }
  if (typeof timestamp.seconds === 'number') {
    const time = timestamp.seconds * 1000 + (Number(timestamp.nanoseconds) || 0) / 1_000_000;
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

/** Momento de criação conhecido do pedido, com fallback para o legado. */
export function orderCreatedAtMillis(order: any): number | null {
  return valueToMillis(order?.createdAt) ?? valueToMillis(order?.orderDateTime);
}

/**
 * Busca pelo prefixo histórico sem permitir que um pedido futuro "roube" um
 * lançamento antigo. Sem datas comparáveis não há vínculo seguro.
 */
export function findLegacyOrderBefore(
  orders: any[],
  rawPrefix: string,
  linkedAt: unknown,
): any | null {
  const prefix = String(rawPrefix || '').substring(0, 5);
  const linkTime = valueToMillis(linkedAt);
  if (prefix.length < 5 || linkTime == null) return null;

  const candidates = orders.filter((order) => {
    if (typeof order?.id !== 'string' || !order.id.startsWith(prefix)) return false;
    const createdAt = orderCreatedAtMillis(order);
    return createdAt != null && createdAt <= linkTime;
  });

  // Prefixo é apenas compatibilidade histórica. Se houver colisão, escolher o
  // primeiro repetiria exatamente a classe de erro que esta fase elimina.
  return candidates.length === 1 ? candidates[0] : null;
}

/** Regra pura usada pelo Caixa para resolver a origem de uma venda. */
export function matchCashSaleSource(
  lanc: CashSaleLink,
  orders: any[],
  encomendasComoPedidos: any[] = [],
): any | null {
  if (lanc.tipo !== 'venda') return null;
  if (lanc.orderId) return orders.find((order) => order?.id === lanc.orderId) || null;
  if (lanc.encomendaId) {
    return encomendasComoPedidos.find((order) => order?.id === lanc.encomendaId) || null;
  }

  const match = (lanc.titulo || '').match(/#([A-Za-z0-9]+)/);
  return match ? findLegacyOrderBefore(orders, match[1], lanc.data) : null;
}

/** Venda histórica que não carrega id e cujo fallback seguro não resolveu. */
export function isUnlinkedLegacyCashSale(lanc: CashSaleLink, matchedSource: any | null): boolean {
  if (lanc.tipo !== 'venda' || matchedSource) return false;
  if (lanc.orderId || lanc.encomendaId) return false;
  if (/^\s*acerto de prazo\b/i.test(lanc.titulo || '')) return false;
  return true;
}
