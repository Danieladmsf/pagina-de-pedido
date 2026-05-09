
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
import { Plus, Search, Loader2, ShoppingBag, Leaf, Lock, ChevronLeft, ChevronRight, Info, ArrowLeft, MapPin, Phone, Clock as ClockIcon, Truck, CreditCard } from 'lucide-react';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

export function MenuPageClient() {
  const db = useFirestore();
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

  const storeIdFromUrl = searchParams.get('s');

  // Proteção: Só tenta criar a referência se o 'db' for válido
  const storeRef = useMemoFirebase(() => {
    if (!db || !storeIdFromUrl) return null;
    return doc(db, 'roles_admin', storeIdFromUrl);
  }, [db, storeIdFromUrl]);

  const categoriesQuery = useMemoFirebase(() => {
    if (!db) return null;
    if (storeIdFromUrl) return query(collection(db, 'categories'), where('ownerId', '==', storeIdFromUrl));
    return collection(db, 'categories');
  }, [db, storeIdFromUrl]);

  const itemsQuery = useMemoFirebase(() => {
    if (!db) return null;
    if (storeIdFromUrl) return query(collection(db, 'menuItems'), where('ownerId', '==', storeIdFromUrl));
    return collection(db, 'menuItems');
  }, [db, storeIdFromUrl]);

  const addonsQuery = useMemoFirebase(() => {
    if (!db) return null;
    if (storeIdFromUrl) return query(collection(db, 'addons'), where('ownerId', '==', storeIdFromUrl));
    return collection(db, 'addons');
  }, [db, storeIdFromUrl]);

  const { data: storeInfo } = useDoc(storeRef);
  const { data: categories, isLoading: loadingCats } = useCollection(categoriesQuery);
  const { data: items, isLoading: loadingItems } = useCollection(itemsQuery);
  const { data: addons } = useCollection(addonsQuery);

  // Derivar storeId efetivo: do URL (?s=) ou do ownerId do primeiro item carregado
  const storeId = storeIdFromUrl || (items && items.length > 0 ? (items[0] as any).ownerId : null);

  const storeProfileRef = useMemoFirebase(() => {
    if (!db || !storeId) return null;
    return doc(db, 'store_profiles', storeId);
  }, [db, storeId]);

  const { data: storeProfile } = useDoc(storeProfileRef);

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
      
      const matchesCategory = activeCategoryId === 'all' || item.categoryId === activeCategoryId;
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           item.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [activeCategoryId, searchQuery, items, visibleCategories]);

  const isStoreOpenRightNow = useMemo(() => {
    if (!storeProfile) return { isOpen: true, reason: '' };

    // Check caixa
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
  }, [storeProfile]);

  if (!db || loadingCats || loadingItems) {
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
    <div className="min-h-screen pb-24 relative">
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
      {!showStoreInfo && (<>
      {!isStoreOpenRightNow.isOpen && (
        <div className="bg-red-500/95 backdrop-blur text-white text-center py-2.5 px-4 font-bold text-sm z-50 sticky top-0 shadow-md flex items-center justify-center gap-2">
          {isStoreOpenRightNow.reason === 'hours_closed' 
            ? '⚠️ Fechado no momento devido ao horário de funcionamento.'
            : '⚠️ Abriremos em breve! O sistema está sendo preparado.'}
        </div>
      )}
      <section
        className="relative w-full bg-no-repeat bg-top bg-[length:100%_auto] md:bg-[length:100%_100%] md:aspect-[1832/560] bg-[image:url('/lima-limao-bg-mobile.png')] md:bg-[image:url('/lima-limao-bg.png')]"
      >
        <div className="absolute inset-0 bg-white/25" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-white pointer-events-none" />
        <div className="relative max-w-7xl mx-auto px-4 md:px-8 py-6 flex justify-end">
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
            />
          </div>
        </div>
        <div className="relative max-w-7xl mx-auto px-4 md:px-8 pt-[78px] md:pt-[186px] pb-6 space-y-5">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="O que você quer saborear hoje?"
              className="pl-10 h-12 bg-white border-primary/10 rounded-2xl shadow-md focus:ring-accent"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="relative group/cats">
            {/* Left fade gradient */}
            <div className={`hidden md:block absolute left-10 top-0 bottom-0 w-8 bg-gradient-to-r from-white/80 to-transparent z-[5] pointer-events-none transition-opacity duration-200 ${canScrollLeft ? 'opacity-100' : 'opacity-0'}`} />

            {/* Left scroll arrow - desktop only */}
            <button
              onClick={() => scrollCategories('left')}
              className={`hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 z-10 w-9 h-9 items-center justify-center rounded-full bg-white/90 shadow-lg border border-primary/10 text-primary hover:bg-primary hover:text-white transition-all duration-200 ${canScrollLeft ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
              aria-label="Scroll categorias esquerda"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            {/* Category buttons */}
            <div
              ref={categoryScrollRef}
              className="flex flex-row gap-2 overflow-x-auto pb-4 md:pb-2 hide-scrollbar snap-x md:mx-11"
            >
              <Button
                variant={activeCategoryId === 'all' ? 'default' : 'outline'}
                className={`rounded-full px-6 whitespace-nowrap h-11 text-sm font-bold transition-all shadow-sm flex-shrink-0 ${
                  activeCategoryId === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-white border-primary/20 text-primary hover:bg-primary/5'
                }`}
                onClick={() => setActiveCategoryId('all')}
              >
                Todos
              </Button>
              {visibleCategories.map((cat) => (
                <Button
                  key={cat.id}
                  variant={activeCategoryId === cat.id ? 'default' : 'outline'}
                  className={`rounded-full px-6 whitespace-nowrap h-11 text-sm font-bold transition-all shadow-sm flex-shrink-0 ${
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
            <div className={`hidden md:block absolute right-10 top-0 bottom-0 w-8 bg-gradient-to-l from-white/80 to-transparent z-[5] pointer-events-none transition-opacity duration-200 ${canScrollRight ? 'opacity-100' : 'opacity-0'}`} />

            {/* Right scroll arrow - desktop only */}
            <button
              onClick={() => scrollCategories('right')}
              className={`hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 z-10 w-9 h-9 items-center justify-center rounded-full bg-white/90 shadow-lg border border-primary/10 text-primary hover:bg-primary hover:text-white transition-all duration-200 ${canScrollRight ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
              aria-label="Scroll categorias direita"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </section>
      <ActiveOrdersBanner />
      <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredItems.map((item) => {
          const rawStock = item.stockQuantity;
          const hasStockControl = rawStock !== null && rawStock !== undefined && rawStock !== '';
          const currentStock = hasStockControl ? Number(rawStock) : null;
          const isOutOfStock = storeProfile?.general?.enableInventory && hasStockControl && currentStock !== null && currentStock <= 0;
          
          return (
          <Card 
            key={item.id} 
            className={`group overflow-hidden border-none shadow-md hover:shadow-2xl transition-all cursor-pointer rounded-3xl bg-white flex flex-col ${isOutOfStock ? 'opacity-60 grayscale-[0.5] pointer-events-none' : ''}`}
            onClick={() => !isOutOfStock && setSelectedItem(item)}
          >
            <div className="relative h-56 w-full">
              <Image 
                src={item.imageUrl || 'https://picsum.photos/seed/placeholder/600/400'} 
                alt={item.name} 
                fill 
                className="object-cover group-hover:scale-105 transition-transform duration-700"
              />
              <Badge className="absolute top-4 right-4 bg-accent text-white font-black border-none shadow-lg px-3 py-1 text-base">
                R$ {item.price.toFixed(2)}
              </Badge>
              {storeProfile?.general?.enableInventory && hasStockControl && currentStock !== null && (
                <Badge className={`absolute bottom-4 right-4 font-bold border-none shadow-lg px-2.5 py-1 text-xs ${isOutOfStock ? 'bg-red-600 text-white' : currentStock <= 5 ? 'bg-amber-500/90 text-white backdrop-blur' : 'bg-white/90 text-emerald-700 backdrop-blur'}`}>
                  {isOutOfStock ? 'Esgotado' : `Estoque: ${currentStock}`}
                </Badge>
              )}
            </div>
            <CardContent className="p-6 flex flex-col flex-1">
              <div className="flex-1 space-y-2 mb-4">
                <h3 className="text-xl font-black text-primary group-hover:text-accent transition-colors">{item.name}</h3>
                <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
                  {item.description}
                </p>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-muted">
                <span className="text-xs font-black text-primary/40 uppercase tracking-widest">
                  {categories?.find(c => c.id === item.categoryId)?.name}
                </span>
                <Button disabled={isOutOfStock} size="sm" className={`text-white h-10 w-10 p-0 rounded-xl shadow-md transition-colors ${isOutOfStock ? 'bg-slate-300' : 'bg-primary hover:bg-accent'}`}>
                  <Plus className="h-6 w-6" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )})}
      </div>

      {filteredItems.length === 0 && (
        <div className="py-20 text-center space-y-4">
          <p className="text-xl text-muted-foreground font-medium">Ops! Esta loja ainda não tem itens no cardápio.</p>
        </div>
      )}

      <footer className="mt-20 pt-10 border-t border-primary/10 text-center text-muted-foreground text-sm space-y-4">
        <div>
          <p className="font-bold">© 2024 {storeProfile?.general?.name || storeInfo?.storeName || 'Lima Limão'}</p>
          <p>{storeId ? 'Cardápio Digital Profissional' : 'O verdadeiro sabor da fruta!'}</p>
        </div>
        <div className="pt-4 flex justify-center gap-4">
          <Link href="/admin" className="inline-flex items-center gap-1 text-[10px] opacity-30 hover:opacity-100">
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
      </>)}
      <Toaster />
    </div>
  );
}
