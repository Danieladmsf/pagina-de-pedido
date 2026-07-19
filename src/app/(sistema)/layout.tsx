'use client';

import React, { useState, useEffect } from 'react';
import { useFirestore, useMemoFirebase, useUser, useDoc, useAuth } from '@/firebase';
import { doc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

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

  const adminRoleRef = useMemoFirebase(() => (db && isRealUser) ? doc(db, 'roles_admin', user!.uid) : null, [db, isRealUser, user?.uid]);
  const { data: adminRole, isLoading: loadingRole } = useDoc(adminRoleRef);

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

  // Só mostra "Acesso Negado" depois que a role realmente resolveu sem permissão.
  // Pequena janela de segurança contra erro transitório (ex.: permissão que
  // se resolve numa nova tentativa) antes de declarar acesso negado.
  const [showAccessDenied, setShowAccessDenied] = useState(false);
  useEffect(() => {
    if (isUserLoading || loadingRole || !db || !isRealUser || adminRole) {
      setShowAccessDenied(false);
      return;
    }
    const timer = setTimeout(() => setShowAccessDenied(true), 800);
    return () => clearTimeout(timer);
  }, [isUserLoading, loadingRole, db, isRealUser, adminRole]);

  const handleLogout = async () => {
    if (!auth) return;
    await signOut(auth);
    router.push('/login');
  };

  // Gate de carregamento. Com useDoc/useCollection em stale-while-revalidate,
  // loadingRole só é true na primeira carga (não pisca em re-subscrições), então
  // este gate não derruba mais a UI/modais durante o uso normal.
  if (isUserLoading || !db || !isRealUser || loadingRole || (!adminRole && !showAccessDenied)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (showAccessDenied) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4 text-center">
        <ShieldAlert className="h-16 w-16 text-destructive mb-4" />
        <h1 className="text-2xl font-bold mb-2">Acesso Negado</h1>
        <p className="text-muted-foreground mb-1">Você não tem permissão de administrador.</p>
        <p className="text-xs font-mono bg-muted p-2 rounded mb-4">Seu UID: {user?.uid}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.location.reload()}>🔄 Tentar novamente</Button>
          <Button onClick={handleLogout}>Sair e Trocar Conta</Button>
        </div>
      </div>
    );
  }

  // A troca direta entre duas contas precisa remontar toda a área interna;
  // assim nenhum estado local de formulário/modal da conta anterior sobrevive.
  return <React.Fragment key={user!.uid}>{children}</React.Fragment>;
}
