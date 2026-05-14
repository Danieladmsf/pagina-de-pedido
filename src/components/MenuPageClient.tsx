
"use client"

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useFirestore, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, where, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { CartDrawer } from '@/components/cart/CartDrawer';
import { CustomerAccountButton } from '@/components/customer/CustomerAccountButton';
import { ActiveOrdersBanner } from '@/components/customer/ActiveOrdersBanner';
import { MenuItemDialog } from '@/components/menu/MenuItemDialog';
import { Toaster } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import { Plus, Search, Loader2, ShoppingBag, Leaf, Lock, ChevronLeft, ChevronRight, Info, ArrowLeft, MapPin, Phone, Clock as ClockIcon, Truck, CreditCard, Flame, Timer } from 'lucide-react';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getTheme, themeToCssVars, ensureBrandFontsLoaded } from '@/lib/themes';
import { useCart } from '@/components/providers/CartProvider';

function PromoCountdown({ endDate }: { endDate: Date }) {
  const [timeLeft, setTimeLeft] = React.useState('');

  React.useEffect(() => {
    const update = () => {
      const diff = endDate.getTime() - Date.now();
      if (diff <= 0) { setTimeLeft('Encerrada'); return; }
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      if (days > 0) setTimeLeft(`${days}d ${hours}h`);
      else if (hours > 0) setTimeLeft(`${hours}h ${mins}min`);
      else setTimeLeft(`${mins}min`);
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [endDate]);

  if (timeLeft === 'Encerrada') return null;

  return (
    <div className="flex items-center gap-1.5 text-[11px] font-bold text-orange-600 bg-orange-50 rounded-lg px-2.5 py-1.5 mb-3">
      <Timer className="h-3.5 w-3.5" />
      <span>Acaba em {timeLeft}</span>
    </div>
  );
}

export function MenuPageClient({ storeSlug }: { storeSlug?: string }) {
  const db = useFirestore();
  const { totalItems, totalPrice } = useCart();
  const searchParams = useSearchParams();
  const [activeCategoryId, setActiveCategoryId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const categoryScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [showStoreInfo, setShowStoreInfo] = useState(false);

  const checkScrollButtons = useCallback(() => {
    const el = categoryScrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);



  const scrollCategories = (direction: 'left' | 'right') => {
    const el = categoryScrollRef.current;
    if (!el) return;
    const scrollAmount = 280;
    el.scrollBy({ left: direction === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' });
  };

  const urlParam = searchParams.get('s');
  const slugId = storeSlug ? storeSlug.split('-').pop() : null;
  const rawStoreId = slugId || urlParam;

  // Resolve short slugs (≤8 chars) to full store UIDs
  const [resolvedStoreId, setResolvedStoreId] = useState<string | null>(null);
  const [slugResolved, setSlugResolved] = useState(false);

  useEffect(() => {
    if (!db || !rawStoreId) { setSlugResolved(true); return; }
    // If it looks like a full UID (>8 chars), use directly
    if (rawStoreId.length > 8) {
      setResolvedStoreId(rawStoreId);
      setSlugResolved(true);
      return;
    }
    // Short slug - look up in store_slugs collection
    import('firebase/firestore').then(({ getDoc, doc: fbDoc }) => {
      getDoc(fbDoc(db, 'store_slugs', rawStoreId)).then((snap: any) => {
        if (snap.exists()) {
          setResolvedStoreId(snap.data().storeId);
        } else {
          // Fallback: maybe it IS a short UID somehow
          setResolvedStoreId(rawStoreId);
        }
        setSlugResolved(true);
      }).catch(() => {
        setResolvedStoreId(rawStoreId);
        setSlugResolved(true);
      });
    });
  }, [db, rawStoreId]);

  const storeIdFromUrl = resolvedStoreId;

  // Proteção: Só tenta criar a referência se o 'db' for válido
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

  const promotionsQuery = useMemoFirebase(() => {
    if (!db || !slugResolved || !storeIdFromUrl) return null;
    return query(collection(db, 'promotions'), where('ownerId', '==', storeIdFromUrl));
  }, [db, slugResolved, storeIdFromUrl]);

  const { data: storeInfo } = useDoc(storeRef);
  const { data: categories, isLoading: loadingCats } = useCollection(categoriesQuery);
  const { data: items, isLoading: loadingItems } = useCollection(itemsQuery);
  const { data: addons } = useCollection(addonsQuery);
  const { data: promotionsRaw } = useCollection(promotionsQuery);

  // Active promotions: active=true AND within date range
  const activePromotions = useMemo(() => {
    if (!promotionsRaw) return [];
    const now = Date.now();
    return promotionsRaw.filter((p: any) => {
      if (!p.active) return false;
      const start = p.startDate?.toDate?.() ? p.startDate.toDate().getTime() : new Date(p.startDate).getTime();
      const end = p.endDate?.toDate?.() ? p.endDate.toDate().getTime() : new Date(p.endDate).getTime();
      return now >= start && now <= end;
    });
  }, [promotionsRaw]);

  // Map of menuItemId -> promoPrice for active promotions
  const promoItemsMap = useMemo(() => {
    const map: Record<string, { promoPrice: number; originalPrice: number; endDate: Date; promoName: string }> = {};
    activePromotions.forEach((p: any) => {
      const end = p.endDate?.toDate?.() ? p.endDate.toDate() : new Date(p.endDate);
      (p.items || []).forEach((pi: any) => {
        map[pi.menuItemId] = { promoPrice: pi.promoPrice, originalPrice: pi.originalPrice, endDate: end, promoName: p.name };
      });
    });
    return map;
  }, [activePromotions]);

  // Items that are promo-only (should only show in promo section)
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

  // Derivar storeId efetivo: do URL (?s=) ou do ownerId do primeiro item carregado
  const storeId = storeIdFromUrl || (items && items.length > 0 ? (items[0] as any).ownerId : null);

  const storeProfileRef = useMemoFirebase(() => {
    if (!db || !storeId) return null;
    return doc(db, 'store_profiles', storeId);
  }, [db, storeId]);

  const cashRegistersQuery = useMemoFirebase(() => {
    if (!db || !storeId) return null;
    return query(collection(db, 'cash_registers'), where('ownerId', '==', storeId));
  }, [db, storeId]);

  const { data: storeProfile } = useDoc(storeProfileRef);
  const { data: cashRegisters, isLoading: loadingCashRegisters } = useCollection(cashRegistersQuery);

  const hasOpenCashRegister = useMemo(() => {
    if (!storeId || loadingCashRegisters) return null;
    return (cashRegisters || []).some((cashRegister: any) => cashRegister.status === 'aberto');
  }, [storeId, loadingCashRegisters, cashRegisters]);

  const theme = getTheme((storeProfile as any)?.theme);
  const storeDisplayName = storeProfile?.general?.name || storeInfo?.storeName || '';
  const currentYear = new Date().getFullYear();
  const foundedYear = Number((storeProfile as any)?.general?.foundedYear);
  const footerYear = Number.isInteger(foundedYear) && foundedYear >= 1800 && foundedYear <= currentYear ? foundedYear : currentYear;
  const bannerDesktopUrl = (storeProfile as any)?.general?.bannerUrl as string | undefined;
  const bannerMobileUrl = (storeProfile as any)?.general?.bannerMobileUrl as string | undefined;
  const bannerImageUrl = bannerDesktopUrl || bannerMobileUrl;
  const hasBanner = Boolean(bannerImageUrl);
  const hasDedicatedMobileBanner = Boolean(bannerMobileUrl);
  const heroThemeBackground = theme.bgPattern || `linear-gradient(135deg, ${theme.colors.bg} 0%, ${theme.colors.surface} 100%)`;

  useEffect(() => { ensureBrandFontsLoaded(); }, []);

  useEffect(() => {
    document.title = storeDisplayName ? `${storeDisplayName} - Cardápio Digital` : 'Cardápio Digital';
  }, [storeDisplayName]);

  // 🔍 DEBUG: Ver storeId e storeProfile completo
  if (storeProfile) {
    console.log('[MenuPageClient] ✅ storeId=' + storeId + ' | address=' + (storeProfile?.general?.address || 'VAZIO') + ' | feeRules(root)=' + JSON.stringify(storeProfile?.feeRules) + ' | feeRules(fees)=' + JSON.stringify(storeProfile?.fees?.feeRules) + ' | deliveryFee=' + storeProfile?.fees?.deliveryFee);
  } else {
    console.log('[MenuPageClient] ❌ storeProfile é NULL/UNDEFINED | storeId=' + storeId);
  }

  // Controle de Presença (Cliente Online)
  React.useEffect(() => {
    if (!db || !storeId) return;
    const sessionId = Math.random().toString(36).substring(2, 15);
    const sessionRef = doc(db, 'active_sessions', sessionId);

    const ping = async () => {
      try {
        await setDoc(sessionRef, {
          storeId: storeId || 'default',
          lastActive: Date.now()
        });
      } catch (e) {}
    };

    ping();
    const interval = setInterval(ping, 30000); // 30s

    const handleUnload = () => {
      deleteDoc(sessionRef).catch(() => {});
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleUnload);
      handleUnload();
    };
  }, [db, storeId]);

  const visibleCategories = useMemo(() => {
    if (!categories) return [];
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 is Sunday
    const daysMap = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const currentDayName = daysMap[dayOfWeek];
    const currentHour = today.getHours();
    const currentMin = today.getMinutes();
    const currentMins = currentHour * 60 + currentMin;

    return categories.filter((cat: any) => {
      if (cat.isAvailable === false) return false;
      if (!cat.availability?.enabled) return true;
      
      const { days, startTime, endTime } = cat.availability;
      if (days && !days.includes(currentDayName)) return false;
      
      const [openHour, openMin] = (startTime || '00:00').split(':').map(Number);
      const [closeHour, closeMin] = (endTime || '23:59').split(':').map(Number);
      
      const openMins = openHour * 60 + openMin;
      const closeMins = closeHour * 60 + closeMin;
      
      return currentMins >= openMins && currentMins <= closeMins;
    }).sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  }, [categories]);

  useEffect(() => {
    const el = categoryScrollRef.current;
    if (!el) return;
    checkScrollButtons();
    el.addEventListener('scroll', checkScrollButtons, { passive: true });
    const ro = new ResizeObserver(checkScrollButtons);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', checkScrollButtons);
      ro.disconnect();
    };
  }, [checkScrollButtons, visibleCategories]);

  const filteredItems = useMemo(() => {
    if (!items) return [];
    
    // Only show items whose category is visible
    const visibleCategoryIds = new Set(visibleCategories.map(c => c.id));

    return items.filter(item => {
      if (item.isAvailable === false) return false;
      if (!visibleCategoryIds.has(item.categoryId)) return false;
      // Hide promo-only items from regular categories
      if (promoOnlyIds.has(item.id) && activeCategoryId !== '__promo__') return false;
      
      const matchesCategory = activeCategoryId === 'all' || activeCategoryId === '__promo__' || item.categoryId === activeCategoryId;
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           item.description.toLowerCase().includes(searchQuery.toLowerCase());
      
      // If promo category is selected, only show promo items
      if (activeCategoryId === '__promo__') {
        return promoItemsMap[item.id] && matchesSearch;
      }
      return matchesCategory && matchesSearch;
    });
  }, [activeCategoryId, searchQuery, items, visibleCategories]);

  const isStoreOpenRightNow = useMemo(() => {
    if (storeId && (loadingCashRegisters || hasOpenCashRegister !== true)) {
      return { isOpen: false, reason: 'caixa_closed' };
    }

    if (!storeProfile) return { isOpen: true, reason: '' };

    // Compatibilidade com perfis antigos: se o perfil marcar fechado, respeita tambem.
    if (storeProfile.isCaixaAberto === false) {
      return { isOpen: false, reason: 'caixa_closed' };
    }

    // Check planned closures (feriados/folgas agendadas)
    if (storeProfile.plannedClosures && storeProfile.plannedClosures.length > 0) {
      const todayStr = new Date().toISOString().split('T')[0];
      const closure = storeProfile.plannedClosures.find((c: any) => c.date === todayStr);
      if (closure) {
        return { isOpen: false, reason: closure.reason ? `Fechado hoje: ${closure.reason}` : 'hours_closed' };
      }
    }

    // Check working hours
    if (storeProfile.workingHours && storeProfile.workingHours.length > 0) {
      const today = new Date();
      const dayOfWeek = today.getDay(); // 0 is Sunday
      const daysMap = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
      const currentDayName = daysMap[dayOfWeek];

      const todayConfig = storeProfile.workingHours.find((wh: any) => wh.day === currentDayName);

      if (todayConfig) {
        if (todayConfig.isClosed) return { isOpen: false, reason: 'hours_closed' };
        
        const [openHour, openMin] = todayConfig.open.split(':').map(Number);
        const [closeHour, closeMin] = todayConfig.close.split(':').map(Number);
        
        const currentHour = today.getHours();
        const currentMin = today.getMinutes();
        
        const currentMins = currentHour * 60 + currentMin;
        const openMins = openHour * 60 + openMin;
        const closeMins = closeHour * 60 + closeMin;
        
        if (currentMins < openMins || currentMins > closeMins) {
          return { isOpen: false, reason: 'hours_closed' };
        }
      }
    }

    return { isOpen: true, reason: '' };
  }, [storeId, loadingCashRegisters, hasOpenCashRegister, storeProfile]);

  if (!db || !slugResolved || loadingCats || loadingItems) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF7]">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground font-medium">Buscando sabores...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden pb-24 relative" style={themeToCssVars(theme)}>
      {showStoreInfo && (
        <div className="min-h-screen bg-[#FAFAF7]">
          {/* Header */}
          <div className="bg-white sticky top-0 z-30 shadow-sm border-b">
            <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
              <button onClick={() => setShowStoreInfo(false)} className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
                <ArrowLeft className="h-5 w-5 text-slate-700" />
              </button>
              <h1 className="text-lg font-bold text-slate-800">Informações da Loja</h1>
            </div>
          </div>

          <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
            {/* Logo + Nome */}
            <div className="bg-white rounded-2xl shadow-sm border p-6 flex items-center gap-4">
              {storeProfile?.general?.logoUrl ? (
                <img src={storeProfile.general.logoUrl} alt="Logo" className="w-16 h-16 rounded-2xl object-cover ring-2 ring-primary/20 shadow" />
              ) : (
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-emerald-700 flex items-center justify-center text-white font-black text-xl ring-2 ring-primary/20 shadow">
                  {(storeProfile?.general?.name || 'L').charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <h2 className="text-xl font-black text-slate-800">{storeProfile?.general?.name || 'Minha Loja'}</h2>
                <p className="text-sm text-muted-foreground">Cardápio Digital</p>
              </div>
            </div>

            {/* Mais Informações */}
            <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/15 to-emerald-500/15 border border-primary/20 flex items-center justify-center">
                  <Truck className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-bold text-slate-800">Mais Informações</h2>
                  <p className="text-xs text-muted-foreground">Regras de entrega e retirada.</p>
                </div>
              </header>
              <div className="p-6 space-y-3 text-sm">
                <div className="flex justify-between items-center py-1.5 border-b border-slate-50">
                  <span className="text-muted-foreground">Pedido mínimo de:</span>
                  <span className="font-bold text-slate-700">R$ {(storeProfile?.fees?.minOrderValue || 0).toFixed(2)}</span>
                </div>
                {(() => {
                  const rules = storeProfile?.fees?.feeRules || storeProfile?.feeRules || [];
                  const fixedFee = storeProfile?.fees?.deliveryFee || 0;
                  if (rules.length > 0) {
                    const fees = rules.map((r: any) => r.fee).sort((a: number, b: number) => a - b);
                    return (
                      <div className="flex justify-between items-center py-1.5 border-b border-slate-50">
                        <span className="text-muted-foreground">Taxa de entrega:</span>
                        <span className="font-bold text-slate-700">R$ {fees[0].toFixed(2)} a R$ {fees[fees.length - 1].toFixed(2)}</span>
                      </div>
                    );
                  } else if (fixedFee > 0) {
                    return (
                      <div className="flex justify-between items-center py-1.5 border-b border-slate-50">
                        <span className="text-muted-foreground">Taxa de entrega:</span>
                        <span className="font-bold text-slate-700">R$ {fixedFee.toFixed(2)}</span>
                      </div>
                    );
                  }
                  return null;
                })()}
                <div className="flex justify-between items-center py-1.5 border-b border-slate-50">
                  <span className="text-muted-foreground">Tempo de entrega:</span>
                  <span className="font-bold text-slate-700">{storeProfile?.fees?.deliveryTime || '00:50'}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-slate-50">
                  <span className="text-muted-foreground">Aceita retirada no local:</span>
                  <span className="font-bold text-emerald-600">Sim</span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-muted-foreground">Tempo de retirada:</span>
                  <span className="font-bold text-slate-700">{storeProfile?.fees?.pickupTime || '00:30'}</span>
                </div>
              </div>
            </section>

            {/* Contato */}
            {(storeProfile?.general?.phone || storeProfile?.general?.whatsapp) && (
              <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500/15 to-cyan-500/15 border border-blue-500/20 flex items-center justify-center">
                    <Phone className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-base font-bold text-slate-800">Contato</h2>
                    <p className="text-xs text-muted-foreground">Fale conosco por telefone ou WhatsApp.</p>
                  </div>
                </header>
                <div className="p-6 space-y-2 text-sm">
                  {storeProfile?.general?.phone && (
                    <a href={`tel:${storeProfile.general.phone.replace(/\D/g, '')}`} className="flex items-center gap-3 text-slate-700 hover:text-primary transition-colors p-2 rounded-lg hover:bg-primary/5">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{storeProfile.general.phone}</span>
                    </a>
                  )}
                  {storeProfile?.general?.whatsapp && (
                    <a href={`https://wa.me/55${storeProfile.general.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-slate-700 hover:text-emerald-600 transition-colors p-2 rounded-lg hover:bg-emerald-50">
                      <span className="text-lg">📱</span>
                      <span className="font-medium">{storeProfile.general.whatsapp}</span>
                      <span className="text-xs text-emerald-600 font-bold ml-auto">WhatsApp →</span>
                    </a>
                  )}
                </div>
              </section>
            )}

            {/* Endereço */}
            {storeProfile?.general?.address && (
              <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500/15 to-pink-500/15 border border-purple-500/20 flex items-center justify-center">
                    <MapPin className="h-5 w-5 text-purple-600" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-base font-bold text-slate-800">Endereço</h2>
                    <p className="text-xs text-muted-foreground">Onde estamos localizados.</p>
                  </div>
                </header>
                <div className="p-6">
                  <p className="text-sm text-slate-700 leading-relaxed">
                    {storeProfile.general.address}{storeProfile.general.addressNumber ? `, ${storeProfile.general.addressNumber}` : ''}{storeProfile.general.addressComplement ? ` - ${storeProfile.general.addressComplement}` : ''}
                  </p>
                </div>
              </section>
            )}

            {/* Horários */}
            {storeProfile?.workingHours && storeProfile.workingHours.length > 0 && (
              <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500/15 to-orange-500/15 border border-amber-500/20 flex items-center justify-center">
                    <ClockIcon className="h-5 w-5 text-amber-600" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-base font-bold text-slate-800">Horário de Funcionamento</h2>
                    <p className="text-xs text-muted-foreground">Confira quando estamos abertos.</p>
                  </div>
                </header>
                <div className="p-6 space-y-0">
                  {storeProfile.workingHours.map((wh: any, i: number) => {
                    const today = new Date();
                    const daysMap = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
                    const isToday = wh.day === daysMap[today.getDay()];
                    return (
                      <div key={i} className={`flex justify-between items-center py-2.5 text-sm ${i < storeProfile.workingHours.length - 1 ? 'border-b border-slate-50' : ''} ${isToday ? 'bg-primary/5 -mx-2 px-2 rounded-lg' : ''}`}>
                        <span className={`font-medium ${isToday ? 'text-primary font-bold' : 'text-slate-600'}`}>
                          {wh.day}{isToday ? ' (Hoje)' : ''}
                        </span>
                        {wh.isClosed ? (
                          <span className="text-red-500 font-bold text-xs uppercase">Fechado</span>
                        ) : (
                          <span className={`font-bold ${isToday ? 'text-primary' : 'text-slate-700'}`}>{wh.open} - {wh.close}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Formas de Pagamento */}
            {storeProfile?.paymentMethods && storeProfile.paymentMethods.filter((p: any) => p.active).length > 0 && (
              <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500/15 to-teal-500/15 border border-emerald-500/20 flex items-center justify-center">
                    <CreditCard className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-base font-bold text-slate-800">Formas de Pagamento</h2>
                    <p className="text-xs text-muted-foreground">Opções de pagamento no estabelecimento.</p>
                  </div>
                </header>
                <div className="p-6">
                  <div className="flex flex-wrap gap-2">
                    {storeProfile.paymentMethods.filter((p: any) => p.active).map((pm: any) => (
                      <span key={pm.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 rounded-full text-sm font-medium text-slate-700 border border-slate-100">
                        <span>{pm.icon}</span> {pm.label}
                      </span>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* Botão Voltar ao Cardápio */}
            <div className="pt-4 pb-8">
              <Button onClick={() => setShowStoreInfo(false)} className="w-full h-12 rounded-2xl font-bold text-base">
                ← Voltar ao Cardápio
              </Button>
            </div>
          </div>
        </div>
      )}
      {!showStoreInfo && (<div className="w-full max-w-full overflow-x-hidden">
      {!isStoreOpenRightNow.isOpen && (
        <div className="bg-red-500/95 backdrop-blur text-white text-center py-2.5 px-4 font-bold text-sm z-50 sticky top-0 shadow-md flex items-center justify-center gap-2">
          {isStoreOpenRightNow.reason === 'hours_closed' 
            ? '⚠️ Fechado no momento devido ao horário de funcionamento.'
            : '⚠️ Abriremos em breve! O sistema está sendo preparado.'}
        </div>
      )}
      <section className={`relative w-full overflow-hidden ${hasBanner ? 'min-h-[255px] sm:min-h-[330px] md:min-h-[430px]' : 'min-h-[235px] sm:min-h-[280px] md:min-h-[340px]'}`}>
        <div className="absolute inset-0">
          <div className="absolute inset-0" style={{ background: heroThemeBackground }} />
          {hasBanner ? (
            <>
              <div
                className={`absolute inset-0 md:hidden ${hasDedicatedMobileBanner ? 'bg-cover bg-center' : 'bg-contain bg-top bg-no-repeat'}`}
                style={{ backgroundImage: `url("${bannerMobileUrl || bannerImageUrl}")` }}
              />
              <div
                className="absolute inset-0 hidden bg-cover bg-center md:block"
                style={{ backgroundImage: `url("${bannerDesktopUrl || bannerImageUrl}")` }}
              />
            </>
          ) : null}
          <div className={hasBanner ? "absolute inset-0 bg-[linear-gradient(90deg,rgba(15,23,42,0.34),rgba(15,23,42,0.04)_46%,rgba(15,23,42,0.16)),linear-gradient(180deg,rgba(15,23,42,0.18),transparent_36%,rgba(15,23,42,0.38))]" : "absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(255,255,255,0.76),transparent_34%),linear-gradient(90deg,rgba(255,255,255,0.34),rgba(255,255,255,0.08)_52%,rgba(255,255,255,0.28))]"} />
          <div
            className="absolute inset-x-0 bottom-0 h-24 pointer-events-none"
            style={{ background: `linear-gradient(to bottom, transparent, ${theme.colors.bg})` }}
          />
        </div>

        <div className="relative z-20 max-w-7xl mx-auto px-3 py-3 flex items-start justify-between md:px-8 md:py-4">
          <div className="inline-flex rounded-2xl border border-white/35 bg-white/20 p-1.5 shadow-2xl shadow-slate-950/25 backdrop-blur-md">
            {storeProfile?.general?.logoUrl ? (
              <img
                src={storeProfile.general.logoUrl}
                alt="Logo"
                className="h-14 w-14 shrink-0 rounded-xl object-cover ring-2 ring-white/90 shadow-lg md:h-20 md:w-20 md:rounded-2xl"
              />
            ) : (
              <div className="h-14 w-14 shrink-0 rounded-xl bg-primary text-primary-foreground flex items-center justify-center text-2xl font-black shadow-lg ring-2 ring-white/90 md:h-20 md:w-20 md:rounded-2xl md:text-3xl">
                {(storeProfile?.general?.name || storeInfo?.storeName || 'G').charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <CustomerAccountButton />
            <button
              onClick={() => setShowStoreInfo(true)}
              className="w-11 h-11 rounded-2xl bg-white/90 backdrop-blur shadow-md border border-primary/10 flex items-center justify-center text-primary hover:bg-primary hover:text-white transition-all"
              aria-label="Informações da loja"
            >
              <Info className="h-5 w-5" />
            </button>
            {/* 🔍 DEBUG */}
            {(() => {
              console.log('[MenuPageClient] storeProfile para CartDrawer:', {
                fees: storeProfile?.fees,
                feeRules_root: storeProfile?.feeRules,
                feeRules_fees: storeProfile?.fees?.feeRules,
                address: storeProfile?.general?.address?.substring(0, 30),
                deliveryFee: storeProfile?.fees?.deliveryFee,
                maxRadius: storeProfile?.fees?.maxDeliveryRadius,
              });
              return null;
            })()}
            <CartDrawer
              storeOwnerId={storeId}
              deliveryFee={storeProfile?.fees?.deliveryFee || (storeInfo as any)?.deliveryFee || 0}
              storeAddress={storeProfile?.general?.address || (storeInfo as any)?.storeAddress || ''}
              deliveryFeeRules={storeProfile?.fees?.feeRules || storeProfile?.feeRules || (storeInfo as any)?.deliveryFeeRules || []}
              maxDeliveryRadius={storeProfile?.fees?.maxDeliveryRadius || 0}
              paymentMethods={storeProfile?.paymentMethods}
              isStoreOpen={isStoreOpenRightNow.isOpen}
              menuItems={items || []}
              enableInventory={storeProfile?.general?.enableInventory || false}
              themeId={(storeProfile as any)?.theme}
            />
          </div>
        </div>
        <div className="relative z-10 max-w-7xl mx-auto px-3 pb-3 pt-24 sm:pt-32 md:px-8 md:pb-8 md:pt-56" />
      </section>

      <div className="relative z-20 max-w-7xl mx-auto px-3 pt-2 md:px-8 md:pt-3">
        <div className="rounded-2xl border border-primary/10 bg-white/95 p-2.5 shadow-xl shadow-slate-900/10 backdrop-blur-xl md:rounded-[1.75rem] md:p-4">
          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(280px,420px)_minmax(0,1fr)] lg:items-center">
            <div className="relative min-w-0">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-primary/55 md:left-4 md:h-5 md:w-5" />
              <Input
                placeholder="O que você quer saborear hoje?"
                className="h-12 rounded-xl border-white/70 bg-white pl-10 text-sm shadow-md focus:ring-accent md:h-14 md:rounded-2xl md:pl-11 md:text-base"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="relative min-w-0 max-w-full group/cats">
              {/* Left fade gradient */}
              <div className={`hidden md:block absolute left-10 top-0 bottom-0 w-8 bg-gradient-to-r from-white to-transparent z-[5] pointer-events-none transition-opacity duration-200 ${canScrollLeft ? 'opacity-100' : 'opacity-0'}`} />

              {/* Left scroll arrow - desktop only */}
              <button
                onClick={() => scrollCategories('left')}
                className={`hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 z-10 w-9 h-9 items-center justify-center rounded-full bg-white/95 shadow-lg border border-primary/10 text-primary hover:bg-primary hover:text-white transition-all duration-200 ${canScrollLeft ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                aria-label="Scroll categorias esquerda"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>

              {/* Category buttons */}
              <div
                ref={categoryScrollRef}
                className="flex max-w-full min-w-0 flex-row gap-2 overflow-x-auto pb-1 hide-scrollbar snap-x md:mx-11"
              >
                <Button
                  variant={activeCategoryId === 'all' ? 'default' : 'outline'}
                  className={`rounded-full px-4 whitespace-nowrap h-10 text-xs font-bold transition-all shadow-sm flex-shrink-0 md:h-11 md:px-6 md:text-sm ${
                    activeCategoryId === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-white border-primary/20 text-primary hover:bg-primary/5'
                  }`}
                  onClick={() => setActiveCategoryId('all')}
                >
                  Todos
                </Button>
                {hasActivePromos && (
                  <Button
                    variant={activeCategoryId === '__promo__' ? 'default' : 'outline'}
                    className={`rounded-full px-4 whitespace-nowrap h-10 text-xs font-bold transition-all shadow-sm flex-shrink-0 md:h-11 md:px-6 md:text-sm gap-1.5 ${
                      activeCategoryId === '__promo__'
                      ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white border-0 shadow-orange-500/30 shadow-lg'
                      : 'bg-white border-orange-300 text-orange-600 hover:bg-orange-50 animate-pulse'
                    }`}
                    onClick={() => setActiveCategoryId('__promo__')}
                  >
                    <Flame className="h-4 w-4" /> Promoções
                  </Button>
                )}
                {visibleCategories.map((cat) => (
                  <Button
                    key={cat.id}
                    variant={activeCategoryId === cat.id ? 'default' : 'outline'}
                    className={`rounded-full px-4 whitespace-nowrap h-10 text-xs font-bold transition-all shadow-sm flex-shrink-0 md:h-11 md:px-6 md:text-sm ${
                      activeCategoryId === cat.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-white border-primary/20 text-primary hover:bg-primary/5'
                    }`}
                    onClick={() => setActiveCategoryId(cat.id)}
                  >
                    {cat.name}
                  </Button>
                ))}
              </div>

              {/* Right fade gradient */}
              <div className={`hidden md:block absolute right-10 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent z-[5] pointer-events-none transition-opacity duration-200 ${canScrollRight ? 'opacity-100' : 'opacity-0'}`} />

              {/* Right scroll arrow - desktop only */}
              <button
                onClick={() => scrollCategories('right')}
                className={`hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 z-10 w-9 h-9 items-center justify-center rounded-full bg-white/95 shadow-lg border border-primary/10 text-primary hover:bg-primary hover:text-white transition-all duration-200 ${canScrollRight ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                aria-label="Scroll categorias direita"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
      <ActiveOrdersBanner />
      <div className="max-w-7xl mx-auto w-full overflow-x-hidden px-3 pt-5 md:px-8 md:pt-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-3 xl:grid-cols-4">
        {filteredItems.map((item) => {
          const rawStock = item.stockQuantity;
          const hasStockControl = rawStock !== null && rawStock !== undefined && rawStock !== '';
          const currentStock = hasStockControl ? Number(rawStock) : null;
          const isOutOfStock = storeProfile?.general?.enableInventory && hasStockControl && currentStock !== null && currentStock <= 0;
          
          return (
          (() => {
            const promo = promoItemsMap[item.id];
            const isPromoItem = !!promo;
            const displayPrice = isPromoItem ? promo.promoPrice : item.price;
            const discountPct = isPromoItem && promo.originalPrice > 0 ? Math.round((1 - promo.promoPrice / promo.originalPrice) * 100) : 0;

            return (
            <Card 
              key={item.id} 
              className={`group overflow-hidden border-none shadow-md hover:shadow-2xl transition-all cursor-pointer rounded-2xl bg-white flex flex-col md:rounded-3xl ${isOutOfStock ? 'opacity-60 grayscale-[0.5] pointer-events-none' : ''} ${isPromoItem ? 'ring-2 ring-orange-400/40' : ''}`}
              onClick={() => !isOutOfStock && setSelectedItem(item)}
            >
              <div className="relative h-44 w-full md:h-56">
                <Image 
                  src={item.imageUrl || 'https://picsum.photos/seed/placeholder/600/400'} 
                  alt={item.name} 
                  fill 
                  className="object-cover group-hover:scale-105 transition-transform duration-700"
                />
                {isPromoItem ? (
                  <>
                    <Badge className="absolute top-3 left-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-black border-none shadow-lg px-2.5 py-1 text-sm md:top-4 md:left-4 gap-1">
                      <Flame className="h-3.5 w-3.5" /> -{discountPct}%
                    </Badge>
                    <div className="absolute top-3 right-3 md:top-4 md:right-4 flex flex-col items-end gap-1">
                      <Badge className="bg-accent text-white font-black border-none shadow-lg px-2.5 py-1 text-sm md:px-3 md:text-base">
                        R$ {displayPrice.toFixed(2)}
                      </Badge>
                      <span className="text-[11px] font-bold text-white/90 line-through bg-black/40 backdrop-blur-sm rounded px-1.5 py-0.5">
                        R$ {promo.originalPrice.toFixed(2)}
                      </span>
                    </div>
                  </>
                ) : (
                  <Badge className="absolute top-3 right-3 bg-accent text-white font-black border-none shadow-lg px-2.5 py-1 text-sm md:top-4 md:right-4 md:px-3 md:text-base">
                    R$ {item.price.toFixed(2)}
                  </Badge>
                )}
                {storeProfile?.general?.enableInventory && hasStockControl && currentStock !== null && (
                  <Badge className={`absolute bottom-3 right-3 font-bold border-none shadow-lg px-2 py-1 text-[11px] md:bottom-4 md:right-4 md:px-2.5 md:text-xs ${isOutOfStock ? 'bg-red-600 text-white' : currentStock <= 5 ? 'bg-amber-500/90 text-white backdrop-blur' : 'bg-white/90 text-emerald-700 backdrop-blur'}`}>
                    {isOutOfStock ? 'Esgotado' : `Estoque: ${currentStock}`}
                  </Badge>
                )}
              </div>
              <CardContent className="p-4 flex flex-col flex-1 md:p-6">
                <div className="flex-1 space-y-2 mb-4">
                  <h3 className="min-h-[2.5rem] text-base font-black leading-tight text-primary line-clamp-2 group-hover:text-accent transition-colors md:min-h-[3.25rem] md:text-lg">
                    {item.name}
                  </h3>
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed md:text-sm md:line-clamp-3">
                    {item.description}
                  </p>
                </div>
                {isPromoItem && (
                  <PromoCountdown endDate={promo.endDate} />
                )}
                <div className="flex items-center justify-between pt-4 border-t border-muted">
                  <span className="max-w-[calc(100%-3rem)] truncate text-[10px] font-black text-primary/40 uppercase tracking-widest md:text-xs">
                    {isPromoItem ? <span className="text-orange-500">🔥 PROMO</span> : categories?.find(c => c.id === item.categoryId)?.name}
                  </span>
                  <Button disabled={isOutOfStock} size="sm" className={`text-white h-9 w-9 p-0 rounded-xl shadow-md transition-colors md:h-10 md:w-10 ${isOutOfStock ? 'bg-slate-300' : isPromoItem ? 'bg-orange-500 hover:bg-orange-600' : 'bg-primary hover:bg-accent'}`}>
                    <Plus className="h-5 w-5 md:h-6 md:w-6" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            );
          })()
        )})}
      </div>

      {filteredItems.length === 0 && (
        <div className="py-20 text-center space-y-4">
          <p className="text-xl text-muted-foreground font-medium">Ops! Esta loja ainda não tem itens no cardápio.</p>
        </div>
      )}

      <footer className="mt-20 pt-10 border-t border-primary/10 text-center text-muted-foreground text-sm space-y-4">
        <div>
          <p className="font-bold">© {footerYear} {storeDisplayName || 'Minha Loja'}</p>
          <p>{storeId ? 'Cardápio Digital Profissional' : 'Faça seu pedido online'}</p>
        </div>
        <div className="pt-4 flex justify-center gap-4">
          <Link href="/" className="inline-flex items-center gap-1 text-[10px] opacity-30 hover:opacity-100">
            <Lock className="h-3 w-3" /> Área Restrita
          </Link>
          <Link href="/register" className="inline-flex items-center gap-1 text-[10px] opacity-30 hover:opacity-100">
            Crie seu Cardápio
          </Link>
        </div>
      </footer>

      <MenuItemDialog
        item={selectedItem}
        isOpen={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        allAddons={addons || []}
        isStoreOpen={isStoreOpenRightNow.isOpen}
      />
      </div>
      </div>)}
      {/* Botão flutuante - Finalizar Pedido */}
      {totalItems > 0 && !showStoreInfo && (
        <button
          onClick={() => {
            // Dispara clique no botão do carrinho para abrir o Sheet
            const cartBtn = document.querySelector('[data-cart-trigger]') as HTMLElement;
            if (cartBtn) cartBtn.click();
          }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center justify-between bg-primary hover:bg-primary/90 text-white px-6 py-4 rounded-2xl shadow-2xl shadow-primary/30 transition-all duration-300 animate-in slide-in-from-bottom-4 fade-in w-[92vw] sm:w-[380px]"
        >
          <span className="font-bold text-base whitespace-nowrap">Finalizar Pedido</span>
          <span className="font-black text-base whitespace-nowrap">
            R$ {totalPrice.toFixed(2)}
          </span>
        </button>
      )}
      <Toaster />
    </div>
  );
}
