'use client';

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Flame, Timer, ShoppingCart, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CartDrawer } from '@/components/cart/CartDrawer';
import { MenuItemDialog } from '@/components/menu/MenuItemDialog';
import { ProductGallery } from '@/components/menu/ProductGallery';
import { Toaster } from '@/components/ui/toaster';
import { StoreSplash } from '@/components/StoreSplash';
import { useCart } from '@/components/providers/CartProvider';
import { useStoreMenuData } from '@/hooks/useStoreMenuData';
import { themeToCssVars } from '@/lib/themes';
import { applyPromoPrice, itemNeedsCustomization } from '@/lib/cart';
import { brl } from '@/lib/utils';
import { checkCartStock, isOutOfStock } from '@/lib/inventory';
import { useToast } from '@/hooks/use-toast';

type ShowcaseMode = 'combos' | 'promocoes' | 'ofertas';

function Countdown({ endDate, noEndDate }: { endDate?: Date; noEndDate?: boolean }) {
  const [timeLeft, setTimeLeft] = useState('');
  useEffect(() => {
    if (noEndDate || !endDate) return;
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
  }, [endDate, noEndDate]);

  if (noEndDate || !endDate) {
    return (
      <div className="mb-3 flex items-center gap-1.5 rounded-lg bg-orange-50 px-2.5 py-1.5 text-[11px] font-bold text-orange-600">
        <Timer className="h-3.5 w-3.5" /> <span>Sem prazo</span>
      </div>
    );
  }
  if (timeLeft === 'Encerrada') return null;
  return (
    <div className="mb-3 flex items-center gap-1.5 rounded-lg bg-orange-50 px-2.5 py-1.5 text-[11px] font-bold text-orange-600">
      <Timer className="h-3.5 w-3.5" /> <span>Acaba em {timeLeft}</span>
    </div>
  );
}

