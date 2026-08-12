'use client';

import React from 'react';
import { Minus, Users } from 'lucide-react';
import { FlipNumber } from '@/components/ui/flip-number';
import { cn } from '@/lib/utils';

export interface AudienceCardProps {
  /** Visitas ao cardápio desde a abertura do caixa. */
  visitas: number;
  /** Quantos estão com o cardápio aberto agora. */
  online: number;
  /** Hora da abertura do caixa, já formatada (ex.: "08:12"). */
  desde: string;
  recolhido: boolean;
  onAlternar: () => void;
}

/**
 * O card do placar, sem nenhuma dependência de dados — é o que permite olhar as
 * quatro combinações (cheio/recolhido x com gente/parado) sem precisar de caixa
 * aberto e cliente no cardápio de verdade.
 *
 * As duas informações moram no mesmo card de propósito: o número grande conta a
 * sessão de caixa inteira e a cor diz como está AGORA. Antes eram dois lugares
 * dizendo coisas parecidas — o placar aqui e um "N clientes online" na aba
 * Delivery.
 */
export function AudienceCard({ visitas, online, desde, recolhido, onAlternar }: AudienceCardProps) {
  const aoVivo = online > 0;

  // Recolhido: as duas informações continuam juntas na pílula — o número da
  // sessão e o ponto que acende quando tem gente no cardápio.
  if (recolhido) {
    return (
      <button
        type="button"
        onClick={onAlternar}
        title={`${visitas} visitas nesta sessão de caixa · ${aoVivo ? `${online} no cardápio agora` : 'ninguém no cardápio agora'}`}
        className={cn(
          'flex items-center gap-2 rounded-full border bg-white/90 py-2 pl-3 pr-3.5 shadow-lg backdrop-blur transition hover:bg-white',
          aoVivo ? 'border-emerald-200' : 'border-slate-200'
        )}
      >
        <PontoAoVivo aoVivo={aoVivo} />
        <FlipNumber value={visitas} className="text-sm font-black text-slate-700" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        'w-[212px] overflow-hidden rounded-2xl border bg-white/95 shadow-xl backdrop-blur transition-colors',
        aoVivo ? 'border-emerald-200 shadow-emerald-900/10' : 'border-slate-200'
      )}
    >
      {/* Fio de luz no topo: aceso com gente no cardápio, apagado na loja
          parada. É o que amarra as duas informações num card só. */}
      <div
        className={cn(
          'relative h-1 w-full overflow-hidden transition-colors',
          aoVivo ? 'bg-emerald-400' : 'bg-slate-200'
        )}
      >
        {aoVivo && (
          <span className="pointer-events-none absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/70 to-transparent" />
        )}
      </div>

      <div className="flex items-start justify-between gap-2 px-4 pt-2.5">
        <p className="text-[11px] font-bold text-slate-500">Visitas no cardápio</p>
        <button
          type="button"
          onClick={onAlternar}
          title="Recolher"
          className="-mr-1 rounded-full p-1 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Número e período empilhados: ao lado um do outro, um placar de 4
          dígitos espremia o texto em três linhas e o card crescia sozinho. */}
      <div className="px-4 pb-2.5">
        <FlipNumber value={visitas} className="text-[40px] font-black leading-none tracking-tight text-slate-800" />
        <p className="mt-1 text-[10px] font-medium leading-none text-slate-400">desde a abertura, {desde}</p>
      </div>

      <div
        className={cn(
          'flex items-center gap-2 border-t px-4 py-2 transition-colors',
          aoVivo ? 'border-emerald-100 bg-emerald-50/70' : 'border-slate-100 bg-slate-50/70'
        )}
      >
        <PontoAoVivo aoVivo={aoVivo} />
        <Users className={cn('h-3.5 w-3.5 shrink-0', aoVivo ? 'text-emerald-600' : 'text-slate-400')} />
        <p className={cn('flex items-center gap-1 text-xs font-bold', aoVivo ? 'text-emerald-700' : 'text-slate-400')}>
          {aoVivo ? (
            <>
              <FlipNumber value={online} /> no cardápio agora
            </>
          ) : (
            'ninguém agora'
          )}
        </p>
      </div>
    </div>
  );
}

/** Estado ao vivo com ponto + ícone + rótulo — nunca só a cor. */
function PontoAoVivo({ aoVivo }: { aoVivo: boolean }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {aoVivo && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      )}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', aoVivo ? 'bg-emerald-500' : 'bg-slate-300')} />
    </span>
  );
}
