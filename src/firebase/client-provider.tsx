'use client';

import React, { useState, useEffect, type ReactNode } from 'react';
import { FirebaseProvider } from '@/firebase/provider';
import { initializeFirebase } from '@/firebase';

interface FirebaseClientProviderProps {
  children: ReactNode;
}

export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
  const [services, setServices] = useState<any>(null);

  useEffect(() => {
    // Inicializa o Firebase apenas no cliente após a montagem do componente
    setServices(initializeFirebase());
  }, []);

  // Enquanto os serviços não estão prontos, renderizamos apenas o layout básico
  // para evitar erros de "useContext" nos componentes filhos.
  if (!services) {
    return (
      <div className="min-h-screen bg-[#FAFAF7]">
        {children}
      </div>
    );
  }

  return (
    <FirebaseProvider
      firebaseApp={services.firebaseApp}
      auth={services.auth}
      firestore={services.firestore}
    >
      {children}
    </FirebaseProvider>
  );
}
