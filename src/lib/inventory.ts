import {
  Firestore,
  DocumentReference,
  doc,
  runTransaction,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

/**
 * Controle de estoque centralizado. FONTE ÚNICA — não reimplemente nada disto
 * nos componentes: toda regra de "tem estoque?", "está esgotado?" e "abate"
 * mora aqui.
 *
 * Modelo:
 *  - O estoque é abatido na INCLUSÃO do pedido (criação ou adição de item),
 *    não no "entregue". Assim um item não é vendido em dois lugares ao mesmo tempo.
 *  - Cada pedido guarda `stockDeductedItems` (mapa itemId -> qtd já reservada).
 *    Essa é a fonte da verdade: edições aplicam o DELTA entre o desejado e o já
 *    reservado, e cancelamentos restauram exatamente o que foi reservado.
 *  - Só é "ilimitado" o item SEM estoque definido (null/undefined/não-número).
 *    Número é sempre controlado — inclusive 0. **Zerou, zerou.**
 *  - A reconciliação roda dentro de uma TRANSAÇÃO Firestore (read-check-write
 *    atômico), evitando venda concorrente do mesmo último item.
 */

export type StockMap = Record<string, number>;

export interface OrderLikeItem {
  id?: string;
  quantity?: number | string;
  isCombo?: boolean;
  comboItems?: Array<{ itemId?: string }> | null;
}

/** Produto do cardápio, na parte que interessa ao estoque. */
export interface StockItemLike {
  id?: string;
  name?: string;
  stockQuantity?: unknown;
  isCombo?: boolean;
  comboItems?: Array<{ itemId?: string }> | null;
}

/**
 * Estoque "gerenciado" de um valor cru do banco.
 *
 * Retorna `null` SÓ quando não há controle de estoque (campo vazio/inválido).
 * Número negativo é sujeira de dado (digitação, correção manual) e vale ZERO —
 * jamais "ilimitado". Tratar negativo como ilimitado era o bug que fazia um
 * produto zerado voltar a vender para sempre sem nunca abater.
 */
export function getManagedStock(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value < 0 ? 0 : value;
}

/**
 * Normaliza o que o usuário digitou num campo de estoque, para GRAVAR.
 * Vazio => null (ilimitado). Qualquer número => inteiro >= 0.
 */
export function normalizeStockInput(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === '') return null;
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}

/**
 * Estoque efetivo de um item do cardápio (null = ilimitado).
 * Combo vale o MENOR estoque entre seus componentes; componente que não existe
 * mais zera o combo.
 */
export function getEffectiveStock(item: StockItemLike | null | undefined, allItems?: StockItemLike[]): number | null {
  if (!item) return null;
  if (!item.isCombo) return getManagedStock(item.stockQuantity);

  const parts = item.comboItems || [];
  if (parts.length === 0) return getManagedStock(item.stockQuantity);

  let min: number | null = null;
  for (const part of parts) {
    const matched = allItems?.find((i) => i.id === part?.itemId);
    const stock = matched ? getManagedStock(matched.stockQuantity) : 0;
    if (stock === null) continue; // componente ilimitado não limita o combo
    if (min === null || stock < min) min = stock;
  }
  return min;
}

/** Item esgotado? (só faz sentido com o controle de estoque ligado) */
export function isOutOfStock(
  item: StockItemLike | null | undefined,
  opts: { enableInventory?: boolean; allItems?: StockItemLike[] } = {},
): boolean {
  if (!opts.enableInventory) return false;
  const stock = getEffectiveStock(item, opts.allItems);
  return stock !== null && stock <= 0;
}

export interface CartStockCheck {
  allowed: boolean;
  message?: string;
}

/**
 * O carrinho projetado cabe no estoque? Usado ANTES de gravar, para avisar o
 * usuário; a validação que vale é a da transação em {@link reconcileOrderStock}.
 */
