'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useFirestore, useCollection, useMemoFirebase, useUser, useDoc, useAuth } from '@/firebase';
import { collection, doc, updateDoc, query, where, getDoc, runTransaction } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Settings, ShieldAlert } from 'lucide-react';
import { CaixaTab } from '@/components/caixa/CaixaTab';
import { useToast } from '@/hooks/use-toast';
import confetti from 'canvas-confetti';
import { Badge } from '@/components/ui/badge';
import { DeliveryTab } from '@/components/admin/DeliveryTab';
import { NovoPedidoTab } from '@/components/admin/NovoPedidoTab';
import { discardMesasDraft, MesasTab } from '@/components/admin/MesasTab';
import { WelcomeWizard } from '@/components/admin/WelcomeWizard';
import { EncomendasPedidosTab } from '@/components/admin/EncomendasPedidosTab';
import { useCaixa } from '@/hooks/useCaixa';
import { buildStoreLink, formatWorkingHours, getWhatsAppMessages, renderWhatsAppTemplate } from '@/lib/whatsapp-messages';
import { reconcileOrderStock, releaseOrderStock, InsufficientStockError } from '@/lib/inventory';
import { playLoudAudio } from '@/lib/order-sound';
import { createConcurrencyQueue } from '@/lib/throttle-queue';
import { syncCustomerFromOrder } from '@/lib/customers/customer-sync';
import { AdminPasswordDialog } from '@/components/admin/AdminPasswordDialog';
import { isAdminSessionUnlocked, unlockAdminSession, type AdminSecret } from '@/lib/admin-password';
import {
  arePermissionsResolved,
  can,
  getEligibleTabs,
  getPdvFallbackTab,
  getPdvPermissions,
  PDV_TAB_IDS,
  type PdvTabId,
} from '@/lib/pdv-permissions';
import { usePdvAccess } from '@/contexts/PdvAccessContext';
import { hasAnyRetaguardaAccess } from '@/lib/user-permissions';

// Fila global (por aba) que limita os envios de WhatsApp simultâneos, evitando
// estourar o limite de taxa da w-api numa rajada de pedidos.
const whatsappQueue = createConcurrencyQueue(3);

function isPdvTabId(value: unknown): value is PdvTabId {
  return typeof value === 'string' && PDV_TAB_IDS.includes(value as PdvTabId);
}

