'use client';

import * as React from 'react';
import Image from 'next/image';
import { Flame, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from '@/components/ui/carousel';

type PromoInfo = { promoPrice: number; originalPrice: number };

interface MenuVitrineProps {
  items: any[] | null | undefined;
  promoItemsMap: Record<string, PromoInfo>;
  comboEmoji: string;
  isVisible: (item: any) => boolean;
  onSelectItem: (item: any) => void;
}

function shuffle<T>(arr: T[]): T[] {
  return arr
    .map((v) => [Math.random(), v] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
}

/**
 * Vitrine no topo do cardápio — carrossel de imagens que gira sozinho, estilo
 * painel de TV de fast-food. Mistura aleatoriamente combos, promoções e
 * produtos normais (com foto). Tocar num slide abre o produto.
 */
export function MenuVitrine({ items, promoItemsMap, comboEmoji, isVisible, onSelectItem }: MenuVitrineProps) {
  const [api, setApi] = React.useState<CarouselApi>();
  const [current, setCurrent] = React.useState(0);
  const [paused, setPaused] = React.useState(false);

  const slides = React.useMemo(() => {
    const pool = (items || []).filter(
      (it) => it.isAvailable !== false && isVisible(it) && (it.imageUrl || (it.images && it.images.length))
    );
    const combos = pool.filter((it) => it.isCombo);
    const promos = pool.filter((it) => !it.isCombo && promoItemsMap[it.id]);
    const normals = pool.filter((it) => !it.isCombo && !promoItemsMap[it.id]);

    // Garante combos e promoções, completa com produtos normais aleatórios,
    // e embaralha tudo pra dar cara de vitrine rotativa.
    const fillCount = Math.max(3, 10 - combos.length - promos.length);
    const featured = [...combos, ...promos, ...shuffle(normals).slice(0, fillCount)];
    return shuffle(featured).slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, promoItemsMap]);

  React.useEffect(() => {
    if (!api) return;
    setCurrent(api.selectedScrollSnap());
    const onSelect = () => setCurrent(api.selectedScrollSnap());
    api.on('select', onSelect);
    return () => { api.off('select', onSelect); };
  }, [api]);

  // Autoplay
  React.useEffect(() => {
    if (!api || slides.length < 2 || paused) return;
    const id = setInterval(() => api.scrollNext(), 4200);
    return () => clearInterval(id);
  }, [api, slides.length, paused]);

  if (slides.length === 0) return null;

  return (
    <div
      className="relative mb-8 w-full overflow-hidden rounded-2xl shadow-lg md:mb-10 md:rounded-3xl"
      onPointerDown={() => setPaused(true)}
      onPointerUp={() => setPaused(false)}
      onPointerLeave={() => setPaused(false)}
      onMouseEnter={() => setPaused(true)}
    >
      <Carousel setApi={setApi} opts={{ loop: true, align: 'start' }}>
        <CarouselContent className="ml-0">
          {slides.map((item) => {
            const promo = promoItemsMap[item.id];
            const isPromo = !!promo;
            const price = isPromo ? promo.promoPrice : item.price;
            const originalPrice = isPromo ? promo.originalPrice : (item.originalPrice || 0);
            const discountPct = originalPrice > price ? Math.round((1 - price / originalPrice) * 100) : 0;
            const cover = (item.images && item.images.length ? item.images[0] : item.imageUrl) as string;
            const tag = item.isCombo ? 'COMBO' : isPromo ? 'PROMOÇÃO' : 'DESTAQUE';

            return (
              <CarouselItem key={item.id} className="pl-0">
                <button
                  type="button"
                  onClick={() => onSelectItem(item)}
                  className="group relative block h-56 w-full text-left sm:h-64 md:h-80"
                >
                  <Image
                    src={cover}
                    alt={item.name}
                    fill
                    sizes="100vw"
                    className="object-cover transition-transform duration-[6000ms] ease-out group-hover:scale-105"
                    priority={false}
                  />
                  {/* Overlay escuro pra leitura */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />

                  {/* Tag topo-esquerda */}
                  <span
                    className={cn(
                      'absolute left-3 top-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black text-white shadow-lg md:left-5 md:top-5 md:text-xs',
                      item.isCombo
                        ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600'
                        : isPromo
                          ? 'bg-gradient-to-r from-orange-500 to-red-500'
                          : 'bg-black/50 backdrop-blur-sm'
                    )}
                  >
                    {item.isCombo ? <span>{comboEmoji}</span> : isPromo ? <Flame className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {tag}
                  </span>

                  {discountPct > 0 && (
                    <span className="absolute right-3 top-3 rounded-full bg-white px-2.5 py-1 text-sm font-black text-red-600 shadow-lg md:right-5 md:top-5">
                      -{discountPct}%
                    </span>
                  )}

                  {/* Conteúdo inferior */}
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 md:p-6">
                    <div className="min-w-0">
                      <h3 className="line-clamp-2 text-lg font-black leading-tight text-white drop-shadow md:text-2xl">
                        {item.name}
                      </h3>
                      {item.description && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-white/80 md:text-sm">{item.description}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end">
                      {originalPrice > price && (
                        <span className="text-xs font-bold text-white/70 line-through">R$ {originalPrice.toFixed(2)}</span>
                      )}
                      {price > 0 && (
                        <span className="rounded-xl bg-accent px-3 py-1.5 text-base font-black text-white shadow-lg md:text-lg">
                          R$ {price.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              </CarouselItem>
            );
          })}
        </CarouselContent>
      </Carousel>

      {/* Bolinhas */}
      {slides.length > 1 && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
          {slides.map((_, i) => (
            <span
              key={i}
              className={cn('h-1.5 rounded-full transition-all', i === current ? 'w-5 bg-white' : 'w-1.5 bg-white/50')}
            />
          ))}
        </div>
      )}
    </div>
  );
}
