'use client';

import React, { useEffect } from 'react';
import { useFirestore, useUser, useAuth } from '@/firebase';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { PdvAccessProvider } from '@/contexts/PdvAccessContext';
import { MenuLateralProvider } from '@/contexts/MenuLateralContext';
import { PerfilDaLojaProvider } from '@/contexts/PerfilDaLojaContext';
import { OrderAlertsWatcher } from '@/components/system/OrderAlertsWatcher';
import { AudienceBadge } from '@/components/system/AudienceBadge';

// Guard de autenticação único do sistema interno (PDV + Gestão). É a mesma
// lógica que vivia na antiga página raiz; centralizada aqui, as duas rotas não
// duplicam o gate. Como layouts não remontam ao navegar entre /pdv e /gestao,
// a troca de rota não re-passa pelo guard nem pisca o loader.
export function SistemaGuard({ children }: { children: React.ReactNode }) {
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

  // O OrderAlertsWatcher fica AQUI (não dentro de /pdv) de propósito: o layout não
  // remonta ao navegar entre PDV e Retaguarda, então o alerta de pedido novo (som +
  // impressão automática) toca em qualquer uma das duas telas.
  return (
    <PdvAccessProvider>
      <MenuLateralProvider>
        <PerfilDaLojaProvider>
          <OrderAlertsWatcher />
          <AudienceBadge />
          {children}
        </PerfilDaLojaProvider>
      </MenuLateralProvider>
    </PdvAccessProvider>
  );
}
