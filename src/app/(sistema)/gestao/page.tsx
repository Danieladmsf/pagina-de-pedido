'use client';

import React, { useState, useEffect } from 'react';
import { useFirestore, useCollection, useMemoFirebase, useUser, useDoc, useAuth } from '@/firebase';
import { collection, doc, updateDoc, query, where } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Loader2, Eye } from 'lucide-react';
import { DashboardTab } from '@/components/admin/DashboardTab';
import { RelatoriosTab } from '@/components/admin/RelatoriosTab';
import { useToast } from '@/hooks/use-toast';
import { CurrencyInput } from '@/components/ui/currency-input';
import { ClientesTab } from '@/components/admin/ClientesTab';
import { StoreProfileTab } from '@/components/admin/StoreProfileTab';
import { RetaguardaShell } from '@/components/admin/RetaguardaShell';
import { CategoriasTab } from '@/components/admin/CategoriasTab';
import { ProdutosTab } from '@/components/admin/ProdutosTab';
import { AdicionaisTab } from '@/components/admin/AdicionaisTab';
import { WelcomeWizard } from '@/components/admin/WelcomeWizard';
import { AppearanceTab } from '@/components/admin/AppearanceTab';
import { WhatsAppTab } from '@/components/admin/WhatsAppTab';
import { PromotionsTab } from '@/components/admin/PromotionsTab';
import { EstoqueTab } from '@/components/admin/EstoqueTab';
import { CampanhasTab } from '@/components/campanhas/CampanhasTab';
import { EncomendasAdminTab } from '@/components/admin/EncomendasAdminTab';
import { FreelanceTab } from '@/components/admin/FreelanceTab';
import { useCaixa } from '@/hooks/useCaixa';
import { brl } from '@/lib/utils';
import { getLigarTudoUpdate } from '@/lib/menu-visibility';
import { type TipoDeAlerta } from '@/lib/produtos/alertas';

/**
 * A cor de cada etiqueta de alerta. Mesma paleta na barra do topo e na linha
 * do produto: a dona aprende a cor uma vez.
 */
import { AdminPasswordDialog } from '@/components/admin/AdminPasswordDialog';
import { ADMIN_SESSION_UPDATED_EVENT, getAdminSessionRemainingMs, isAdminSessionUnlocked, unlockAdminSession, type AdminSecret } from '@/lib/admin-password';
import { usePdvAccess } from '@/contexts/PdvAccessContext';
import {
  canAccessRetaguardaTab,
  canEditRetaguardaTab,
  EMPTY_OPERATOR_RETAGUARDA_PERMISSIONS,
} from '@/lib/user-permissions';
import { OperatorCatalogReadOnly } from '@/components/admin/OperatorCatalogReadOnly';
import { UsuariosTab } from '@/components/admin/UsuariosTab';

const GESTAO_TAB_ORDER = [
  'dashboard',
  'relatorios',
  'produtos',
  'estoque',
  'categorias',
  'addons',
  'clientes',
  'promocoes',
  'whatsapp',
  'campanhas',
  'encomendas',
  'freelance',
  'usuarios',
  'perfil_geral',
  'perfil_taxas',
  'perfil_horarios',
  'perfil_pagamentos',
  'perfil_impressora',
  'perfil_aparencia',
] as const;

/** Abas de cadastro que têm uma versão só de leitura para quem não pode alterar. */
const CATALOGO_TABS = ['produtos', 'categorias', 'addons', 'promocoes'];

