'use client';

import React, { useEffect, useState } from 'react';
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
 * - Caso contrário, começa a carregar JÁ no mount (não precisa rolar). As buscas
 *   são limitadas por uma fila no loader, então a lista inteira pode pedir foto
 *   que só algumas vão à rede por vez. Cai nas iniciais se não houver foto/erro.
 */
export function ContactAvatar({ phone, initials, loadPhoto, className }: ContactAvatarProps) {
  const peeked = peekProfilePhoto(phone); // string | null | undefined
  const [url, setUrl] = useState<string | null>(typeof peeked === 'string' ? peeked : null);
  const [resolved, setResolved] = useState(peeked !== undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!phone || resolved) return;
    let alive = true;
    loadPhoto(phone).then((u) => { if (alive) { setUrl(u); setResolved(true); } });
    return () => { alive = false; };
  }, [phone, resolved, loadPhoto]);

  return (
    <div
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
