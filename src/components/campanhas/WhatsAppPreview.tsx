'use client';

import React from 'react';
import { Check, CheckCheck } from 'lucide-react';

interface WhatsAppPreviewProps {
  storeName: string;
  storeLogo?: string;
  message: string;
  imageUrl?: string | null;
}

/**
 * Mockup de celular mostrando como a mensagem chega no WhatsApp do cliente.
 * Puramente visual — recebe o texto já renderizado (tokens substituídos).
 */
export function WhatsAppPreview({ storeName, storeLogo, message, imageUrl }: WhatsAppPreviewProps) {
  const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const initials = (storeName || 'L').split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  return (
    <div className="relative mx-auto w-[300px] shrink-0">
      {/* Celular */}
      <div className="rounded-[2.4rem] bg-slate-900 p-2.5 shadow-2xl ring-1 ring-black/10">
        <div className="overflow-hidden rounded-[1.9rem] bg-[#e5ddd5]">
          {/* Topo (cabeçalho do chat) */}
          <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-white/20 ring-1 ring-white/30">
              {storeLogo ? (
                <img src={storeLogo} alt={storeName} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs font-bold">{initials}</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-tight">{storeName || 'Minha Loja'}</p>
              <p className="text-[10px] text-emerald-100/80">online</p>
            </div>
          </div>

          {/* Corpo do chat (fundo padrão do WhatsApp) */}
          <div
            className="min-h-[360px] space-y-2 px-3 py-4"
            style={{
              backgroundImage:
                'radial-gradient(rgba(0,0,0,0.04) 1px, transparent 1px)',
              backgroundSize: '16px 16px',
            }}
          >
            {/* Balão recebido */}
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-1.5 pb-1.5 pt-1.5 shadow-sm">
                {imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl}
                    alt="anexo"
                    className="mb-1 max-h-44 w-full rounded-xl object-cover"
                  />
                )}
                <div className="px-1.5">
                  <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-slate-800">
                    {message?.trim() ? message : 'Sua mensagem aparece aqui…'}
                  </p>
                  <div className="mt-0.5 flex items-center justify-end gap-1">
                    <span className="text-[10px] text-slate-400">{now}</span>
                    <CheckCheck className="h-3.5 w-3.5 text-sky-500" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Barra de digitação (decorativa) */}
          <div className="flex items-center gap-2 bg-[#f0f0f0] px-3 py-2">
            <div className="flex-1 rounded-full bg-white px-3 py-1.5 text-[11px] text-slate-400">
              Mensagem
            </div>
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#075e54] text-white">
              <Check className="h-4 w-4" />
            </div>
          </div>
        </div>
      </div>

      <p className="mt-3 text-center text-[11px] text-slate-400">
        Pré-visualização — assim o cliente recebe
      </p>
    </div>
  );
}
