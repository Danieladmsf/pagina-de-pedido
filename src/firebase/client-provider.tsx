
'use client';

import React, { useState, useEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { FirebaseProvider } from '@/firebase/provider';
import { initializeFirebase } from '@/firebase';
import { Loader2 } from 'lucide-react';

// Telas que não leem nada do Firebase e por isso não devem esperar por ele.
// Isto existe por causa do Google: enquanto o loader abaixo segurava a árvore
// inteira, o HTML servido saía com um spinner e mais nada — o buscador recebia
// uma página em branco. Como estas rotas não dependem de dados da loja, elas
// renderizam de primeira, no servidor, com o texto pronto.
const ROTAS_SEM_FIREBASE = ['/', '/polaris'];

interface FirebaseClientProviderProps {
  children: ReactNode;
}

export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
  const [services, setServices] = useState<any>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const pathname = usePathname();
  const dispensaFirebase = ROTAS_SEM_FIREBASE.includes(pathname);

  useEffect(() => {
    try {
      const initialized = initializeFirebase();
      setServices(initialized);
    } catch (error) {
      console.error("Erro ao inicializar Firebase:", error);
    } finally {
      setIsInitializing(false);
    }
  }, []);

  // Enquanto o Firebase inicializa, mostramos um loader para evitar erros de hidratação.
  // O servidor e o primeiro render do cliente decidem igual (a rota é a mesma nos dois),
  // então liberar as rotas da lista acima não gera divergência de hidratação.
  if (isInitializing && !dispensaFirebase) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF7]">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  // Se por algum motivo falhar, renderiza o provider com nulos para não quebrar o contexto
  return (
    <FirebaseProvider
      firebaseApp={services?.firebaseApp || null}
      auth={services?.auth || null}
      firestore={services?.firestore || null}
    >
      {children}
    </FirebaseProvider>
  );
}
