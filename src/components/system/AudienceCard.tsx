'use client';

import React from 'react';
import { ChevronRight, Minus, ShoppingBag, Users } from 'lucide-react';
import { FlipNumber } from '@/components/ui/flip-number';
import { ContactAvatar } from '@/components/shared/ContactAvatar';
import { brl, cn } from '@/lib/utils';
import { iniciais, primeiroNome, type Visitante } from '@/lib/visitantes';

export interface AudienceCardProps {
  /** Visitas ao cardápio desde a abertura do caixa. */
  visitas: number;
  /** Quantos estão com o cardápio aberto agora. */
  online: number;
  /** Hora da abertura do caixa, já formatada (ex.: "08:12"). */
  desde: string;
  /** Gente com nome que passou pelo cardápio, mais recente primeiro (até 4). */
  pessoas: Visitante[];
  /** Quantas dessas pessoas deixaram carrinho montado sem fechar. */
  carrinhosParados: number;
  /** Quanto está parado nesses carrinhos. */
  valorParado: number;
  /** Busca a foto do WhatsApp pelo telefone (cai nas iniciais se não houver). */
  loadPhoto: (phone: string) => Promise<string | null>;
  /** Abre a tela de quem passou. */
  onAbrirVisitantes: () => void;
  recolhido: boolean;
  onAlternar: () => void;
}

/**
 * O card do placar, sem nenhuma dependência de dados — é o que permite olhar as
 * combinações (cheio/recolhido x com gente/parado x com e sem carrinho parado)
 * sem precisar de caixa aberto e cliente no cardápio de verdade.
 *
 * As informações moram no mesmo card de propósito: o número grande conta a
 * sessão de caixa inteira, a cor diz como está AGORA, e a fileira de rostos diz
 * QUEM — é por ela que se chega na tela de oportunidades.
 */
export function AudienceCard({
  visitas,
  online,
  desde,
  pessoas,
  carrinhosParados,
  valorParado,
  loadPhoto,
  onAbrirVisitantes,
  recolhido,
  onAlternar,
}: AudienceCardProps) {
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
        {carrinhosParados > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700">
            <ShoppingBag className="h-3 w-3" />
            {carrinhosParados}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      className={cn(
        'w-[228px] overflow-hidden rounded-2xl border bg-white/95 shadow-xl backdrop-blur transition-colors',
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

      {/* Os rostos: sem eles o número é só um número. A fileira inteira é o
          caminho para a tela de quem passou. */}
      <button
        type="button"
        onClick={onAbrirVisitantes}
        className="group flex w-full items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-left transition-colors hover:bg-slate-50"
      >
        {pessoas.length > 0 ? (
          <span className="flex -space-x-2">
            {pessoas.map((pessoa) => (
              <ContactAvatar
                key={pessoa.id}
                phone={pessoa.telefone || ''}
                initials={iniciais(pessoa.nome)}
                loadPhoto={loadPhoto}
                className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-[9px] font-bold text-white ring-2 ring-white"
              />
            ))}
          </span>
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 ring-2 ring-white">
            <Users className="h-3.5 w-3.5" />
          </span>
        )}
        <span className="min-w-0 flex-1 text-[11px] font-bold leading-tight text-slate-600">
          {pessoas.length > 0 ? (
            <>
              {primeiroNome(pessoas[0].nome) || 'Alguém'}
              {pessoas.length > 1 && ` e mais ${pessoas.length - 1}`}
            </>
          ) : (
            'Ver quem passou'
          )}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" />
      </button>

      {/* A linha que vira trabalho: sacola montada e pedido não fechado. */}
      {carrinhosParados > 0 && (
        <button
          type="button"
          onClick={onAbrirVisitantes}
          className="flex w-full items-center gap-2 border-t border-amber-100 bg-amber-50 px-4 py-2 text-left transition-colors hover:bg-amber-100"
        >
          <ShoppingBag className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span className="min-w-0 flex-1 text-[11px] font-bold leading-tight text-amber-800">
            {carrinhosParados} {carrinhosParados === 1 ? 'carrinho parado' : 'carrinhos parados'}
            {valorParado > 0 && <span className="font-black"> · {brl(valorParado)}</span>}
          </span>
        </button>
      )}

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
