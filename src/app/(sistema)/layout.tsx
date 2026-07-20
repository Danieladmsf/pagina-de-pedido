'use client';

import React, { useEffect } from 'react';
import { useFirestore, useUser, useAuth } from '@/firebase';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { PdvAccessProvider } from '@/contexts/PdvAccessContext';

// Guard de autenticação único do sistema interno (PDV + Gestão). É a mesma
// lógica que vivia na antiga página raiz; centralizada aqui, as duas rotas não
// duplicam o gate. Como layouts não remontam ao navegar entre /pdv e /gestao,
// a troca de rota não re-passa pelo guard nem pisca o loader.
export default function SistemaLayout({ children }: { children: React.ReactNode }) {
  const db = useFirestore();
  const auth = useAuth();
  const router = useRouter();
  const { user, isUserLoading } = useUser();

  const isRealUser = !!(user && !user.isAnonymous);

  // Redireciona para o login só quando há CERTEZA de que não há sessão.
  //
  // Causa raiz (confirmada): num reload de deploy, o service worker novo assume e o
  // IndexedDB fica brevemente indisponível. O Firebase então reporta "sem sessão"
  // (authStateReady resolve com currentUser=null) e só RESTAURA a sessão um instante
  // depois. Por isso esperamos o estado ficar pronto e re-checamos por ~2s antes de
  // mandar pro login — é o tratamento de um async conhecido, não um timer no escuro.
  // Logout intencional vai direto via handleLogout.
  useEffect(() => {
    if (!auth) return;
    if (user && !user.isAnonymous) return; // já logado neste render

    let cancelled = false;
    let tries = 0;
    const MAX_TRIES = 8; // ~2s a 250ms

    const decide = () => {
      if (cancelled) return;
      if (auth.currentUser && !auth.currentUser.isAnonymous) return; // sessão voltou
      tries += 1;
      if (tries >= MAX_TRIES) {
        router.replace('/login');
        return;
      }
      setTimeout(decide, 250);
    };

    // authStateReady() resolve quando o Firebase determina o estado inicial.
    auth.authStateReady().then(decide).catch(() => decide());
    return () => { cancelled = true; };
  }, [user, auth, router]);

  if (isUserLoading || !db || !isRealUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return <PdvAccessProvider>{children}</PdvAccessProvider>;
}
