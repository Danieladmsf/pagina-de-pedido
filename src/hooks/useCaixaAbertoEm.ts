'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useFirestore } from '@/firebase';

/**
 * Quando a sessão de caixa atual começou — o marco de tudo que a audiência
 * conta. `cash_registers` é a fonte: quem abriu o caixa gravou ali o
 * `dataAbertura`.
 *
 * Não tentar espelhar isso em `store_profiles` junto do `isCaixaAberto`: a regra
 * do operador é `hasOnly(['isCaixaAberto'])` e um campo a mais bloqueia a
 * abertura de caixa dele.
 *
 * Vive num hook só porque o placar flutuante e a tela de visitantes precisam do
 * MESMO marco — dois cálculos separados divergiriam no dia em que a loja abre
 * dois caixas.
 */
export function useCaixaAbertoEm(ownerId: string | null | undefined): Date | null {
  const db = useFirestore();
  const [caixaAbertoEm, setCaixaAbertoEm] = useState<Date | null>(null);

  useEffect(() => {
    if (!db || !ownerId) return;
    const q = query(
      collection(db, 'cash_registers'),
      where('ownerId', '==', ownerId),
      where('status', '==', 'aberto')
    );
    const parar = onSnapshot(
      q,
      (snap) => {
        // Mais de um caixa aberto (acontece) vale o mais recente.
        const abertura = snap.docs
          .map((d) => d.data()?.dataAbertura?.toDate?.() as Date | undefined)
          .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()))
          .sort((a, b) => b.getTime() - a.getTime())[0];
        setCaixaAbertoEm(abertura ?? null);
      },
      () => setCaixaAbertoEm(null)
    );
    return () => parar();
  }, [db, ownerId]);

  return caixaAbertoEm;
}
