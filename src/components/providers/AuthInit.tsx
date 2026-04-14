
'use client';

import React, { useEffect } from 'react';
import { useAuth } from '@/firebase';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';

export function AuthInit({ children }: { children: React.ReactNode }) {
  const auth = useAuth();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        signInAnonymously(auth).catch(console.error);
      }
    });
    return () => unsubscribe();
  }, [auth]);

  return <>{children}</>;
}