export default function PdvPage() {
  const db = useFirestore();
  const auth = useAuth();
  const router = useRouter();
  const { toast, dismiss } = useToast();
  const { user, isUserLoading } = useUser();
  const { role, ownerId, actorId, actorName, operatorPermissions } = usePdvAccess();
  const [activeTab, setActiveTab] = useState<PdvTabId>('delivery');
  const [hasUnsavedMesaChanges, setHasUnsavedMesaChanges] = useState(false);
  const [passwordDialogPurpose, setPasswordDialogPurpose] = useState<'gestao' | 'recovery' | null>(null);

  // (O warmup do QZ Tray e o alerta de pedido novo — som + impressão automática —
  // agora vivem no <OrderAlertsWatcher/> do layout, pra funcionarem também na
  // Retaguarda. Aqui embaixo ficam só as tarefas específicas do PDV.)

  // ── Varredura de re-tentativa de WhatsApp ──
  // A cada 30s, re-tenta o aviso de "pedido recebido" para pedidos recentes que
  // ainda não foram notificados (falha transitória, limite de taxa, ou pedido que
  // chegou enquanto este PC recarregava). A reserva atômica + a fila garantem que
  // só sai 1 mensagem por pedido, sem estourar o limite da w-api. A janela de 30min
  // evita re-tentar pedidos antigos para sempre.
  // Também dispara o lembrete do comprovante Pix ~1 min após o pedido (apenas
  // pagamento pix, e somente depois do aviso de "pedido recebido").
  useEffect(() => {
    if (!db || !user) return;
    const id = setInterval(() => {
      const send = whatsappSendRef.current;
      const list = ordersForSweepRef.current;
      if (!send || !list) return;
      const now = Date.now();
      for (const o of list) {
        if (!o || o.source === 'pdv' || !o.customerPhone) continue;
        if (o.status === 'canceled' || !o.orderDateTime) continue;
        const ageMs = now - new Date(o.orderDateTime).getTime();
        if (ageMs > 30 * 60 * 1000) continue;
        if (o.receivedMessageSent !== true) {
          void whatsappQueue(() => send(o, 'received'));
          continue; // o lembrete do Pix só sai DEPOIS do aviso de pedido recebido
        }
        // Lembrete amigável do comprovante Pix, ~1 min após o pedido.
        // Mesma reserva atômica (pixProofMessageSent) das demais mensagens:
        // não duplica entre PCs e não interfere nos avisos de status seguintes.
        if (o.paymentMethod === 'pix' && o.pixProofMessageSent !== true && o.status !== 'delivered' && ageMs >= 1 * 60 * 1000) {
          void whatsappQueue(() => send(o, 'pix_proof'));
        }
      }
    }, 30000);
    return () => clearInterval(id);
  }, [db, user]);

  const [autoOpenAbrirCaixa, setAutoOpenAbrirCaixa] = useState(false);
  const [caixaSelecionadoId, setCaixaSelecionadoId] = useState<string | null>(null);
  const [wizardDismissed, setWizardDismissed] = useState(false);
  const [isCelebrating, setIsCelebrating] = useState(false);
  const newClientToastIdRef = useRef<string | null>(null);

  const previousUserIdRef = useRef<string | null>(user?.uid ?? null);
  useEffect(() => {
    const nextUserId = user?.uid ?? null;
    const previousUserId = previousUserIdRef.current;
    if (previousUserId !== nextUserId) {
      if (previousUserId) discardMesasDraft(previousUserId);
      setActiveTab('delivery');
      setHasUnsavedMesaChanges(false);
      setPasswordDialogPurpose(null);
      setAutoOpenAbrirCaixa(false);
      setCaixaSelecionadoId(null);
      setWizardDismissed(false);
      setIsCelebrating(false);
      newClientToastIdRef.current = null;
    }
    previousUserIdRef.current = nextUserId;
  }, [user?.uid]);
  
  
  // Hook do Caixa compartilhado entre módulos
  const { caixaAberto, registrarLancamento, caixaAtual } = useCaixa({
    ownerId,
    actorId,
    actorName,
    caixaSelecionadoId,
    onCaixaSelecionadoIdChange: setCaixaSelecionadoId,
  });
  
  const isRealUser = !!(user && !user.isAnonymous);
  const canReadOperationalOrders = role === 'owner' || (!!operatorPermissions && (
    can(operatorPermissions.pdv, 'tabs.delivery')
    || can(operatorPermissions.pdv, 'tabs.novo_pedido')
    || can(operatorPermissions.pdv, 'tabs.mesas')
  ));
  const canReadEncomendas = role === 'owner'
    || (!!operatorPermissions && can(operatorPermissions.pdv, 'tabs.encomendas_pedidos'));


  // Consultas filtradas pelo UID do dono (Multi-tenancy) com checagem de DB
  const categoriesQuery = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return query(collection(db, 'categories'), where('ownerId', '==', ownerId));
  }, [db, isRealUser, ownerId]);

  const itemsQuery = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return query(collection(db, 'menuItems'), where('ownerId', '==', ownerId));
  }, [db, isRealUser, ownerId]);

  const ordersQuery = useMemoFirebase(() => {
    if (!db || !isRealUser || !canReadOperationalOrders) return null;
    return query(collection(db, 'orders'), where('ownerId', '==', ownerId));
  }, [canReadOperationalOrders, db, isRealUser, ownerId]);

  const addonsQuery = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return query(collection(db, 'addons'), where('ownerId', '==', ownerId));
  }, [db, isRealUser, ownerId]);

  const addonCategoriesQuery = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return query(collection(db, 'addonCategories'), where('ownerId', '==', ownerId));
  }, [db, isRealUser, ownerId]);

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
  const adminSecretResolved = role === 'operator'
    || (!!adminSecretRef && !adminSecretLoading && !adminSecretError);
  const resolvedStoreProfile = (storeProfileLoading || storeProfileError) ? undefined : storeProfile;
  const permissionsResolved = arePermissionsResolved(resolvedStoreProfile);
  const permissions = React.useMemo(
    () => role === 'operator' && operatorPermissions
      ? operatorPermissions.pdv
      : getPdvPermissions({}),
    [operatorPermissions, role],
  );
  const hasRetaguardaAccess = role === 'owner'
    || (!!operatorPermissions
      && hasAnyRetaguardaAccess(role, operatorPermissions.retaguarda));
  const eligibleTabs = React.useMemo(
    () => permissionsResolved ? getEligibleTabs(permissions, storeProfile?.theme) : [],
    [permissions, permissionsResolved, storeProfile?.theme],
  );
  const visibleActiveTab = permissionsResolved
    ? (eligibleTabs.includes(activeTab) ? activeTab : getPdvFallbackTab(eligibleTabs, activeTab))
    : null;

  const selectPdvTab = React.useCallback((
    requested: PdvTabId,
    options: { history?: 'push' | 'none'; bypassUnsaved?: boolean } = {},
  ) => {
    if (!permissionsResolved) return;
    const target = eligibleTabs.includes(requested)
      ? requested
      : getPdvFallbackTab(eligibleTabs, activeTab);
    if (!target) return;

    if (!options.bypassUnsaved && target !== activeTab && hasUnsavedMesaChanges) {
      if (!window.confirm('Você tem alterações não salvas na Mesa. Se sair, essas alterações serão perdidas. Deseja sair?')) {
        return;
      }
      if (user?.uid) discardMesasDraft(user.uid);
      setHasUnsavedMesaChanges(false);
    }

    setActiveTab(target);
    if (target !== requested) {
      window.history.replaceState({ type: 'pdv-tab', tab: target }, '');
    } else if (options.history !== 'none') {
      const currentState = window.history.state;
      if (!currentState || currentState.type !== 'pdv-tab' || currentState.tab !== target) {
        window.history.pushState({ type: 'pdv-tab', tab: target }, '');
      }
    }
  }, [activeTab, eligibleTabs, hasUnsavedMesaChanges, permissionsResolved, user?.uid]);

  const handleTabChange = React.useCallback((newTab: PdvTabId) => {
    selectPdvTab(newTab, { history: 'push' });
  }, [selectPdvTab]);

  // Toda navegação (inclusive Back/Forward) passa pela lista canônica elegível.
  useEffect(() => {
    if (!permissionsResolved) return;
    const handlePopState = (event: PopStateEvent) => {
      if (event.state?.type !== 'pdv-tab') return;
      if (isPdvTabId(event.state.tab)) {
        selectPdvTab(event.state.tab, { history: 'none' });
        return;
      }
      const fallback = getPdvFallbackTab(eligibleTabs, activeTab);
      if (fallback) {
        setActiveTab(fallback);
        window.history.replaceState({ type: 'pdv-tab', tab: fallback }, '');
      }
    };

    window.addEventListener('popstate', handlePopState);
    if (!window.history.state || window.history.state.type !== 'pdv-tab') {
      const initial = eligibleTabs.includes(activeTab)
        ? activeTab
        : getPdvFallbackTab(eligibleTabs, activeTab);
      if (initial) window.history.replaceState({ type: 'pdv-tab', tab: initial }, '');
    }
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeTab, eligibleTabs, permissionsResolved, selectPdvTab]);

  // Revogação e mudança de tema prevalecem sobre o aviso de rascunho da Mesa.
  useEffect(() => {
    if (!permissionsResolved || eligibleTabs.includes(activeTab)) return;
    const fallback = getPdvFallbackTab(eligibleTabs, activeTab);
    if (!fallback) return;
    setActiveTab(fallback);
    window.history.replaceState({ type: 'pdv-tab', tab: fallback }, '');
  }, [activeTab, eligibleTabs, permissionsResolved]);

  useEffect(() => {
    if (caixaSelecionadoId && (
      !can(permissions, 'actions.caixa.verCaixasAnteriores')
      || !eligibleTabs.includes('caixa')
    )) {
      setCaixaSelecionadoId(null);
    }
  }, [caixaSelecionadoId, eligibleTabs, permissions]);

  useEffect(() => {
    if (!permissionsResolved) return;
    if (passwordDialogPurpose === 'gestao' && !can(permissions, 'global.botaoRetaguarda')) {
      setPasswordDialogPurpose(null);
    }
    if (passwordDialogPurpose === 'recovery' && eligibleTabs.length > 0) {
      setPasswordDialogPurpose(null);
    }
  }, [eligibleTabs.length, passwordDialogPurpose, permissions, permissionsResolved]);

  const handleOpenCaixa = React.useCallback(() => {
    if (!eligibleTabs.includes('caixa') || !can(permissions, 'actions.caixa.abrirCaixa')) {
      setAutoOpenAbrirCaixa(false);
      selectPdvTab('caixa', { history: 'push' });
      return;
    }
    setAutoOpenAbrirCaixa(true);
    selectPdvTab('caixa', { history: 'push' });
  }, [eligibleTabs, permissions, selectPdvTab]);

  const { data: categories, isLoading: loadingCats } = useCollection(categoriesQuery);
  const { data: addonCategories, isLoading: loadingAddonCats } = useCollection(addonCategoriesQuery);
  const { data: items, isLoading: loadingItems } = useCollection(itemsQuery);
  const { data: ordersRaw, isLoading: loadingOrders, error: ordersError } = useCollection(ordersQuery);

  // Encomendas ficam em coleção própria (não em `orders`). Assinamos aqui — só na
  // confeitaria — para o CONTADOR (badge) da aba Encomendas. O alerta sonoro/aviso
  // de "nova encomenda" mora no <OrderAlertsWatcher/> do layout.
  const encomendasAlertQuery = useMemoFirebase(() => {
    if (!db || !isRealUser || !canReadEncomendas || storeProfile?.theme !== 'confeitaria') return null;
    return query(collection(db, 'encomendas'), where('ownerId', '==', ownerId));
  }, [canReadEncomendas, db, isRealUser, ownerId, storeProfile?.theme]);
  const { data: encomendasRaw } = useCollection(encomendasAlertQuery);

  const ordersRawSorted = React.useMemo(() => {
    if (!ordersRaw) return [];
    return [...ordersRaw].sort((a: any, b: any) => (b.orderDateTime || '').localeCompare(a.orderDateTime || ''));
  }, [ordersRaw]);

  const orders = React.useMemo(() => {
    if (!ordersRawSorted) return [];
    
    let validOrders = [...ordersRawSorted];
    
    if (caixaAtual) {
      // Converter Timestamp para milissegundos
      const openingTime = caixaAtual.dataAbertura?.toDate?.()?.getTime() || 0;
      const closingTime = caixaAtual.dataFechamento?.toDate?.()?.getTime() || Infinity;
      
      validOrders = validOrders.filter(o => {
        const oTime = new Date(o.orderDateTime || o.createdAt || 0).getTime();
        // Incluir uma margem de segurança de 1 minuto antes e depois para cobrir eventuais atrasos de rede no Firebase
        return oTime >= (openingTime - 60000) && oTime <= (closingTime + 60000);
      });
    } else {
      // Se não há caixa aberto nem selecionado no histórico, não mostra pedidos na interface principal
      validOrders = [];
    }

    return validOrders;
  }, [ordersRawSorted, caixaAtual]);

  const deliveryOrders = React.useMemo(() => {
    const merged = new Map<string, any>();
    for (const order of orders) {
      if (order.orderType === 'delivery' || order.orderType === 'pickup') {
        merged.set(order.id, order);
      }
    }

    if (!caixaSelecionadoId) {
      for (const order of ordersRawSorted) {
        if ((order.orderType === 'delivery' || order.orderType === 'pickup') && !['delivered', 'canceled'].includes(order.status)) {
          merged.set(order.id, order);
        }
      }
    }

    return Array.from(merged.values()).sort((a: any, b: any) => (b.orderDateTime || '').localeCompare(a.orderDateTime || ''));
  }, [orders, ordersRawSorted, caixaSelecionadoId]);

  const sortedProductCategories = React.useMemo(() => {
    return [...(categories || [])].sort((a: any, b: any) => {
      const orderA = a.displayOrder ?? 0;
      const orderB = b.displayOrder ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return (a.name || '').localeCompare(b.name || '', 'pt-BR');
    });
  }, [categories]);




  const seenOrderIdsRef = useRef<Set<string> | null>(null);
  const whatsappWebhookSyncRef = useRef(false);
  // Refs para a varredura de re-tentativa de WhatsApp (evita closure velha no setInterval).
  const whatsappSendRef = useRef<((order: any, status: string) => Promise<any>) | null>(null);
  const ordersForSweepRef = useRef<any[] | null>(null);
  ordersForSweepRef.current = (ordersRaw as any[]) || null;

  useEffect(() => {
    if (!user || !isRealUser || role !== 'owner' || whatsappWebhookSyncRef.current) return;
    whatsappWebhookSyncRef.current = true;

    const timer = window.setTimeout(async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch('/wapi/configure-webhooks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ empresaId: ownerId }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data?.error) {
          console.warn('[WhatsApp] Nao foi possivel sincronizar webhooks:', data?.error || response.status);
        }
      } catch (error) {
        console.warn('[WhatsApp] Falha ao sincronizar webhooks:', error);
      }
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [isRealUser, ownerId, role, user]);

  // O som do alerta agora mora em @/lib/order-sound e é disparado pelo
  // <OrderAlertsWatcher/> (layout). Aqui só reusamos playLoudAudio (importado) na
  // campainha contínua do modo manual, mais abaixo.

  // Pedidos "comer no local" do app NÃO recebem mesa automaticamente: ficam na
  // fila "Novos pedidos online" (purgatório) do MesasTab até o operador aceitar e
  // escolher a mesa real onde o cliente sentou (padrão dos PDVs profissionais).

  useEffect(() => {
    if (!ordersRaw || !db || !user) return;
    const currentIds = new Set((ordersRaw as any[]).map(o => o.id));
    if (seenOrderIdsRef.current === null) {
      seenOrderIdsRef.current = currentIds;
      return;
    }
    
    // Todos os pedidos novos que entraram agora
    const allNewOnes = (ordersRaw as any[]).filter(o => !seenOrderIdsRef.current!.has(o.id));
    
    // Filtro para apitar: apenas pendentes. Pedidos criados no PDV de mesa
    // (source: 'pdv') já imprimem o ticket localmente — não reimprimir aqui.
    const pendingNewOnes = allNewOnes.filter(o => o.status === 'pending' && o.source !== 'pdv');
    
    if (pendingNewOnes.length > 0) {
      // O alerta imediato (som + impressão automática + aviso do navegador) foi
      // movido para <OrderAlertsWatcher/> no layout, pra tocar/imprimir também na
      // Retaguarda. Aqui fica só o que é do PDV: avisar o cliente no WhatsApp
      // (a baixa de estoque / cadastro seguem logo abaixo em processIncomingOrders).
      // ── Envio Automático de Notificação WhatsApp (com fila/limite) ──
      pendingNewOnes.forEach((ord: any) => {
        void whatsappQueue(() => sendOrderWhatsAppNotification(ord, 'received'));
      });
    }

    // Lógica para cadastrar clientes, abater estoque e disparar confetes (processado sequencialmente para evitar condições de corrida assíncronas)
    const processIncomingOrders = async () => {
      const isInventoryEnabled = !!(storeProfile?.general?.enableInventory || storeProfile?.enableInventory);
      for (const order of allNewOnes) {
        // --- 1. ABATIMENTO DE ESTOQUE IMEDIATO (rede de segurança p/ pedidos
        //         que cheguem ainda não abatidos) ---
        if (isInventoryEnabled && order.stockDeducted !== true && order.status !== 'canceled') {
          try {
            await reconcileOrderStock(db, {
              enableInventory: true,
              targetItems: order.items || [],
              alreadyDeducted: order.stockDeductedItems,
              order: { ref: doc(db, 'orders', order.id), mode: 'update', data: {} },
            });
          } catch (err) {
            console.error("Erro ao abater estoque do pedido novo:", order.id, err);
          }
        }

        // --- 2. SINCRONIA DE CLIENTE (identidade/endereço) — fonte única ---
        // Não conta o pedido aqui (status ainda não é 'delivered'); só registra
        // quem é o cliente e o endereço, sem nunca sobrescrever com vazio.
        try {
          if (role === 'owner') {
            const res = await syncCustomerFromOrder(db, order, { ownerId, countOrder: false });
            if (res.created && order.orderType === 'delivery') {
              // Comemorar cliente novo no delivery!
              setIsCelebrating(true);
              const { id } = toast({
                title: "🎉 CLIENTE NOVO!",
                description: `${(order.customerName || 'Cliente').trim()} acabou de fazer o primeiro pedido!`,
                className: "bg-gradient-to-r from-emerald-500 to-teal-500 text-white border-none shadow-lg",
                duration: 999999
              });
              newClientToastIdRef.current = id;
            }
          }
        } catch (err) {
          console.error("Erro ao sincronizar cliente automático:", err);
        }
      }
    };
    void processIncomingOrders();

    seenOrderIdsRef.current = currentIds;
  }, [ordersRaw, toast, db, user, storeProfile]);

  // (Alerta de nova encomenda e pedido de permissão de notificação também foram
  // para o <OrderAlertsWatcher/> — tocam em qualquer tela, PDV ou Retaguarda.)

  // Efeito do confete contínuo e limpeza da notificação
  useEffect(() => {
    if (visibleActiveTab === 'delivery' && newClientToastIdRef.current) {
      dismiss(newClientToastIdRef.current);
      newClientToastIdRef.current = null;
    }

    if (!isCelebrating) return;

    let duration = visibleActiveTab === 'delivery' ? 4000 : 9999999;
    let animationEnd = Date.now() + duration;

    const interval = setInterval(() => {
      let timeLeft = animationEnd - Date.now();
      if (timeLeft <= 0) {
        clearInterval(interval);
        setIsCelebrating(false);
        return;
      }

      confetti({
        particleCount: 15,
        spread: 360,
        startVelocity: 30,
        origin: { x: Math.random(), y: Math.random() - 0.2 },
        colors: ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6']
      });
    }, 300);

    return () => clearInterval(interval);
  }, [isCelebrating, visibleActiveTab]);


  // Som constante enquanto houver pedidos pendentes
  useEffect(() => {
    const isManualPrint = !!(storeProfile?.general?.manualPrint || storeProfile?.manualPrint);
    if (!isManualPrint) return;

    // Só toca a campainha para pedidos que ESTÃO VISÍVEIS e acionáveis na tela de
    // Delivery (deliveryOrders), garantindo que sempre haja um botão "Recebido"
    // para silenciar. Varrer ordersRaw (toda a história, sem recorte de caixa nem
    // de tipo) fazia o alarme tocar por pedidos pendentes órfãos — ex.: pedido
    // "comer no local" preso no purgatório do MesasTab, ou pendente de caixa
    // fechado — que nem aparecem aqui: o apito tocava "sem pedido" na tela.
    // Pedidos do PDV (source 'pdv') ou já aceitos (accepted) não disparam o alarme.
    const hasPending = deliveryOrders.some(o => o.status === 'pending' && o.source !== 'pdv' && !o.accepted);
    if (!hasPending) return;

    let isPlaying = true;
    let timeoutId: NodeJS.Timeout;

    const playLoop = () => {
      if (!isPlaying) return;
      playLoudAudio(4.0); // Toca 4x mais alto
      timeoutId = setTimeout(playLoop, 4000); // Toca o MP3 a cada 4 segundos
    };

    playLoop();

    return () => {
      isPlaying = false;
      clearTimeout(timeoutId);
    };
  }, [deliveryOrders, playLoudAudio, storeProfile]);
  const { data: addons } = useCollection(addonsQuery);






  const handleLogout = async () => {
    if (!auth) return;
    if (user?.uid) discardMesasDraft(user.uid);
    await signOut(auth);
    router.push('/login');
  };

  const handleOpenRetaguarda = () => {
    if (!hasRetaguardaAccess || !can(permissions, 'global.botaoRetaguarda') || !adminSecretResolved) return;
    if (adminSecret && !isAdminSessionUnlocked(user?.uid || '', adminSecret)) {
      setPasswordDialogPurpose('gestao');
      return;
    }
    router.push('/gestao');
  };

  const handleRecoveryRetaguarda = () => {
    if (!hasRetaguardaAccess || !adminSecretResolved) return;
    if (adminSecret && !isAdminSessionUnlocked(user?.uid || '', adminSecret)) {
      setPasswordDialogPurpose('recovery');
      return;
    }
    router.push('/gestao');
  };

  const isDeliveryDisabled = storeProfile?.general?.disableDelivery || false;

  const handleToggleDelivery = async () => {
    if (!db || !user || !storeProfileRef) return;
    if (!can(permissions, 'global.toggleDelivery')) {
      toast({ variant: 'destructive', title: 'Permissão removida pelo administrador' });
      return;
    }
    try {
      const newStatus = !isDeliveryDisabled;
      await updateDoc(storeProfileRef, { 'general.disableDelivery': newStatus });
      toast({
        title: newStatus ? '🛵 Delivery Desativado' : '🛵 Delivery Ativado',
        description: newStatus 
          ? 'Apenas opções de retirar ou comer no local ficarão disponíveis.' 
          : 'Clientes já podem escolher a opção de entrega.',
      });
    } catch (err: any) {
      console.error('Erro ao alternar status do delivery:', err);
      toast({ variant: 'destructive', title: 'Erro ao atualizar', description: err.message });
    }
  };

  const sendOrderWhatsAppNotification = async (order: any, status: string) => {
    if (!user) return { sent: false, skipped: true, reason: 'Usuario indisponivel.' };
    if (!order?.customerPhone) return { sent: false, skipped: true, reason: 'Pedido sem telefone do cliente.' };
    if (!['received', 'pix_proof', 'ready', 'out_for_delivery', 'canceled'].includes(status)) {
      return { sent: false, skipped: true, reason: 'Status sem notificacao automatica.' };
    }

    if (status === 'received') {
      if (order.receivedMessageSent) {
        console.log('[WhatsApp] Mensagem de recebido ja enviada para o pedido:', order.id);
        return { sent: false, skipped: true, reason: 'Mensagem de recebido ja enviada.' };
      }
    }

    if (status === 'pix_proof') {
      if (order.pixProofMessageSent) {
        console.log('[WhatsApp] Lembrete do comprovante Pix ja enviado para o pedido:', order.id);
        return { sent: false, skipped: true, reason: 'Lembrete do comprovante Pix ja enviado.' };
      }
    }

    if (status === 'out_for_delivery') {
      if (order.outForDeliveryMessageSent) {
        console.log('[WhatsApp] Mensagem de saiu para entrega ja enviada para o pedido:', order.id);
        return { sent: false, skipped: true, reason: 'Mensagem de saiu para entrega ja enviada.' };
      }
    }

    if (status === 'canceled') {
      if (order.canceledMessageSent) {
        console.log('[WhatsApp] Mensagem de cancelamento ja enviada para o pedido:', order.id);
        return { sent: false, skipped: true, reason: 'Mensagem de cancelamento ja enviada.' };
      }
    }

    const firstName = order.customerName ? order.customerName.split(' ')[0] : 'Cliente';
    const shortId = order.id ? order.id.slice(-6).toUpperCase() : '000000';
    const totalStr = typeof order.totalAmount === 'number' ? `R$ ${order.totalAmount.toFixed(2).replace('.', ',')}` : 'R$ 0,00';
    
    let itemsList = '';
    if (order.items && Array.isArray(order.items)) {
      itemsList = order.items.map((item: any) => {
        const itemTotal = (item.unitPrice || 0) * (item.quantity || 1);
        const itemTotalStr = itemTotal.toFixed(2).replace('.', ',');
        let line = `${item.quantity}x ${item.name} - R$ ${itemTotalStr}`;

        if (item.addons && Array.isArray(item.addons)) {
          item.addons.forEach((addon: any) => {
            line += `\n > ${addon.name}`;
          });
        }

        line += `\n Obs: ${item.notes || 'Nenhuma'}`;
        return line;
      }).join('\n\n');
    }
    
    let paymentText = order.paymentMethod || 'Dinheiro';
    if (order.paymentMethod === 'credit_card' || order.paymentMethod === 'credito') paymentText = 'Crédito';
    if (order.paymentMethod === 'debit_card' || order.paymentMethod === 'debito') paymentText = 'Débito';
    if (order.paymentMethod === 'pix') paymentText = 'Pix';
    if (order.paymentMethod === 'cash' || order.paymentMethod === 'dinheiro') paymentText = 'Dinheiro';
    if (order.paymentMethod === 'conta_casa') paymentText = 'Prazo';

    let addressLine = '';
    if (order.orderType === 'delivery') {
      addressLine = `Entregar em: ${order.deliveryAddress || 'Não informado'}`;
    } else if (order.orderType === 'dine_in') {
      addressLine = `Comer no local: ${order.deliveryAddress || 'Mesa não informada'}`;
    } else if (order.orderType === 'pickup') {
      addressLine = `Retirar no local`;
    }

    const subtotalVal = order.subtotal !== undefined ? order.subtotal : ((order.totalAmount || 0) - (order.deliveryFee || 0));
    const subtotalStr = `R$ ${subtotalVal.toFixed(2).replace('.', ',')}`;
    const feeVal = order.deliveryFee || 0;
    // Frete a Prazo não é registrado pela loja (acerto direto cliente→entregador):
    // o resumo não lista valor, só a instrução — e o Total segue sem a taxa.
    const feeStr = feeVal > 0 && order.payDeliveryToMotoboy === true
      ? 'paga direto ao entregador na entrega'
      : `R$ ${feeVal.toFixed(2).replace('.', ',')}`;

    const formatPhoneDisplay = (phoneStr: string) => {
      const digits = phoneStr.replace(/\D/g, '');
      if (digits.length === 11) {
        return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
      }
      if (digits.length === 10) {
        return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
      }
      return phoneStr;
    };
    const phoneFormatted = formatPhoneDisplay(order.customerPhone || '');

    let msgTempo = '';
    if (order.orderType === 'delivery' && storeProfile?.fees?.deliveryTime) {
      msgTempo = `\n⏳ Tempo estimado de entrega: ${storeProfile.fees.deliveryTime}`;
    } else if (order.orderType === 'pickup' && storeProfile?.fees?.pickupTime) {
      msgTempo = `\n⏳ Tempo estimado para retirada: ${storeProfile.fees.pickupTime}`;
    }

    let message = '';
    let msgType = '';
    let templateKey:
      | 'orderReceived'
      | 'pixProofRequest'
      | 'orderReadyDelivery'
      | 'orderReadyPickup'
      | 'orderReadyDineIn'
      | 'orderOutForDelivery'
      | 'orderPickupReady'
      | 'orderDineInReady'
      | 'orderCanceled'
      | null = null;

    if (status === 'received') {
      templateKey = 'orderReceived';
      msgType = 'order_created';
    } else if (status === 'pix_proof') {
      templateKey = 'pixProofRequest';
      msgType = 'pix_proof_request';
    } else if (status === 'ready') {
      // Notificação de preparo concluído
      if (order.orderType === 'pickup') {
        templateKey = 'orderReadyPickup';
        msgType = 'order_ready_pickup';
      } else if (order.orderType === 'dine_in') {
        templateKey = 'orderReadyDineIn';
        msgType = 'order_ready_dine_in';
      } else {
        templateKey = 'orderReadyDelivery';
        msgType = 'order_ready';
      }
    } else if (status === 'out_for_delivery') {
      // Mensagem diferenciada por tipo de pedido
      if (order.orderType === 'pickup') {
        templateKey = 'orderPickupReady';
        msgType = 'pickup_ready';
      } else if (order.orderType === 'dine_in') {
        templateKey = 'orderDineInReady';
        msgType = 'dine_in_ready';
      } else {
        templateKey = 'orderOutForDelivery';
        msgType = 'delivery_out';
      }
    } else if (status === 'canceled') {
      templateKey = 'orderCanceled';
      msgType = 'order_canceled';
    }

    if (templateKey) {
      const whatsappMessages = getWhatsAppMessages(storeProfile?.whatsappMessages);
      message = renderWhatsAppTemplate(whatsappMessages[templateKey], {
        cliente: order.customerName || 'Cliente',
        primeiro_nome: firstName,
        pedido: shortId,
        itens: itemsList,
        total: totalStr,
        pagamento: paymentText,
        tempo_estimado: msgTempo,
        loja: storeProfile?.general?.name || storeProfile?.storeName || 'Minha loja',
        link: buildStoreLink(storeProfile, ownerId, typeof window !== 'undefined' ? window.location.origin : undefined),
        horarios: formatWorkingHours(storeProfile?.workingHours),
        celular: phoneFormatted,
        endereco: addressLine,
        subtotal: subtotalStr,
        taxa_entrega: feeStr,
      });
    }

    if (!message) return { sent: false, skipped: true, reason: 'Mensagem vazia.' };

    // ── Reserva ATÔMICA do envio (anti-duplicação multi-PC) ──
    // Em vez de marcar a flag só DEPOIS de enviar, reivindicamos o envio numa
    // transação ANTES. Com 2 PCs logados, só um consegue passar de false→true;
    // o outro vê a flag já marcada e desiste — eliminando a mensagem duplicada.
    const flagField =
      status === 'received' ? 'receivedMessageSent'
      : status === 'pix_proof' ? 'pixProofMessageSent'
      : status === 'out_for_delivery' ? 'outForDeliveryMessageSent'
      : status === 'canceled' ? 'canceledMessageSent'
      : null;

    if (flagField && db && order.id) {
      let claimed = false;
      try {
        const ref = doc(db, 'orders', order.id);
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists()) return;
          if (snap.data()[flagField]) return; // outro PC já reivindicou/enviou
          tx.update(ref, { [flagField]: true });
          claimed = true;
        });
      } catch (err) {
        // Falha de transação (esta máquina tem o streaming/long-polling do
        // Firestore instável). Em vez de enviar SEM marcar a flag — o que faria
        // a varredura de 30s reenviar a mesma mensagem e duplicar —, fazemos uma
        // reserva best-effort NÃO transacional: se a flag já estiver marcada,
        // desiste (evita duplicar); senão marca e segue (prefere enviar a perder).
        console.warn('[WhatsApp] Falha ao reivindicar envio (transação):', err);
        try {
          const ref = doc(db, 'orders', order.id);
          const snap = await getDoc(ref);
          if (snap.exists() && (snap.data() as any)?.[flagField]) {
            return { sent: false, skipped: true, reason: 'Envio já reivindicado (fallback).' };
          }
          await updateDoc(ref, { [flagField]: true });
          claimed = true;
        } catch {
          // Sem conseguir nem ler/escrever a flag: envia mesmo assim para não
          // deixar o cliente sem aviso (aceita o risco raro de 1 duplicado).
          claimed = true;
        }
      }
      if (!claimed) {
        return { sent: false, skipped: true, reason: 'Envio já reivindicado por outro dispositivo.' };
      }
    }

    try {
      const token = await user.getIdToken();
      const response = await fetch('/wapi/send-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          empresaId: ownerId,
          phone: order.customerPhone,
          message,
          type: msgType,
          orderId: order.id,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.error) {
        const reason = data?.error || 'API recusou notificacao do pedido.';
        console.warn('[WhatsApp] API recusou notificacao do pedido:', reason, data);
        // Só libera para re-tentativa (sweep) em falha TRANSITÓRIA: limite de
        // taxa (429) ou erro de servidor (5xx). Em rejeição definitiva (ex.:
        // número inválido) mantém reivindicado para não re-enviar em loop.
        const transient = response.status === 429 || response.status >= 500;
        if (transient && flagField && db && order.id) {
          await updateDoc(doc(db, 'orders', order.id), { [flagField]: false }).catch(() => {});
        }
        return { sent: false, skipped: false, reason };
      }
      // Sucesso: a flag já foi marcada na reserva atômica acima.

      return { sent: true, skipped: false };
    } catch (error) {
      console.warn('[WhatsApp] Falha ao enviar notificacao do pedido:', error);
      // Erro de rede: desfaz a reserva para permitir nova tentativa depois.
      if (flagField && db && order.id) {
        await updateDoc(doc(db, 'orders', order.id), { [flagField]: false }).catch(() => {});
      }
      const reason = error instanceof Error ? error.message : 'Falha ao enviar notificacao do pedido.';
      return { sent: false, skipped: false, reason };
    }
  };
  // Mantém o ref da função de envio sempre atualizado (usado pela varredura).
  whatsappSendRef.current = sendOrderWhatsAppNotification;

  const updateOrderStatus = async (orderId: string, statusOrUpdates: string | any) => {
    if (!db || !user) return;
    try {
      const updates = typeof statusOrUpdates === 'string' ? { status: statusOrUpdates } : statusOrUpdates;
      const currentOrder = (ordersRaw as any[])?.find(o => o.id === orderId);
      const finalizingSale = updates.status === 'delivered' && currentOrder && currentOrder.status !== 'delivered';
      const shouldDeductStock = !!(finalizingSale && storeProfile?.general?.enableInventory && currentOrder.stockDeducted !== true);
      
      // Sincronização de Cliente quando o pedido é finalizado (entregue).
      // Conta o pedido de forma IDEMPOTENTE (não duplica entre PCs/re-disparos).
      if (role === 'owner' && finalizingSale && currentOrder) {
        try {
          await syncCustomerFromOrder(db, currentOrder, { ownerId, countOrder: true });
        } catch (err) {
          console.error('Erro ao sincronizar cliente (entrega):', err);
        }
      }

      if (updates.status === 'canceled' && currentOrder && currentOrder.status !== 'canceled') {
        // Devolve ao estoque o que o pedido reservou e grava o cancelamento (atômico).
        const res = await releaseOrderStock(db, {
          enableInventory: !!storeProfile?.general?.enableInventory,
          alreadyDeducted: currentOrder.stockDeductedItems,
          order: { ref: doc(db, 'orders', orderId), mode: 'update', data: updates },
        });
        toast({ title: "Status Atualizado", description: res.changed ? "O pedido foi cancelado e o estoque foi retornado." : "O pedido foi cancelado." });
        // Avisa o cliente do cancelamento pelo WhatsApp (anti-duplicação via flag).
        await sendOrderWhatsAppNotification({ ...currentOrder, ...updates }, 'canceled');
        return true;
      }

      if (shouldDeductStock) {
        // Pedido sendo finalizado sem ter sido abatido antes: abate agora (atômico).
        await reconcileOrderStock(db, {
          enableInventory: true,
          targetItems: currentOrder.items || [],
          alreadyDeducted: currentOrder.stockDeductedItems,
          order: { ref: doc(db, 'orders', orderId), mode: 'update', data: updates },
        });
      } else {
        await updateDoc(doc(db, 'orders', orderId), updates);
      }
      toast({ title: "Status Atualizado", description: "O pedido foi atualizado." });
      if (updates.status && currentOrder?.status !== updates.status) {
        const notificationResult = await sendOrderWhatsAppNotification({ ...currentOrder, ...updates }, updates.status);
        if (notificationResult.sent && updates.status === 'out_for_delivery') {
          toast({ title: 'WhatsApp enviado', description: 'Mensagem de saiu para entrega enviada ao cliente.' });
        } else if (!notificationResult.skipped && notificationResult.reason && updates.status === 'out_for_delivery') {
          toast({ variant: 'destructive', title: 'WhatsApp nao enviado', description: notificationResult.reason });
        }
      }
      return true;
    } catch (err: any) {
      console.error(err);
      const isStock = err instanceof InsufficientStockError;
      toast({ variant: "destructive", title: isStock ? "Estoque insuficiente" : "Erro ao atualizar", description: isStock ? err.message : "Falha na comunicação." });
      return false;
    }
  };



  // O guard do (sistema)/layout só monta esta página com sessão e db prontos;
  // este return não executa na prática — repõe o narrowing de tipos que o
  // antigo gate da página única fazia (db: Firestore | null → Firestore).
  if (!db || !user) return null;

  if (storeProfileError || adminSecretError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-100 p-6 text-center">
        <ShieldAlert className="h-10 w-10 text-amber-500" />
        <p className="font-semibold text-slate-800">Não foi possível carregar as permissões do PDV.</p>
        <p className="max-w-md text-sm text-slate-500">Confira a conexão e tente novamente. O PDV permanece bloqueado até a verificação terminar.</p>
        <button className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700" onClick={() => window.location.reload()}>
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <>
    <div className="admin-scale h-screen bg-slate-100 flex overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0 transition-all duration-300 relative z-0">
        {/* Dark Top Navigation Bar */}
        <div className="bg-[#2a3042] text-slate-300 h-14 flex justify-between items-center pr-4 pl-2 shrink-0 shadow-sm z-10">
          <div className="flex h-full items-center">
            {!permissionsResolved ? (
              <div className="flex items-center gap-3 px-3" aria-label="Carregando permissões do PDV">
                <div className="h-7 w-20 animate-pulse rounded bg-white/10" />
                <div className="h-7 w-24 animate-pulse rounded bg-white/10" />
                <div className="h-7 w-20 animate-pulse rounded bg-white/10" />
              </div>
            ) : (
              <>
                {eligibleTabs.includes('caixa') && (
                  <button onClick={() => handleTabChange('caixa')} className={`px-6 h-full flex items-center text-sm font-medium transition-colors ${visibleActiveTab === 'caixa' ? 'bg-slate-100 text-slate-800' : 'hover:bg-white/10'}`}>
                    Caixa
                  </button>
                )}
                {eligibleTabs.includes('delivery') && (
                  <button onClick={() => handleTabChange('delivery')} className={`px-6 h-full flex items-center text-sm font-medium transition-colors ${visibleActiveTab === 'delivery' ? 'bg-slate-100 text-slate-800' : 'hover:bg-white/10'}`}>
                    Delivery
                  </button>
                )}
                {eligibleTabs.includes('novo_pedido') && (
                  <button onClick={() => handleTabChange('novo_pedido')} className={`px-6 h-full flex items-center text-sm font-medium transition-colors ${visibleActiveTab === 'novo_pedido' ? 'bg-slate-100 text-slate-800' : 'hover:bg-white/10'}`}>
                    Balcão
                  </button>
                )}
                {eligibleTabs.includes('mesas') && (
                  <button onClick={() => handleTabChange('mesas')} className={`relative px-6 h-full flex items-center text-sm font-medium transition-colors ${visibleActiveTab === 'mesas' ? 'bg-slate-100 text-slate-800' : 'hover:bg-white/10'}`}>
                    Mesa
                    {(() => {
                      const novosOnlineMesa = (orders as any[]).filter(
                        (order) => order.orderType === 'dine_in' && order.source === 'cardapio' && order.status === 'pending' && !order.accepted,
                      ).length;
                      return novosOnlineMesa > 0 ? (
                        <span className="absolute top-2 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 animate-pulse shadow">
                          {novosOnlineMesa}
                        </span>
                      ) : null;
                    })()}
                  </button>
                )}
                {eligibleTabs.includes('encomendas_pedidos') && (
                  <button onClick={() => handleTabChange('encomendas_pedidos')} className={`relative px-6 h-full flex items-center text-sm font-medium transition-colors ${visibleActiveTab === 'encomendas_pedidos' ? 'bg-slate-100 text-slate-800' : 'hover:bg-white/10'}`}>
                    Encomendas
                    {(() => {
                      const novasEncomendas = (encomendasRaw as any[] | null || []).filter(
                        (encomenda) => (encomenda.status || 'orcamento') === 'orcamento',
                      ).length;
                      return novasEncomendas > 0 ? (
                        <span className="absolute top-2 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 animate-pulse shadow">
                          {novasEncomendas}
                        </span>
                      ) : null;
                    })()}
                  </button>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-3 h-full">
            {!permissionsResolved ? (
              <div className="h-7 w-52 animate-pulse rounded bg-white/10" aria-label="Carregando controles" />
            ) : (
              <>
                {adminSecretResolved && hasRetaguardaAccess && can(permissions, 'global.botaoRetaguarda') && (
                  <button onClick={handleOpenRetaguarda} className="flex items-center gap-1.5 text-sm font-medium hover:text-white transition-colors" title="Abrir a Retaguarda (produtos, relatórios, perfil da loja)">
                    <Settings className="h-4 w-4" /> Retaguarda
                  </button>
                )}

                <div className="h-6 w-px bg-white/10" />
                <div className="flex items-center gap-2">
                  <Badge className={`border-0 rounded-sm px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider ${caixaAberto ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-red-500 hover:bg-red-600'}`}>
                    {caixaAberto ? 'Aberto' : 'Fechado'}
                  </Badge>
                  {can(permissions, 'global.toggleDelivery') && (
                    <button
                      onClick={handleToggleDelivery}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all border ${
                        isDeliveryDisabled
                          ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                          : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                      }`}
                      title={isDeliveryDisabled ? 'Ligar Delivery' : 'Desligar Delivery'}
                    >
                      <span>🛵</span>
                      <span>Delivery: {isDeliveryDisabled ? 'DESLIGADO' : 'LIGADO'}</span>
                    </button>
                  )}
                </div>
              </>
            )}
            <div className="h-6 w-px bg-white/10" />
            <button onClick={handleLogout} className="text-sm font-medium hover:text-white transition-colors">Sair</button>
          </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 p-2 overflow-hidden flex flex-col min-h-0">
        {!permissionsResolved && (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-32 w-full max-w-xl animate-pulse rounded-xl bg-slate-200" />
          </div>
        )}

        {permissionsResolved && eligibleTabs.length === 0 && (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="max-w-lg rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
              <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" />
              <h1 className="mt-4 text-xl font-bold text-slate-800">Nenhuma aba liberada</h1>
              <p className="mt-2 text-sm text-slate-600">
                {hasRetaguardaAccess
                  ? 'Ajuste as permissões na Retaguarda para voltar a operar.'
                  : 'Peça ao administrador da loja para liberar ao menos uma função.'}
              </p>
              {hasRetaguardaAccess && (
                <button onClick={handleRecoveryRetaguarda} className="mt-5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                  Abrir Retaguarda
                </button>
              )}
            </div>
          </div>
        )}

        {visibleActiveTab === 'delivery' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <DeliveryTab 
              db={db}
              user={user}
              orders={deliveryOrders || []}
              updateOrderStatus={updateOrderStatus} 
              registrarLancamento={registrarLancamento}
              caixaAberto={!!caixaAberto}
              isCaixaHistorico={!!caixaSelecionadoId}
              onOpenCaixa={handleOpenCaixa}
              storeProfile={storeProfile}
              items={items || []}
              categories={categories || []}
              addons={addons || []}
              addonCategories={addonCategories || []}
              permissions={permissions}
            />
          </div>
        )}

        {visibleActiveTab === 'caixa' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <CaixaTab
              storeProfile={storeProfile}
              orders={orders || []}
              allOrders={ordersRawSorted || []}
              autoOpenAbrirCaixa={autoOpenAbrirCaixa}
              onModalOpened={() => setAutoOpenAbrirCaixa(false)}
              selectedCaixaId={caixaSelecionadoId}
              onSelectedCaixaIdChange={setCaixaSelecionadoId}
              updateOrderStatus={updateOrderStatus}
              permissions={permissions}
            />
          </div>
        )}

        {visibleActiveTab === 'novo_pedido' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <NovoPedidoTab 
            categories={sortedProductCategories || []} 
            items={items || []} 
            db={db} 
            user={user}
            registrarLancamento={registrarLancamento}
            caixaAberto={!!caixaAberto}
            storeProfile={storeProfile}
            addons={addons || []}
            addonCategories={addonCategories || []}
            onOpenCaixa={handleOpenCaixa}
            permissions={permissions}
          />
          </div>
        )}

        {visibleActiveTab === 'mesas' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <MesasTab
            orders={orders || []}
            categories={sortedProductCategories || []}
            items={items || []}
            db={db}
            user={user}
            registrarLancamento={registrarLancamento}
            caixaAberto={!!caixaAberto}
            storeInfo={storeProfile}
            addons={addons || []}
            addonCategories={addonCategories || []}
            onOpenCaixa={handleOpenCaixa}
            onUnsavedChangesChange={setHasUnsavedMesaChanges}
            permissions={permissions}
          />
          </div>
        )}


        {visibleActiveTab === 'encomendas_pedidos' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <EncomendasPedidosTab db={db} user={user} storeProfile={storeProfile}
              registrarLancamento={registrarLancamento} caixaAberto={!!caixaAberto} permissions={permissions} />
          </div>
        )}


      </div>

      </div>
    </div>

    {adminSecret && (
      <AdminPasswordDialog
        open={passwordDialogPurpose !== null}
        onOpenChange={(open) => {
          if (!open) setPasswordDialogPurpose(null);
        }}
        secret={adminSecret}
        title="Abrir Retaguarda"
        description="Digite a senha do administrador para acessar configurações e relatórios."
        onSuccess={() => {
          const purpose = passwordDialogPurpose;
          setPasswordDialogPurpose(null);
          if (purpose === 'gestao' || purpose === 'recovery') {
            const canOpen = purpose === 'recovery'
              ? permissionsResolved && eligibleTabs.length === 0 && hasRetaguardaAccess
              : permissionsResolved && hasRetaguardaAccess && can(permissions, 'global.botaoRetaguarda');
            if (!canOpen) {
              toast({ variant: 'destructive', title: 'Permissão removida pelo administrador' });
              return;
            }
            unlockAdminSession(user.uid, adminSecret);
            router.push('/gestao');
          }
        }}
      />
    )}

    {role === 'owner' && db && isRealUser && !storeProfileLoading && !storeProfileError && !wizardDismissed && !storeProfile?.onboardingCompleted && (
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