export default function GestaoPage() {
  const db = useFirestore();
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { user, isUserLoading } = useUser();
  const { role, ownerId, actorId, actorName, operatorName, operatorPermissions, storeUser } = usePdvAccess();
  const retaguardaPermissions = operatorPermissions?.retaguarda
    ?? EMPTY_OPERATOR_RETAGUARDA_PERMISSIONS;
  const isTabAllowed = React.useCallback(
    (tabId: string) => canAccessRetaguardaTab(role, retaguardaPermissions, tabId),
    [retaguardaPermissions, role],
  );
  const podeEditarAba = React.useCallback(
    (tabId: string) => canEditRetaguardaTab(role, retaguardaPermissions, tabId),
    [retaguardaPermissions, role],
  );
  const allowedTabs = React.useMemo(
    () => GESTAO_TAB_ORDER.filter((tabId) => isTabAllowed(tabId)),
    [isTabAllowed],
  );
  const [storedActiveTab, setActiveTab] = useState<string>('dashboard');
  // O cadastro de motoboys virou parte da aba Gestão de Entregas. Quem voltar
  // pelo histórico do navegador na aba antiga cai lá, e não numa tela vazia.
  const tabPedida = storedActiveTab === 'perfil_motoboys' ? 'freelance' : storedActiveTab;
  const activeTab = isTabAllowed(tabPedida)
    ? tabPedida
    : allowedTabs[0] ?? '';

  // Synchronize history state with activeTab
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (event.state && event.state.type === 'gestao-tab') {
        const requested = typeof event.state.tab === 'string' ? event.state.tab : '';
        const target = isTabAllowed(requested) ? requested : allowedTabs[0];
        if (target) setActiveTab(target);
      }
    };
    window.addEventListener('popstate', handlePopState);
    
    // Replace initial state with current tab if no state exists
    if (!window.history.state) {
      window.history.replaceState({ type: 'gestao-tab', tab: activeTab }, '');
    }

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [activeTab, allowedTabs, isTabAllowed]);

  useEffect(() => {
    if (activeTab && storedActiveTab !== activeTab) {
      setActiveTab(activeTab);
      window.history.replaceState({ type: 'gestao-tab', tab: activeTab }, '');
    }
  }, [activeTab, storedActiveTab]);

  // Quem clica num item do menu estando em OUTRA tela do painel (Visitantes é a
  // primeira delas) chega aqui com a aba pedida na URL: /gestao?aba=produtos.
  // Lemos uma vez, no primeiro render, e limpamos o endereço — a aba continua
  // sendo estado da página, e a URL não fica grudada no histórico. Permissão
  // continua mandando: aba proibida cai no fallback do `activeTab`.
  useEffect(() => {
    const pedida = new URLSearchParams(window.location.search).get('aba');
    if (!pedida) return;
    setActiveTab(pedida);
    window.history.replaceState({ type: 'gestao-tab', tab: pedida }, '', '/gestao');
  }, []);

  useEffect(() => {
    if (role === 'operator' && allowedTabs.length === 0) {
      router.replace('/pdv');
    }
  }, [allowedTabs.length, role, router]);

  const handleTabChange = (newTab: string) => {
    if (!isTabAllowed(newTab)) {
      toast({ variant: 'destructive', title: 'Você não tem acesso a este módulo.' });
      return;
    }
    setActiveTab(newTab);
    const currentState = window.history.state;
    if (!currentState || currentState.type !== 'gestao-tab' || currentState.tab !== newTab) {
      window.history.pushState({ type: 'gestao-tab', tab: newTab }, '');
    }
  };
  const [wizardDismissed, setWizardDismissed] = useState(false);
  
  // Estados para filtros de Produtos
  const [productSearch, setProductSearch] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState('todas');
  // Filtro do resumo "mercadoria presa": desligado com estoque esperando.
  /** Etiqueta de alerta em foco na lista (null = todos os produtos). */
  const [filtroAlerta, setFiltroAlerta] = useState<TipoDeAlerta | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

  
  // Hook do Caixa: a Gestão só precisa dele para o acerto de crédito na aba
  // Clientes (registrarLancamento/caixaAberto); sessão/histórico ficam no PDV.
  const { caixaAberto, registrarLancamento } = useCaixa({
    ownerId,
    actorId,
    actorName,
    enabled: role === 'owner' || isTabAllowed('clientes') || isTabAllowed('prazo'),
  });
  
  const isRealUser = !!(user && !user.isAnonymous);
  // Cadastro liberado só para ver: a tela real é toda de edição, então quem não
  // pode alterar recebe a lista em leitura no lugar dela.
  const catalogoSomenteConsulta = CATALOGO_TABS.includes(activeTab) && !podeEditarAba(activeTab);
  // Demais módulos não têm versão de leitura: o aviso conta o que vai acontecer
  // se ele tentar salvar (o servidor recusa) em vez de deixar a descoberta pro erro.
  const moduloSomenteConsulta = !catalogoSomenteConsulta
    && activeTab !== ''
    && isTabAllowed(activeTab)
    && !podeEditarAba(activeTab)
    && !['dashboard', 'relatorios'].includes(activeTab);

  // Consultas filtradas pelo UID do dono (Multi-tenancy) com checagem de DB
  const categoriesQuery = useMemoFirebase(() => {
    if (!db || !isRealUser || !(role === 'owner' || isTabAllowed('produtos') || isTabAllowed('categorias'))) return null;
    return query(collection(db, 'categories'), where('ownerId', '==', ownerId));
  }, [db, isRealUser, isTabAllowed, ownerId, role]);

  const itemsQuery = useMemoFirebase(() => {
    if (!db || !isRealUser || !(role === 'owner' || isTabAllowed('produtos') || isTabAllowed('promocoes'))) return null;
    return query(collection(db, 'menuItems'), where('ownerId', '==', ownerId));
  }, [db, isRealUser, isTabAllowed, ownerId, role]);

  const ordersQuery = useMemoFirebase(() => {
    const precisaDosPedidos = role === 'owner'
      || ['dashboard', 'relatorios', 'clientes', 'freelance', 'encomendas'].some(isTabAllowed);
    if (!db || !isRealUser || !precisaDosPedidos) return null;
    return query(collection(db, 'orders'), where('ownerId', '==', ownerId));
  }, [db, isRealUser, isTabAllowed, ownerId, role]);

  const addonsQuery = useMemoFirebase(() => {
    if (!db || !isRealUser || !(role === 'owner' || isTabAllowed('produtos') || isTabAllowed('addons'))) return null;
    return query(collection(db, 'addons'), where('ownerId', '==', ownerId));
  }, [db, isRealUser, isTabAllowed, ownerId, role]);

  const addonCategoriesQuery = useMemoFirebase(() => {
    if (!db || !isRealUser || !(role === 'owner' || isTabAllowed('produtos') || isTabAllowed('addons'))) return null;
    return query(collection(db, 'addonCategories'), where('ownerId', '==', ownerId));
  }, [db, isRealUser, isTabAllowed, ownerId, role]);

  const promotionsQuery = useMemoFirebase(() => {
    if (!db || !isRealUser || !(role === 'owner' || isTabAllowed('promocoes'))) return null;
    return query(collection(db, 'promotions'), where('ownerId', '==', ownerId));
  }, [db, isRealUser, isTabAllowed, ownerId, role]);

  const storeProfileRef = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return doc(db, 'store_profiles', ownerId);
  }, [db, isRealUser, ownerId]);

  const { data: storeProfile, isLoading: storeProfileLoading, error: storeProfileError } = useDoc(storeProfileRef);

  const adminSecretRef = useMemoFirebase(() => {
    if (!db || !isRealUser || role !== 'owner') return null;
    return doc(db, 'admin_secrets', ownerId);
  }, [db, isRealUser, ownerId, role]);
  const { data: adminSecret, isLoading: adminSecretLoading, error: adminSecretError } = useDoc<AdminSecret>(adminSecretRef);
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [isAdminGateResolved, setIsAdminGateResolved] = useState(false);
  const adminSecretResolved = role === 'operator'
    || (!!adminSecretRef && !adminSecretLoading && !adminSecretError);

  const previousUserIdRef = React.useRef<string | null>(user?.uid ?? null);
  useEffect(() => {
    const nextUserId = user?.uid ?? null;
    if (previousUserIdRef.current !== nextUserId) {
      setIsAdminUnlocked(false);
      setIsAdminGateResolved(false);
      setActiveTab(role === 'owner' ? 'dashboard' : allowedTabs[0] ?? '');
      setWizardDismissed(false);
    }
    previousUserIdRef.current = nextUserId;
  }, [allowedTabs, role, user?.uid]);

  useEffect(() => {
    if (role === 'operator') {
      setIsAdminUnlocked(true);
      setIsAdminGateResolved(true);
      return;
    }
    if (!adminSecretRef || adminSecretLoading || adminSecretError) {
      setIsAdminGateResolved(false);
      return;
    }
    setIsAdminUnlocked(!adminSecret || isAdminSessionUnlocked(user!.uid, adminSecret));
    setIsAdminGateResolved(true);
  }, [adminSecret, adminSecretError, adminSecretLoading, adminSecretRef, role, user]);

  useEffect(() => {
    if (!adminSecret || !isAdminUnlocked || !user) return;
    let timeoutId: number | undefined;
    const validateAndSchedule = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      const remaining = getAdminSessionRemainingMs(user.uid, adminSecret);
      if (remaining <= 0) {
        setIsAdminUnlocked(false);
        return;
      }
      timeoutId = window.setTimeout(validateAndSchedule, remaining + 50);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') validateAndSchedule();
    };
    validateAndSchedule();
    window.addEventListener('focus', validateAndSchedule);
    window.addEventListener(ADMIN_SESSION_UPDATED_EVENT, validateAndSchedule);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      window.removeEventListener('focus', validateAndSchedule);
      window.removeEventListener(ADMIN_SESSION_UPDATED_EVENT, validateAndSchedule);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [adminSecret, isAdminUnlocked, user]);

  const effectiveAdminUnlocked = role === 'operator' || (adminSecretResolved && (
    !adminSecret
    || (!!user && isAdminUnlocked && isAdminSessionUnlocked(user.uid, adminSecret))
  ));

  const { data: categories, isLoading: loadingCats } = useCollection(categoriesQuery);
  const { data: addonCategories, isLoading: loadingAddonCats } = useCollection(addonCategoriesQuery);
  const { data: items, isLoading: loadingItems } = useCollection(itemsQuery);
  const { data: ordersRaw, isLoading: loadingOrders, error: ordersError } = useCollection(ordersQuery);
  const { data: promotions, isLoading: loadingPromotions } = useCollection(promotionsQuery);

  const { data: addons, isLoading: loadingAddons } = useCollection(addonsQuery);

  // Higiene: containers podem acumular IDs de adicionais que foram excluídos
  // da Lista Matriz (vínculo fica órfão no addonIds). Limpa uma vez por
  // sessão, só nos containers do próprio dono, quando os dois datasets
  // chegaram completos.
  const danglingCleanupDoneRef = React.useRef(false);
  useEffect(() => {
    if (danglingCleanupDoneRef.current) return;
    if (role !== 'owner' || !db || !isRealUser || !addons || !addonCategories) return;
    danglingCleanupDoneRef.current = true;
    const validIds = new Set((addons as any[]).map((a: any) => a.id));
    const dirty = (addonCategories as any[]).filter((c: any) =>
      c.ownerId === ownerId &&
      Array.isArray(c.addonIds) &&
      c.addonIds.some((id: string) => !validIds.has(id))
    );
    if (dirty.length === 0) return;
    (async () => {
      try {
        for (const c of dirty) {
          const cleaned = c.addonIds.filter((id: string) => validIds.has(id));
          await updateDoc(doc(db, 'addonCategories', c.id), { addonIds: cleaned });
        }
        console.log(`[higiene] ${dirty.length} container(s) limpos de adicionais excluídos.`);
      } catch (e) {
        console.warn('[higiene] falha ao limpar containers:', e);
      }
    })();
  }, [addonCategories, addons, db, isRealUser, ownerId, role]);

  const [editingCombo, setEditingCombo] = useState<any>(null);
  // Chaves "produtoId:toggle" com escrita em voo. O Firestore pinta o botão na
  // hora (latency compensation), então sem isto o dono via "ligado" antes de
  // existir gravação — e se a rede caísse ou o PC fosse desligado no fim do
  // expediente, a mudança morria com a aba sem nenhum aviso.
  const [salvandoVisibilidade, setSalvandoVisibilidade] = useState<Set<string>>(new Set());

  /**
   * Religa o produto em todos os canais. Mesmo tratamento do botão da linha:
   * trava enquanto grava e avisa se a gravação falhar, porque o Firestore pinta
   * a mudança local antes de o servidor confirmar.
   *
   * Fica na página porque duas telas oferecem o botão: a aba Produtos e o
   * catálogo somente-consulta de quem não pode editar.
   */
  const religarProduto = React.useCallback(async (item: any) => {
    if (!db) return;
    const chave = `${item.id}:religar`;
    setSalvandoVisibilidade((atual) => new Set(atual).add(chave));
    try {
      await updateDoc(doc(db, 'menuItems', item.id), getLigarTudoUpdate());
      toast({ title: `"${item.name}" voltou para o cardápio` });
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Não deu para religar',
        description: `"${item.name}" continua desligado. Confira a internet e tente de novo.`,
      });
    } finally {
      setSalvandoVisibilidade((atual) => {
        const proximo = new Set(atual);
        proximo.delete(chave);
        return proximo;
      });
    }
  }, [db, toast]);

  const [quickPriceEdit, setQuickPriceEdit] = useState<{ id: string; name: string; price: number; collection?: 'menuItems' | 'addons' } | null>(null);

  // Manage quick price edit dialog
  useEffect(() => {
    const isOpen = quickPriceEdit !== null;
    if (isOpen) {
      window.history.pushState({ type: 'admin-quick-price' }, '');
      const handlePop = () => setQuickPriceEdit(null);
      window.addEventListener('popstate', handlePop);
      return () => {
        window.removeEventListener('popstate', handlePop);
        if (window.history.state?.type === 'admin-quick-price') window.history.back();
      };
    }
  }, [quickPriceEdit !== null]);

  const handleLogout = async () => {
    if (!auth) return;
    await signOut(auth);
    router.push('/login');
  };

  // O guard do (sistema)/layout só monta esta página com sessão e db prontos;
  // este return não executa na prática — repõe o narrowing de tipos que o
  // antigo gate da página única fazia (db: Firestore | null → Firestore).
  if (!db || !user) return null;

  // A casca fica na tela mesmo enquanto a Retaguarda se verifica.
  //
  // Antes estes três estados devolviam tela cheia e o menu sumia junto: quem
  // voltava de Visitantes via a tela inteira piscar — menu e barra escura
  // sumiam, entrava um spinner por alguns segundos e tudo voltava. Só o
  // conteúdo troca agora; o chrome fica parado.
  const comCasca = (conteudo: React.ReactNode) => (
    <RetaguardaShell
      activeTab={activeTab}
      onTabChange={handleTabChange}
      storeName={storeProfile?.general?.name}
      storeLogo={storeProfile?.general?.logoUrl}
      theme={storeProfile?.theme}
      operatorName={operatorName}
      onLogout={handleLogout}
    >
      {conteudo}
    </RetaguardaShell>
  );

  if (adminSecretError) {
    return comCasca(
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-semibold text-slate-800">Não foi possível verificar a senha da Retaguarda.</p>
        <p className="max-w-md text-sm text-slate-500">Confira a conexão e tente novamente. O acesso permanece bloqueado até a verificação terminar.</p>
        <Button onClick={() => window.location.reload()}>Tentar novamente</Button>
      </div>
    );
  }

  if (storeProfileError) {
    return comCasca(
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-semibold text-slate-800">Não foi possível carregar o perfil da loja.</p>
        <p className="max-w-md text-sm text-slate-500">Confira a conexão e tente novamente. As configurações permanecem bloqueadas enquanto o perfil não puder ser verificado.</p>
        <Button onClick={() => window.location.reload()}>Tentar novamente</Button>
      </div>
    );
  }

  if (!isAdminGateResolved || !adminSecretResolved) {
    return comCasca(
      <div className="flex flex-1 items-center justify-center text-sm font-medium text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Verificando acesso à Retaguarda…
      </div>
    );
  }

  if (adminSecret && !effectiveAdminUnlocked) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100">
        <div className="rounded-xl border bg-white px-8 py-6 text-center shadow-sm">
          <p className="font-semibold text-slate-800">Retaguarda protegida</p>
          <p className="mt-1 text-sm text-slate-500">Informe a senha do administrador para continuar.</p>
        </div>
        <AdminPasswordDialog
          open
          onOpenChange={() => {}}
          secret={adminSecret}
          title="Abrir Retaguarda"
          description="Digite a senha do administrador para acessar configurações e relatórios."
          canCancel={false}
          onSuccess={() => {
            unlockAdminSession(user.uid, adminSecret);
            setIsAdminUnlocked(true);
          }}
        />
      </div>
    );
  }

  return (
    <>
    <RetaguardaShell
      activeTab={activeTab}
      onTabChange={handleTabChange}
      storeName={storeProfile?.general?.name}
      storeLogo={storeProfile?.general?.logoUrl}
      theme={storeProfile?.theme}
      operatorName={operatorName}
      onLogout={handleLogout}
    >

        {activeTab === 'dashboard' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <DashboardTab
              db={db}
              user={storeUser}
              orders={ordersRaw || []}
              items={items || []}
              categories={categories || []}
              storeProfile={storeProfile}
            />
          </div>
        )}

        {activeTab === 'relatorios' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <RelatoriosTab
              db={db}
              ownerId={ownerId}
              orders={ordersRaw || []}
              items={items || []}
              categories={categories || []}
              storeProfile={storeProfile}
            />
          </div>
        )}

        {/* Módulo Administrativo (Nova Gestão) */}
        {activeTab === 'whatsapp' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <WhatsAppTab user={storeUser} storeProfile={storeProfile} db={db} />
          </div>
        )}

        {activeTab === 'campanhas' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <CampanhasTab db={db} user={storeUser} storeProfile={storeProfile} />
          </div>
        )}

        {activeTab === 'encomendas' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
              <EncomendasAdminTab db={db} user={storeUser} storeProfile={storeProfile} />
            </div>
          </div>
        )}

        {catalogoSomenteConsulta && (
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            <OperatorCatalogReadOnly
              activeTab={activeTab as 'produtos' | 'categorias' | 'addons' | 'promocoes'}
              items={(items || []) as any[]}
              categories={(categories || []) as any[]}
              addons={(addons || []) as any[]}
              promotions={(promotions || []) as any[]}
              isLoading={activeTab === 'produtos'
                ? loadingItems
                : activeTab === 'categorias'
                  ? loadingCats
                  : activeTab === 'addons'
                    ? loadingAddons
                    : loadingPromotions}
            />
          </div>
        )}

        {moduloSomenteConsulta && (
          <div className="mx-auto mb-2 flex w-full max-w-[1600px] items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
            <Eye className="h-4 w-4 shrink-0" />
            <span>
              <strong>Modo consulta.</strong> Você pode olhar esta tela; salvar alterações aqui não é permitido no seu acesso.
            </span>
          </div>
        )}

        {activeTab === 'estoque' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
              <EstoqueTab
                db={db}
                ownerId={ownerId}
                items={items}
                orders={ordersRaw}
                userName={operatorName || actorName || ''}
                storeName={storeProfile?.general?.name || ''}
                enableInventory={!!storeProfile?.general?.enableInventory}
                onReligarProduto={podeEditarAba('produtos') ? religarProduto : undefined}
              />
            </div>
          </div>
        )}

        {activeTab === 'promocoes' && !catalogoSomenteConsulta && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <PromotionsTab
              db={db} user={storeUser} items={items || []} categories={categories || []} 
              setEditingCombo={(combo) => {
                setEditingCombo(combo);
                if (combo) {
                  handleTabChange('produtos');
                }
              }} 
            />
          </div>
        )}

        <div className={
          ['produtos', 'addons', 'categorias', 'clientes'].includes(activeTab)
            ? 'flex-1 min-h-0 flex flex-col overflow-hidden'
            : ['freelance', 'usuarios'].includes(activeTab) || activeTab.startsWith('perfil_')
              ? 'flex-1 min-h-0 overflow-y-auto custom-scrollbar'
              : 'hidden'
        }>
          <div className={
            (activeTab === 'produtos' || activeTab === 'addons' || activeTab === 'categorias' || activeTab === 'clientes')
              ? 'max-w-[1600px] w-full mx-auto px-2 mt-2 flex-1 min-h-0 flex flex-col'
              : 'max-w-[1600px] w-full mx-auto px-2 space-y-8 relative pb-12 mt-4'
          }>

          {activeTab === 'produtos' && !catalogoSomenteConsulta && (
            <ProdutosTab
              db={db}
              ownerId={ownerId}
              storeUser={storeUser}
              storeProfile={storeProfile}
              categories={(categories || []) as any[]}
              items={(items || []) as any[]}
              addons={(addons || []) as any[]}
              addonCategories={(addonCategories || []) as any[]}
              promotions={(promotions || []) as any[]}
              productSearch={productSearch}
              setProductSearch={setProductSearch}
              productCategoryFilter={productCategoryFilter}
              setProductCategoryFilter={setProductCategoryFilter}
              filtroAlerta={filtroAlerta}
              setFiltroAlerta={setFiltroAlerta}
              sortConfig={sortConfig}
              setSortConfig={setSortConfig}
              editingCombo={editingCombo}
              setEditingCombo={setEditingCombo}
              salvandoVisibilidade={salvandoVisibilidade}
              setSalvandoVisibilidade={setSalvandoVisibilidade}
              religarProduto={religarProduto}
              onEditarPreco={setQuickPriceEdit}
              onIrParaAba={handleTabChange}
            />
          )}

          {/* Quick Price Edit Dialog */}
          <Dialog open={quickPriceEdit !== null} onOpenChange={(open) => { if (!open) setQuickPriceEdit(null); }}>
            <DialogContent className="sm:max-w-[320px]">
              <DialogHeader>
                <DialogTitle className="text-base">Editar Preço</DialogTitle>
              </DialogHeader>
              {quickPriceEdit && (
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  if (!db || !quickPriceEdit) return;
                  const formData = new FormData(e.currentTarget);
                  const newPrice = parseFloat(formData.get('quickPrice') as string);
                  if (isNaN(newPrice) || newPrice < 0) {
                    toast({ variant: 'destructive', title: 'Preço inválido' });
                    return;
                  }
                  try {
                    await updateDoc(doc(db, quickPriceEdit.collection || 'menuItems', quickPriceEdit.id), { price: newPrice });
                    toast({ title: 'Preço atualizado!', description: `${quickPriceEdit.name}: ${brl(newPrice)}` });
                    setQuickPriceEdit(null);
                  } catch (err: any) {
                    toast({ variant: 'destructive', title: 'Erro', description: err?.message });
                  }
                }} className="space-y-4 pt-2">
                  <div>
                    <p className="text-sm text-muted-foreground mb-3 font-medium">{quickPriceEdit.name}</p>
                    <Label htmlFor="quickPrice">Novo preço (R$)</Label>
                    <CurrencyInput
                      id="quickPrice"
                      name="quickPrice"
                      defaultValue={quickPriceEdit.price}
                      required
                      placeholder="0,00"
                    />
                  </div>
                  <DialogFooter>
                    <Button type="submit" className="w-full h-11 font-bold">Salvar Preço</Button>
                  </DialogFooter>
                </form>
              )}
            </DialogContent>
          </Dialog>

          {activeTab === 'categorias' && !catalogoSomenteConsulta && (
            <CategoriasTab
              db={db}
              ownerId={ownerId}
              categories={(categories || []) as any[]}
              items={(items || []) as any[]}
              promotions={(promotions || []) as any[]}
              onVerProdutosDaCategoria={(categoryId) => {
                setProductCategoryFilter(categoryId);
                handleTabChange('produtos');
              }}
            />
          )}

          {activeTab === 'addons' && !catalogoSomenteConsulta && (
            <AdicionaisTab
              db={db}
              ownerId={ownerId}
              categories={(categories || []) as any[]}
              items={(items || []) as any[]}
              addons={(addons || []) as any[]}
              addonCategories={(addonCategories || []) as any[]}
              onEditarPreco={setQuickPriceEdit}
            />
          )}

          {activeTab === 'perfil_aparencia' && (
            <AppearanceTab db={db} user={storeUser} storeProfile={storeProfile} isLoading={storeProfileLoading} />
          )}

          {activeTab === 'usuarios' && (
            <UsuariosTab
              key={user.uid}
              user={user}
              db={db}
              adminSecret={adminSecret}
              isAdminSecretLoading={adminSecretLoading}
            />
          )}
          {activeTab.startsWith('perfil_') && activeTab !== 'perfil_aparencia' && activeTab !== 'perfil_motoboys' && (
            <StoreProfileTab db={db} user={storeUser} activeSection={activeTab.replace('perfil_', '') as any} />
          )}

          {activeTab === 'clientes' && (
            <ClientesTab db={db} user={storeUser} registrarLancamento={registrarLancamento} caixaAberto={!!caixaAberto} />
          )}

          {activeTab === 'freelance' && (
            <div className="mt-6">
              <FreelanceTab
                orders={ordersRaw || []}
                storeProfile={storeProfile}
                // O cadastro da equipe saiu do Perfil da Loja, mas continua
                // valendo a mesma permissão de quem podia editar o perfil.
                podeEditarEquipe={isTabAllowed('perfil_geral')}
              />
            </div>
          )}
          </div>
        </div>
    </RetaguardaShell>

    {db && isRealUser && !storeProfileLoading && !wizardDismissed && !storeProfile?.onboardingCompleted && (
      <WelcomeWizard
        db={db}
        userId={ownerId}
        storeName={storeProfile?.general?.name}
        onComplete={() => setWizardDismissed(true)}
      />
    )}
    </>
  );
}