export function ShowcasePageClient({
  storeSlug,
  mode,
  splashLogoUrl,
  splashStoreName,
  splashBg,
}: {
  storeSlug?: string;
  mode: ShowcaseMode;
  splashLogoUrl?: string;
  splashStoreName?: string;
  splashBg?: string;
}) {
  const searchParams = useSearchParams();
  const urlParam = searchParams.get('s');
  const { cart, addToCart, totalItems, totalPrice } = useCart();
  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  const data = useStoreMenuData(storeSlug, urlParam);
  const {
    isLoading, now, storeId, storeInfo, storeProfile,
    items, addons, addonCategories, deliveryVisibleItems,
    promoItemsMap, hasActivePromos, theme, comboEmoji, isStoreOpen,
    isVisibleForCustomerMenu,
  } = data;

  const { toast } = useToast();
  const inventoryOn = !!storeProfile?.general?.enableInventory;

  const isCombos = mode === 'combos';
  const isOfertas = mode === 'ofertas';
  const homeHref = `/${storeSlug ?? ''}${urlParam ? `?s=${urlParam}` : ''}`;

  const showcaseItems = useMemo(() => {
    if (!items) return [];
    return items.filter((item: any) => {
      if (item.isAvailable === false) return false;
      if (!isVisibleForCustomerMenu(item)) return false;
      if (item.startDate && now < new Date(item.startDate)) return false;
      if (item.endDate && now > new Date(item.endDate)) return false;
      if (isOfertas) return !!item.isCombo || !!promoItemsMap[item.id];
      return isCombos ? !!item.isCombo : !!promoItemsMap[item.id];
    });
  }, [items, isVisibleForCustomerMenu, now, isCombos, isOfertas, promoItemsMap]);

  const handleAddClick = useCallback((e: React.MouseEvent, item: any) => {
    e.preventDefault();
    e.stopPropagation();
    const effectiveItem = applyPromoPrice(item, promoItemsMap);
    if (itemNeedsCustomization(effectiveItem)) {
      setSelectedItem(effectiveItem);
      return;
    }
    // Sem esta trava o "+" desta página punha no carrinho produto já esgotado
    // (o erro só aparecia lá na frente, ao fechar o pedido).
    const check = checkCartStock([...cart, { ...effectiveItem, quantity: 1 }], items || [], inventoryOn);
    if (!check.allowed) {
      toast({ title: 'Estoque insuficiente', description: check.message, variant: 'destructive' });
      return;
    }
    addToCart(effectiveItem, 1, { addons: [], notes: '' });
  }, [addToCart, promoItemsMap, cart, items, inventoryOn, toast]);

  const openCart = () => {
    const cartBtn = document.querySelector('[data-cart-trigger]') as HTMLElement | null;
    cartBtn?.click();
  };

  if (isLoading) {
    return <StoreSplash logoUrl={splashLogoUrl} storeName={splashStoreName} bgColor={splashBg} />;
  }

  const heroGradient = isOfertas
    ? 'from-orange-500 via-pink-600 to-purple-600'
    : isCombos
      ? 'from-purple-600 via-fuchsia-600 to-pink-600'
      : 'from-orange-500 via-red-500 to-rose-600';
  const title = isOfertas ? 'Ofertas' : isCombos ? 'Combos' : 'Promoções';
  const heroIcon = isOfertas ? '🔥' : isCombos ? comboEmoji : '🔥';
  const subtitle = isOfertas
    ? 'Combos e promoções da casa reunidos num só lugar. Aproveite!'
    : isCombos
      ? 'Monte seu pedido pagando menos — combos exclusivos da casa.'
      : 'Ofertas por tempo limitado. Aproveite enquanto duram!';

  return (
    <div className="min-h-screen w-full max-w-full pb-24" style={themeToCssVars(theme)}>
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link
            href={homeHref}
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100"
            aria-label="Voltar ao cardápio"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          {storeProfile?.general?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={storeProfile.general.logoUrl} alt="" className="h-8 w-8 rounded-lg object-cover ring-1 ring-primary/15" />
          ) : null}
          <span className="truncate text-sm font-bold text-slate-800">
            {storeProfile?.general?.name || storeInfo?.storeName || 'Cardápio'}
          </span>
        </div>
      </header>

      {/* Hero */}
      <section className={`bg-gradient-to-br ${heroGradient} px-4 py-8 text-white md:py-12`}>
        <div className="mx-auto max-w-5xl">
          <div className="mb-2 flex items-center gap-2 text-2xl md:text-3xl">
            <span>{heroIcon}</span>
            <h1 className="font-black">{title}</h1>
          </div>
          <p className="max-w-xl text-sm text-white/90 md:text-base">{subtitle}</p>
        </div>
      </section>

      {/* Grid */}
      <main className="mx-auto max-w-5xl px-4 py-6 md:py-8">
        {showcaseItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <span className="text-4xl">{isCombos ? '🎁' : '🔥'}</span>
            <p className="text-lg font-bold text-slate-700">
              {isOfertas
                ? 'Nenhuma oferta disponível agora'
                : isCombos
                  ? 'Nenhum combo disponível agora'
                  : 'Nenhuma promoção ativa no momento'}
            </p>
            <Link href={homeHref} className="mt-2 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white">
              Ver cardápio completo
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-3">
            {showcaseItems.map((item: any) => {
              const promo = promoItemsMap[item.id];
              const isPromoItem = !!promo;
              const displayPrice = isPromoItem ? promo.promoPrice : item.price;
              const originalPrice = isPromoItem ? promo.originalPrice : (item.originalPrice || 0);
              const discountPct = originalPrice > 0 ? Math.round((1 - displayPrice / originalPrice) * 100) : 0;
              const savings = originalPrice > displayPrice ? originalPrice - displayPrice : 0;
              const qtyInCart = cart.filter((i: any) => i.id === item.id).reduce((s: number, i: any) => s + i.quantity, 0);
              const outOfStock = isOutOfStock(item, { enableInventory: inventoryOn, allItems: items || [] });

              return (
                <Card
                  key={item.id}
                  onClick={() => { if (!outOfStock) setSelectedItem(applyPromoPrice(item, promoItemsMap)); }}
                  className={`group flex cursor-pointer flex-col overflow-hidden rounded-2xl border-none bg-white shadow-md transition-all hover:shadow-2xl md:rounded-3xl ${outOfStock ? 'opacity-60 grayscale-[0.5]' : ''} ${isPromoItem ? 'ring-2 ring-orange-400/40' : ''}`}
                >
                  <ProductGallery
                    images={item.images}
                    fallback={item.imageUrl || (storeProfile as any)?.general?.defaultProductImageUrl}
                    alt={item.name}
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  >
                    {discountPct > 0 && (
                      <Badge className="absolute left-3 top-3 gap-1 border-none bg-gradient-to-r from-orange-500 to-red-500 px-2.5 py-1 text-sm font-black text-white shadow-lg">
                        <Flame className="h-3.5 w-3.5" /> -{discountPct}%
                      </Badge>
                    )}
                    <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
                      <Badge className="border-none bg-accent px-2.5 py-1 text-sm font-black text-white shadow-lg md:text-base">
                        {brl(displayPrice)}
                      </Badge>
                      {originalPrice > displayPrice && (
                        <span className="rounded bg-black/40 px-1.5 py-0.5 text-[11px] font-bold text-white/90 line-through backdrop-blur-sm">
                          {brl(originalPrice)}
                        </span>
                      )}
                    </div>
                    {qtyInCart > 0 && (
                      <Badge className="absolute bottom-3 left-3 z-10 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-md">
                        {qtyInCart} no carrinho
                      </Badge>
                    )}
                    {outOfStock && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60">
                        <span className="rounded-full bg-slate-900/85 px-3 py-1 text-xs font-black uppercase tracking-wider text-white shadow-lg">
                          Esgotado
                        </span>
                      </div>
                    )}
                  </ProductGallery>

                  <CardContent className="flex flex-1 flex-col p-4 md:p-5">
                    <div className="mb-3 flex-1 space-y-2">
                      <h3 className="line-clamp-2 text-base font-black leading-tight text-primary transition-colors group-hover:text-accent md:text-lg">
                        {item.name}
                      </h3>
                      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground md:text-sm">
                        {item.description}
                      </p>
                    </div>

                    {isPromoItem && <Countdown endDate={promo.endDate} noEndDate={promo.noEndDate} />}

                    {savings > 0 && (
                      <div className="mb-3 inline-flex w-fit items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">
                        💰 Economize {brl(savings)}
                      </div>
                    )}

                    <button
                      onClick={(e) => handleAddClick(e, item)}
                      disabled={outOfStock}
                      className={`mt-auto flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white transition-all ${outOfStock ? 'cursor-not-allowed bg-slate-300' : 'bg-primary hover:brightness-110 active:scale-[0.98]'}`}
                    >
                      <Plus className="h-4 w-4" />
                      {outOfStock ? 'Esgotado' : itemNeedsCustomization(item) ? 'Ver opções' : 'Adicionar'}
                    </button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {/* CartDrawer oculto — aberto via [data-cart-trigger] */}
      <div className="hidden">
        <CartDrawer
          storeOwnerId={storeId}
          deliveryFee={storeProfile?.fees?.deliveryFee || (storeInfo as any)?.deliveryFee || 0}
          storeAddress={storeProfile?.general?.address || (storeInfo as any)?.storeAddress || ''}
          deliveryCities={storeProfile?.general?.deliveryCities || storeProfile?.fees?.deliveryCities || []}
          deliveryFeeRules={storeProfile?.fees?.feeRules || storeProfile?.feeRules || (storeInfo as any)?.deliveryFeeRules || []}
          customAddressRules={storeProfile?.fees?.customAddressRules || storeProfile?.customAddressRules || []}
          maxDeliveryRadius={storeProfile?.fees?.maxDeliveryRadius || 0}
          paymentMethods={storeProfile?.paymentMethods}
          pixKey={storeProfile?.creditPixKey}
          pixName={storeProfile?.creditPixName}
          isStoreOpen={isStoreOpen}
          menuItems={deliveryVisibleItems}
          enableInventory={storeProfile?.general?.enableInventory || false}
          themeId={(storeProfile as any)?.theme}
          promoItemsMap={promoItemsMap}
          disableDelivery={storeProfile?.general?.disableDelivery || false}
        />
      </div>

      <MenuItemDialog
        item={selectedItem}
        isOpen={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        allAddons={addons || []}
        addonCategories={addonCategories || []}
        isStoreOpen={isStoreOpen}
        menuItems={deliveryVisibleItems}
        enableInventory={storeProfile?.general?.enableInventory || false}
      />

      {/* Botão flutuante "Ver pedido" */}
      {totalItems > 0 && (
        <button
          onClick={openCart}
          className="fixed bottom-6 left-1/2 z-50 flex w-[92vw] -translate-x-1/2 items-center justify-between gap-4 rounded-2xl bg-primary/95 px-5 py-3.5 text-white shadow-lg shadow-primary/25 ring-1 ring-white/15 backdrop-blur-md transition-all hover:bg-primary active:scale-[0.98] sm:w-[380px]"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-white/25 px-1.5 text-sm font-black tabular-nums">
              {totalItems}
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap text-base font-bold">
              <ShoppingCart className="h-4 w-4" /> Ver pedido
            </span>
          </span>
          <span className="whitespace-nowrap text-base font-black tabular-nums">{brl(totalPrice)}</span>
        </button>
      )}

      <Toaster />
    </div>
  );
}
