// Matemática pura do carrinho, compartilhada pelos canais internos
// (NovoPedidoTab, MesasTab, edição do DeliveryTab) e pelo cardápio público
// (MenuPageClient, só as partes puras). O que fica em cada tela é a fiação de
// estado (setCart/setEditItemsCart, abrir diálogo, guardas por canal).

export type PromoPriceMap = Record<string, { promoPrice: number } | undefined>;

/** Item vendido por peso (kg): `price` é o preço por quilo. */
export function isWeightItem(item: any): boolean {
  return item?.saleUnit === 'kg';
}

/** Arredonda para 2 casas evitando ruído de ponto flutuante. */
export function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Valor da linha de um item por peso: preço/kg × (gramas / 1000). */
export function weightLineUnitPrice(pricePerKg: number, grams: number): number {
  return roundMoney((Number(pricePerKg) || 0) * (Number(grams) || 0) / 1000);
}

/**
 * Cria uma NOVA linha de carrinho para um produto vendido por peso (kg).
 * Mantém quantity = 1 e usa `unitPrice` como o valor já calculado do peso,
 * então toda a matemática existente (`unitPrice * quantity`) continua correta.
 * O peso começa em 0 — o operador digita as gramas na própria linha.
 */
export function makeWeightCartLine(item: any, grams = 0): any {
  const pricePerKg = Number(item.price) || 0;
  return {
    ...item,
    cartItemId: `${item.id}-${Date.now()}`,
    saleUnit: 'kg',
    pricePerKg,
    weightGrams: grams,
    quantity: 1,
    addons: [],
    notes: '',
    unitPrice: weightLineUnitPrice(pricePerKg, grams),
  };
}

/** Recalcula o valor da linha por peso ao mudar as gramas. Retorna o novo carrinho. */
export function setCartLineWeight(prev: any[], cartItemId: string, grams: number): any[] {
  return prev.map((i) => {
    const key = i.cartItemId || i.id;
    if (key !== cartItemId) return i;
    const pricePerKg = Number(i.pricePerKg ?? i.price) || 0;
    return { ...i, weightGrams: grams, unitPrice: weightLineUnitPrice(pricePerKg, grams) };
  });
}

/** Primeiro item por peso ainda sem peso informado (bloqueia o fechamento). */
export function findUnweighedItem(items: any[]): any | undefined {
  return (items || []).find((i) => isWeightItem(i) && !(Number(i.weightGrams) > 0));
}

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
