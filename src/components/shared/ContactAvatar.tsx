'use client';

import React, { useEffect, useRef, useState } from 'react';
import { peekProfilePhoto } from '@/lib/wapi/profile-photo';

interface ContactAvatarProps {
  phone: string;
  initials: string;
  loadPhoto: (phone: string) => Promise<string | null>;
  /** Classe do círculo (tamanho/estilo). Default = 36px (h-9 w-9). */
  className?: string;
}

/**
 * Avatar do contato com a foto do WhatsApp.
 *
 * - Se a foto já está em cache (localStorage/módulo), renderiza INSTANTÂNEA na 1ª
 *   pintura (sem rede, sem esperar) — como o WhatsApp.
 * - Caso contrário, busca quando o item se aproxima da tela (pré-carrega antes de
 *   ficar visível) e cai nas iniciais se não houver foto/erro.
 */
export function ContactAvatar({ phone, initials, loadPhoto, className }: ContactAvatarProps) {
  const peeked = peekProfilePhoto(phone); // string | null | undefined
  const [url, setUrl] = useState<string | null>(typeof peeked === 'string' ? peeked : null);
  const [resolved, setResolved] = useState(peeked !== undefined);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!phone || resolved) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        io.disconnect();
        loadPhoto(phone).then((u) => { setUrl(u); setResolved(true); });
      }
    }, { rootMargin: '400px' }); // pré-carrega bem antes de aparecer
    io.observe(el);
    return () => io.disconnect();
  }, [phone, resolved, loadPhoto]);

  return (
    <div
      ref={ref}
      className={className || 'flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-[11px] font-bold text-white'}
    >
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" loading="eager" onError={() => setFailed(true)} />
      ) : (
        initials
      )}
    </div>
  );
}
