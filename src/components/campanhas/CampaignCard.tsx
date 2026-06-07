'use client';

import React from 'react';

interface CampaignCardProps {
  storeName: string;
  logo?: string;
  text: string;
}

/**
 * Card visual da campanha (1000x1000) montado a partir do texto + logo da loja.
 * Renderizado fora da tela e convertido em PNG via html-to-image — sem custo de
 * API de imagem. É a "arte" anexada à campanha.
 */
export const CampaignCard = React.forwardRef<HTMLDivElement, CampaignCardProps>(({ storeName, logo, text }, ref) => {
  const initials = (storeName || '?').split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  return (
    <div
      ref={ref}
      style={{ width: 1000, height: 1000 }}
      className="relative flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-emerald-600 via-emerald-600 to-teal-700 px-20 text-center text-white"
    >
      {/* enfeites */}
      <div style={{ position: 'absolute', top: -120, right: -120, width: 420, height: 420, borderRadius: '9999px', background: 'rgba(255,255,255,0.10)' }} />
      <div style={{ position: 'absolute', bottom: -140, left: -100, width: 360, height: 360, borderRadius: '9999px', background: 'rgba(45,212,191,0.20)' }} />

      <div className="relative flex flex-col items-center gap-10">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" crossOrigin="anonymous" className="h-44 w-44 rounded-[2rem] object-cover" style={{ boxShadow: '0 0 0 8px rgba(255,255,255,0.25)' }} />
        ) : (
          <div className="flex h-44 w-44 items-center justify-center rounded-[2rem] bg-white/15 text-6xl font-black" style={{ boxShadow: '0 0 0 8px rgba(255,255,255,0.25)' }}>
            {initials}
          </div>
        )}

        <h2 className="text-6xl font-black tracking-tight">{storeName}</h2>

        <p className="max-w-[800px] whitespace-pre-wrap text-4xl font-semibold leading-snug text-emerald-50">
          {text}
        </p>
      </div>

      <div className="absolute bottom-16 text-2xl font-medium text-emerald-50/80">
        🛵 Peça pelo nosso cardápio
      </div>
    </div>
  );
});

CampaignCard.displayName = 'CampaignCard';
