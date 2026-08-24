'use client';

import React, { createContext, useContext } from 'react';
import { doc } from 'firebase/firestore';
import { useDoc, useFirestore, useMemoFirebase } from '@/firebase';
import { usePdvAccess } from '@/contexts/PdvAccessContext';

interface PerfilDaLoja {
  storeProfile: any;
}

const PerfilDaLojaCtx = createContext<PerfilDaLoja | null>(null);

/**
 * O cadastro da loja lido UMA VEZ, no layout do sistema.
 *
 * Existe pelo nome e pela foto no topo do menu. Cada tela buscava o perfil por
 * conta própria e passava para o menu por prop, então ao trocar de rota o menu
 * montava antes de o dado chegar e mostrava "Minha Loja" com as iniciais
 * genéricas por ~100ms antes de virar o nome real — a piscada que sobrava no
 * canto superior esquerdo. Aqui o dado vive acima das páginas, no layout que
 * não remonta, e o cabeçalho do menu nunca fica sem.
 */
export function PerfilDaLojaProvider({ children }: { children: React.ReactNode }) {
  const db = useFirestore();
  const { ownerId } = usePdvAccess();

  const perfilRef = useMemoFirebase(
    () => (db && ownerId ? doc(db, 'store_profiles', ownerId) : null),
    [db, ownerId],
  );
  const { data: storeProfile } = useDoc<any>(perfilRef);

  return (
    <PerfilDaLojaCtx.Provider value={{ storeProfile }}>
      {children}
    </PerfilDaLojaCtx.Provider>
  );
}

/** Devolve `null` fora do provider — quem chama cai no que receber por prop. */
export function usePerfilDaLoja() {
  return useContext(PerfilDaLojaCtx);
}
