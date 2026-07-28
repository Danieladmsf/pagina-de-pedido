'use client';

import React, { useState, useEffect } from 'react';
import { useFirestore, useCollection, useMemoFirebase, useUser, useDoc, useAuth } from '@/firebase';
import { collection, doc, deleteDoc, setDoc, updateDoc, query, where, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { findUnderSuppliedProducts } from '@/lib/addon-groups';
import { Pencil, Trash2, Plus, Utensils, Tag, Loader2, Clock, Upload, ChevronDown, Wallet, Store, GripVertical, Search, Copy, HelpCircle } from 'lucide-react';
import { DashboardTab } from '@/components/admin/DashboardTab';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { CurrencyInput } from '@/components/ui/currency-input';
import { ClientesTab } from '@/components/admin/ClientesTab';
import { StoreProfileTab } from '@/components/admin/StoreProfileTab';
import { SidebarNav } from '@/components/admin/SidebarNav';
import { WelcomeWizard } from '@/components/admin/WelcomeWizard';
import { AppearanceTab } from '@/components/admin/AppearanceTab';
import { WhatsAppTab } from '@/components/admin/WhatsAppTab';
import { PromotionsTab } from '@/components/admin/PromotionsTab';
import { CampanhasTab } from '@/components/campanhas/CampanhasTab';
import { EncomendasAdminTab } from '@/components/admin/EncomendasAdminTab';
import { FreelanceTab } from '@/components/admin/FreelanceTab';
import { ComboModal } from '@/components/admin/ComboModal';
import { ProductModal } from '@/components/admin/ProductModal';
import { useCaixa } from '@/hooks/useCaixa';
import { Switch } from '@/components/ui/switch';
import { brl, removeAccents } from '@/lib/utils';
import { uploadImage } from '@/lib/upload';
import { MENU_VISIBILITY_TOGGLES, getToggleUpdate, hasAnyVisibleToggle, isToggleActive } from '@/lib/menu-visibility';
import { AdminPasswordDialog } from '@/components/admin/AdminPasswordDialog';
import { ADMIN_SESSION_UPDATED_EVENT, getAdminSessionRemainingMs, isAdminSessionUnlocked, unlockAdminSession, type AdminSecret } from '@/lib/admin-password';
import { usePdvAccess } from '@/contexts/PdvAccessContext';
import {
  canAccessRetaguarda,
  EMPTY_OPERATOR_RETAGUARDA_PERMISSIONS,
  getRetaguardaPermissionForTab,
} from '@/lib/user-permissions';
import { OperatorCatalogReadOnly } from '@/components/admin/OperatorCatalogReadOnly';
import { UsuariosTab } from '@/components/admin/UsuariosTab';

const GESTAO_TAB_ORDER = [
  'dashboard',
  'produtos',
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
] as const;

export default function GestaoPage() {
  const db = useFirestore();
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { user, isUserLoading } = useUser();
  const { role, ownerId, actorId, actorName, operatorName, operatorPermissions } = usePdvAccess();
  const retaguardaPermissions = operatorPermissions?.retaguarda
    ?? EMPTY_OPERATOR_RETAGUARDA_PERMISSIONS;
  const isTabAllowed = React.useCallback((tabId: string) => {
    const permission = getRetaguardaPermissionForTab(tabId);
    return permission !== null && canAccessRetaguarda(role, retaguardaPermissions, permission);
  }, [retaguardaPermissions, role]);
  const allowedTabs = React.useMemo(
    () => GESTAO_TAB_ORDER.filter((tabId) => isTabAllowed(tabId)),
    [isTabAllowed],
  );
  const [storedActiveTab, setActiveTab] = useState<string>('dashboard');
  const activeTab = isTabAllowed(storedActiveTab)
    ? storedActiveTab
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [wizardDismissed, setWizardDismissed] = useState(false);
  // Estados para modal de Categoria
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  
  // Estados para configuração de disponibilidade da categoria
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [isCategoryConfigModalOpen, setIsCategoryConfigModalOpen] = useState(false);
  // Exclusão de categoria: antes apagava só a categoria e os produtos ficavam
  // soltos (sumiam do cardápio e continuavam à venda no PDV, em "Outros").
  const [deletingCategory, setDeletingCategory] = useState<any>(null);
  const [deleteCategoryAction, setDeleteCategoryAction] = useState<'move' | 'wipe'>('move');
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<string>('');
  const [isDeletingCategory, setIsDeletingCategory] = useState(false);
  
  // Estados para filtros de Produtos
  const [productSearch, setProductSearch] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState('todas');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [addonSortConfig, setAddonSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

  const handleAddonSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (addonSortConfig && addonSortConfig.key === key && addonSortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setAddonSortConfig({ key, direction });
  };

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };
  
  // Hook do Caixa: a Gestão só precisa dele para o acerto de crédito na aba
  // Clientes (registrarLancamento/caixaAberto); sessão/histórico ficam no PDV.
  const { caixaAberto, registrarLancamento } = useCaixa({
    ownerId,
    actorId,
    actorName,
    enabled: role === 'owner',
  });
  
  const isRealUser = !!(user && !user.isAnonymous);


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
    if (!db || !isRealUser || role !== 'owner') return null;
    return query(collection(db, 'orders'), where('ownerId', '==', ownerId));
  }, [db, isRealUser, ownerId, role]);

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


  const sortedProductCategories = React.useMemo(() => {
    return [...(categories || [])].sort((a: any, b: any) => {
      const orderA = a.displayOrder ?? 0;
      const orderB = b.displayOrder ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return (a.name || '').localeCompare(b.name || '', 'pt-BR');
    });
  }, [categories]);

  const filteredItems = React.useMemo(() => {
    if (!items) return [];
    let result = items.filter(item => !item.isCombo);
    if (productCategoryFilter !== 'todas') {
      result = result.filter(item => item.categoryId === productCategoryFilter);
    }
    if (productSearch.trim()) {
      const s = removeAccents(productSearch.toLowerCase());
      result = result.filter(item => removeAccents(item.name.toLowerCase()).includes(s));
    }
    
    if (sortConfig) {
      result.sort((a, b) => {
        let valA: any = a[sortConfig.key as keyof typeof a];
        let valB: any = b[sortConfig.key as keyof typeof b];
        
        if (sortConfig.key === 'categoryName') {
           valA = categories?.find(c => c.id === a.categoryId)?.name || '';
           valB = categories?.find(c => c.id === b.categoryId)?.name || '';
        }
        
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    
    return result;
  }, [items, productCategoryFilter, productSearch, sortConfig, categories]);





  /** Produtos que hoje estão numa categoria (combos também carregam categoryId). */
  const itemsOfCategory = (categoryId?: string) =>
    !categoryId ? [] : (items || []).filter((it: any) => it.categoryId === categoryId);

  /**
   * Exclui a categoria SEM deixar produto solto: ou move os produtos pra outra
   * categoria, ou apaga tudo junto. O caminho antigo apagava só a categoria e o
   * produto virava fantasma — sumia do cardápio e continuava vendável no PDV.
   */
  const confirmDeleteCategory = async () => {
    if (!db || !deletingCategory) return;
    const alvos = itemsOfCategory(deletingCategory.id);
    // Sem outra categoria não existe "mover" — a tela já mostra só a opção de
    // apagar junto, e aqui a regra tem que ser a mesma pra não travar.
    const outras = (categories || []).filter((c: any) => c.id !== deletingCategory.id);
    const movendo = alvos.length > 0 && deleteCategoryAction === 'move' && outras.length > 0;

    if (movendo && !outras.some((c: any) => c.id === deleteCategoryTarget)) {
      toast({ variant: 'destructive', title: 'Escolha para onde vão os produtos' });
      return;
    }

    setIsDeletingCategory(true);
    try {
      // Firestore aceita no máximo 500 operações por lote.
      const LOTE = 450;
      for (let i = 0; i < alvos.length; i += LOTE) {
        const batch = writeBatch(db);
        alvos.slice(i, i + LOTE).forEach((it: any) => {
          const ref = doc(db, 'menuItems', it.id);
          if (movendo) batch.update(ref, { categoryId: deleteCategoryTarget });
          else batch.delete(ref);
        });
        await batch.commit();
      }
      // A categoria só sai depois que os produtos estão resolvidos: se algo
      // falhar no meio, ela continua lá e nada vira fantasma.
      await deleteDoc(doc(db, 'categories', deletingCategory.id));

      toast({
        title: 'Categoria excluída',
        description: alvos.length === 0
          ? undefined
          : movendo
            ? `${alvos.length} ${alvos.length === 1 ? 'produto foi movido' : 'produtos foram movidos'} para ${categories?.find((c: any) => c.id === deleteCategoryTarget)?.name || 'a outra categoria'}.`
            : `${alvos.length} ${alvos.length === 1 ? 'produto foi excluído' : 'produtos foram excluídos'} junto.`,
      });
      setDeletingCategory(null);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Não deu para excluir', description: error.message });
    } finally {
      setIsDeletingCategory(false);
    }
  };

  const handleDragEndCategory = async (result: DropResult) => {
    if (!result.destination || !db || !categories) return;
    
    const sourceIndex = result.source.index;
    const destinationIndex = result.destination.index;
    
    if (sourceIndex === destinationIndex) return;

    // Get sorted array
    const sortedCategories = [...categories].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
    
    // Reorder
    const [moved] = sortedCategories.splice(sourceIndex, 1);
    sortedCategories.splice(destinationIndex, 0, moved);
    
    // Update all displayOrders
    const batch = writeBatch(db);
    sortedCategories.forEach((cat, index) => {
      const catRef = doc(db, 'categories', cat.id);
      batch.update(catRef, { displayOrder: index });
    });
    
    try {
      await batch.commit();
      toast({ title: "Ordem atualizada com sucesso!" });
    } catch (error: any) {
      toast({ variant: 'destructive', title: "Erro ao atualizar ordem", description: error.message });
    }
  };

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

  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [editingCombo, setEditingCombo] = useState<any>(null);
  const [editingAddon, setEditingAddon] = useState<any>(null);
  const [editingAddonContainers, setEditingAddonContainers] = useState<Set<string>>(new Set());
  const [uploadingImageProductId, setUploadingImageProductId] = useState<string | null>(null);
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

  // Manage history state for product edit screen
  useEffect(() => {
    const isOpen = editingProduct !== null;
    if (isOpen) {
      window.history.pushState({ type: 'admin-product' }, '');

      const handlePopState = (event: PopStateEvent) => {
        setEditingProduct(null);
      };

      window.addEventListener('popstate', handlePopState);
      return () => {
        window.removeEventListener('popstate', handlePopState);
        if (window.history.state?.type === 'admin-product') {
          window.history.back();
        }
      };
    }
  }, [editingProduct !== null]);

  // Manage history state for combo edit screen
  useEffect(() => {
    const isOpen = editingCombo !== null;
    if (isOpen) {
      window.history.pushState({ type: 'admin-combo' }, '');

      const handlePopState = (event: PopStateEvent) => {
        setEditingCombo(null);
      };

      window.addEventListener('popstate', handlePopState);
      return () => {
        window.removeEventListener('popstate', handlePopState);
        if (window.history.state?.type === 'admin-combo') {
          window.history.back();
        }
      };
    }
  }, [editingCombo !== null]);

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

  // Manage category creation dialog
  useEffect(() => {
    if (isCategoryModalOpen) {
      window.history.pushState({ type: 'admin-category-modal' }, '');
      const handlePop = () => setIsCategoryModalOpen(false);
      window.addEventListener('popstate', handlePop);
      return () => {
        window.removeEventListener('popstate', handlePop);
        if (window.history.state?.type === 'admin-category-modal') window.history.back();
      };
    }
  }, [isCategoryModalOpen]);

  // Manage category config dialog
  useEffect(() => {
    if (isCategoryConfigModalOpen) {
      window.history.pushState({ type: 'admin-category-config' }, '');
      const handlePop = () => setIsCategoryConfigModalOpen(false);
      window.addEventListener('popstate', handlePop);
      return () => {
        window.removeEventListener('popstate', handlePop);
        if (window.history.state?.type === 'admin-category-config') window.history.back();
      };
    }
  }, [isCategoryConfigModalOpen]);

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

  if (role === 'operator') {
    if (!['produtos', 'categorias', 'addons', 'promocoes'].includes(activeTab)) {
      return (
        <div className="flex h-screen items-center justify-center bg-slate-100 text-sm font-medium text-slate-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Redirecionando para o PDV…
        </div>
      );
    }

    return (
      <div className="admin-scale flex h-screen overflow-hidden bg-slate-100">
        <SidebarNav
          activeTab={activeTab}
          setActiveTab={handleTabChange}
          isOpen={isSidebarOpen}
          setIsOpen={setIsSidebarOpen}
          storeName={storeProfile?.general?.name}
          storeLogo={storeProfile?.general?.logoUrl}
          theme={storeProfile?.theme}
        />
        <div className="relative z-0 flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between bg-[#2a3042] pl-14 pr-4 text-slate-300 shadow-sm">
            <button
              onClick={() => router.push('/pdv')}
              className="flex h-full items-center gap-2 px-6 text-sm font-medium transition-colors hover:bg-white/10"
            >
              <Wallet className="h-4 w-4" /> Frente de Caixa
            </button>
            <div className="flex items-center gap-4">
              <span className="hidden text-xs text-slate-400 sm:inline">{operatorName || user.email}</span>
              <button onClick={handleLogout} className="text-sm font-medium transition-colors hover:text-white">Sair</button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
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
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="admin-scale h-screen bg-slate-100 flex overflow-hidden">
      <SidebarNav activeTab={activeTab} setActiveTab={handleTabChange} isOpen={isSidebarOpen} setIsOpen={setIsSidebarOpen} storeName={storeProfile?.general?.name} storeLogo={storeProfile?.general?.logoUrl} theme={storeProfile?.theme} />
      <div className="flex-1 flex flex-col min-w-0 transition-all duration-300 relative z-0">
        {/* Dark Top Navigation Bar */}
        <div className="bg-[#2a3042] text-slate-300 h-14 flex justify-between items-center pr-4 pl-14 shrink-0 shadow-sm z-10">
          <div className="flex h-full items-center">
            <button
              onClick={() => router.push('/pdv')}
              className="px-6 h-full flex items-center gap-2 text-sm font-medium transition-colors hover:bg-white/10"
              title="Ir para a frente de caixa (pedidos, mesas, caixa)"
            >
              <Wallet className="h-4 w-4" />
              Frente de Caixa
            </button>
          </div>

          <div className="flex items-center gap-4 h-full">
            <button onClick={handleLogout} className="text-sm font-medium hover:text-white transition-colors">
              Sair
            </button>
          </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 p-2 overflow-hidden flex flex-col min-h-0">
        
        {activeTab === 'dashboard' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <DashboardTab
              db={db}
              user={user}
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
            <WhatsAppTab user={user} storeProfile={storeProfile} db={db} />
          </div>
        )}

        {activeTab === 'campanhas' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <CampanhasTab db={db} user={user} storeProfile={storeProfile} />
          </div>
        )}

        {activeTab === 'encomendas' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
              <EncomendasAdminTab db={db} user={user} storeProfile={storeProfile} />
            </div>
          </div>
        )}


        {activeTab === 'promocoes' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <PromotionsTab 
              db={db} user={user} items={items || []} categories={categories || []} 
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

          {activeTab === 'produtos' && (
            <div className={`mt-2 flex-1 min-h-0 flex flex-col ${(editingProduct !== null || editingCombo !== null) ? 'overflow-y-auto custom-scrollbar' : ''}`}>
              {editingCombo === null && (
                <div className="mb-3 px-2 shrink-0 flex items-baseline gap-3 flex-wrap">
                  <h1 className="text-2xl font-black tracking-tight text-slate-800">
                    {editingProduct !== null ? (editingProduct.isMarmita ? 'Editar Marmita' : 'Editar Produto') : 'Produtos e Marmitas'}
                  </h1>
                  <p className="text-sm text-muted-foreground font-medium">
                    {editingProduct !== null ? 'Gerencie as configurações deste item.' : 'Gerencie seu cardápio e monte produtos personalizados (Marmitas).'}
                  </p>
                </div>
              )}
            {editingProduct !== null ? (
              <div className="pb-4 pr-1">
                <ProductModal
                  db={db} user={user} addons={addons || []}
                  addonCategories={addonCategories || []}
                  editingProduct={editingProduct} setEditingProduct={setEditingProduct}
                  categories={categories || []}
                />
              </div>
            ) : editingCombo !== null ? (
              <div className="pb-4 pr-1">
                <ComboModal
                  db={db} user={user} items={items || []}
                  editingCombo={editingCombo} setEditingCombo={setEditingCombo}
                  categories={categories || []}
                />
              </div>
            ) : (
            <Card className="border shadow-md rounded-2xl overflow-hidden flex-1 min-h-0 flex flex-col">
              <CardHeader className="flex flex-col gap-2 border-b bg-white p-3 shrink-0">
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Procurar produto ou marmita..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="flex-1"
                  />
                  <Button onClick={() => setEditingProduct({})} className="bg-primary text-white shrink-0">
                    <Plus className="mr-2 h-4 w-4" /> Novo Produto
                  </Button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                  <button
                    type="button"
                    onClick={() => { setProductCategoryFilter('todas'); setProductSearch(''); }}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-bold transition-colors ${
                      productCategoryFilter === 'todas'
                        ? 'border-primary bg-primary text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-primary/50 hover:text-primary'
                    }`}
                  >
                    Todos
                  </button>
                  {sortedProductCategories.map((cat: any) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => { setProductCategoryFilter(cat.id); setProductSearch(''); }}
                      className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-bold transition-colors ${
                        productCategoryFilter === cat.id
                          ? 'border-primary bg-primary text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-primary/50 hover:text-primary'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="pl-6 w-[80px] cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSort('id')}>
                        <div className="flex items-center">Id {sortConfig?.key === 'id' ? <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${sortConfig.direction === 'asc' ? 'rotate-180' : ''}`} /> : <ChevronDown className="ml-1 h-3 w-3 opacity-20" />}</div>
                      </TableHead>
                      <TableHead className="w-[80px]">Ref</TableHead>
                      <TableHead className="cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSort('name')}>
                        <div className="flex items-center">Título {sortConfig?.key === 'name' ? <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${sortConfig.direction === 'asc' ? 'rotate-180' : ''}`} /> : <ChevronDown className="ml-1 h-3 w-3 opacity-20" />}</div>
                      </TableHead>
                      <TableHead className="w-[120px] cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSort('price')}>
                        <div className="flex items-center">Valor {sortConfig?.key === 'price' ? <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${sortConfig.direction === 'asc' ? 'rotate-180' : ''}`} /> : <ChevronDown className="ml-1 h-3 w-3 opacity-20" />}</div>
                      </TableHead>
                      <TableHead className="w-[100px] text-center">Estoque</TableHead>
                      <TableHead className="w-[200px] cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSort('categoryName')}>
                        <div className="flex items-center">Categoria {sortConfig?.key === 'categoryName' ? <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${sortConfig.direction === 'asc' ? 'rotate-180' : ''}`} /> : <ChevronDown className="ml-1 h-3 w-3 opacity-20" />}</div>
                      </TableHead>
                      <TableHead className="w-[190px] text-center">
                        <span className="whitespace-nowrap text-[11px]">Delivery / Local</span>
                      </TableHead>
                      <TableHead className="text-right pr-6 w-[150px]">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="h-32 text-center text-sm text-muted-foreground">
                          Nenhum produto ou marmita encontrado nesta categoria.
                        </TableCell>
                      </TableRow>
                    ) : filteredItems.map((item) => {
                      const catName = categories?.find(c => c.id === item.categoryId)?.name || 'Sem Categoria';
                      const itemAddons = addons?.filter(a => item.addonIds?.includes(a.id)) || [];
                      const allOff = !hasAnyVisibleToggle(item);
                      const visibilityChannels = MENU_VISIBILITY_TOGGLES.map((toggle) => ({
                        label: toggle.label,
                        trackClass: toggle.trackClass,
                        active: isToggleActive(item, toggle),
                        onToggle: async () => {
                          if (!db) return;
                          const newVal = !isToggleActive(item, toggle);
                          await updateDoc(doc(db, 'menuItems', item.id), getToggleUpdate(item, toggle, newVal));
                        },
                      }));
                       
                      return (
                        <TableRow key={item.id} className={allOff ? 'opacity-60 bg-slate-50/50' : ''}>
                          <TableCell className="pl-6 text-muted-foreground text-xs">{item.id.slice(-6).toUpperCase()}</TableCell>
                          <TableCell>
                            <div className="relative h-10 w-10 rounded overflow-hidden border bg-muted/30 flex items-center justify-center">
                              {item.imageUrl ? (
                                <Image src={item.imageUrl} alt={item.name} fill className="object-cover" />
                              ) : (
                                <Utensils className="h-4 w-4 text-muted-foreground/40" />
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-slate-800">{item.name}</div>
                            {itemAddons.length > 0 && (
                              <div className="mt-1">
                                <Badge className="text-[10px] bg-teal-500 hover:bg-teal-600 font-normal">
                                  Opções: {itemAddons.map(a => a.name).join('; ')}
                                </Badge>
                              </div>
                            )}
                            {item.isCombo && item.comboItems?.length > 0 && (
                              <div className="mt-1">
                                <Badge className="text-[10px] bg-purple-600 hover:bg-purple-700 font-normal">
                                  Combo: {item.comboItems.length} itens
                                </Badge>
                              </div>
                            )}
                            {item.addonGroups?.length > 0 && (
                              <div className="mt-1">
                                <Badge className="text-[10px] bg-orange-600 hover:bg-orange-700 font-normal">
                                  Etapas: {item.addonGroups.length}
                                </Badge>
                              </div>
                            )}
                          </TableCell>
                          <TableCell
                            className="text-primary font-semibold cursor-pointer hover:bg-primary/5 hover:underline transition-colors rounded"
                            title="Clique para editar preço"
                            onClick={() => {
                              setQuickPriceEdit({ id: item.id, name: item.name, price: item.price || 0 });
                            }}
                          >{brl((item.price || 0))}{item.saleUnit === 'kg' ? '/kg' : ''}</TableCell>
                          <TableCell className="text-center">
                            {item.saleUnit === 'kg' ? (
                              <span className="text-xs text-slate-400">por kg</span>
                            ) : (
                              <Input
                                type="number"
                                className="w-20 text-center mx-auto h-8 text-sm"
                                value={item.stockQuantity ?? ''}
                                placeholder="∞"
                                onChange={async (e) => {
                                  if (!db) return;
                                  const val = e.target.value;
                                  await updateDoc(doc(db, 'menuItems', item.id), {
                                    stockQuantity: val === '' ? null : parseInt(val) || 0
                                  });
                                }}
                              />
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">{catName}</TableCell>
                          <TableCell className="text-center">
                            <div className="mx-auto flex w-[160px] items-center justify-center gap-2">
                              {visibilityChannels.map((channel) => (
                                <button
                                  key={channel.label}
                                  type="button"
                                  aria-pressed={channel.active}
                                  aria-label={`${channel.active ? 'Desligar' : 'Ligar'} ${channel.label}`}
                                  title={`${channel.active ? 'Desligar' : 'Ligar'} ${channel.label}`}
                                  className={`relative h-6 w-11 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                                    channel.active ? `${channel.trackClass} border-transparent` : 'border-slate-300 bg-slate-200 hover:bg-slate-300'
                                  }`}
                                  onClick={channel.onToggle}
                                >
                                  <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${channel.active ? 'translate-x-5' : 'translate-x-0'}`} />
                                </button>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-right pr-6 whitespace-nowrap">
                            <div className="flex items-center justify-end gap-0.5">
                              {uploadingImageProductId === item.id ? (
                                <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
                                  <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                                </Button>
                              ) : (
                                <label className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-8 w-8 cursor-pointer" title="Adicionar Imagem Rápido">
                                  <Upload className="h-4 w-4 text-emerald-600" />
                                  <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={async (e) => {
                                      const file = e.target.files?.[0];
                                      if (!file || !db) return;
                                      setUploadingImageProductId(item.id);
                                      try {
                                        toast({ title: "Enviando imagem...", description: "Por favor, aguarde." });
                                        const url = await uploadImage(file);
                                        await updateDoc(doc(db, 'menuItems', item.id), { imageUrl: url });
                                        toast({ title: "Sucesso!", description: "Imagem do produto atualizada." });
                                      } catch (err: any) {
                                        toast({ variant: "destructive", title: "Erro ao enviar", description: err?.message || "Ocorreu um erro." });
                                      } finally {
                                        setUploadingImageProductId(null);
                                      }
                                    }}
                                  />
                                </label>
                              )}
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                                if (item.isCombo) {
                                  setEditingCombo(item);
                                } else {
                                  setEditingProduct(item);
                                }
                              }} title="Editar">
                                <Pencil className="h-4 w-4 text-blue-500" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={async () => {
                                const newName = prompt(`Nome da cópia de "${item.name}":`, `${item.name} (Cópia)`);
                                if (!newName || !db || !user) return;
                                try {
                                  const newDoc = doc(collection(db, 'menuItems'));
                                  const { id, ...itemWithoutId } = item;
                                  await setDoc(newDoc, {
                                    ...itemWithoutId,
                                    id: newDoc.id,
                                    name: newName,
                                    createdAt: Date.now()
                                  });
                                  toast({ title: "Produto duplicado com sucesso!" });
                                } catch(e: any) {
                                  toast({ variant: 'destructive', title: "Erro ao duplicar", description: e.message });
                                }
                              }} title="Duplicar">
                                <Copy className="h-4 w-4 text-emerald-500" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={async () => {
                                if (!db) return;
                                if (confirm("Excluir item?")) await deleteDoc(doc(db, 'menuItems', item.id));
                              }} title="Excluir">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
            )}
            </div>
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

          {activeTab === 'categorias' && (
            <div className="mt-2 flex-1 min-h-0 flex flex-col">
              <div className="mb-3 px-2 shrink-0 flex items-baseline gap-3 flex-wrap">
                <h1 className="text-2xl font-black tracking-tight text-slate-800">Categorias do Cardápio</h1>
                <p className="text-sm text-muted-foreground font-medium">Organize os seus produtos, defina a ordem de exibição e limite horários de disponibilidade.</p>
              </div>
              <Card className="border shadow-md rounded-2xl overflow-hidden flex-1 min-h-0 flex flex-col">
              <CardHeader className="flex flex-row items-center justify-end border-b bg-white p-3 shrink-0">
                <Dialog open={isCategoryModalOpen} onOpenChange={(open) => {
                  setIsCategoryModalOpen(open);
                  if (!open) setNewCategoryName('');
                }}>
                  <DialogTrigger asChild>
                    <Button className="bg-primary text-white">
                      <Plus className="mr-2 h-4 w-4" /> Nova Categoria
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Nova Categoria</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-2">
                      <Label htmlFor="catName">Nome da Categoria</Label>
                      <Input 
                        id="catName" 
                        value={newCategoryName} 
                        onChange={(e) => setNewCategoryName(e.target.value)} 
                        placeholder="Ex: Lanches, Bebidas..." 
                        autoFocus
                      />
                      <p className="text-xs text-muted-foreground">
                        Dica: Crie várias de uma vez separando por vírgula (,) ou ponto-e-vírgula (;)
                      </p>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsCategoryModalOpen(false)}>Cancelar</Button>
                      <Button onClick={async () => {
                        if (!db || !user || !newCategoryName.trim()) return;
                        
                        // Divide por vírgula ou ponto-e-vírgula e remove espaços vazios
                        const nomes = newCategoryName.split(/[,;]/).map(n => n.trim()).filter(n => n.length > 0);
                        
                        if (nomes.length === 0) return;

                        try {
                          // Cria todas as categorias em paralelo
                          await Promise.all(nomes.map(async (name) => {
                            const newDoc = doc(collection(db, 'categories'));
                            return setDoc(newDoc, { 
                              id: newDoc.id, 
                              name, 
                              ownerId,
                              displayOrder: 0, 
                              description: "",
                              isAvailable: true
                            });
                          }));

                          setIsCategoryModalOpen(false);
                          setNewCategoryName('');
                          
                          if (nomes.length > 1) {
                            toast({ title: `${nomes.length} categorias criadas com sucesso!` });
                          } else {
                            toast({ title: 'Categoria criada com sucesso!' });
                          }
                        } catch (err: any) {
                          toast({ variant: 'destructive', title: 'Erro ao criar', description: err.message });
                        }
                      }} className="bg-primary text-white">
                        Salvar
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* Modal de Configuração da Categoria (Disponibilidade) */}
                <Dialog open={isCategoryConfigModalOpen} onOpenChange={setIsCategoryConfigModalOpen}>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Configurar Categoria: {editingCategory?.name}</DialogTitle>
                    </DialogHeader>
                    {editingCategory && (
                      <div className="py-4 space-y-6">
                        <div className="flex items-center justify-between">
                          <Label className="font-bold flex items-center gap-2 text-base">
                            <Clock className="w-4 h-4 text-primary" /> 
                            Limitar Disponibilidade
                          </Label>
                          <Switch 
                            checked={editingCategory.availability?.enabled || false}
                            onCheckedChange={(checked) => setEditingCategory({
                              ...editingCategory,
                              availability: { ...editingCategory.availability, enabled: checked, days: editingCategory.availability?.days || ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'], startTime: editingCategory.availability?.startTime || '00:00', endTime: editingCategory.availability?.endTime || '23:59' }
                            })}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground -mt-4">
                          Se ativado, esta categoria só aparecerá para o cliente nos dias e horários selecionados abaixo.
                        </p>

                        {editingCategory.availability?.enabled && (
                          <div className="space-y-4 pt-2 border-t">
                            <div className="space-y-2">
                              <Label className="text-sm">Dias da Semana</Label>
                              <div className="flex flex-wrap gap-2">
                                {['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].map(d => {
                                  const isSelected = editingCategory.availability?.days?.includes(d);
                                  return (
                                    <Badge 
                                      key={d} 
                                      variant={isSelected ? 'default' : 'outline'}
                                      className="cursor-pointer"
                                      onClick={() => {
                                        const currentDays = editingCategory.availability?.days || [];
                                        const newDays = isSelected ? currentDays.filter((x: string) => x !== d) : [...currentDays, d];
                                        setEditingCategory({
                                          ...editingCategory,
                                          availability: { ...editingCategory.availability, days: newDays }
                                        });
                                      }}
                                    >
                                      {d.substring(0, 3)}
                                    </Badge>
                                  );
                                })}
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <Label className="text-xs">Horário Inicial</Label>
                                <Input 
                                  type="time" 
                                  value={editingCategory.availability?.startTime || '00:00'}
                                  onChange={(e) => setEditingCategory({
                                    ...editingCategory,
                                    availability: { ...editingCategory.availability, startTime: e.target.value }
                                  })}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Horário Final</Label>
                                <Input 
                                  type="time" 
                                  value={editingCategory.availability?.endTime || '23:59'}
                                  onChange={(e) => setEditingCategory({
                                    ...editingCategory,
                                    availability: { ...editingCategory.availability, endTime: e.target.value }
                                  })}
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsCategoryConfigModalOpen(false)}>Cancelar</Button>
                      <Button onClick={async () => {
                        if (!db || !editingCategory) return;
                        try {
                          await updateDoc(doc(db, 'categories', editingCategory.id), {
                            availability: editingCategory.availability || null
                          });
                          setIsCategoryConfigModalOpen(false);
                          toast({ title: 'Configurações salvas!' });
                        } catch (err: any) {
                          toast({ variant: 'destructive', title: 'Erro ao salvar', description: err.message });
                        }
                      }} className="bg-primary text-white">
                        Salvar Configurações
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                  <Table>
                    <TableHeader className="bg-muted/30 sticky top-0 z-10 backdrop-blur-sm">
                      <TableRow>
                        <TableHead className="pl-6">Nome</TableHead>
                        <TableHead className="text-right pr-6">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                  <DragDropContext onDragEnd={handleDragEndCategory}>
                    <Droppable droppableId="categories-list">
                      {(provided) => (
                        <TableBody {...provided.droppableProps} ref={provided.innerRef}>
                          {categories?.sort((a,b) => (a.displayOrder || 0) - (b.displayOrder || 0)).map((cat, index) => (
                            <Draggable key={cat.id} draggableId={cat.id} index={index}>
                              {(provided) => (
                                <TableRow 
                                  ref={provided.innerRef} 
                                  {...provided.draggableProps}
                                  className="bg-white"
                                >
                                  <TableCell className="font-bold pl-6">
                                    <div className="flex items-center gap-3">
                                      <div {...provided.dragHandleProps} className="cursor-grab hover:text-primary active:cursor-grabbing p-1">
                                        <GripVertical className="h-5 w-5 text-muted-foreground" />
                                      </div>
                                      <div>
                                        {cat.name}
                                        {cat.availability?.enabled && (
                                          <p className="text-[10px] text-muted-foreground font-normal mt-0.5">
                                            {cat.availability.days?.map((d: string) => d.substring(0, 3)).join(', ')} ({cat.availability.startTime || '00:00'} às {cat.availability.endTime || '23:59'})
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right pr-6">
                                    <div className="flex items-center justify-end gap-1">
                                      <div className="flex items-center gap-1.5 mr-4 border-r pr-4">
                                        <Switch 
                                          checked={cat.isAvailable !== false} 
                                          onCheckedChange={async (checked) => {
                                            if (!db) return;
                                            await updateDoc(doc(db, 'categories', cat.id), { isAvailable: checked });
                                            toast({ title: checked ? 'Categoria ativada' : 'Categoria desativada' });
                                          }} 
                                          className="scale-75 data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-red-500"
                                        />
                                        <span className={`text-[10px] font-medium uppercase ${cat.isAvailable !== false ? 'text-green-600' : 'text-red-500'}`}>{cat.isAvailable !== false ? 'Ligada' : 'Desligada'}</span>
                                      </div>
                                      <Button variant="ghost" size="icon" onClick={() => {
                                        setEditingCategory(cat);
                                        setIsCategoryConfigModalOpen(true);
                                      }} className={cat.availability?.enabled ? 'text-primary' : 'text-muted-foreground'}>
                                        <Clock className="h-4 w-4" />
                                      </Button>
                                      <Button variant="ghost" size="icon" onClick={() => {
                                        setDeletingCategory(cat);
                                        setDeleteCategoryAction('move');
                                        setDeleteCategoryTarget(
                                          (categories || []).find((c: any) => c.id !== cat.id)?.id || ''
                                        );
                                      }}>
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </TableBody>
                      )}
                    </Droppable>
                  </DragDropContext>
                </Table>
                </div>
              </CardContent>
            </Card>

            {/* Excluir categoria: avisa quando ainda tem produtos dentro e obriga
                a decidir o destino deles (mover ou apagar junto). */}
            <Dialog open={!!deletingCategory} onOpenChange={(open) => { if (!open && !isDeletingCategory) setDeletingCategory(null); }}>
              <DialogContent className="sm:max-w-md">
                {deletingCategory && (() => {
                  const alvos = itemsOfCategory(deletingCategory.id);
                  const combos = alvos.filter((it: any) => it.isCombo).length;
                  const outras = (categories || []).filter((c: any) => c.id !== deletingCategory.id);
                  const semDestino = outras.length === 0;
                  const acao = semDestino ? 'wipe' : deleteCategoryAction;
                  return (
                    <>
                      <DialogHeader>
                        <DialogTitle>Excluir "{deletingCategory.name}"</DialogTitle>
                      </DialogHeader>

                      {alvos.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Essa categoria está vazia. Pode excluir sem problema.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-sm">
                            Essa categoria tem <strong>{alvos.length} {alvos.length === 1 ? 'produto' : 'produtos'}</strong>
                            {combos > 0 && <> (sendo {combos} {combos === 1 ? 'combo' : 'combos'})</>}. O que fazer com {alvos.length === 1 ? 'ele' : 'eles'}?
                          </p>

                          {!semDestino && (
                            <label className={`flex flex-col gap-2 rounded-lg border p-3 cursor-pointer transition ${acao === 'move' ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}>
                              <div className="flex items-center gap-2">
                                <input
                                  type="radio"
                                  checked={acao === 'move'}
                                  onChange={() => setDeleteCategoryAction('move')}
                                  className="accent-primary"
                                />
                                <span className="text-sm font-medium">Mover para outra categoria</span>
                              </div>
                              <p className="text-xs text-muted-foreground pl-6">
                                Os produtos continuam à venda, só mudam de lugar no cardápio.
                              </p>
                              <div className="pl-6">
                                <Select
                                  value={deleteCategoryTarget}
                                  onValueChange={(v) => { setDeleteCategoryAction('move'); setDeleteCategoryTarget(v); }}
                                >
                                  <SelectTrigger className="h-9">
                                    <SelectValue placeholder="Escolha a categoria" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {outras.map((c: any) => (
                                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </label>
                          )}

                          <label className={`flex flex-col gap-2 rounded-lg border p-3 cursor-pointer transition ${acao === 'wipe' ? 'border-destructive bg-destructive/5' : 'hover:bg-muted/40'}`}>
                            <div className="flex items-center gap-2">
                              <input
                                type="radio"
                                checked={acao === 'wipe'}
                                onChange={() => setDeleteCategoryAction('wipe')}
                                className="accent-destructive"
                              />
                              <span className="text-sm font-medium">Excluir os produtos junto</span>
                            </div>
                            <p className="text-xs text-muted-foreground pl-6">
                              {alvos.length === 1 ? 'O produto some' : 'Os produtos somem'} do cardápio e do PDV. Não tem como desfazer.
                            </p>
                          </label>

                          {semDestino && (
                            <p className="text-xs text-muted-foreground">
                              Não há outra categoria para onde mover — crie uma antes se não quiser perder esses produtos.
                            </p>
                          )}
                        </div>
                      )}

                      <DialogFooter>
                        <Button variant="outline" onClick={() => setDeletingCategory(null)} disabled={isDeletingCategory}>
                          Cancelar
                        </Button>
                        <Button
                          onClick={confirmDeleteCategory}
                          disabled={isDeletingCategory}
                          className={acao === 'wipe' && alvos.length > 0 ? 'bg-destructive text-white hover:bg-destructive/90' : 'bg-primary text-white'}
                        >
                          {isDeletingCategory && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          {alvos.length === 0
                            ? 'Excluir categoria'
                            : acao === 'move'
                              ? 'Mover e excluir categoria'
                              : `Excluir categoria e ${alvos.length} ${alvos.length === 1 ? 'produto' : 'produtos'}`}
                        </Button>
                      </DialogFooter>
                    </>
                  );
                })()}
              </DialogContent>
            </Dialog>
            </div>
          )}

          {activeTab === 'addons' && (() => {
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
              const typeLabel = item.isCombo ? ' (Combo)' : item.isMarmita ? ' (Marmita)' : ' (Produto)';
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
                <p className="text-sm text-muted-foreground font-medium">Crie itens extras que podem ser vinculados aos seus produtos (ex: Bacon, Molho Extra, Adicionais da Marmita).</p>
              </div>
              <Card className="border shadow-md rounded-2xl overflow-hidden flex-1 min-h-0 flex flex-col">
              <CardContent className="p-0 flex-1 min-h-0 flex flex-col lg:flex-row">
                {/* ── Coluna 1: containers (lista vertical) ── */}
                <div className="flex shrink-0 flex-col border-b bg-white lg:w-[270px] lg:border-b-0 lg:border-r min-h-0 max-h-44 lg:max-h-none">
                  <div className="shrink-0 border-b px-3 py-2">
                    <p className="text-xs font-bold text-slate-700">Containers</p>
                  </div>
                  <div className="min-h-0 flex-1 space-y-1 overflow-y-auto custom-scrollbar p-2">
                    {/* Lista Matriz com identidade âmbar (mesma cor do guia de ajuda),
                        para não se confundir com os containers */}
                    <Button
                      variant="outline"
                      onClick={() => { setAddonCategoryFilter('all'); setHighlightedAddonId(null); setAddonSearchTerm(''); }}
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
                        onClick={() => { setAddonCategoryFilter(g); setHighlightedAddonId(null); setAddonSearchTerm(''); }}
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
                    <Input placeholder="Buscar adicionais..." value={addonSearchTerm} onChange={(e) => setAddonSearchTerm(e.target.value)} className="pl-9" />
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
            <AppearanceTab db={db} user={user} storeProfile={storeProfile} />
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
          {activeTab.startsWith('perfil_') && activeTab !== 'perfil_aparencia' && (
            <StoreProfileTab db={db} user={user} activeSection={activeTab.replace('perfil_', '') as any} />
          )}

          {activeTab === 'clientes' && (
            <ClientesTab db={db} user={user} registrarLancamento={registrarLancamento} caixaAberto={!!caixaAberto} />
          )}

          {activeTab === 'freelance' && (
            <div className="mt-6">
              <FreelanceTab orders={ordersRaw || []} storeProfile={storeProfile} />
            </div>
          )}
          </div>
        </div>
      </div>

      </div>
    </div>

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
