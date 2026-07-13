'use client';

import * as React from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImageLightboxProps {
  images: string[];
  index: number;
  onIndexChange: (i: number) => void;
  open: boolean;
  onClose: () => void;
  alt?: string;
}

const MAX_SCALE = 4;
const MIN_SCALE = 1;

/**
 * Visualizador de imagem em tela cheia com zoom. Sem dependência externa:
 * - Toque: pinça (2 dedos), toque duplo pra ampliar/resetar, arrastar pra
 *   navegar (sem zoom) ou mover a imagem (com zoom).
 * - Mouse: duplo-clique amplia/reseta, arrastar move quando ampliado, roda
 *   do mouse dá zoom. Setas do teclado trocam a foto; Esc fecha.
 */
export function ImageLightbox({ images, index, onIndexChange, open, onClose, alt = '' }: ImageLightboxProps) {
  const [scale, setScale] = React.useState(1);
  const [tx, setTx] = React.useState(0);
  const [ty, setTy] = React.useState(0);

  const gesture = React.useRef<any>({});
  const lastTap = React.useRef(0);
  const indexRef = React.useRef(index);
  indexRef.current = index;

  const reset = React.useCallback(() => { setScale(1); setTx(0); setTy(0); }, []);

  const go = React.useCallback((dir: number) => {
    if (images.length < 2) return;
    reset();
    onIndexChange((indexRef.current + dir + images.length) % images.length);
  }, [images.length, onIndexChange, reset]);

  // Reseta zoom ao trocar de imagem ou reabrir
  React.useEffect(() => { reset(); }, [index, open, reset]);

  // Trava scroll do body, Esc/setas e botão voltar do navegador
  React.useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.history.pushState({ type: 'lightbox' }, '');
    const onPop = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
      if (window.history.state?.type === 'lightbox') window.history.back();
    };
  }, [open, go, onClose]);

  if (!open) return null;

  const dist = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      gesture.current = { mode: 'pinch', startDist: dist(e.touches), startScale: scale };
    } else if (e.touches.length === 1) {
      gesture.current = {
        mode: scale > 1 ? 'pan' : 'swipe',
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startTx: tx,
        startTy: ty,
        dx: 0,
      };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (g.mode === 'pinch' && e.touches.length === 2) {
      const ratio = dist(e.touches) / g.startDist;
      setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, g.startScale * ratio)));
    } else if (g.mode === 'pan' && e.touches.length === 1) {
      setTx(g.startTx + (e.touches[0].clientX - g.startX));
      setTy(g.startTy + (e.touches[0].clientY - g.startY));
    } else if (g.mode === 'swipe' && e.touches.length === 1) {
      g.dx = e.touches[0].clientX - g.startX;
    }
  };

  const onTouchEnd = () => {
    const g = gesture.current;
    if (g.mode === 'swipe') {
      if (Math.abs(g.dx || 0) > 60) {
        go(g.dx < 0 ? 1 : -1);
      } else if (Math.abs(g.dx || 0) < 10) {
        // Toque simples: detecta toque duplo pra ampliar/resetar
        const nowT = Date.now();
        if (nowT - lastTap.current < 300) {
          setScale((s) => (s > 1 ? (reset(), 1) : 2.5));
          lastTap.current = 0;
        } else {
          lastTap.current = nowT;
        }
      }
    }
    if (scale <= 1.05) reset();
    gesture.current = {};
  };

  const onDoubleClick = () => { if (scale > 1) reset(); else setScale(2.5); };
  const onMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    gesture.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, startTx: tx, startTy: ty };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const g = gesture.current;
    if (g.mode === 'pan') {
      setTx(g.startTx + (e.clientX - g.startX));
      setTy(g.startTy + (e.clientY - g.startY));
    }
  };
  const onMouseUp = () => { gesture.current = {}; };
  const onWheel = (e: React.WheelEvent) => {
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s - e.deltaY * 0.002)));
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex select-none items-center justify-center bg-black/95"
      onClick={(e) => { if (e.target === e.currentTarget && scale <= 1) onClose(); }}
    >
      <button
        onClick={onClose}
        aria-label="Fechar"
        className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>

      {images.length > 1 && (
        <div className="absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-sm font-bold text-white backdrop-blur-sm">
          {index + 1} / {images.length}
        </div>
      )}

      {images.length > 1 && (
        <>
          <button
            onClick={() => go(-1)}
            aria-label="Anterior"
            className="absolute left-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={() => go(1)}
            aria-label="Próxima"
            className="absolute right-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      <div
        className="relative flex h-full w-full items-center justify-center overflow-hidden"
        style={{ touchAction: 'none' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onDoubleClick={onDoubleClick}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[index]}
          alt={alt}
          draggable={false}
          className="max-h-[92vh] max-w-full object-contain"
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transition: gesture.current.mode ? 'none' : 'transform 0.2s ease-out',
            cursor: scale > 1 ? 'grab' : 'zoom-in',
          }}
        />
      </div>

      {images.length > 1 && (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Foto ${i + 1}`}
              onClick={() => { reset(); onIndexChange(i); }}
              className={cn('h-2 rounded-full transition-all', i === index ? 'w-5 bg-white' : 'w-2 bg-white/50 hover:bg-white/70')}
            />
          ))}
        </div>
      )}
    </div>
  );
}
