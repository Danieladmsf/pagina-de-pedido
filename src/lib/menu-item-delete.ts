/**
 * Exclusão de produto SEM deixar referência morta atrás.
 *
 * `promotions.items[].menuItemId` é a única referência cruzada a `menuItems` no
 * projeto. Apagar só o produto deixava a linha órfã na promoção — a tela de
 * Promoções mostrava um item em branco e o "de/por" apontava pro vazio. Na Lima
 * Limão isso já tinha acontecido 5 vezes antes de alguém notar.
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
export async function deleteMenuItemWithCleanup(db: any, itemId: string, promotions: any[]): Promise<void> {
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
