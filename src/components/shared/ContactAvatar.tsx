'use client';

import React, { useEffect, useRef, useState } from 'react';

interface ContactAvatarProps {
  phone: string;
  initials: string;
  loadPhoto: (phone: string) => Promise<string | null>;
  /** Classe do círculo (tamanho/estilo). Default = 36px (h-9 w-9). */
  className?: string;
}

/**
 * Avatar do contato com a foto do WhatsApp carregada SOB DEMANDA (só quando
 * entra na tela, via IntersectionObserver). Fallback para as iniciais quando não
 * há foto, o link expirou ou deu erro. Compartilhado entre Campanhas e Clientes.
 */
export function ContactAvatar({ phone, initials, loadPhoto, className }: ContactAvatarProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!phone || url) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        io.disconnect();
        loadPhoto(phone).then((u) => { if (u) setUrl(u); });
      }
    }, { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, [phone, url, loadPhoto]);

  return (
    <div
      ref={ref}
      className={className || 'flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-[11px] font-bold text-white'}
    >
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        initials
      )}
    </div>
  );
}
