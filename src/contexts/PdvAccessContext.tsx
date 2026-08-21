'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { doc } from 'firebase/firestore';
import { signOut, type User } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAuth, useDoc, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import {
  normalizeOperatorPermissions,
  type OperatorPermissions,
  type OperatorRoleDocument,
} from '@/lib/user-permissions';

export type PdvAccessRole = 'owner' | 'operator';

export interface PdvAccessContextValue {
  role: PdvAccessRole;
  ownerId: string;
  actorId: string;
  operatorName: string | null;
  /** Nome legível de quem está operando (dono ou funcionário) para carimbar vendas. */
  actorName: string;
  operatorPermissions: OperatorPermissions | null;
  /**
   * A mesma sessão de quem está logado, mas com o uid da LOJA.
   *
   * Dezenas de telas da Retaguarda descobrem de quem são os dados fazendo
   * `where('ownerId', '==', user.uid)` ou `doc('store_profiles', user.uid)`.
   * Para o dono isso já é o certo; para um funcionário, seria o uid dele — a
   * tela abriria vazia ou, pior, gravaria dado fora da loja. Passar este objeto
   * no lugar de `user` conserta todos esses pontos de uma vez, sem espalhar o
   * ownerId por cada componente. Quem precisa saber QUEM fez a ação continua
   * usando actorId/actorName, que não mudam.
   */
  storeUser: User;
  isLoading: false;
}

const PdvAccessContext = createContext<PdvAccessContextValue | null>(null);

interface AdminRoleDocument {
  storeName?: string;
  email?: string;
}

function LoadingAccess() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
    </div>
  );
}

export function PdvAccessProvider({ children }: { children: React.ReactNode }) {
  const db = useFirestore();
  const auth = useAuth();
  const router = useRouter();
  const { user } = useUser();
  const actorId = user?.uid ?? '';

  const adminRoleRef = useMemoFirebase(
    () => (db && actorId ? doc(db, 'roles_admin', actorId) : null),
    [actorId, db],
  );
  const operatorRoleRef = useMemoFirebase(
    () => (db && actorId ? doc(db, 'roles_operador', actorId) : null),
    [actorId, db],
  );
  const {
    data: adminRole,
    isLoading: adminLoading,
    error: adminError,
  } = useDoc<AdminRoleDocument>(adminRoleRef);
  const {
    data: operatorRole,
    isLoading: operatorLoading,
    error: operatorError,
  } = useDoc<OperatorRoleDocument>(operatorRoleRef);

  const [showAccessDenied, setShowAccessDenied] = useState(false);
  const ownerId = adminRole
    ? actorId
    : operatorRole?.active === true && typeof operatorRole.ownerId === 'string'
      ? operatorRole.ownerId.trim()
      : '';
  const role: PdvAccessRole | null = adminRole
    ? 'owner'
    : ownerId
      ? 'operator'
      : null;
  const rolesLoading = adminLoading || operatorLoading;
  const accessError = adminError || operatorError;

  useEffect(() => {
    if (rolesLoading || accessError || role) {
      setShowAccessDenied(false);
      return;
    }
    const timer = window.setTimeout(() => setShowAccessDenied(true), 800);
    return () => window.clearTimeout(timer);
  }, [accessError, role, rolesLoading]);

  const operatorPermissions = useMemo(
    () => role === 'operator'
      ? normalizeOperatorPermissions(operatorRole?.permissions)
      : null,
    [operatorRole?.permissions, role],
  );

  // Proxy em vez de cópia: User tem métodos e getters no protótipo (getIdToken,
  // reload...), que um spread perderia. Só o uid é trocado.
  const storeUser = useMemo(() => {
    if (!user) return null;
    if (role !== 'operator' || !ownerId || ownerId === user.uid) return user;
    return new Proxy(user, {
      get(alvo, prop) {
        if (prop === 'uid') return ownerId;
        const valor = Reflect.get(alvo, prop, alvo);
        return typeof valor === 'function' ? valor.bind(alvo) : valor;
      },
    });
  }, [ownerId, role, user]);

  const handleLogout = async () => {
    if (!auth) return;
    await signOut(auth);
    router.push('/login');
  };

  if (!db || !actorId || !user || !storeUser || rolesLoading || (!role && !accessError && !showAccessDenied)) {
    return <LoadingAccess />;
  }

  if (accessError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-4 text-center">
        <ShieldAlert className="mb-4 h-16 w-16 text-destructive" />
        <h1 className="mb-2 text-2xl font-bold">Não foi possível verificar seu acesso</h1>
        <p className="mb-4 max-w-md text-sm text-muted-foreground">
          As permissões permanecem bloqueadas. Confira a conexão e tente novamente.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.location.reload()}>Tentar novamente</Button>
          <Button onClick={handleLogout}>Sair e trocar conta</Button>
        </div>
      </div>
    );
  }

  if (!role || !ownerId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-4 text-center">
        <ShieldAlert className="mb-4 h-16 w-16 text-destructive" />
        <h1 className="mb-2 text-2xl font-bold">Acesso negado</h1>
        <p className="mb-1 text-muted-foreground">
          Esta conta não pertence a uma loja ou está desativada.
        </p>
        <p className="mb-4 rounded bg-muted p-2 font-mono text-xs">Seu UID: {actorId}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.location.reload()}>Tentar novamente</Button>
          <Button onClick={handleLogout}>Sair e trocar conta</Button>
        </div>
      </div>
    );
  }

  const operatorName = role === 'operator' ? operatorRole?.name?.trim() || null : null;
  const value: PdvAccessContextValue = {
    role,
    ownerId,
    actorId,
    operatorName,
    actorName: role === 'operator'
      ? (operatorName || user?.email || 'Funcionário')
      : (user?.displayName?.trim() || user?.email || 'Administrador'),
    operatorPermissions,
    storeUser,
    isLoading: false,
  };

  // Troca de conta/papel remonta toda a área interna. Estados locais e dados
  // otimistas de uma identidade nunca sobrevivem para a próxima.
  return (
    <PdvAccessContext.Provider value={value} key={`${actorId}:${role}:${ownerId}`}>
      {children}
    </PdvAccessContext.Provider>
  );
}

export function usePdvAccess(): PdvAccessContextValue {
  const context = useContext(PdvAccessContext);
  if (!context) {
    throw new Error('usePdvAccess deve ser usado dentro de PdvAccessProvider.');
  }
  return context;
}
