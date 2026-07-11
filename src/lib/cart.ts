// Matemática pura do carrinho, compartilhada pelos canais internos
// (NovoPedidoTab, MesasTab, edição do DeliveryTab) e pelo cardápio público
// (MenuPageClient, só as partes puras). O que fica em cada tela é a fiação de
// estado (setCart/setEditItemsCart, abrir diálogo, guardas por canal).

export type PromoPriceMap = Record<string, { promoPrice: number } | undefined>;

/** Item precisa do diálogo de customização (tem addons diretos ou grupos). */
export function itemNeedsCustomization(item: any): boolean {
  const hasNormalAddons = Array.isArray(item.addonIds) && item.addonIds.length > 0;
  const hasAddonGroups = Array.isArray(item.addonGroups) && item.addonGroups.some((group: any) => {
    return (Array.isArray(group.addonIds) && group.addonIds.length > 0)
      || group.addonCategoryId
      || group.addonCategoryName;
  });
  return hasNormalAddons || hasAddonGroups;
}

/** Aplica o preço promocional ao item (se houver promo para o id). */
export function applyPromoPrice(item: any, promoItemsMap: PromoPriceMap): any {
  const promo = promoItemsMap?.[item.id];
  return promo ? { ...item, price: promo.promoPrice } : item;
}

/**
 * Adiciona um item SEM addons: incrementa a quantidade se já existe uma linha
 * do mesmo id sem addons, senão anexa uma nova linha. Retorna o novo carrinho.
 */
export function addSimpleItemToCart(prev: any[], effectiveItem: any): any[] {
  const existingIndex = prev.findIndex(i => i.id === effectiveItem.id && (!i.addons || i.addons.length === 0));
  if (existingIndex > -1) {
    return prev.map((i, idx) => idx === existingIndex ? { ...i, quantity: i.quantity + 1 } : i);
  }
  return [
    ...prev,
    {
      ...effectiveItem,
      cartItemId: `${effectiveItem.id}-${Date.now()}`,
      quantity: 1,
      addons: [],
      notes: '',
      unitPrice: effectiveItem.price,
    },
  ];
}

/**
 * Monta a linha de carrinho vinda do diálogo de customização, somando os addons
 * no unitPrice. O chamador anexa ao seu próprio estado (setCart/setEditItemsCart).
 */
export function buildCustomizedCartItem(item: any, quantity: number, options: any): any {
  const unitPrice = item.price + (options.addons || []).reduce((acc: number, a: any) => acc + (a.price || 0), 0);
  return {
    ...item,
    cartItemId: `${item.id}-${Date.now()}`,
    quantity,
    addons: options.addons || [],
    notes: options.notes || '',
    unitPrice,
  };
}
