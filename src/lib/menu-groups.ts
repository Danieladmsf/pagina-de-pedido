import { normalizeSearch } from '@/lib/utils';
import { isCategoryOn, isItemVisibleInChannel, type SalesChannel } from '@/lib/menu-visibility';
import type { PromoItemInfo } from '@/hooks/usePromotions';

// Agrupamento do cardápio para os canais internos (PDV/Mesa). Idêntico entre
// NovoPedidoTab e MesasTab, exceto pelo canal — a única diferença passa a ser o
// argumento `channel`. Garante que Promoções e Combos tenham sempre a própria
// seção em todos os canais (o combo já "sumiu" por falta da seção __combos__).

export type MenuGroup = { id: string; name: string; items: any[] };

export type MenuPromoInfo = {
  promoItemsMap: Record<string, PromoItemInfo>;
  promoOnlyIds: Set<string>;
  hasActivePromos: boolean;
};

export function buildAdminMenuGroups(
  items: any[] | null | undefined,
  categories: any[] | null | undefined,
  channel: SalesChannel,
  searchTerm: string,
  promo: MenuPromoInfo
): MenuGroup[] {
  const { promoItemsMap, promoOnlyIds, hasActivePromos } = promo;

  // Categoria desligada leva os produtos dela junto — inclusive os que estariam
  // na seção de Promoções. Combo não obedece categoria (tem seção própria).
  const categoriasDesligadas = new Set(
    (categories || []).filter((cat: any) => !isCategoryOn(cat)).map((cat: any) => cat.id)
  );

  const filteredItems = (items || []).filter((item: any) => {
    if (item.isAvailable === false) return false;
    if (!isItemVisibleInChannel(item, channel)) return false;
    if (!item.isCombo && categoriasDesligadas.has(item.categoryId)) return false;
    return normalizeSearch(item.name).includes(normalizeSearch(searchTerm));
  });

  const groups: MenuGroup[] = [];

  // Seção de Promoções
  if (hasActivePromos) {
    const promoItems = filteredItems.filter((item: any) => promoItemsMap[item.id]);
    if (promoItems.length > 0) {
      groups.push({ id: '__promo__', name: '🔥 Promoções', items: promoItems });
    }
  }

  // Seção de Combos (dedicada, para o combo aparecer em todos os canais e não
  // ficar "escondido" dentro de uma categoria)
  const comboItems = filteredItems.filter((it: any) => it.isCombo && !promoOnlyIds.has(it.id));
  if (comboItems.length > 0) {
    groups.push({ id: '__combos__', name: '🎁 Combos', items: comboItems });
  }

  // Categorias normais (combos ficam na seção Combos acima, não aqui)
  (categories || []).forEach((cat: any) => {
    const catItems = filteredItems.filter((it: any) => it.categoryId === cat.id && !it.isCombo && !promoOnlyIds.has(it.id));
    if (catItems.length > 0) {
      groups.push({ id: cat.id, name: cat.name, items: catItems });
    }
  });

  const uncategorizedItems = filteredItems.filter(
    (it: any) => !it.isCombo && !(categories || []).some((c: any) => c.id === it.categoryId) && !promoOnlyIds.has(it.id)
  );
  if (uncategorizedItems.length > 0) {
    groups.push({ id: '__none__', name: 'Outros', items: uncategorizedItems });
  }

  return groups;
}
