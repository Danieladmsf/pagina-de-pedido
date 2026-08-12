'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import { usePdvAccess } from '@/contexts/PdvAccessContext';
import { usePublicAudience } from '@/hooks/usePublicAudience';
import { AudienceCard } from '@/components/system/AudienceCard';

const CHAVE_RECOLHIDO = 'audience-badge-recolhido';

/**
 * Placar flutuante da audiência do cardápio: quantas pessoas visitaram a loja
 * desde que o caixa abriu e quantas estão com o cardápio aberto agora.
 *
 * Vive no layout do sistema (junto do OrderAlertsWatcher) para acompanhar tanto
 * o PDV quanto a Retaguarda sem remontar na troca de tela. Some com o caixa
 * fechado: o número é da sessão de caixa, fora dela não significa nada.
 *
 * Aqui só mora a busca dos dados — o desenho é o `AudienceCard`.
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

  return (
    <div className="fixed bottom-4 right-4 z-40 print:hidden">
      <AudienceCard
        visitas={visitasNaSessao ?? 0}
        online={online}
        desde={desde}
        recolhido={recolhido}
        onAlternar={alternar}
      />
    </div>
  );
}
