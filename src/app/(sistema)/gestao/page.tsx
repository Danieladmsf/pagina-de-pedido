'use client';

import React, { useState, useEffect } from 'react';
import { useFirestore, useCollection, useMemoFirebase, useUser, useDoc, useAuth } from '@/firebase';
import { collection, doc, deleteDoc, setDoc, updateDoc, query, where, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { findUnderSuppliedProducts } from '@/lib/addon-groups';
import { Pencil, Trash2, Plus, Tag, Loader2, Store, Search, HelpCircle, Eye } from 'lucide-react';
import { DashboardTab } from '@/components/admin/DashboardTab';
import { RelatoriosTab } from '@/components/admin/RelatoriosTab';
import { useToast } from '@/hooks/use-toast';
import { CurrencyInput } from '@/components/ui/currency-input';
import { ClientesTab } from '@/components/admin/ClientesTab';
import { StoreProfileTab } from '@/components/admin/StoreProfileTab';
import { RetaguardaShell } from '@/components/admin/RetaguardaShell';
import { CategoriasTab } from '@/components/admin/CategoriasTab';
import { ProdutosTab } from '@/components/admin/ProdutosTab';
import { WelcomeWizard } from '@/components/admin/WelcomeWizard';
import { AppearanceTab } from '@/components/admin/AppearanceTab';
import { WhatsAppTab } from '@/components/admin/WhatsAppTab';
import { PromotionsTab } from '@/components/admin/PromotionsTab';
import { EstoqueTab } from '@/components/admin/EstoqueTab';
import { CampanhasTab } from '@/components/campanhas/CampanhasTab';
import { EncomendasAdminTab } from '@/components/admin/EncomendasAdminTab';
import { FreelanceTab } from '@/components/admin/FreelanceTab';
import { useCaixa } from '@/hooks/useCaixa';
import { Switch } from '@/components/ui/switch';
import { brl, removeAccents } from '@/lib/utils';
import { getLigarTudoUpdate, hasAnyVisibleToggle } from '@/lib/menu-visibility';
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
  const [addonSortConfig, setAddonSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

  const handleAddonSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (addonSortConfig && addonSortConfig.key === key && addonSortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setAddonSortConfig({ key, direction });
  };

  
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
  const [editingAddon, setEditingAddon] = useState<any>(null);

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

  const [editingAddonContainers, setEditingAddonContainers] = useState<Set<string>>(new Set());
  const [quickPriceEdit, setQuickPriceEdit] = useState<{ id: string; name: string; price: number; collection?: 'menuItems' | 'addons' } | null>(null);
  const [addonSearchTerm, setAddonSearchTerm] = useState('');
  const [addonCategoryFilter, setAddonCategoryFilter] = useState('all');
  const [containerProductSearch, setContainerProductSearch] = useState('');
  const [highlightedAddonId, setHighlightedAddonId] = useState<string | null>(null);
  const [selectedAddonIds, setSelectedAddonIds] = useState<Set<string>>(new Set());
  const [isBulkCategoryModalOpen, setIsBulkCategoryModalOpen] = useState(false);
  const [bulkCategoryNames, setBulkCategoryNames] = useState<Set<string>>(new Set());
  const [bulkCategoryInitial, setBulkCategoryInitial] = useState<Set<string>>(new Set());
  const [bulkCategorySearch, setBulkCategorySearch] = useState('');
  const [isAddonCategoryModalOpen, setIsAddonCategoryModalOpen] = useState(false);
  const [newAddonCategoryName, setNewAddonCategoryName] = useState('');
  const [isEditCategoryModalOpen, setIsEditCategoryModalOpen] = useState(false);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editCategoryNewName, setEditCategoryNewName] = useState('');
  const [reportPeriod, setReportPeriod] = useState<'today' | '7d' | '30d' | 'all' | 'custom'>('30d');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  // Manage history state for addon edit dialog
  useEffect(() => {
    const isOpen = editingAddon !== null;
    if (isOpen) {
      window.history.pushState({ type: 'admin-addon' }, '');

      const handlePopState = (event: PopStateEvent) => {
        setEditingAddon(null);
      };

      window.addEventListener('popstate', handlePopState);
      return () => {
        window.removeEventListener('popstate', handlePopState);
        if (window.history.state?.type === 'admin-addon') {
          window.history.back();
        }
      };
    }
  }, [editingAddon !== null]);

  // Manage addon category dialog
  useEffect(() => {
    if (isAddonCategoryModalOpen) {
      window.history.pushState({ type: 'admin-addon-category' }, '');
      const handlePop = () => setIsAddonCategoryModalOpen(false);
      window.addEventListener('popstate', handlePop);
      return () => {
        window.removeEventListener('popstate', handlePop);
        if (window.history.state?.type === 'admin-addon-category') window.history.back();
      };
    }
  }, [isAddonCategoryModalOpen]);

  // Manage edit category dialog
  useEffect(() => {
    if (isEditCategoryModalOpen) {
      window.history.pushState({ type: 'admin-edit-category' }, '');
      const handlePop = () => setIsEditCategoryModalOpen(false);
      window.addEventListener('popstate', handlePop);
      return () => {
        window.removeEventListener('popstate', handlePop);
        if (window.history.state?.type === 'admin-edit-category') window.history.back();
      };
    }
  }, [isEditCategoryModalOpen]);

  // Manage bulk category assignment dialog
  useEffect(() => {
    if (isBulkCategoryModalOpen) {
      window.history.pushState({ type: 'admin-bulk-category' }, '');
      const handlePop = () => setIsBulkCategoryModalOpen(false);
      window.addEventListener('popstate', handlePop);
      return () => {
        window.removeEventListener('popstate', handlePop);
        if (window.history.state?.type === 'admin-bulk-category') window.history.back();
      };
    }
  }, [isBulkCategoryModalOpen]);

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

  if (adminSecretError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-100 p-6 text-center">
        <p className="font-semibold text-slate-800">Não foi possível verificar a senha da Retaguarda.</p>
        <p className="max-w-md text-sm text-slate-500">Confira a conexão e tente novamente. O acesso permanece bloqueado até a verificação terminar.</p>
        <Button onClick={() => window.location.reload()}>Tentar novamente</Button>
      </div>
    );
  }

  if (storeProfileError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-100 p-6 text-center">
        <p className="font-semibold text-slate-800">Não foi possível carregar o perfil da loja.</p>
        <p className="max-w-md text-sm text-slate-500">Confira a conexão e tente novamente. As configurações permanecem bloqueadas enquanto o perfil não puder ser verificado.</p>
        <Button onClick={() => window.location.reload()}>Tentar novamente</Button>
      </div>
    );
  }

  if (!isAdminGateResolved || !adminSecretResolved) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 text-sm font-medium text-slate-500">
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

          {activeTab === 'addons' && !catalogoSomenteConsulta && (() => {
            const getAddonLegacyGroup = (addon: any) => (addon.group || '').trim();
            const explicitGroups = (addonCategories || []).map((c: any) => c.name);
            const implicitGroups = (addons || []).map(getAddonLegacyGroup).filter(Boolean);
            // Ordem alfabética pt-BR (ignora acentos e maiúsculas/minúsculas)
            const allGroups = (Array.from(new Set([...explicitGroups, ...implicitGroups])) as string[])
              .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
            const addonCategoryByName = new Map((addonCategories || []).map((c: any) => [c.name, c]));
            const getLegacyAddonIdsForGroup = (name: string) => (addons || [])
              .filter((addon: any) => getAddonLegacyGroup(addon) === name)
              .map((addon: any) => addon.id);
            const getContainerAddonIds = (name: string) => {
              const category = addonCategoryByName.get(name) as any;
              const removedIds = new Set(category?.removedAddonIds || []);
              return Array.from(new Set([...(category?.addonIds || []), ...getLegacyAddonIdsForGroup(name)]))
                .filter((id: string) => !removedIds.has(id));
            };
            const getAddonContainerNames = (addon: any) => {
              const names = allGroups.filter(name => getContainerAddonIds(name).includes(addon.id));
              return names.length > 0 ? names : [getAddonLegacyGroup(addon) || 'Sem container'];
            };
            const ensureAddonCategory = async (name: string, seedIds: string[] = []) => {
              const existing = addonCategoryByName.get(name) as any;
              if (existing) {
                return { ref: doc(db, 'addonCategories', existing.id), data: existing };
              }
              const newDoc = doc(collection(db, 'addonCategories'));
              const data = {
                id: newDoc.id,
                name,
                ownerId,
                addonIds: Array.from(new Set(seedIds)),
                usePrice: true,
                min: 0,
                max: 0,
              };
              await setDoc(newDoc, data);
              return { ref: newDoc, data };
            };
            const isContainerView = addonCategoryFilter !== 'all';
            const removeAddonFromContainer = async (addon: any) => {
              if (!db || !user || !isContainerView) return;
              const containerName = addonCategoryFilter;
              const currentIds = getContainerAddonIds(containerName);
              const nextIds = currentIds.filter((id: string) => id !== addon.id);
              const existing = addonCategoryByName.get(containerName) as any;
              const removedAddonIds = Array.from(new Set([...(existing?.removedAddonIds || []), addon.id]));
              const { ref } = await ensureAddonCategory(containerName, currentIds);
              await updateDoc(ref, {
                addonIds: nextIds,
                removedAddonIds,
              });
              toast({ title: 'Item removido apenas deste container.' });
            };
            /**
             * Produtos que passariam a pedir MAIS do que conseguem oferecer se
             * este adicional saísse do ar. Só conta o que quebra AGORA (o que já
             * estava furado antes não vira aviso novo).
             */
            const impactoDeTirarAddon = (addonId: string) => {
              const antes = new Set(
                findUnderSuppliedProducts(items || [], addons || [], addonCategories || [])
                  .map((p) => `${p.product.id}|${p.groupName}`)
              );
              return findUnderSuppliedProducts(
                items || [], addons || [], addonCategories || [], new Set([addonId])
              ).filter((p) => !antes.has(`${p.product.id}|${p.groupName}`));
            };
            /** Texto do aviso, ou '' quando nada é afetado. */
            const avisoImpacto = (addonId: string) => {
              const afetados = impactoDeTirarAddon(addonId);
              if (afetados.length === 0) return '';
              const linhas = afetados
                .slice(0, 8)
                .map((a) => `• ${a.product.name} — a etapa "${a.groupName}" pede ${a.configuredMin} e ficaria com ${a.available}`)
                .join('\n');
              const resto = afetados.length > 8 ? `\n... e mais ${afetados.length - 8}` : '';
              return `\n\nATENÇÃO: ${afetados.length} ${afetados.length === 1 ? 'produto vai ficar' : 'produtos vão ficar'} com menos opções do que a etapa obrigatória pede:\n${linhas}${resto}\n\nEles continuam à venda, mas com menos escolhas do que você configurou.`;
            };
            const setAddonGlobalActive = async (addon: any, active: boolean) => {
              if (!db) return;
              // Pausar some com o adicional para o cliente igual excluir, então
              // o aviso vale para os dois caminhos.
              if (!active) {
                const aviso = avisoImpacto(addon.id);
                if (aviso && !confirm(`Pausar "${addon.name}"?${aviso}`)) return;
              }
              await updateDoc(doc(db, 'addons', addon.id), { active });
              toast({ title: active ? 'Adicional ativado globalmente' : 'Adicional pausado globalmente' });
            };
            // Pausa LOCAL: vale só para o container aberto. Regra do interruptor:
            // Lista Matriz liga/desliga global; dentro do container, só ali.
            const pausedInCurrentContainer = new Set<string>(
              ((addonCategoryByName.get(addonCategoryFilter) as any)?.pausedAddonIds || []) as string[]
            );
            const setAddonPausedInContainer = async (addon: any, paused: boolean) => {
              if (!db || !user || !isContainerView) return;
              const containerName = addonCategoryFilter;
              const { ref, data } = await ensureAddonCategory(containerName, getContainerAddonIds(containerName));
              const next = new Set<string>(((data as any)?.pausedAddonIds || []) as string[]);
              if (paused) next.add(addon.id); else next.delete(addon.id);
              await updateDoc(ref, { pausedAddonIds: Array.from(next) });
              toast({
                title: paused ? `Pausado só em "${containerName}"` : `Reativado em "${containerName}"`,
                description: paused ? 'Nos outros containers o item continua ativo. Para pausar em todos, use a Lista Matriz.' : undefined,
              });
            };

            // Vínculo produto <-> container: o produto "usa" o container quando tem
            // um addonGroup apontando para ele (por id ou nome).
            const productUsesContainer = (product: any, containerName: string, containerId?: string) =>
              (product.addonGroups || []).some((g: any) => (containerId && g.addonCategoryId === containerId) || g.addonCategoryName === containerName);
            const linkProductToContainer = async (product: any, containerName: string) => {
              if (!db) return;
              const currentIds = getContainerAddonIds(containerName);
              const { ref, data } = await ensureAddonCategory(containerName, currentIds);
              const containerId = (data as any)?.id || ref.id;
              const cat = addonCategoryByName.get(containerName) as any;
              const newGroup = {
                name: containerName,
                addonCategoryId: containerId,
                addonCategoryName: containerName,
                addonIds: currentIds,
                usePrice: cat?.usePrice !== false,
                min: 0,
                max: cat?.max || 0,
              };
              const groups = (product.addonGroups || []).filter((g: any) => !(g.addonCategoryId === containerId || g.addonCategoryName === containerName));
              await updateDoc(doc(db, 'menuItems', product.id), { addonGroups: [...groups, newGroup] });
            };
            const unlinkProductFromContainer = async (product: any, containerName: string, containerId?: string) => {
              if (!db) return;
              const groups = (product.addonGroups || []).filter((g: any) => !((containerId && g.addonCategoryId === containerId) || g.addonCategoryName === containerName));
              await updateDoc(doc(db, 'menuItems', product.id), { addonGroups: groups });
            };
            const toggleProductContainer = async (product: any, containerName: string) => {
              const cat = addonCategoryByName.get(containerName) as any;
              const containerId = cat?.id;
              try {
                if (productUsesContainer(product, containerName, containerId)) {
                  await unlinkProductFromContainer(product, containerName, containerId);
                  toast({ title: `"${product.name}" desvinculado de ${containerName}.` });
                } else {
                  await linkProductToContainer(product, containerName);
                  toast({ title: `"${product.name}" vinculado a ${containerName}.` });
                }
              } catch (err: any) {
                toast({ variant: 'destructive', title: 'Erro', description: err?.message });
              }
            };
            const containerFilterId = (addonCategoryByName.get(addonCategoryFilter) as any)?.id;
            const containerProductList = (items || [])
              .filter((p: any) => {
                const q = removeAccents(containerProductSearch.toLowerCase()).trim();
                return !q || removeAccents(String(p.name || '').toLowerCase()).includes(q);
              })
              .sort((a: any, b: any) => {
                // Selecionados primeiro, depois o restante; cada grupo em ordem alfabetica.
                const aUses = productUsesContainer(a, addonCategoryFilter, containerFilterId);
                const bUses = productUsesContainer(b, addonCategoryFilter, containerFilterId);
                if (aUses !== bUses) return aUses ? -1 : 1;
                return (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' });
              });
            const getAddonContainerSet = (addonId: string) =>
              new Set(allGroups.filter(name => getContainerAddonIds(name).includes(addonId)));
            // Containers que usam o item destacado (clicado na Lista Matriz) -> pintados de laranja.
            const highlightedContainers = highlightedAddonId ? getAddonContainerSet(highlightedAddonId) : new Set<string>();
            // Com um adicional destacado, os containers laranja sobem para o topo
            // da lista (alfabéticos entre si); o restante segue alfabético abaixo.
            // allGroups já vem ordenado, então o particionamento preserva a ordem.
            const orderedGroups = highlightedContainers.size > 0
              ? [...allGroups.filter(g => highlightedContainers.has(g)), ...allGroups.filter(g => !highlightedContainers.has(g))]
              : allGroups;
            const syncAddonContainers = async (addonId: string, selected: Set<string>) => {
              if (!db || !user) return;
              const current = getAddonContainerSet(addonId);
              // Vincular aos containers recém-marcados
              for (const name of selected) {
                if (current.has(name)) continue;
                const currentIds = getContainerAddonIds(name);
                const { ref } = await ensureAddonCategory(name, currentIds);
                const existing = addonCategoryByName.get(name) as any;
                const removedAddonIds = (existing?.removedAddonIds || []).filter((id: string) => id !== addonId);
                await updateDoc(ref, { addonIds: Array.from(new Set([...currentIds, addonId])), removedAddonIds });
              }
              // Remover dos containers desmarcados
              for (const name of current) {
                if (selected.has(name)) continue;
                const nextIds = getContainerAddonIds(name).filter((id: string) => id !== addonId);
                const { ref } = await ensureAddonCategory(name, getContainerAddonIds(name));
                const existing = addonCategoryByName.get(name) as any;
                const removedAddonIds = Array.from(new Set([...(existing?.removedAddonIds || []), addonId]));
                await updateDoc(ref, { addonIds: nextIds, removedAddonIds });
              }
            };
            const handleSaveAddonWithContainers = async (e: React.FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              if (!user || !db) return;
              const formData = new FormData(e.currentTarget);
              const rawName = (formData.get('addonName') as string) || '';
              const description = ((formData.get('addonDescription') as string) || '').trim();
              const price = parseFloat(formData.get('addonPrice') as string);
              const baseData = {
                description,
                price,
                group: editingAddon?.group || '',
                ownerId,
              };
              // Em modo de criacao, nomes separados por , ou ; criam varios adicionais de uma vez
              // (todos com o mesmo preco/descricao/containers). Na edicao, mantem nome unico.
              const names = editingAddon?.id
                ? [rawName.trim()].filter(Boolean)
                : Array.from(new Set(
                    rawName.split(/[,;\n]/).map(n => n.trim()).filter(Boolean)
                  ));
              if (names.length === 0) {
                toast({ variant: 'destructive', title: 'Erro', description: 'Informe ao menos um nome.' });
                return;
              }
              try {
                if (editingAddon?.id) {
                  await updateDoc(doc(db, 'addons', editingAddon.id), { ...baseData, name: names[0] });
                  await syncAddonContainers(editingAddon.id, editingAddonContainers);
                } else {
                  for (const name of names) {
                    const newDoc = doc(collection(db, 'addons'));
                    await setDoc(newDoc, { ...baseData, name, id: newDoc.id });
                    await syncAddonContainers(newDoc.id, editingAddonContainers);
                  }
                }
                setEditingAddon(null);
                toast({
                  title: 'Sucesso',
                  description: names.length > 1 ? `${names.length} adicionais criados.` : 'Adicional salvo.',
                });
              } catch (err: any) {
                console.error('Erro ao salvar adicional:', err);
                toast({ variant: 'destructive', title: 'Erro', description: err?.message || 'Falha ao salvar adicional.' });
              }
            };
            const normalizeAddonLookup = (value: string) =>
              removeAccents(value.toLowerCase()).replace(/\s+/g, ' ').trim();
            const normalizedAddonSearch = normalizeAddonLookup(addonSearchTerm);
            const isAddonListSearch = /[,;\n]/.test(addonSearchTerm);
            const addonSearchTerms = isAddonListSearch
              ? Array.from(new Set(addonSearchTerm
                  .split(/[,;\n]/)
                  .map(term => normalizeAddonLookup(term))
                  .filter(Boolean)))
              : [];
            const addonSearchTermSet = new Set(addonSearchTerms);
            const filteredAddons = (addons || []).filter((addon: any) => {
              const addonName = normalizeAddonLookup(addon.name || '');
              if (isAddonListSearch) {
                if (addonSearchTerms.length > 0 && !addonSearchTermSet.has(addonName)) return false;
              } else if (normalizedAddonSearch && !addonName.includes(normalizedAddonSearch)) {
                return false;
              }
              const g = getAddonLegacyGroup(addon);
              if (addonCategoryFilter !== 'all' && !getContainerAddonIds(addonCategoryFilter).includes(addon.id) && g !== addonCategoryFilter) return false;
              return true;
            }).sort((a: any, b: any) => {
              if (isAddonListSearch) {
                return (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' });
              }
              if (!addonSortConfig) return (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' });
              let valA: any = a[addonSortConfig.key];
              let valB: any = b[addonSortConfig.key];
              
              if (addonSortConfig.key === 'group') {
                valA = getAddonContainerNames(a).join(', ');
                valB = getAddonContainerNames(b).join(', ');
              }
              
              if (typeof valA === 'string' && typeof valB === 'string') {
                 if (valA.toLowerCase() < valB.toLowerCase()) return addonSortConfig.direction === 'asc' ? -1 : 1;
                 if (valA.toLowerCase() > valB.toLowerCase()) return addonSortConfig.direction === 'asc' ? 1 : -1;
              } else {
                 if (valA < valB) return addonSortConfig.direction === 'asc' ? -1 : 1;
                 if (valA > valB) return addonSortConfig.direction === 'asc' ? 1 : -1;
              }
              return 0;
            });

            const addonUsageMap = new Map<string, Set<string>>();
            for (const item of (items || [])) {
              const typeLabel = item.isCombo ? ' (Combo)' : item.isMarmita ? ' (Montável)' : ' (Produto)';
              const statusLabel = item.isAvailable === false ? ' [Inativo]' : '';
              const displayName = `${item.name}${typeLabel}${statusLabel}`;
              
              for (const id of (item.addonIds || [])) {
                if (!addonUsageMap.has(id)) addonUsageMap.set(id, new Set());
                addonUsageMap.get(id)!.add(displayName);
              }
              for (const g of (item.addonGroups || [])) {
                for (const id of (g.addonIds || [])) {
                  if (!addonUsageMap.has(id)) addonUsageMap.set(id, new Set());
                  addonUsageMap.get(id)!.add(displayName);
                }
              }
            }

            const addonNameMap = new Map<string, string[]>();
            for (const addon of addons || []) {
              const nameKey = addon.name
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove acentos
                .toLowerCase()
                .trim()
                .replace(/\s+/g, ' ') // Espaços múltiplos
                .replace(/s\b/g, '') // Plurais no final da palavra
                .replace(/[ao]\b/g, ''); // Masculino/Feminino no final da palavra
              if (!addonNameMap.has(nameKey)) addonNameMap.set(nameKey, []);
              addonNameMap.get(nameKey)!.push(addon.id);
            }

            const unusedDuplicateIds = new Set<string>();
            for (const [name, ids] of addonNameMap.entries()) {
              if (ids.length > 1) {
                for (const id of ids) {
                  if (!addonUsageMap.has(id) || addonUsageMap.get(id)!.size === 0) {
                    unusedDuplicateIds.add(id);
                  }
                }
              }
            }

            return (
            <div className="mt-2 flex-1 min-h-0 flex flex-col">
              <div className="mb-3 px-2 shrink-0 flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-black tracking-tight text-slate-800">Grupos de Adicionais</h1>
                <a
                  href="/ajuda/adicionais"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Como funcionam os adicionais? Abre o guia visual"
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 transition-colors hover:bg-emerald-200"
                >
                  <HelpCircle className="h-4 w-4" />
                </a>
                <p className="text-sm text-muted-foreground font-medium">Crie itens extras que podem ser vinculados aos seus produtos (ex: Bacon, Molho Extra, Borda Recheada).</p>
              </div>
              <Card className="border shadow-md rounded-2xl overflow-hidden flex-1 min-h-0 flex flex-col">
              <CardContent className="p-0 flex-1 min-h-0 flex flex-col lg:flex-row">
                {/* ── Coluna 1: containers (lista vertical) ── */}
                <div className="flex shrink-0 flex-col border-b bg-white lg:w-[270px] lg:border-b-0 lg:border-r min-h-0 max-h-44 lg:max-h-none">
                  <div className="shrink-0 border-b px-3 py-2">
                    <p className="text-xs font-bold text-slate-700">Containers</p>
                    {/* O destaque sobrevive à troca de container: é assim que se
                        navega entre os containers que usam o mesmo item. Mas ele
                        precisa de saída visível — indo para um container onde o
                        item não aparece, não haveria onde clicar de novo. */}
                    {highlightedAddonId && (() => {
                      const destacado = (addons || []).find((a: any) => a.id === highlightedAddonId);
                      if (!destacado) return null;
                      return (
                        <div className="mt-1.5 flex items-center gap-1 rounded-md border border-orange-300 bg-orange-50 px-1.5 py-1">
                          <span className="min-w-0 flex-1 truncate text-[10px] font-bold text-orange-800" title={`Containers que usam "${destacado.name}"`}>
                            usando: {destacado.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => setHighlightedAddonId(null)}
                            className="shrink-0 text-[11px] font-bold text-orange-500 transition-colors hover:text-orange-800"
                            title="Tirar o destaque"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="min-h-0 flex-1 space-y-1 overflow-y-auto custom-scrollbar p-2">
                    {/* Lista Matriz com identidade âmbar (mesma cor do guia de ajuda),
                        para não se confundir com os containers */}
                    <Button
                      variant="outline"
                      onClick={() => { setAddonCategoryFilter('all'); setAddonSearchTerm(''); }}
                      size="sm"
                      className={`w-full justify-start gap-2 rounded-lg border-2 font-bold ${
                        addonCategoryFilter === 'all'
                          ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600 hover:text-white'
                          : 'border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400 hover:bg-amber-100 hover:text-amber-900'
                      }`}
                    >
                      <Store className="h-3.5 w-3.5" /> Lista Matriz
                    </Button>
                    {orderedGroups.map(g => (
                      <Button
                        key={g}
                        variant={addonCategoryFilter === g ? 'default' : 'outline'}
                        onClick={() => { setAddonCategoryFilter(g); setAddonSearchTerm(''); }}
                        size="sm"
                        className={`w-full h-auto min-h-9 py-1.5 justify-between gap-2 rounded-lg flex items-center group ${
                          highlightedContainers.has(g) && addonCategoryFilter !== g
                            ? 'border-orange-400 bg-orange-100 text-orange-700 hover:bg-orange-200'
                            : ''
                        }`}
                      >
                        <span className="text-left whitespace-normal break-words leading-tight">{g}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          <span className="rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[10px]">
                            {getContainerAddonIds(g).length}
                          </span>
                          {addonCategoryFilter === g && (
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditCategoryName(g);
                                setEditCategoryNewName(g);
                                setIsEditCategoryModalOpen(true);
                              }}
                              className="bg-primary-foreground/20 hover:bg-primary-foreground/40 text-primary-foreground p-1 rounded-full transition-colors cursor-pointer"
                              title="Editar Container"
                            >
                              <Pencil className="h-3 w-3" />
                            </span>
                          )}
                        </span>
                      </Button>
                    ))}

                    <Dialog open={isEditCategoryModalOpen} onOpenChange={(open) => {
                      setIsEditCategoryModalOpen(open);
                      if (!open) {
                        setEditCategoryName('');
                        setEditCategoryNewName('');
                      }
                    }}>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Editar Container: {editCategoryName}</DialogTitle>
                        </DialogHeader>
                        <div className="py-4 space-y-4">
                          <div className="space-y-2">
                            <Label>Nome do Container</Label>
                            <Input 
                              autoFocus
                              value={editCategoryNewName} 
                              onChange={(e) => setEditCategoryNewName(e.target.value)} 
                              placeholder="Digite o novo nome..." 
                            />
                          </div>
                        </div>
                        <DialogFooter className="flex flex-row items-center justify-between w-full sm:justify-between">
                          <Button 
                            variant="destructive" 
                            className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200"
                            onClick={async () => {
                            if (!db || !user || !editCategoryName) return;
                            if (!confirm(`Tem certeza que deseja EXCLUIR a categoria "${editCategoryName}"?\n\nOs adicionais continuam na lista matriz; apenas este container será removido.`)) return;
                            try {
                              const batch = writeBatch(db);
                              const oldName = editCategoryName.trim();
                              
                              // 1. Delete the category document if it exists explicitly
                              const catDocs = addonCategories?.filter((c: any) => c.name.trim() === oldName);
                              catDocs?.forEach((catDoc: any) => {
                                batch.delete(doc(db, 'addonCategories', catDoc.id));
                              });
                              (addons || [])
                                .filter((addon: any) => getAddonLegacyGroup(addon) === oldName)
                                .forEach((addon: any) => {
                                  batch.update(doc(db, 'addons', addon.id), { group: '' });
                                });

                              // 2. Remove as etapas (addonGroups) que apontam para este container
                              //    em todos os produtos, senao o card "fantasma" continua aparecendo
                              //    no cardapio do cliente e no ProductModal do admin.
                              const deletedCatIds = new Set((catDocs || []).map((c: any) => c.id));
                              (items || []).forEach((product: any) => {
                                const productGroups = Array.isArray(product.addonGroups) ? product.addonGroups : [];
                                if (productGroups.length === 0) return;
                                const remaining = productGroups.filter((g: any) => {
                                  const matchesName = (g.addonCategoryName || '').trim() === oldName;
                                  const matchesId = g.addonCategoryId && deletedCatIds.has(g.addonCategoryId);
                                  return !(matchesName || matchesId);
                                });
                                if (remaining.length !== productGroups.length) {
                                  batch.update(doc(db, 'menuItems', product.id), { addonGroups: remaining });
                                }
                              });

                              await batch.commit();
                              toast({ title: 'Container excluído com sucesso!' });
                              setIsEditCategoryModalOpen(false);
                              if (addonCategoryFilter === oldName) {
                                setAddonCategoryFilter('all');
                              }
                            } catch (err: any) {
                              toast({ variant: 'destructive', title: 'Erro', description: err.message });
                            }
                          }}>
                            <Trash2 className="w-4 h-4 mr-2" /> Excluir
                          </Button>
                          <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setIsEditCategoryModalOpen(false)}>Cancelar</Button>
                            <Button onClick={async () => {
                              if (!db || !user || !editCategoryName || !editCategoryNewName.trim() || editCategoryName === editCategoryNewName.trim()) return;
                              try {
                                const batch = writeBatch(db);
                                const newName = editCategoryNewName.trim();
                                const oldName = editCategoryName.trim();
                                
                                // 1. Rename the category document if it exists explicitly
                                const catDoc = addonCategories?.find((c: any) => c.name.trim() === oldName);
                                if (catDoc) {
                                  batch.update(doc(db, 'addonCategories', catDoc.id), { name: newName });
                                } else {
                                  // It was an implicit category, let's create it explicitly with the new name
                                  const newDoc = doc(collection(db, 'addonCategories'));
                                  batch.set(newDoc, { id: newDoc.id, name: newName, ownerId, addonIds: getLegacyAddonIdsForGroup(oldName), usePrice: true, min: 0, max: 0 });
                                }
                                (addons || [])
                                  .filter((addon: any) => getAddonLegacyGroup(addon) === oldName)
                                  .forEach((addon: any) => {
                                    batch.update(doc(db, 'addons', addon.id), { group: newName });
                                  });

                                await batch.commit();
                                toast({ title: 'Container renomeado com sucesso!' });
                                setIsEditCategoryModalOpen(false);
                                if (addonCategoryFilter === oldName) {
                                  setAddonCategoryFilter(newName);
                                }
                              } catch (err: any) {
                                toast({ variant: 'destructive', title: 'Erro', description: err.message });
                              }
                            }} className="bg-primary text-white">
                              Salvar
                            </Button>
                          </div>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                </div>
                </div>

                {/* ── Coluna 2: adicionais do container / lista matriz ── */}
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="shrink-0 flex flex-wrap items-center gap-2 border-b bg-white px-3 py-2">
                  <div className="relative min-w-[180px] flex-1">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Buscar adicionais..." value={addonSearchTerm} onChange={(e) => { setAddonSearchTerm(e.target.value); setHighlightedAddonId(null); }} className="pl-9" />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                  {/* Controles do container selecionado, na linha dos botões */}
                  {addonCategoryFilter !== 'all' && (() => {
                    const category = addonCategoryByName.get(addonCategoryFilter) as any;
                    const usePrice = category?.usePrice !== false;
                    return (
                      <>
                        <div className="flex items-center gap-1 bg-sky-50 border border-sky-200 rounded-lg px-2 py-1.5 whitespace-nowrap">
                          <span className="text-[10px] text-sky-700 font-semibold" title="0 = opcional">Mínimo:</span>
                          <Input
                            type="number"
                            min="0"
                            value={category?.min || 0}
                            onChange={async (e) => {
                              if (!db || !user) return;
                              const val = parseInt(e.target.value) || 0;
                              try {
                                const currentIds = getContainerAddonIds(addonCategoryFilter);
                                const { ref } = await ensureAddonCategory(addonCategoryFilter, currentIds);
                                await updateDoc(ref, { min: val });
                              } catch (err: any) {
                                toast({ variant: 'destructive', title: 'Erro', description: err.message });
                              }
                            }}
                            className="w-10 h-6 px-0 text-center border-0 bg-transparent text-sky-700 font-bold text-xs shadow-none focus-visible:ring-0"
                            title="Quantidade mínima obrigatória para o cliente fechar o pedido (0 = opcional)"
                          />
                        </div>
                        <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 whitespace-nowrap">
                          <span className="text-[10px] text-amber-700 font-semibold" title="0 = Sem Limite">Máximo:</span>
                          <Input
                            type="number"
                            min="0"
                            value={category?.max || 0}
                            onChange={async (e) => {
                              if (!db || !user) return;
                              const val = parseInt(e.target.value) || 0;
                              try {
                                const currentIds = getContainerAddonIds(addonCategoryFilter);
                                const { ref } = await ensureAddonCategory(addonCategoryFilter, currentIds);
                                await updateDoc(ref, { max: val });
                              } catch (err: any) {
                                toast({ variant: 'destructive', title: 'Erro', description: err.message });
                              }
                            }}
                            className="w-10 h-6 px-0 text-center border-0 bg-transparent text-amber-700 font-bold text-xs shadow-none focus-visible:ring-0"
                            title="Limite máximo de escolhas (0 = Ilimitado)"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!db || !user) return;
                            try {
                              const currentIds = getContainerAddonIds(addonCategoryFilter);
                              const { ref } = await ensureAddonCategory(addonCategoryFilter, currentIds);
                              await updateDoc(ref, { usePrice: !usePrice });
                              toast({ title: !usePrice ? 'Preços ativados' : 'Preços desativados' });
                            } catch (err: any) {
                              toast({ variant: 'destructive', title: 'Erro', description: err.message });
                            }
                          }}
                          className={`h-9 rounded-full px-3 text-xs font-bold transition-colors ${
                            usePrice
                              ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                              : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          }`}
                        >
                          {usePrice ? 'Usa preço' : 'Sem preço'}
                        </button>
                      </>
                    );
                  })()}
                  <Dialog open={isAddonCategoryModalOpen} onOpenChange={(open) => {
                    setIsAddonCategoryModalOpen(open);
                    if (!open) setNewAddonCategoryName('');
                  }}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="whitespace-nowrap border-dashed text-primary border-primary/50 hover:bg-primary/10">
                        <Plus className="mr-2 h-4 w-4" /> Novo Container
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Novo Container de Adicionais</DialogTitle>
                      </DialogHeader>
                      <div className="py-4 space-y-2">
                        <Label>Nome do Container</Label>
                        <Input
                          autoFocus
                          value={newAddonCategoryName}
                          onChange={(e) => setNewAddonCategoryName(e.target.value)}
                          placeholder="Ex: Opções PF, Bebidas..."
                        />
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddonCategoryModalOpen(false)}>Cancelar</Button>
                        <Button onClick={async () => {
                          if (!db || !user || !newAddonCategoryName.trim()) return;
                          try {
                            const newDoc = doc(collection(db, 'addonCategories'));
                            await setDoc(newDoc, { id: newDoc.id, name: newAddonCategoryName.trim(), ownerId, addonIds: [], usePrice: true, min: 0, max: 0 });
                            toast({ title: 'Container criado com sucesso!' });
                            setIsAddonCategoryModalOpen(false);
                            setNewAddonCategoryName('');
                          } catch (err: any) {
                            toast({ variant: 'destructive', title: 'Erro', description: err.message });
                          }
                        }} className="bg-primary text-white">
                          Salvar
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  {selectedAddonIds.size > 0 && (
                    <Button
                      onClick={() => {
                        // Pre-marca os containers que ja contem TODOS os itens selecionados.
                        const selectedIds = Array.from(selectedAddonIds);
                        const already = new Set(
                          allGroups.filter(name => {
                            const ids = getContainerAddonIds(name);
                            return selectedIds.every(id => ids.includes(id));
                          })
                        );
                        setBulkCategoryInitial(already);
                        setBulkCategoryNames(new Set(already));
                        setBulkCategorySearch('');
                        setIsBulkCategoryModalOpen(true);
                      }}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <Tag className="mr-2 h-4 w-4" />
                      Adicionar ao Container ({selectedAddonIds.size})
                    </Button>
                  )}
                  <Dialog open={editingAddon !== null} onOpenChange={(open) => { if (!open) setEditingAddon(null); }}>
                    <DialogTrigger asChild>
                      <Button onClick={() => { setEditingAddon({}); setEditingAddonContainers(new Set()); }} className="bg-primary text-white">
                        <Plus className="mr-2 h-4 w-4" /> Novo Adicional
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[680px]">
                      <DialogHeader>
                        <DialogTitle>{editingAddon?.id ? 'Editar Adicional' : 'Novo Adicional'}</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleSaveAddonWithContainers} className="space-y-4 pt-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="addonName">Nome</Label>
                          <Input id="addonName" name="addonName" defaultValue={editingAddon?.name} placeholder="Ex: Bacon, Queijo Extra, Gelo..." required />
                          {!editingAddon?.id && (
                            <p className="text-xs text-muted-foreground">
                              Dica: separe varios nomes com <span className="font-medium">,</span> ou <span className="font-medium">;</span> para criar em massa (mesmo preco e containers).
                            </p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="addonDescription">Texto de apresentacao</Label>
                          <Textarea
                            id="addonDescription"
                            name="addonDescription"
                            defaultValue={editingAddon?.description || ''}
                            placeholder="Ex: fatias de abacaxi fresco, porcao extra, molho especial..."
                            className="min-h-[80px] resize-none text-sm"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="addonPrice">Preço (R$)</Label>
                          <CurrencyInput id="addonPrice" name="addonPrice" defaultValue={editingAddon?.price} required placeholder="0,00" />
                        </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Containers vinculados <span className="font-normal text-muted-foreground">(opcional)</span></Label>
                          {allGroups.length > 0 ? (
                            <div className="max-h-[260px] overflow-y-auto rounded-md border border-input divide-y">
                              {allGroups.map(name => {
                                const checked = editingAddonContainers.has(name);
                                return (
                                  <label key={name} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded border-gray-300"
                                      checked={checked}
                                      onChange={(ev) => {
                                        setEditingAddonContainers(prev => {
                                          const next = new Set(prev);
                                          if (ev.target.checked) next.add(name);
                                          else next.delete(name);
                                          return next;
                                        });
                                      }}
                                    />
                                    <span className={checked ? 'font-medium text-emerald-700' : ''}>{name}</span>
                                  </label>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground italic">
                              Nenhum container criado ainda. Crie um em "Novo Container".
                            </p>
                          )}
                        </div>
                        </div>
                        <DialogFooter>
                          <Button type="submit" className="w-full h-12 font-bold">Salvar</Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                  <Dialog open={isBulkCategoryModalOpen} onOpenChange={(open) => {
                    setIsBulkCategoryModalOpen(open);
                    if (!open) { setBulkCategoryNames(new Set()); setBulkCategoryInitial(new Set()); setBulkCategorySearch(''); }
                  }}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Containers de {selectedAddonIds.size} {selectedAddonIds.size === 1 ? 'item' : 'itens'}</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-2 py-2">
                        <p className="text-xs text-muted-foreground">
                          Os containers ja marcados contem os itens selecionados. Marque para adicionar, desmarque para remover.
                        </p>
                        <div className="relative">
                          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input
                            value={bulkCategorySearch}
                            onChange={(e) => setBulkCategorySearch(e.target.value)}
                            placeholder="Buscar container..."
                            className="h-9 pl-8 text-sm"
                          />
                        </div>
                        {allGroups.length > 0 ? (
                          <div className="max-h-[300px] overflow-y-auto rounded-md border border-input divide-y custom-scrollbar">
                            {allGroups
                              .filter(name => {
                                const q = removeAccents(bulkCategorySearch.toLowerCase()).trim();
                                return !q || removeAccents(name.toLowerCase()).includes(q);
                              })
                              .map(name => {
                                const checked = bulkCategoryNames.has(name);
                                return (
                                  <label key={name} className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition hover:bg-slate-50 ${checked ? 'bg-emerald-50' : ''}`}>
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded border-gray-300"
                                      checked={checked}
                                      onChange={(ev) => {
                                        setBulkCategoryNames(prev => {
                                          const next = new Set(prev);
                                          if (ev.target.checked) next.add(name); else next.delete(name);
                                          return next;
                                        });
                                      }}
                                    />
                                    <span className={`flex-1 ${checked ? 'font-medium text-emerald-700' : 'text-slate-700'}`}>{name}</span>
                                    <span className="text-[10px] text-slate-400">{getContainerAddonIds(name).length}</span>
                                  </label>
                                );
                              })}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground italic py-4 text-center">
                            Nenhum container criado ainda. Crie um em &quot;Novo Container&quot;.
                          </p>
                        )}
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsBulkCategoryModalOpen(false)}>Cancelar</Button>
                        <Button onClick={async () => {
                          if (!db || selectedAddonIds.size === 0) return;
                          const toAdd = Array.from(bulkCategoryNames).filter(name => !bulkCategoryInitial.has(name));
                          const toRemove = Array.from(bulkCategoryInitial).filter(name => !bulkCategoryNames.has(name));
                          if (toAdd.length === 0 && toRemove.length === 0) {
                            setIsBulkCategoryModalOpen(false);
                            return;
                          }
                          try {
                            for (const name of toAdd) {
                              const currentIds = getContainerAddonIds(name);
                              const nextIds = Array.from(new Set([...currentIds, ...Array.from(selectedAddonIds)]));
                              const { ref } = await ensureAddonCategory(name, currentIds);
                              const existing = addonCategoryByName.get(name) as any;
                              const removedAddonIds = (existing?.removedAddonIds || []).filter((id: string) => !selectedAddonIds.has(id));
                              await updateDoc(ref, { addonIds: nextIds, removedAddonIds });
                            }
                            for (const name of toRemove) {
                              const currentIds = getContainerAddonIds(name);
                              const nextIds = currentIds.filter((id: string) => !selectedAddonIds.has(id));
                              const { ref } = await ensureAddonCategory(name, currentIds);
                              const existing = addonCategoryByName.get(name) as any;
                              const removedAddonIds = Array.from(new Set([...(existing?.removedAddonIds || []), ...Array.from(selectedAddonIds)]));
                              await updateDoc(ref, { addonIds: nextIds, removedAddonIds });
                            }
                            toast({ title: `Containers atualizados (${toAdd.length} adicionado(s), ${toRemove.length} removido(s)).` });
                            setIsBulkCategoryModalOpen(false);
                            setSelectedAddonIds(new Set());
                            setBulkCategoryNames(new Set());
                            setBulkCategoryInitial(new Set());
                            setBulkCategorySearch('');
                          } catch (err: any) {
                            toast({ variant: 'destructive', title: 'Erro', description: err.message });
                          }
                        }} className="bg-emerald-600 text-white hover:bg-emerald-700">
                          Salvar
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
                </div>
                {!isContainerView && (
                  <div className="shrink-0 border-b px-4 py-2 text-xs font-semibold bg-slate-50 text-slate-600">
                    Lista Matriz: editar, pausar ou excluir aqui altera o adicional globalmente.
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="w-[50px] pl-6">
                        <input 
                          type="checkbox" 
                          className="h-4 w-4 rounded border-gray-300"
                          checked={filteredAddons.length > 0 && selectedAddonIds.size === filteredAddons.length}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedAddonIds(new Set(filteredAddons.map((a: any) => a.id)));
                            } else {
                              setSelectedAddonIds(new Set());
                            }
                          }}
                        />
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-slate-100 transition-colors select-none" onClick={() => handleAddonSort('name')}>
                        Nome {addonSortConfig?.key === 'name' && (addonSortConfig.direction === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-slate-100 transition-colors select-none" onClick={() => handleAddonSort('price')}>
                        Preço {addonSortConfig?.key === 'price' && (addonSortConfig.direction === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead className="text-right pr-6">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAddons.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                          {addons?.length === 0 ? 'Nenhum adicional cadastrado.' : 'Nenhum adicional encontrado na busca.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredAddons.map((addon: any) => {
                        let rowClass = selectedAddonIds.has(addon.id) ? 'bg-emerald-50/30' : '';
                        if (highlightedAddonId === addon.id) {
                          rowClass = 'bg-orange-50 ring-1 ring-inset ring-orange-300';
                        }
                        if (unusedDuplicateIds.has(addon.id)) {
                          rowClass = 'bg-red-200 border-2 border-red-500';
                        }
                        return (
                        <TableRow key={addon.id} className={rowClass}>
                          <TableCell className="pl-6">
                            <input 
                              type="checkbox" 
                              className="h-4 w-4 rounded border-gray-300"
                              checked={selectedAddonIds.has(addon.id)}
                              onChange={(e) => {
                                const newSet = new Set(selectedAddonIds);
                                if (e.target.checked) newSet.add(addon.id);
                                else newSet.delete(addon.id);
                                setSelectedAddonIds(newSet);
                              }}
                            />
                          </TableCell>
                          <TableCell
                            className="font-bold cursor-pointer hover:bg-orange-50/50 transition-colors"
                            title="Clique para destacar os containers que usam este item"
                            onClick={() => setHighlightedAddonId(prev => prev === addon.id ? null : addon.id)}
                          >
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <span className={`text-slate-900 ${addon.active === false ? 'line-through decoration-red-500 decoration-2' : ''}`}>{addon.name}</span>
                                {addon.active === false && <span className="bg-red-100 text-red-700 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">Pausado</span>}
                                {unusedDuplicateIds.has(addon.id) && <span className="bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide ml-2">S/ USO (DUPLICADO)</span>}
                              </div>
                              {addon.description && (
                                <div className="text-[11px] text-slate-500 mt-0.5 font-normal max-w-[200px] sm:max-w-xs md:max-w-md line-clamp-2">
                                  {addon.description}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell
                            className="text-primary font-semibold cursor-pointer hover:bg-primary/5 hover:underline transition-colors rounded"
                            title="Clique para editar preço"
                            onClick={() => setQuickPriceEdit({ id: addon.id, name: addon.name, price: addon.price || 0, collection: 'addons' })}
                          >{brl((addon.price || 0))}</TableCell>
                          <TableCell className="text-right pr-6">
                            {isContainerView ? (
                              <div className="flex items-center justify-end gap-2">
                                <div
                                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-1"
                                  title={`Ativo/Pausado APENAS neste container (${addonCategoryFilter}). Para pausar em todos, use a Lista Matriz.`}
                                >
                                  <Switch
                                    checked={!pausedInCurrentContainer.has(addon.id)}
                                    onCheckedChange={(checked) => setAddonPausedInContainer(addon, !checked)}
                                    aria-label="Ativo/Pausado neste container"
                                    className="scale-75 data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-red-500"
                                  />
                                  <span className={`text-[10px] font-medium uppercase ${!pausedInCurrentContainer.has(addon.id) ? 'text-green-600' : 'text-red-500'}`}>
                                    {!pausedInCurrentContainer.has(addon.id) ? 'Ativo aqui' : 'Pausado aqui'}
                                  </span>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Remover apenas deste container"
                                  onClick={async () => {
                                    if (confirm(`Remover "${addon.name}" apenas do container "${addonCategoryFilter}"?`)) {
                                      await removeAddonFromContainer(addon);
                                    }
                                  }}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1">
                                <div className="flex items-center gap-1.5 mr-4 border-r pr-4">
                                  <Switch
                                    checked={addon.active !== false}
                                    onCheckedChange={(checked) => setAddonGlobalActive(addon, checked)}
                                    className="scale-75 data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-red-500"
                                  />
                                  <span className={`text-[10px] font-medium uppercase ${addon.active !== false ? 'text-green-600' : 'text-red-500'}`}>{addon.active !== false ? 'Ativo' : 'Pausado'}</span>
                                </div>
                                <Button variant="ghost" size="icon" onClick={() => { setEditingAddon(addon); setEditingAddonContainers(getAddonContainerSet(addon.id)); }}>
                                  <Pencil className="h-4 w-4 text-blue-500" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={async () => {
                                  if (!db) return;
                                  if (confirm(`Excluir adicional da lista matriz? Isso remove do banco de dados.${avisoImpacto(addon.id)}`)) await deleteDoc(doc(db, 'addons', addon.id));
                                }}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
                </div>
                </div>

                {/* ── Coluna 3: produtos que usam o container ── */}
                {isContainerView && (
                  <div className="flex shrink-0 flex-col border-t bg-slate-50/40 lg:w-[320px] lg:border-l lg:border-t-0 min-h-0 max-h-[55vh] lg:max-h-none">
                    <div className="border-b bg-white px-3 py-2">
                      <p className="text-xs font-bold text-slate-700">Produtos que usam &quot;{addonCategoryFilter}&quot;</p>
                      <p className="text-[10px] text-slate-500">Marque para vincular este container ao produto; desmarque para remover.</p>
                      <div className="relative mt-2">
                        <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input value={containerProductSearch} onChange={(e) => setContainerProductSearch(e.target.value)} placeholder="Buscar produto..." className="h-8 pl-8 text-xs" />
                      </div>
                    </div>
                    <div className="flex-1 divide-y overflow-y-auto custom-scrollbar">
                      {containerProductList.length === 0 ? (
                        <p className="px-3 py-4 text-center text-xs text-muted-foreground">Nenhum produto encontrado.</p>
                      ) : containerProductList.map((product: any) => {
                        const checked = productUsesContainer(product, addonCategoryFilter, (addonCategoryByName.get(addonCategoryFilter) as any)?.id);
                        return (
                          <label key={product.id} className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-xs transition ${checked ? 'bg-emerald-50' : 'opacity-50 hover:opacity-100 hover:bg-white'}`}>
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300"
                              checked={checked}
                              onChange={() => toggleProductContainer(product, addonCategoryFilter)}
                            />
                            <span className="flex-1 truncate">
                              <span className={`font-semibold ${!hasAnyVisibleToggle(product) ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{product.name}</span>
                              <span className="ml-1 text-[10px] text-slate-400">{categories?.find((c: any) => c.id === product.categoryId)?.name || ''}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
            </div>
            );
          })()}

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
