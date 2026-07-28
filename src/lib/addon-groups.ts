/**
 * Fonte única da regra de "etapa de adicionais" (addonGroups).
 *
 * Existia uma cópia dessa resolução no MenuItemDialog (cardápio) e pedaços dela
 * espalhados no admin. Quando as cópias divergiram, nasceu um beco sem saída: a
 * etapa sem adicional disponível sumia da tela mas continuava sendo exigida na
 * validação, e o botão "Adicionar" ficava morto pra sempre, sem explicar nada.
 *
 * Regra central: **não se exige mais escolhas do que existem opções**. Se a loja
 * pausou ou excluiu adicionais, o mínimo efetivo acompanha o que sobrou.
 */

export interface ResolvedGroup {
  /** Adicionais que o cliente realmente vê (existem e estão ativos). */
  availableAddons: any[];
  /** Mínimo que a loja configurou. */
  configuredMin: number;
  /** Mínimo cobrável de verdade: nunca maior que o número de opções. */
  min: number;
  max: number;
  /** A loja pede mais do que consegue oferecer (etapa "furada"). */
  isUnderSupplied: boolean;
}

const numericValue = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function getCategoryForGroup(group: any, addonCategories: any[]) {
  if (group?.addonCategoryId && group.addonCategoryId !== 'undefined') {
    const byId = (addonCategories || []).find((c: any) => c.id === group.addonCategoryId);
    if (byId) return byId;
  }
  if (group?.addonCategoryName && group.addonCategoryName !== 'undefined') {
    return (addonCategories || []).find((c: any) => c.name === group.addonCategoryName);
  }
  return undefined;
}

function categoryAddonIds(category: any, allAddons: any[]) {
  const removed = new Set(category.removedAddonIds || []);
  // Pausa local: o item segue no container, mas não aparece por ele.
  const paused = new Set(category.pausedAddonIds || []);
  const legacy = (allAddons || [])
    .filter((a: any) => (a.group || '').trim() === category.name)
    .map((a: any) => a.id);
  return Array.from(new Set([...(category.addonIds || []), ...legacy]))
    .filter((id) => !removed.has(id) && !paused.has(id));
}

export function getGroupAddonIds(group: any, allAddons: any[], addonCategories: any[]): string[] {
  const category = getCategoryForGroup(group, addonCategories);
  if (category) return categoryAddonIds(category, allAddons);
  if (group?.addonCategoryName) {
    const legacy = (allAddons || [])
      .filter((a: any) => (a.group || '').trim() === group.addonCategoryName)
      .map((a: any) => a.id);
    if (legacy.length > 0) return legacy;
  }
  return group?.addonIds || [];
}

/**
 * Resolve uma etapa. `unavailableAddonIds` permite simular "e se eu pausar/
 * excluir este adicional?" sem tocar no banco — é o que alimenta o aviso do admin.
 */
export function resolveGroup(
  group: any,
  allAddons: any[],
  addonCategories: any[],
  unavailableAddonIds?: Set<string>,
): ResolvedGroup {
  const ids = getGroupAddonIds(group, allAddons, addonCategories);
  const availableAddons = (allAddons || []).filter(
    (a: any) => ids.includes(a.id) && a.active !== false && !unavailableAddonIds?.has(a.id),
  );
  const category = getCategoryForGroup(group, addonCategories);
  const configuredMin = numericValue(category ? (category.min ?? group?.min) : group?.min);
  const max = numericValue(category ? category.max : group?.max);
  return {
    availableAddons,
    configuredMin,
    min: Math.min(configuredMin, availableAddons.length),
    max,
    isUnderSupplied: configuredMin > availableAddons.length,
  };
}

export interface UnderSuppliedProduct {
  product: any;
  groupName: string;
  configuredMin: number;
  available: number;
}

/**
 * Produtos cuja etapa OBRIGATÓRIA ficaria com menos opções do que o mínimo
 * pedido — ou seja, seriam vendidos com menos itens do que a loja configurou.
 * Passando `unavailableAddonIds`, responde "o que quebra se eu tirar isto?".
 */
export function findUnderSuppliedProducts(
  items: any[],
  allAddons: any[],
  addonCategories: any[],
  unavailableAddonIds?: Set<string>,
): UnderSuppliedProduct[] {
  const out: UnderSuppliedProduct[] = [];
  for (const product of items || []) {
    const groups = Array.isArray(product?.addonGroups) ? product.addonGroups : [];
    for (const group of groups) {
      const r = resolveGroup(group, allAddons, addonCategories, unavailableAddonIds);
      if (r.configuredMin > 0 && r.isUnderSupplied) {
        out.push({
          product,
          groupName: group?.name || 'etapa',
          configuredMin: r.configuredMin,
          available: r.availableAddons.length,
        });
      }
    }
  }
  return out;
}
