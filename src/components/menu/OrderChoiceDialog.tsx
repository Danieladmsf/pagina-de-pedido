'use client';

import React from 'react';
import Link from 'next/link';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { CakeSlice, ChevronRight, ShoppingBag, X } from 'lucide-react';
import { themeToCssVars, type ThemePreset } from '@/lib/themes';
import { getOrderLinkCards, storeWhatsappDigits, type OrderLinkCardId } from '@/lib/order-link';

// Tela de escolha do "link de pedidos": aparece quando o cliente entra pelo link
// que a loja mandou e o dono configurou "Tela de escolha" em Mensagens
// automáticas. Vive em portal (fora da div do tema), então o themeToCssVars vai
// no próprio conteúdo — mesmo padrão do menu lateral do cardápio.

// Marca do WhatsApp: o lucide não traz logos de terceiros e um balãozinho
// genérico não comunica "é o WhatsApp mesmo".
function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413" />
    </svg>
  );
}

const CARD_COPY: Record<OrderLinkCardId, { title: string; subtitle: string }> = {
  menu: { title: 'Fazer pedido pelo app', subtitle: 'Monte seu pedido pelo cardápio' },
  encomendas: { title: 'Fazer uma encomenda', subtitle: 'Bolos e doces com data marcada' },
  whatsapp: { title: 'Falar no WhatsApp', subtitle: 'Tire dúvidas com a nossa equipe' },
};

export function OrderChoiceDialog({
  open,
  onOpenChange,
  storeProfile,
  storeSlug,
  theme,
  isStoreOpen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeProfile: any;
  storeSlug?: string;
  theme: ThemePreset;
  isStoreOpen: boolean;
}) {
  const cards = getOrderLinkCards(storeProfile);
  const storeName = storeProfile?.general?.name || 'nossa loja';
  const logoUrl = storeProfile?.general?.logoUrl || '';
  const whatsappUrl = `https://wa.me/${storeWhatsappDigits(storeProfile)}?text=${encodeURIComponent('Olá! Gostaria de fazer um pedido.')}`;

  const cardClass =
    'group relative flex w-full items-center gap-3.5 rounded-2xl border border-black/[0.07] bg-white p-3.5 text-left shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-all hover:-translate-y-px hover:border-primary/35 hover:shadow-[0_8px_20px_-8px_rgba(16,24,40,0.22)] active:translate-y-0 active:scale-[0.99] motion-reduce:transition-none motion-reduce:hover:translate-y-0';

  function renderInner(id: OrderLinkCardId) {
    const copy = CARD_COPY[id];
    return (
      <>
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
          style={
            id === 'whatsapp'
              ? { background: 'rgba(37, 211, 102, 0.12)', color: '#128C7E' }
              : { background: 'hsl(var(--primary) / 0.11)', color: 'hsl(var(--primary))' }
          }
        >
          {id === 'menu' && <ShoppingBag className="h-[22px] w-[22px]" />}
          {id === 'encomendas' && <CakeSlice className="h-[22px] w-[22px]" />}
          {id === 'whatsapp' && <WhatsAppGlyph className="h-[22px] w-[22px]" />}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold leading-tight text-slate-900">{copy.title}</span>
          <span className="mt-0.5 block text-xs leading-snug text-slate-500">{copy.subtitle}</span>
        </span>

        <ChevronRight className="h-[18px] w-[18px] shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-primary motion-reduce:transition-none" />
      </>
    );
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[3px] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        <DialogPrimitive.Content
          style={themeToCssVars(theme)}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-t-[28px] bg-[#FBFBFA] pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-8px_40px_-12px_rgba(16,24,40,0.35)] duration-300 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-bottom-6 data-[state=open]:slide-in-from-bottom-6 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[25.5rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] sm:pb-5 sm:shadow-[0_24px_60px_-15px_rgba(16,24,40,0.4)] sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=open]:slide-in-from-bottom-0"
        >
          {/* Cabeçalho: leve lavagem da cor da marca, sem bloco chapado */}
          <div
            className="relative rounded-t-[28px] px-6 pb-5 pt-3 text-center sm:pt-6"
            style={{ background: 'radial-gradient(120% 108% at 50% 0%, hsl(var(--primary) / 0.13), transparent 66%)' }}
          >
            {/* Puxador do bottom sheet (só no celular) */}
            <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-slate-900/15 sm:hidden" />

            <DialogPrimitive.Close
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-black/5 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:top-5"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>

            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt=""
                className="mx-auto h-16 w-16 rounded-2xl object-cover shadow-[0_6px_16px_-6px_rgba(16,24,40,0.45)] ring-1 ring-black/5"
              />
            ) : (
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-2xl font-black text-white shadow-[0_6px_16px_-6px_rgba(16,24,40,0.45)] ring-1 ring-black/5">
                {String(storeName).charAt(0).toUpperCase()}
              </div>
            )}

            <p className="mt-3 truncate text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
              {storeName}
            </p>

            <DialogPrimitive.Title
              className="mt-1 text-[23px] font-black leading-tight tracking-tight text-slate-900"
              style={{ fontFamily: 'var(--brand-font-heading)' }}
            >
              Como você prefere pedir?
            </DialogPrimitive.Title>

            <DialogPrimitive.Description className="mx-auto mt-1.5 max-w-[17rem] text-[13px] leading-snug text-slate-500">
              É só escolher por onde continuar.
            </DialogPrimitive.Description>
          </div>

          <div className="space-y-2.5 px-5">
            {cards.map((id) => {
              if (id === 'menu') {
                return (
                  <button key={id} type="button" onClick={() => onOpenChange(false)} className={cardClass}>
                    {renderInner(id)}
                  </button>
                );
              }

              if (id === 'encomendas') {
                return (
                  <Link
                    key={id}
                    href={`/${storeSlug}/encomendas`}
                    onClick={() => onOpenChange(false)}
                    className={cardClass}
                  >
                    {renderInner(id)}
                  </Link>
                );
              }

              return (
                <a
                  key={id}
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onOpenChange(false)}
                  className={cardClass}
                >
                  {renderInner(id)}
                </a>
              );
            })}
          </div>

          <div className="mx-5 mt-5 border-t border-slate-900/[0.06] pt-3.5">
            <p className="flex items-center justify-center gap-1.5 text-[11px] font-bold">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: isStoreOpen ? 'hsl(var(--open))' : 'hsl(var(--closed))' }}
              />
              <span style={{ color: isStoreOpen ? 'hsl(var(--open))' : 'hsl(var(--closed))' }}>
                {isStoreOpen ? 'Aberto agora' : 'Fechado no momento'}
              </span>
            </p>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
