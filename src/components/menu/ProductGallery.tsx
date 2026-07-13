'use client';

import * as React from 'react';
import Image from 'next/image';
import { ZoomIn } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from '@/components/ui/carousel';
import { ImageLightbox } from '@/components/menu/ImageLightbox';

interface ProductGalleryProps {
  /** Galeria completa (capa + extras). Se vazia, cai no fallback. */
  images?: string[] | null;
  /** Imagem de capa usada quando não há galeria (item antigo). */
  fallback?: string;
  alt: string;
  className?: string;
  sizes?: string;
  /** Habilita zoom em tela cheia ao tocar na imagem (usar no detalhe do produto). */
  enableZoom?: boolean;
  /** Badges/overlays posicionados sobre a imagem (o wrapper é relative). */
  children?: React.ReactNode;
}

/**
 * Galeria reutilizável do cardápio. Uma imagem = <Image> simples; várias =
 * carrossel (Embla, o mesmo de components/ui/carousel) com bolinhas de posição.
 * Com `enableZoom`, tocar na imagem abre o visualizador em tela cheia (pinça/
 * duplo-toque). Usado no detalhe do produto e nas páginas de Combos/Promoções.
 */
export function ProductGallery({
  images,
  fallback,
  alt,
  className,
  sizes = '(max-width: 640px) 100vw, 400px',
  enableZoom = false,
  children,
}: ProductGalleryProps) {
  const pics = ((images && images.length ? images : fallback ? [fallback] : []) as string[]).filter(Boolean);

  const [api, setApi] = React.useState<CarouselApi>();
  const [current, setCurrent] = React.useState(0);
  const [lightboxOpen, setLightboxOpen] = React.useState(false);
  const [lightboxIndex, setLightboxIndex] = React.useState(0);

  React.useEffect(() => {
    if (!api) return;
    setCurrent(api.selectedScrollSnap());
    const onSelect = () => setCurrent(api.selectedScrollSnap());
    api.on('select', onSelect);
    return () => {
      api.off('select', onSelect);
    };
  }, [api]);

  const openZoom = (i: number) => {
    if (!enableZoom) return;
    setLightboxIndex(i);
    setLightboxOpen(true);
  };

  if (pics.length === 0) return null;

  const lightbox = enableZoom ? (
    <ImageLightbox
      images={pics}
      index={lightboxIndex}
      onIndexChange={setLightboxIndex}
      open={lightboxOpen}
      onClose={() => setLightboxOpen(false)}
      alt={alt}
    />
  ) : null;

  const zoomHint = enableZoom ? (
    <div className="pointer-events-none absolute bottom-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm">
      <ZoomIn className="h-4 w-4" />
    </div>
  ) : null;

  if (pics.length === 1) {
    return (
      <div className={cn('relative aspect-[4/3] w-full overflow-hidden', className)}>
        <Image
          src={pics[0]}
          alt={alt}
          fill
          sizes={sizes}
          className={cn('object-cover', enableZoom && 'cursor-zoom-in')}
          onClick={() => openZoom(0)}
        />
        {zoomHint}
        {children}
        {lightbox}
      </div>
    );
  }

  return (
    <div className={cn('relative w-full overflow-hidden', className)}>
      <Carousel setApi={setApi} opts={{ loop: true }}>
        <CarouselContent className="ml-0">
          {pics.map((src, i) => (
            <CarouselItem key={i} className="pl-0">
              <div className="relative aspect-[4/3] w-full">
                <Image
                  src={src}
                  alt={`${alt} — foto ${i + 1}`}
                  fill
                  sizes={sizes}
                  className={cn('object-cover', enableZoom && 'cursor-zoom-in')}
                  onClick={() => openZoom(i)}
                />
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>

      {/* Bolinhas de posição */}
      <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
        {pics.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Ver foto ${i + 1}`}
            onClick={() => api?.scrollTo(i)}
            className={cn(
              'h-1.5 rounded-full shadow-sm transition-all',
              i === current ? 'w-4 bg-white' : 'w-1.5 bg-white/60 hover:bg-white/80'
            )}
          />
        ))}
      </div>

      {zoomHint}
      {children}
      {lightbox}
    </div>
  );
}
