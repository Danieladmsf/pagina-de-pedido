/**
 * Exclusão de produto SEM deixar referência morta atrás.
 *
 * Produtos podem ser citados por promoções e por `comboItems[].itemId`. Apagar
 * só o produto deixava a promoção órfã e podia transformar um combo em uma
 * oferta diferente da que o dono montou.
 *
 * Produto e promoções saem no MESMO batch: ou tudo, ou nada.
 */
import { doc, writeBatch } from 'firebase/firestore';

/** Promoções que citam este produto (pra avisar antes de apagar). */
export function promotionsUsingItem(promotions: any[], itemId: string): any[] {
  return (promotions || []).filter((p: any) =>
    (Array.isArray(p?.items) ? p.items : []).some((i: any) => i?.menuItemId === itemId)
  );
}

/** Combos vivos que dependem de qualquer produto que se pretende apagar. */
export function combosUsingRemovedItems(menuItems: any[], itemIds: Set<string>): any[] {
  return (menuItems || []).filter((item: any) =>
    item?.isCombo === true
      && !itemIds.has(item.id)
      && (Array.isArray(item.comboItems) ? item.comboItems : [])
        .some((part: any) => itemIds.has(part?.itemId)),
  );
}

export function comboReferenceWarning(menuItems: any[], itemIds: Set<string>): string {
  const combos = combosUsingRemovedItems(menuItems, itemIds);
  if (combos.length === 0) return '';
  const nomes = combos.map((combo: any) => `• ${combo.name || 'combo sem nome'}`).join('\n');
  return `A exclusão foi bloqueada porque ${combos.length} ${combos.length === 1 ? 'combo depende' : 'combos dependem'} deste produto:\n${nomes}\n\nEdite ou exclua ${combos.length === 1 ? 'o combo' : 'os combos'} primeiro.`;
}

/**
 * Como cada promoção fica DEPOIS de remover um conjunto de produtos.
 * Usado tanto na exclusão de um produto só quanto na exclusão em massa pela
 * categoria — se só o caminho de um produto limpasse, apagar a categoria
 * inteira recriaria as referências mortas.
 */
export function promotionUpdatesForRemovedItems(
  promotions: any[],
  itemIds: Set<string>,
): Array<{ id: string; items: any[] }> {
  const updates: Array<{ id: string; items: any[] }> = [];
  for (const promo of promotions || []) {
    const items = Array.isArray(promo?.items) ? promo.items : [];
    if (!items.some((i: any) => itemIds.has(i?.menuItemId))) continue;
    updates.push({ id: promo.id, items: items.filter((i: any) => !itemIds.has(i?.menuItemId)) });
  }
  return updates;
}

/** Apaga o produto e, no mesmo batch, tira ele de todas as promoções. */
export async function deleteMenuItemWithCleanup(
  db: any,
  itemId: string,
  promotions: any[],
  menuItems: any[] = [],
): Promise<void> {
  const comboWarning = comboReferenceWarning(menuItems, new Set([itemId]));
  if (comboWarning) throw new Error(comboWarning);
  const batch = writeBatch(db);
  batch.delete(doc(db, 'menuItems', itemId));
  for (const u of promotionUpdatesForRemovedItems(promotions, new Set([itemId]))) {
    batch.update(doc(db, 'promotions', u.id), { items: u.items });
  }
  await batch.commit();
}

/** Aviso pro dono, ou '' quando o produto não está em promoção nenhuma. */
export function deleteItemWarning(promotions: any[], itemId: string): string {
  const afetadas = promotionsUsingItem(promotions, itemId);
  if (afetadas.length === 0) return '';
  const nomes = afetadas.map((p: any) => `• ${p.name || 'promoção sem nome'}`).join('\n');
  return `\n\nEste produto está em ${afetadas.length} ${afetadas.length === 1 ? 'promoção' : 'promoções'} e será removido ${afetadas.length === 1 ? 'dela' : 'delas'} também:\n${nomes}`;
}
