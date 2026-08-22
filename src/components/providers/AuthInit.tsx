'use client';

import React, { useEffect } from 'react';
import { useAuth } from '@/firebase';
import { setPersistence, browserLocalPersistence, onAuthStateChanged } from 'firebase/auth';
import { marcarSessaoLocal } from '@/lib/sessao-local';

export function AuthInit({ children }: { children: React.ReactNode }) {
  const auth = useAuth();

  useEffect(() => {
    if (!auth) return;

    (async () => {
      try {
        await setPersistence(auth, browserLocalPersistence);
      } catch (err) {
        console.warn('[AuthInit] setPersistence falhou:', err);
      }

      try {
        await auth.authStateReady();
      } catch (err) {
        console.warn('[AuthInit] authStateReady falhou:', err);
      }

      if (auth.currentUser) {
        console.log('[AuthInit] ♻️ user restaurado:', auth.currentUser.uid, auth.currentUser.isAnonymous ? '(anônimo)' : `(${auth.currentUser.email})`);
      } else {
        console.log('[AuthInit] sem user — anônimo será criado on-demand no checkout/login');
      }
    })();
  }, [auth]);

  // Mantém o marcador de "esta máquina tem conta" em dia — é o que faz a página
  // inicial mandar o dono direto ao PDV sem mostrar a vitrine. Fica aqui porque
  // este é o único ponto que acompanha entrada e saída em todas as telas.
  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (usuario) => {
      marcarSessaoLocal(!!usuario && !usuario.isAnonymous);
    });
  }, [auth]);

  return <>{children}</>;
}
