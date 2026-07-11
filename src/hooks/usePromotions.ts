import { useMemo } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { useCollection, useMemoFirebase } from '@/firebase';

// Fonte única das promoções ativas para os canais internos (PDV/Mesa). Antes
// esta lógica era copiada em NovoPedidoTab e MesasTab, e as duas liam o campo
// ERRADO (`p.products`) — as promoções são gravadas em `p.items` pelo
// PromotionsTab, então promo nunca aparecia nem aplicava preço nesses canais.
// Aqui lemos `p.items`, igual ao cardápio público.

export type PromoItemInfo = { promoPrice: number; originalPrice: number; promoName: string };

export type UsePromotionsResult = {
  activePromotions: any[];
  promoItemsMap: Record<string, PromoItemInfo>;
  promoOnlyIds: Set<string>;
  hasActivePromos: boolean;
};

export function usePromotions(db: any, ownerId?: string): UsePromotionsResult {
  const promotionsQuery = useMemoFirebase(() => {
    if (!db || !ownerId) return null;
    return query(collection(db, 'promotions'), where('ownerId', '==', ownerId));
  }, [db, ownerId]);

  const { data: promotionsRaw } = useCollection(promotionsQuery);

  const activePromotions = useMemo(() => {
    if (!promotionsRaw) return [];
    return promotionsRaw.filter((p: any) => {
      if (p.active === false) return false;
      const timeVal = (value: any) => {
        if (!value) return NaN;
        const date = value?.toDate?.() ? value.toDate() : new Date(value);
        return date.getTime();
      };
      const start = timeVal(p.startDate) || 0;
      const end = p.noEndDate || !p.endDate ? Number.POSITIVE_INFINITY : (timeVal(p.endDate) || Number.POSITIVE_INFINITY);
      const nowTime = Date.now();
      return nowTime >= start && nowTime <= end;
    });
  }, [promotionsRaw]);

  const promoItemsMap = useMemo(() => {
    const map: Record<string, PromoItemInfo> = {};
    activePromotions.forEach((p: any) => {
      (p.items || []).forEach((pi: any) => {
        map[pi.menuItemId] = { promoPrice: pi.promoPrice, originalPrice: pi.originalPrice, promoName: p.name };
      });
    });
    return map;
  }, [activePromotions]);

  const promoOnlyIds = useMemo(() => {
    const ids = new Set<string>();
    activePromotions.forEach((p: any) => {
      (p.items || []).forEach((pi: any) => {
        if (pi.promoOnly) ids.add(pi.menuItemId);
      });
    });
    return ids;
  }, [activePromotions]);

  const hasActivePromos = Object.keys(promoItemsMap).length > 0;

  return { activePromotions, promoItemsMap, promoOnlyIds, hasActivePromos };
}
