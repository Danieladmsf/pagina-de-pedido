'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Eye, Users, X } from 'lucide-react';
import { useFirestore } from '@/firebase';
import { usePdvAccess } from '@/contexts/PdvAccessContext';
import { usePublicAudience } from '@/hooks/usePublicAudience';
import { FlipNumber } from '@/components/ui/flip-number';
import { cn } from '@/lib/utils';

const CHAVE_RECOLHIDO = 'audience-badge-recolhido';

/**
 * Placar flutuante da audiência do cardápio: quantas pessoas visitaram a loja
 * desde que o caixa abriu e quantas estão com o cardápio aberto agora.
 *
 * Vive no layout do sistema (junto do OrderAlertsWatcher) para acompanhar tanto
 * o PDV quanto a Retaguarda sem remontar na troca de tela. Some com o caixa
 * fechado: o número é da sessão de caixa, fora dela não significa nada.
 */
export function AudienceBadge() {
  const db = useFirestore();
  const { ownerId } = usePdvAccess();
  const [caixaAbertoEm, setCaixaAbertoEm] = useState<Date | null>(null);
  const [recolhido, setRecolhido] = useState(false);

  useEffect(() => {
    try {
      setRecolhido(window.localStorage.getItem(CHAVE_RECOLHIDO) === '1');
    } catch {
      /* storage bloqueado: começa aberto */
    }
  }, []);

  // Sessão de caixa aberta. `cash_registers` é a fonte — quem abriu o caixa
  // gravou ali o `dataAbertura` que define o início da contagem.
  useEffect(() => {
    if (!db || !ownerId) return;
    const q = query(
      collection(db, 'cash_registers'),
      where('ownerId', '==', ownerId),
      where('status', '==', 'aberto')
    );
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const abertura = snap.docs
          .map((d) => d.data()?.dataAbertura?.toDate?.() as Date | undefined)
          .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()))
          .sort((a, b) => b.getTime() - a.getTime())[0];
        setCaixaAbertoEm(abertura ?? null);
      },
      () => setCaixaAbertoEm(null)
    );
    return () => unsubscribe();
  }, [db, ownerId]);

  const { online, visitasNaSessao, semAcesso } = usePublicAudience(ownerId, caixaAbertoEm);

  const desde = useMemo(() => {
    if (!caixaAbertoEm) return '';
    return caixaAbertoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }, [caixaAbertoEm]);

  if (semAcesso || !caixaAbertoEm) return null;

  const alternar = () => {
    const proximo = !recolhido;
    setRecolhido(proximo);
    try {
      window.localStorage.setItem(CHAVE_RECOLHIDO, proximo ? '1' : '0');
    } catch {
      /* sem storage: vale só nesta sessão */
    }
  };

  if (recolhido) {
    return (
      <button
        type="button"
        onClick={alternar}
        title="Mostrar visitas do cardápio"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-3 py-2 text-sm font-bold text-slate-700 shadow-lg backdrop-blur transition hover:bg-white print:hidden"
      >
        <Eye className="h-4 w-4 text-primary" />
        <FlipNumber value={visitasNaSessao ?? 0} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[210px] overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur print:hidden">
      <div className="flex items-start justify-between gap-2 px-4 pt-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Visitas no cardápio</p>
          <p className="text-[10px] font-medium text-slate-400">desde a abertura, {desde}</p>
        </div>
        <button
          type="button"
          onClick={alternar}
          title="Recolher"
          className="-mr-1 -mt-1 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-4 pb-1">
        <FlipNumber
          value={visitasNaSessao ?? 0}
          className="text-4xl font-black tracking-tight text-slate-800"
        />
      </div>

      <div className="mt-1 flex items-center gap-2 border-t bg-slate-50/80 px-4 py-2">
        <span className="relative flex h-2 w-2 shrink-0">
          {online > 0 && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          )}
          <span
            className={cn(
              'relative inline-flex h-2 w-2 rounded-full',
              online > 0 ? 'bg-emerald-500' : 'bg-slate-300'
            )}
          />
        </span>
        <Users className={cn('h-3.5 w-3.5', online > 0 ? 'text-emerald-600' : 'text-slate-400')} />
        <p className={cn('text-xs font-bold', online > 0 ? 'text-emerald-700' : 'text-slate-400')}>
          {online === 0 ? 'ninguém agora' : `${online} no cardápio agora`}
        </p>
      </div>
    </div>
  );
}
