'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useFirestore, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { getTheme } from '@/lib/themes';
import { isItemVisibleInChannel } from '@/lib/menu-visibility';

// Espelha a camada de dados do MenuPageClient (queries + promoções + tema +
// aberto/fechado) para as páginas dedicadas de Combos/Promoções. Mantido como
// hook único para que a lógica de promoção não divirja entre as telas.

function promoDateToMillis(value: any) {
  if (!value) return NaN;
  const date = value?.toDate?.() ? value.toDate() : new Date(value);
  return date.getTime();
}
function getPromotionStartMillis(promo: any) {
  const time = promoDateToMillis(promo.startDate);
  return Number.isFinite(time) ? time : 0;
}
function getPromotionEndMillis(promo: any) {
  if (promo.noEndDate || !promo.endDate) return Number.POSITIVE_INFINITY;
  const time = promoDateToMillis(promo.endDate);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}
function getPromotionEndDate(promo: any) {
  if (promo.noEndDate || !promo.endDate) return undefined;
  const date = promo.endDate?.toDate?.() ? promo.endDate.toDate() : new Date(promo.endDate);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const comboIcons: Record<string, string> = {
  padrao: '🍽️+🥤',
  marmitaria: '🍱+🥤',
  confeitaria: '🍪+🎂',
  pizzaria: '🍕+🥤',
  sucaria: '🥤+🍨',
  sorveteria: '🍦+🥤',
};

export type PromoInfo = {
  promoPrice: number;
  originalPrice: number;
  endDate?: Date;
  noEndDate?: boolean;
  promoName: string;
};

export function useStoreMenuData(storeSlug?: string, urlParam?: string | null) {
  const db = useFirestore();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  const slugId = storeSlug ? storeSlug.split('-').pop() : null;
  const rawStoreId = slugId || urlParam || null;

  // Resolve slugs curtos (≤8 chars) para o UID completo da loja
  const [resolvedStoreId, setResolvedStoreId] = useState<string | null>(null);
  const [slugResolved, setSlugResolved] = useState(false);

  useEffect(() => {
    if (!db || !rawStoreId) { setSlugResolved(true); return; }
    if (rawStoreId.length > 8) {
      setResolvedStoreId(rawStoreId);
      setSlugResolved(true);
      return;
    }
    import('firebase/firestore').then(({ collection, query, where, getDocs }) => {
      const q = query(collection(db, 'store_profiles'), where('shortSlug', '==', rawStoreId));
      getDocs(q).then((snap: any) => {
        setResolvedStoreId(!snap.empty ? snap.docs[0].id : rawStoreId);
        setSlugResolved(true);
      }).catch(() => {
        setResolvedStoreId(rawStoreId);
        setSlugResolved(true);
      });
    });
  }, [db, rawStoreId]);

  const storeIdFromUrl = resolvedStoreId;

  const storeRef = useMemoFirebase(() => {
    if (!db || !slugResolved || !storeIdFromUrl) return null;
    return doc(db, 'roles_admin', storeIdFromUrl);
  }, [db, slugResolved, storeIdFromUrl]);

  const categoriesQuery = useMemoFirebase(() => {
    if (!db || !slugResolved || !storeIdFromUrl) return null;
    return query(collection(db, 'categories'), where('ownerId', '==', storeIdFromUrl));
  }, [db, slugResolved, storeIdFromUrl]);

  const itemsQuery = useMemoFirebase(() => {
    if (!db || !slugResolved || !storeIdFromUrl) return null;
    return query(collection(db, 'menuItems'), where('ownerId', '==', storeIdFromUrl));
  }, [db, slugResolved, storeIdFromUrl]);

  const addonsQuery = useMemoFirebase(() => {
    if (!db || !slugResolved || !storeIdFromUrl) return null;
    return query(collection(db, 'addons'), where('ownerId', '==', storeIdFromUrl));
  }, [db, slugResolved, storeIdFromUrl]);

  const addonCategoriesQuery = useMemoFirebase(() => {
    if (!db || !slugResolved || !storeIdFromUrl) return null;
    return query(collection(db, 'addonCategories'), where('ownerId', '==', storeIdFromUrl));
  }, [db, slugResolved, storeIdFromUrl]);

  const promotionsQuery = useMemoFirebase(() => {
    if (!db || !slugResolved || !storeIdFromUrl) return null;
    return query(collection(db, 'promotions'), where('ownerId', '==', storeIdFromUrl));
  }, [db, slugResolved, storeIdFromUrl]);

  const { data: storeInfo } = useDoc(storeRef);
  const { data: categories, isLoading: loadingCats } = useCollection(categoriesQuery);
  const { data: items, isLoading: loadingItems } = useCollection(itemsQuery);
  const { data: addons } = useCollection(addonsQuery);
  const { data: addonCategories } = useCollection(addonCategoriesQuery);
  const { data: promotionsRaw } = useCollection(promotionsQuery);

  const storeId = storeIdFromUrl || (items && items.length > 0 ? (items[0] as any).ownerId : null);

  const storeProfileRef = useMemoFirebase(() => {
    if (!db || !storeId) return null;
    return doc(db, 'store_profiles', storeId);
  }, [db, storeId]);

  const { data: storeProfile, isLoading: loadingStoreProfile } = useDoc(storeProfileRef);

  const activePromotions = useMemo(() => {
    if (!promotionsRaw) return [];
    const nowMs = Date.now();
    return promotionsRaw.filter((p: any) => {
      if (!p.active) return false;
      return nowMs >= getPromotionStartMillis(p) && nowMs <= getPromotionEndMillis(p);
    });
  }, [promotionsRaw]);

  const promoItemsMap = useMemo(() => {
    const map: Record<string, PromoInfo> = {};
    activePromotions.forEach((p: any) => {
      const end = getPromotionEndDate(p);
      (p.items || []).forEach((pi: any) => {
        map[pi.menuItemId] = {
          promoPrice: pi.promoPrice,
          originalPrice: pi.originalPrice,
          endDate: end,
          noEndDate: !!p.noEndDate || !p.endDate,
          promoName: p.name,
        };
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

  const themeId = (storeProfile as any)?.theme || 'padrao';
  const theme = getTheme(themeId);
  const comboEmoji = comboIcons[themeId] || comboIcons.padrao;

  const isVisibleForCustomerMenu = useCallback(
    (item: any) => isItemVisibleInChannel(item, 'delivery'),
    []
  );

  const deliveryVisibleItems = useMemo(
    () => (items || []).filter(isVisibleForCustomerMenu),
    [items, isVisibleForCustomerMenu]
  );

  const hasOpenCashRegister = useMemo(() => {
    if (!storeId || loadingStoreProfile) return null;
    return Boolean((storeProfile as any)?.isCaixaAberto);
  }, [storeId, loadingStoreProfile, storeProfile]);

  const isStoreOpen = useMemo(() => {
    if (storeId && (loadingStoreProfile || hasOpenCashRegister !== true)) return false;
    if (!storeProfile) return true;
    if ((storeProfile as any).isCaixaAberto === false) return false;
    if ((storeProfile as any).general?.disableDelivery === true) return false;

    const timezone = (storeProfile as any)?.general?.timezone || 'America/Sao_Paulo';
    let localNow = new Date();
    try {
      localNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    } catch {
      localNow = new Date(now);
    }

    const sp = storeProfile as any;
    if (sp.plannedClosures && sp.plannedClosures.length > 0) {
      const yyyy = localNow.getFullYear();
      const mm = String(localNow.getMonth() + 1).padStart(2, '0');
      const dd = String(localNow.getDate()).padStart(2, '0');
      const todayStr = `${yyyy}-${mm}-${dd}`;
      if (sp.plannedClosures.find((c: any) => c.date === todayStr)) return false;
    }

    if (sp.workingHours && sp.workingHours.length > 0) {
      const dayOfWeek = localNow.getDay();
      const cleanDaysOfWeek = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
      const diacritics = new RegExp('[\\u0300-\\u036f]', 'g');
      const cleanDay = (d: string) =>
        String(d || '').trim().toLowerCase().normalize('NFD').replace(diacritics, '');
      const todayConfig = sp.workingHours.find((wh: any) => cleanDay(wh.day) === cleanDaysOfWeek[dayOfWeek]);
      if (todayConfig) {
        if (todayConfig.isClosed) return false;
        const [openHour, openMin] = todayConfig.open.split(':').map(Number);
        const [closeHour, closeMin] = todayConfig.close.split(':').map(Number);
        const currentMins = localNow.getHours() * 60 + localNow.getMinutes();
        const openMins = openHour * 60 + openMin;
        const closeMins = closeHour * 60 + closeMin;
        const open = closeMins <= openMins
          ? (currentMins >= openMins || currentMins <= closeMins)
          : (currentMins >= openMins && currentMins <= closeMins);
        if (!open) return false;
      }
    }

    return true;
  }, [storeId, loadingStoreProfile, hasOpenCashRegister, storeProfile, now]);

  const isLoading = !db || !slugResolved || loadingCats || loadingItems;

  return {
    isLoading,
    now,
    storeId,
    storeInfo,
    storeProfile,
    categories,
    items,
    addons,
    addonCategories,
    deliveryVisibleItems,
    activePromotions,
    promoItemsMap,
    promoOnlyIds,
    hasActivePromos,
    theme,
    themeId,
    comboEmoji,
    isStoreOpen,
    isVisibleForCustomerMenu,
  };
}
