'use client';

import React from 'react';
import { PERIODOS_PADRAO, type PeriodoPreset, type PeriodoSelecionado } from '@/lib/periodo';

/**
 * Filtro de período do extrato do Prazo e das compras da ficha — os mesmos
 * atalhos das duas telas mais o personalizado (de / até).
 *
 * Segue o padrão que o Dashboard já usa: os atalhos ficam sempre visíveis e os
 * dois campos de data só aparecem quando "Personalizado" está escolhido, para
 * a barra não ficar carregada no uso do dia a dia.
 */
export function FiltroPeriodo({ valor, onChange, className = '' }: {
  valor: PeriodoSelecionado;
  onChange: (novo: PeriodoSelecionado) => void;
  className?: string;
}) {
  const selecionar = (preset: PeriodoPreset) => onChange({ ...valor, preset });

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {PERIODOS_PADRAO.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => selecionar(p.id)}
          className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
            valor.preset === p.id ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 hover:bg-slate-100'
          }`}
        >
          {p.label}
        </button>
      ))}

      {valor.preset === 'custom' && (
        <div className="ml-1 flex items-center gap-1.5">
          <input
            type="date"
            value={valor.de || ''}
            max={valor.ate || undefined}
            onChange={(e) => onChange({ ...valor, preset: 'custom', de: e.target.value })}
            className="h-8 rounded-md border border-input bg-background px-2 text-[11px]"
            aria-label="Data inicial"
          />
          <span className="text-[11px] text-slate-400">até</span>
          <input
            type="date"
            value={valor.ate || ''}
            min={valor.de || undefined}
            onChange={(e) => onChange({ ...valor, preset: 'custom', ate: e.target.value })}
            className="h-8 rounded-md border border-input bg-background px-2 text-[11px]"
            aria-label="Data final"
          />
          {(valor.de || valor.ate) && (
            <button
              type="button"
              onClick={() => onChange({ preset: 'custom', de: '', ate: '' })}
              className="text-[11px] font-bold text-slate-400 transition-colors hover:text-slate-600"
              title="Limpar as datas"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}
