'use client';

import React, { useEffect } from 'react';
import { useAuth } from '@/firebase';
import { setPersistence, browserLocalPersistence } from 'firebase/auth';

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

  return <>{children}</>;
}