export function checkCartStock(
  projectedCart: OrderLikeItem[],
  menuItemsList: StockItemLike[] | null | undefined,
  enableInventory: boolean,
): CartStockCheck {
  if (!enableInventory || !menuItemsList || menuItemsList.length === 0) return { allowed: true };

  const demand = getStockDemand(projectedCart);

  for (const [productId, reqQty] of Object.entries(demand)) {
    const matched = menuItemsList.find((m) => m.id === productId);
    if (!matched) continue;

    const available = getManagedStock(matched.stockQuantity);
    if (available !== null && reqQty > available) {
      return {
        allowed: false,
        message:
          available === 0
            ? `"${matched.name}" está esgotado.`
            : `"${matched.name}" tem apenas ${available} unidade(s) disponível(is).`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Demanda de estoque por produto (expande combos nos seus componentes).
 * Ex.: 2x "Combo" com 1 refri + 1 lanche -> { refriId: 2, lancheId: 2 }.
 */
export function getStockDemand(items: OrderLikeItem[]): StockMap {
  const demand: StockMap = {};
  for (const item of items || []) {
    const qty = Number(item?.quantity) || 0;
    if (qty <= 0) continue;

    if (item.isCombo && item.comboItems) {
      for (const ci of item.comboItems) {
        if (ci?.itemId) demand[ci.itemId] = (demand[ci.itemId] || 0) + qty;
      }
    } else if (item.id) {
      demand[item.id] = (demand[item.id] || 0) + qty;
    }
  }
  return demand;
}

/**
 * Delta a aplicar = desejado - já reservado, por produto.
 * Positivo = abater mais; negativo = devolver; zero = ignorado.
 */
export function computeStockDelta(alreadyDeducted: StockMap, desired: StockMap): StockMap {
  const delta: StockMap = {};
  const ids = new Set([...Object.keys(alreadyDeducted || {}), ...Object.keys(desired || {})]);
  for (const id of ids) {
    const d = (Number(desired[id]) || 0) - (Number(alreadyDeducted[id]) || 0);
    if (d !== 0) delta[id] = d;
  }
  return delta;
}

/** Erro lançado quando não há estoque suficiente para o que se tenta reservar. */
export class InsufficientStockError extends Error {
  code = 'insufficient-stock' as const;
  itemId: string;
  itemName: string;
  available: number;
  requested: number;
  constructor(itemId: string, itemName: string, available: number, requested: number) {
    super(`"${itemName}" tem apenas ${available} unidade(s) disponível(is), mas foram solicitadas ${requested}.`);
    this.name = 'InsufficientStockError';
    this.itemId = itemId;
    this.itemName = itemName;
    this.available = available;
    this.requested = requested;
  }
}

/**
 * Como gravar o documento do pedido NA MESMA transação do estoque (atômico).
 * Os campos `stockDeducted`/`stockDeductedItems` são adicionados automaticamente.
 */
export interface OrderWriteSpec {
  ref: DocumentReference;
  mode: 'set' | 'update';
  /** Campos do pedido além dos de estoque (itens, totais, status, etc.). */
  data?: Record<string, any>;
  /** Para mode 'set': mesclar com o doc existente. */
  merge?: boolean;
}

export interface ReconcileParams {
  /** Se false, não mexe em estoque (mas ainda grava o pedido, se `order` for dado). */
  enableInventory: boolean;
  /** Itens que o pedido deve ter reservados AGORA (vazio = liberar tudo, ex.: cancelar). */
  targetItems: OrderLikeItem[];
  /** O que este pedido já reservou (order.stockDeductedItems). Default: {}. */
  alreadyDeducted?: StockMap;
  /** Opcional: grava o pedido na MESMA transação do estoque (atomicidade total). */
  order?: OrderWriteSpec;
}

export interface ReconcileResult {
  /** Novo mapa para gravar em order.stockDeductedItems. */
  stockDeductedItems: StockMap;
  /** true se há algo reservado (use em order.stockDeducted). */
  stockDeducted: boolean;
  /** true se o estoque de algum produto foi alterado nesta operação. */
  changed: boolean;
}

/**
 * Reconcilia o estoque dos produtos com o estado desejado do pedido, de forma
 * ATÔMICA e IDEMPOTENTE. Aplica apenas o delta (desejado - já reservado).
 *
 * - Valida estoque dentro da transação e lança {@link InsufficientStockError}
 *   se faltar (nada é gravado nesse caso).
 * - Produtos não gerenciados (estoque ilimitado) são ignorados.
 * - Se `order` for informado, grava o documento do pedido (com `stockDeducted` +
 *   `stockDeductedItems`) na MESMA transação do estoque — atomicidade total.
 * - Retorna o novo `stockDeductedItems` (útil mesmo quando o pedido é gravado).
 *
 * Rodar duas vezes com o mesmo alvo é seguro (delta = 0 na segunda).
 */
export async function reconcileOrderStock(
  db: Firestore,
  { enableInventory, targetItems, alreadyDeducted = {}, order }: ReconcileParams,
): Promise<ReconcileResult> {
  // Estoque desligado: ainda persiste o pedido (sem campos de estoque), se pedido.
  if (!enableInventory) {
    if (order) await writeOrder(order, order.data || {});
    const stockDeductedItems = pruneZeros(alreadyDeducted);
    return { stockDeductedItems, stockDeducted: Object.keys(stockDeductedItems).length > 0, changed: false };
  }

  const desired = getStockDemand(targetItems);
  const delta = computeStockDelta(alreadyDeducted, desired);
  const affectedIds = Object.keys(delta);

  // Sem mudança de estoque: grava só o pedido (atomicidade com estoque é irrelevante aqui).
  if (affectedIds.length === 0) {
    const stockDeductedItems = pruneZeros(alreadyDeducted);
    if (order) {
      await writeOrder(order, { ...(order.data || {}), stockDeducted: Object.keys(stockDeductedItems).length > 0, stockDeductedItems });
    }
    return { stockDeductedItems, stockDeducted: Object.keys(stockDeductedItems).length > 0, changed: false };
  }

  const nextStockDeductedItems = await runTransaction(db, async (tx) => {
    // 1) Leituras primeiro (regra do Firestore: todos os reads antes dos writes).
    const reads = await Promise.all(
      affectedIds.map(async (itemId) => {
        const ref = doc(db, 'menuItems', itemId);
        const snap = await tx.get(ref);
        return { itemId, ref, snap };
      }),
    );

    const next: StockMap = { ...alreadyDeducted };
    const writes: Array<{ ref: DocumentReference; nextStock: number }> = [];

    for (const { itemId, ref, snap } of reads) {
      const d = delta[itemId];
      if (!snap.exists()) continue; // produto sumiu: ignora
      const current = getManagedStock(snap.data().stockQuantity);
      if (current === null) {
        // Estoque não gerenciado: não abate nem rastreia. Garante que não fique
        // sobra de reserva antiga para esse item.
        delete next[itemId];
        continue;
      }

      if (d > 0 && d > current) {
        throw new InsufficientStockError(itemId, snap.data().name || itemId, current, d);
      }

      // d>0 abate, d<0 devolve. O clamp é rede de segurança: o estoque nunca
      // pode ficar negativo (negativo volta a valer 0 e trava a venda).
      writes.push({ ref, nextStock: Math.max(0, current - d) });
      const reserved = (Number(next[itemId]) || 0) + d;
      if (reserved > 0) next[itemId] = reserved;
      else delete next[itemId];
    }

    const stockDeductedItems = pruneZeros(next);

    // 2) Escritas (pedido + estoque na mesma transação).
    if (order) {
      const payload = { ...(order.data || {}), stockDeducted: Object.keys(stockDeductedItems).length > 0, stockDeductedItems };
      if (order.mode === 'set') tx.set(order.ref, payload, { merge: !!order.merge });
      else tx.update(order.ref, payload);
    }
    for (const w of writes) tx.update(w.ref, { stockQuantity: w.nextStock });

    return stockDeductedItems;
  });

  return {
    stockDeductedItems: nextStockDeductedItems,
    stockDeducted: Object.keys(nextStockDeductedItems).length > 0,
    changed: true,
  };
}

/** Grava o pedido fora de transação (casos sem mudança de estoque). */
async function writeOrder(order: OrderWriteSpec, payload: Record<string, any>): Promise<void> {
  if (order.mode === 'set') await setDoc(order.ref, payload, { merge: !!order.merge });
  else await updateDoc(order.ref, payload);
}

/** Conveniência: devolve ao estoque tudo que um pedido reservou (cancelamento). */
export function releaseOrderStock(
  db: Firestore,
  opts: { enableInventory: boolean; alreadyDeducted?: StockMap; order?: OrderWriteSpec },
) {
  return reconcileOrderStock(db, { enableInventory: opts.enableInventory, targetItems: [], alreadyDeducted: opts.alreadyDeducted, order: opts.order });
}

function pruneZeros(map: StockMap): StockMap {
  const out: StockMap = {};
  for (const [k, v] of Object.entries(map || {})) {
    const n = Number(v) || 0;
    if (n > 0) out[k] = n;
  }
  return out;
}
