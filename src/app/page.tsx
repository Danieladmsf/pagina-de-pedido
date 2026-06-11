'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useFirestore, useCollection, useMemoFirebase, useUser, useDoc, useAuth } from '@/firebase';
import { collection, doc, deleteDoc, setDoc, updateDoc, orderBy, query, where, writeBatch, getDocs, runTransaction } from 'firebase/firestore';
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
import { Pencil, Trash2, Plus, LayoutDashboard, Utensils, Tag, LogOut, Loader2, ShieldAlert, ShoppingBag, Clock, CheckCircle2, User, MapPin, Phone, ExternalLink, Upload, BarChart3, TrendingUp, Users, ChevronDown, ChevronRight, Wallet, Store, GripVertical, Search, Copy } from 'lucide-react';
import { CaixaTab } from '@/components/caixa/CaixaTab';
import { DashboardTab } from '@/components/admin/DashboardTab';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import confetti from 'canvas-confetti';
import { Badge } from '@/components/ui/badge';
import { CurrencyInput } from '@/components/ui/currency-input';
import { DeliveryTab } from '@/components/admin/DeliveryTab';
import { NovoPedidoTab } from '@/components/admin/NovoPedidoTab';
import { MesasTab } from '@/components/admin/MesasTab';
import { ClientesTab } from '@/components/admin/ClientesTab';
import { StoreProfileTab } from '@/components/admin/StoreProfileTab';
import { SidebarNav } from '@/components/admin/SidebarNav';
import { WelcomeWizard } from '@/components/admin/WelcomeWizard';
import { AppearanceTab } from '@/components/admin/AppearanceTab';
import { WhatsAppTab } from '@/components/admin/WhatsAppTab';
import { PromotionsTab } from '@/components/admin/PromotionsTab';
import { CampanhasTab } from '@/components/campanhas/CampanhasTab';
import { FreelanceTab } from '@/components/admin/FreelanceTab';
import { CATS, ITEMS, ADDONS } from '@/lib/seedData';
import { normalizeCreditPhone, getPhoneVariants } from '@/lib/customer-credit';
import { ComboModal } from '@/components/admin/ComboModal';
import { printOrderReceipt } from '@/lib/order-receipt-html';
import { ProductModal } from '@/components/admin/ProductModal';
import { useCaixa } from '@/hooks/useCaixa';
import { Switch } from '@/components/ui/switch';
import { Settings, MessageCircle, MapPinned, Box, Menu, HelpCircle } from 'lucide-react';
import { buildStoreLink, formatWorkingHours, getWhatsAppMessages, renderWhatsAppTemplate } from '@/lib/whatsapp-messages';
import { removeAccents } from '@/lib/utils';
import { uploadImage } from '@/lib/upload';
import { MENU_VISIBILITY_TOGGLES, getToggleUpdate, hasAnyVisibleToggle, isToggleActive } from '@/lib/menu-visibility';
import { reconcileOrderStock, releaseOrderStock, InsufficientStockError } from '@/lib/inventory';
import { warmupQz, type PrinterSize } from '@/lib/qz-print';
import { createConcurrencyQueue } from '@/lib/throttle-queue';
import { syncCustomerFromOrder } from '@/lib/customers/customer-sync';

// Fila global (por aba) que limita os envios de WhatsApp simultâneos, evitando
// estourar o limite de taxa da w-api numa rajada de pedidos.
const whatsappQueue = createConcurrencyQueue(3);

export default function AdminPage() {
  const db = useFirestore();
  const auth = useAuth();
  const router = useRouter();
  const { toast, dismiss } = useToast();
  const { user, isUserLoading } = useUser();
  const [activeTab, setActiveTab] = useState<string>('delivery');
  const [hasUnsavedMesaChanges, setHasUnsavedMesaChanges] = useState(false);

  // Esquenta a conexão com o QZ Tray (impressão silenciosa) uma vez por sessão.
  // Se o QZ não estiver no PC, isto não faz nada — a impressão segue por window.print().
  useEffect(() => {
    warmupQz();
  }, []);

  // ── Varredura de re-tentativa de WhatsApp ──
  // A cada 30s, re-tenta o aviso de "pedido recebido" para pedidos recentes que
  // ainda não foram notificados (falha transitória, limite de taxa, ou pedido que
  // chegou enquanto este PC recarregava). A reserva atômica + a fila garantem que
  // só sai 1 mensagem por pedido, sem estourar o limite da w-api. A janela de 30min
  // evita re-tentar pedidos antigos para sempre.
  useEffect(() => {
    if (!db || !user) return;
    const id = setInterval(() => {
      const send = whatsappSendRef.current;
      const list = ordersForSweepRef.current;
      if (!send || !list) return;
      const now = Date.now();
      for (const o of list) {
        if (!o || o.source === 'pdv' || !o.customerPhone) continue;
        if (o.receivedMessageSent === true || o.status === 'canceled') continue;
        if (!o.orderDateTime) continue;
        if (now - new Date(o.orderDateTime).getTime() > 30 * 60 * 1000) continue;
        void whatsappQueue(() => send(o, 'received'));
      }
    }, 30000);
    return () => clearInterval(id);
  }, [db, user]);

  // Synchronize history state with activeTab
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (event.state && event.state.type === 'admin-tab') {
        setActiveTab(event.state.tab);
      }
    };
    window.addEventListener('popstate', handlePopState);
    
    // Replace initial state with current tab if no state exists
    if (!window.history.state) {
      window.history.replaceState({ type: 'admin-tab', tab: activeTab }, '');
    }

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [activeTab]);

  const handleTabChange = (newTab: string) => {
    if (hasUnsavedMesaChanges) {
      if (!confirm('Você tem alterações não salvas na Mesa. Se sair, essas alterações serão perdidas. Deseja sair?')) {
        return;
      }
      setHasUnsavedMesaChanges(false);
    }
    setActiveTab(newTab);
    const currentState = window.history.state;
    if (!currentState || currentState.type !== 'admin-tab' || currentState.tab !== newTab) {
      window.history.pushState({ type: 'admin-tab', tab: newTab }, '');
    }
  };
  const [autoOpenAbrirCaixa, setAutoOpenAbrirCaixa] = useState(false);
  const [caixaSelecionadoId, setCaixaSelecionadoId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [wizardDismissed, setWizardDismissed] = useState(false);
  // Estados para modal de Categoria
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  
  // Estados para configuração de disponibilidade da categoria
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [isCategoryConfigModalOpen, setIsCategoryConfigModalOpen] = useState(false);
  const [isCelebrating, setIsCelebrating] = useState(false);
  const newClientToastIdRef = useRef<string | null>(null);
  
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
  
  // Hook do Caixa compartilhado entre módulos
  const { caixaAberto, registrarLancamento, caixaAtual } = useCaixa({
    caixaSelecionadoId,
    onCaixaSelecionadoIdChange: setCaixaSelecionadoId,
  });
  
  const isRealUser = !!(user && !user.isAnonymous);

  const adminRoleRef = useMemoFirebase(() => (db && isRealUser) ? doc(db, 'roles_admin', user!.uid) : null, [db, isRealUser]);
  const { data: adminRole, isLoading: loadingRole } = useDoc(adminRoleRef);

  // Consultas filtradas pelo UID do dono (Multi-tenancy) com checagem de DB
  const categoriesQuery = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return query(collection(db, 'categories'), where('ownerId', '==', user!.uid));
  }, [db, isRealUser]);

  const itemsQuery = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return query(collection(db, 'menuItems'), where('ownerId', '==', user!.uid));
  }, [db, isRealUser]);

  const ordersQuery = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return query(collection(db, 'orders'), where('ownerId', '==', user!.uid));
  }, [db, isRealUser]);

  const addonsQuery = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return query(collection(db, 'addons'), where('ownerId', '==', user!.uid));
  }, [db, isRealUser]);

  const addonCategoriesQuery = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return query(collection(db, 'addonCategories'), where('ownerId', '==', user!.uid));
  }, [db, isRealUser]);

  const storeProfileRef = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return doc(db, 'store_profiles', user!.uid);
  }, [db, isRealUser]);

  const { data: storeProfile, isLoading: storeProfileLoading } = useDoc(storeProfileRef);

  const { data: categories, isLoading: loadingCats } = useCollection(categoriesQuery);
  const { data: addonCategories, isLoading: loadingAddonCats } = useCollection(addonCategoriesQuery);
  const { data: items, isLoading: loadingItems } = useCollection(itemsQuery);
  const { data: ordersRaw, isLoading: loadingOrders, error: ordersError } = useCollection(ordersQuery);

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



  const seenOrderIdsRef = useRef<Set<string> | null>(null);
  const whatsappWebhookSyncRef = useRef(false);
  // Refs para a varredura de re-tentativa de WhatsApp (evita closure velha no setInterval).
  const whatsappSendRef = useRef<((order: any, status: string) => Promise<any>) | null>(null);
  const ordersForSweepRef = useRef<any[] | null>(null);
  ordersForSweepRef.current = (ordersRaw as any[]) || null;

  useEffect(() => {
    if (!user || !isRealUser || whatsappWebhookSyncRef.current) return;
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
          body: JSON.stringify({ empresaId: user.uid }),
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
  }, [user, isRealUser]);

  const playLoudAudio = React.useCallback(async (volumeMultiplier = 4.0, stopAfterMs?: number) => {
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!(window as any)._sharedAudioCtx) {
        (window as any)._sharedAudioCtx = new AudioCtx();
      }
      const ctx = (window as any)._sharedAudioCtx as AudioContext;
      if (ctx.state === 'suspended') await ctx.resume();

      if (!(window as any)._cachedAudioBuffer) {
        const response = await fetch('/foodora.mp3');
        const arrayBuffer = await response.arrayBuffer();
        (window as any)._cachedAudioBuffer = await ctx.decodeAudioData(arrayBuffer);
      }

      if ((window as any)._currentAudioSource) {
        try {
          (window as any)._currentAudioSource.stop();
        } catch(e) {}
      }

      const source = ctx.createBufferSource();
      (window as any)._currentAudioSource = source;
      source.buffer = (window as any)._cachedAudioBuffer;
      const gainNode = ctx.createGain();
      gainNode.gain.value = volumeMultiplier; // Amplifica o volume
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      // Modo "automático com som": toca em loop e corta exatamente em stopAfterMs
      // (ex.: 6s), independente da duração do MP3.
      if (stopAfterMs && stopAfterMs > 0) source.loop = true;
      source.start(0);
      if (stopAfterMs && stopAfterMs > 0) {
        setTimeout(() => { try { source.stop(); } catch {} }, stopAfterMs);
      }
    } catch (e) {
      console.error('Erro ao tocar audio:', e);
    }
  }, []);

  const playNewOrderBeep = React.useCallback(() => {
    playLoudAudio(4.0);
  }, [playLoudAudio]);

  // Modo "automático com som": toca o alerta por ~12 segundos e para sozinho.
  const playOrderSound6s = React.useCallback(() => {
    playLoudAudio(4.0, 12000);
  }, [playLoudAudio]);

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
      const isManualPrint = !!(storeProfile?.general?.manualPrint || storeProfile?.manualPrint);
      // printMode: 'auto_silent' | 'auto_sound' | 'manual'. Deriva do legado
      // manualPrint quando o perfil ainda não tem o campo novo.
      const printMode = storeProfile?.general?.printMode || (storeProfile as any)?.printMode
        || (isManualPrint ? 'manual' : 'auto_silent');
      if (printMode === 'manual') {
        playNewOrderBeep();
      } else if (printMode === 'auto_sound') {
        playOrderSound6s();
      }
      toast({ title: `Novo pedido recebido!`, description: `${pendingNewOnes.length} pedido(s) aguardando confirmação.` });
      try {
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          new Notification('Novo pedido!', { body: `${pendingNewOnes.length} pedido(s) aguardando confirmação.` });
        }
      } catch {}

      // ── Impressão Automática de Pedidos (INTELIGENTE) ──
      // Só imprime automaticamente onde há impressão silenciosa de verdade (QZ
      // Tray instalado nesta máquina). Sem QZ, NÃO cai no window.print() — assim
      // um PC de monitoramento, sem impressora, não abre o modal do navegador a
      // cada pedido. (Os botões manuais seguem imprimindo normalmente.)
      if (typeof window !== 'undefined' && !(storeProfile?.general?.manualPrint || storeProfile?.manualPrint)) {
        const printerSize = ((storeProfile?.general?.printerSize || storeProfile?.printerSize) === '58mm' ? '58mm' : '80mm') as PrinterSize;
        pendingNewOnes.forEach((ord: any, index: number) => {
          setTimeout(() => {
            // Fallback no-op: sem QZ nesta máquina = não imprime automático (sem modal).
            printOrderReceipt({
              order: ord,
              storeInfo: storeProfile,
              printerSize,
              fallback: () => console.info('[QZ] sem impressão silenciosa nesta máquina → pedido NÃO impresso automaticamente (sem modal). Use os botões manuais se precisar.'),
            });
          }, index * 2000);
        });
      }

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
          const res = await syncCustomerFromOrder(db, order, { ownerId: user.uid, countOrder: false });
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
        } catch (err) {
          console.error("Erro ao sincronizar cliente automático:", err);
        }
      }
    };
    void processIncomingOrders();

    seenOrderIdsRef.current = currentIds;
  }, [ordersRaw, playNewOrderBeep, playOrderSound6s, toast, db, user, storeProfile]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Efeito do confete contínuo e limpeza da notificação
  useEffect(() => {
    if (activeTab === 'delivery' && newClientToastIdRef.current) {
      dismiss(newClientToastIdRef.current);
      newClientToastIdRef.current = null;
    }

    if (!isCelebrating) return;

    let duration = activeTab === 'delivery' ? 4000 : 9999999;
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
  }, [isCelebrating, activeTab]);

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

  // Higiene: containers podem acumular IDs de adicionais que foram excluídos
  // da Lista Matriz (vínculo fica órfão no addonIds). Limpa uma vez por
  // sessão, só nos containers do próprio dono, quando os dois datasets
  // chegaram completos.
  const danglingCleanupDoneRef = React.useRef(false);
  useEffect(() => {
    if (danglingCleanupDoneRef.current) return;
    if (!db || !isRealUser || !addons || !addonCategories) return;
    danglingCleanupDoneRef.current = true;
    const validIds = new Set((addons as any[]).map((a: any) => a.id));
    const dirty = (addonCategories as any[]).filter((c: any) =>
      c.ownerId === user!.uid &&
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
  }, [db, isRealUser, user, addons, addonCategories]);

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

  const reportData = React.useMemo(() => {
    if (!orders) return null;
    const now = new Date();
    let from: Date;
    let to: Date = new Date(now);
    to.setHours(23, 59, 59, 999);
    if (reportPeriod === 'today') { from = new Date(now); from.setHours(0, 0, 0, 0); }
    else if (reportPeriod === '7d') { from = new Date(now); from.setDate(now.getDate() - 7); }
    else if (reportPeriod === '30d') { from = new Date(now); from.setDate(now.getDate() - 30); }
    else if (reportPeriod === 'custom') {
      from = customFrom ? new Date(customFrom + 'T00:00:00') : new Date(0);
      to = customTo ? new Date(customTo + 'T23:59:59') : new Date(now);
    }
    else { from = new Date(0); }

    const filtered = orders.filter((o: any) => {
      const d = new Date(o.orderDateTime);
      return d >= from && d <= to;
    });
    const revenue = filtered.reduce((s: number, o: any) => s + (o.totalAmount || 0), 0);
    const avgTicket = filtered.length ? revenue / filtered.length : 0;

    const byCustomer: Record<string, { name: string; phone: string; count: number; total: number; orders: any[] }> = {};
    filtered.forEach((o: any) => {
      const key = o.customerPhone || o.customerName || o.id;
      if (!byCustomer[key]) byCustomer[key] = { name: o.customerName || '-', phone: o.customerPhone || '-', count: 0, total: 0, orders: [] };
      byCustomer[key].count++;
      byCustomer[key].total += o.totalAmount || 0;
      byCustomer[key].orders.push(o);
    });
    const customers = Object.entries(byCustomer).map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.total - a.total);

    const byItem: Record<string, { name: string; qty: number; revenue: number; occurrences: any[] }> = {};
    filtered.forEach((o: any) => {
      (o.items || []).forEach((it: any) => {
        if (!byItem[it.name]) byItem[it.name] = { name: it.name, qty: 0, revenue: 0, occurrences: [] };
        byItem[it.name].qty += it.quantity || 0;
        byItem[it.name].revenue += (it.unitPrice || 0) * (it.quantity || 0);
        byItem[it.name].occurrences.push({
          orderId: o.id,
          customerName: o.customerName,
          customerPhone: o.customerPhone,
          orderDateTime: o.orderDateTime,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          addons: it.addons,
          notes: it.notes,
        });
      });
    });
    const topItems = Object.values(byItem).sort((a, b) => b.qty - a.qty).slice(0, 10);

    const byDay: Record<string, { date: string; revenue: number; count: number }> = {};
    filtered.forEach((o: any) => {
      const d = new Date(o.orderDateTime);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!byDay[key]) byDay[key] = { date: key, revenue: 0, count: 0 };
      byDay[key].revenue += o.totalAmount || 0;
      byDay[key].count++;
    });
    const dailyBreakdown = Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date));

    return { revenue, count: filtered.length, avgTicket, customers, topItems, dailyBreakdown };
  }, [orders, reportPeriod, customFrom, customTo]);

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

  const [deliveryFeeValue, setDeliveryFeeValue] = useState<number>(0);
  useEffect(() => {
    if (adminRole && typeof (adminRole as any).deliveryFee === 'number') {
      setDeliveryFeeValue((adminRole as any).deliveryFee);
    }
  }, [adminRole]);
  const saveDeliveryFee = async () => {
    if (!db || !user) return;
    try {
      await setDoc(doc(db, 'roles_admin', user.uid), { deliveryFee: deliveryFeeValue }, { merge: true });
      toast({ title: 'Taxa de entrega salva', description: `R$ ${deliveryFeeValue.toFixed(2)}` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro ao salvar', description: err?.message || 'Falha.' });
    }
  };

  const isDeliveryDisabled = storeProfile?.general?.disableDelivery || false;

  const handleToggleDelivery = async () => {
    if (!db || !user || !storeProfileRef) return;
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
    if (!['received', 'ready', 'out_for_delivery'].includes(status)) {
      return { sent: false, skipped: true, reason: 'Status sem notificacao automatica.' };
    }

    if (status === 'received') {
      if (order.receivedMessageSent) {
        console.log('[WhatsApp] Mensagem de recebido ja enviada para o pedido:', order.id);
        return { sent: false, skipped: true, reason: 'Mensagem de recebido ja enviada.' };
      }
    }

    if (status === 'out_for_delivery') {
      if (order.outForDeliveryMessageSent) {
        console.log('[WhatsApp] Mensagem de saiu para entrega ja enviada para o pedido:', order.id);
        return { sent: false, skipped: true, reason: 'Mensagem de saiu para entrega ja enviada.' };
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
    const feeStr = `R$ ${feeVal.toFixed(2).replace('.', ',')}`;

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
      | 'orderReadyDelivery'
      | 'orderReadyPickup'
      | 'orderReadyDineIn'
      | 'orderOutForDelivery'
      | 'orderPickupReady'
      | 'orderDineInReady'
      | null = null;

    if (status === 'received') {
      templateKey = 'orderReceived';
      msgType = 'order_created';
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
        link: buildStoreLink(storeProfile, user.uid, typeof window !== 'undefined' ? window.location.origin : undefined),
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
      : status === 'out_for_delivery' ? 'outForDeliveryMessageSent'
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
        // Falha de transação (rede): segue para não PERDER a mensagem (prefere
        // arriscar um raro duplicado a deixar o cliente sem aviso).
        console.warn('[WhatsApp] Falha ao reivindicar envio (transação):', err);
        claimed = true;
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
          empresaId: user.uid,
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
      if (finalizingSale && currentOrder) {
        try {
          await syncCustomerFromOrder(db, currentOrder, { ownerId: user.uid, countOrder: true });
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
        <p className="text-xs font-mono bg-muted p-2 rounded mb-4">Seu UID: {user.uid}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.location.reload()}>🔄 Tentar novamente</Button>
          <Button onClick={handleLogout}>Sair e Trocar Conta</Button>
        </div>
      </div>
    );
  }

  const storeLink = user && typeof window !== 'undefined' ? buildStoreLink(storeProfile, user.uid, window.location.origin) : '';

  return (
    <>
    <div className="admin-scale h-screen bg-slate-100 flex overflow-hidden">
      <SidebarNav activeTab={activeTab} setActiveTab={handleTabChange} isOpen={isSidebarOpen} setIsOpen={setIsSidebarOpen} storeName={storeProfile?.general?.name} storeLogo={storeProfile?.general?.logoUrl} />
      <div className="flex-1 flex flex-col min-w-0 transition-all duration-300 relative z-0">
        {/* Dark Top Navigation Bar */}
        <div className="bg-[#2a3042] text-slate-300 h-14 flex justify-between items-center pr-4 pl-14 shrink-0 shadow-sm z-10">
          <div className="flex h-full items-center">
            <button
              onClick={() => handleTabChange('caixa')}
              className={`px-6 h-full flex items-center text-sm font-medium transition-colors ${activeTab === 'caixa' ? 'bg-slate-100 text-slate-800' : 'hover:bg-white/10'}`}
            >
            Caixa
          </button>
          <button 
            onClick={() => handleTabChange('delivery')}
            className={`px-6 h-full flex items-center text-sm font-medium transition-colors ${activeTab === 'delivery' ? 'bg-slate-100 text-slate-800' : 'hover:bg-white/10'}`}
          >
            Delivery
          </button>
          <button 
            onClick={() => handleTabChange('novo_pedido')}
            className={`px-6 h-full flex items-center text-sm font-medium transition-colors ${activeTab === 'novo_pedido' ? 'bg-slate-100 text-slate-800' : 'hover:bg-white/10'}`}
          >
            Balcão
          </button>
          <button
            onClick={() => handleTabChange('mesas')}
            className={`relative px-6 h-full flex items-center text-sm font-medium transition-colors ${activeTab === 'mesas' ? 'bg-slate-100 text-slate-800' : 'hover:bg-white/10'}`}
          >
            Mesa
            {(() => {
              const novosOnlineMesa = (orders as any[]).filter(
                (o) => o.orderType === 'dine_in' && o.source === 'cardapio' && o.status === 'pending' && !o.accepted
              ).length;
              if (novosOnlineMesa === 0) return null;
              return (
                <span className="absolute top-2 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 animate-pulse shadow">
                  {novosOnlineMesa}
                </span>
              );
            })()}
          </button>
        </div>
        
        <div className="flex items-center gap-4 h-full">
          <div className="flex items-center gap-2">
            <Badge className={`border-0 rounded-sm px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider ${caixaAberto ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-red-500 hover:bg-red-600'}`}>
              {caixaAberto ? 'Aberto' : 'Fechado'}
            </Badge>
            <button
              onClick={handleToggleDelivery}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all border ${
                isDeliveryDisabled
                  ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
              }`}
              title={isDeliveryDisabled ? "Ligar Delivery" : "Desligar Delivery"}
            >
              <span>🛵</span>
              <span>Delivery: {isDeliveryDisabled ? 'DESLIGADO' : 'LIGADO'}</span>
            </button>
          </div>
          <div className="h-6 w-[1px] bg-white/10 mx-1"></div>
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

        {activeTab === 'delivery' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <DeliveryTab 
              db={db}
              user={user}
              orders={deliveryOrders || []}
              updateOrderStatus={updateOrderStatus} 
              registrarLancamento={registrarLancamento}
              caixaAberto={!!caixaAberto}
              isCaixaHistorico={!!caixaSelecionadoId}
              onOpenCaixa={() => { setAutoOpenAbrirCaixa(true); handleTabChange('caixa'); }}
              storeProfile={storeProfile}
              items={items || []}
              categories={categories || []}
              addons={addons || []}
              addonCategories={addonCategories || []}
            />
          </div>
        )}

        {activeTab === 'caixa' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <CaixaTab
              storeProfile={storeProfile}
              orders={orders || []}
              allOrders={ordersRawSorted || []}
              autoOpenAbrirCaixa={autoOpenAbrirCaixa}
              onModalOpened={() => setAutoOpenAbrirCaixa(false)}
              selectedCaixaId={caixaSelecionadoId}
              onSelectedCaixaIdChange={setCaixaSelecionadoId}
            />
          </div>
        )}

        {activeTab === 'novo_pedido' && (
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
            onOpenCaixa={() => { setAutoOpenAbrirCaixa(true); handleTabChange('caixa'); }}
          />
          </div>
        )}

        {activeTab === 'mesas' && (
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
            onOpenCaixa={() => { setAutoOpenAbrirCaixa(true); handleTabChange('caixa'); }}
            onUnsavedChangesChange={setHasUnsavedMesaChanges}
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
          ['produtos', 'addons', 'categorias'].includes(activeTab)
            ? 'flex-1 min-h-0 flex flex-col overflow-hidden'
            : ['clientes', 'freelance'].includes(activeTab) || activeTab.startsWith('perfil_')
              ? 'flex-1 min-h-0 overflow-y-auto custom-scrollbar'
              : 'hidden'
        }>
          <div className={
            (activeTab === 'produtos' || activeTab === 'addons' || activeTab === 'categorias')
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
                          >R$ {(item.price || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-center">
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
                    toast({ title: 'Preço atualizado!', description: `${quickPriceEdit.name}: R$ ${newPrice.toFixed(2)}` });
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
                              ownerId: user.uid, 
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
                                      <Button variant="ghost" size="icon" onClick={async () => {
                                        if (!db) return;
                                        if (confirm("Excluir categoria?")) await deleteDoc(doc(db, 'categories', cat.id));
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
                ownerId: user!.uid,
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
            const setAddonGlobalActive = async (addon: any, active: boolean) => {
              if (!db) return;
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
              const addonData = {
                name: formData.get('addonName') as string,
                description: ((formData.get('addonDescription') as string) || '').trim(),
                price: parseFloat(formData.get('addonPrice') as string),
                group: editingAddon?.group || '',
                ownerId: user.uid,
              };
              try {
                let savedAddonId = editingAddon?.id;
                if (editingAddon?.id) {
                  await updateDoc(doc(db, 'addons', editingAddon.id), addonData);
                } else {
                  const newDoc = doc(collection(db, 'addons'));
                  savedAddonId = newDoc.id;
                  await setDoc(newDoc, { ...addonData, id: newDoc.id });
                }
                if (savedAddonId) await syncAddonContainers(savedAddonId, editingAddonContainers);
                setEditingAddon(null);
                toast({ title: 'Sucesso', description: 'Adicional salvo.' });
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
                <div className="flex shrink-0 flex-col border-b bg-white lg:w-[230px] lg:border-b-0 lg:border-r min-h-0 max-h-44 lg:max-h-none">
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
                        className={`w-full justify-between gap-2 rounded-lg flex items-center group ${
                          highlightedContainers.has(g) && addonCategoryFilter !== g
                            ? 'border-orange-400 bg-orange-100 text-orange-700 hover:bg-orange-200'
                            : ''
                        }`}
                      >
                        <span className="truncate">{g}</span>
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
                                  batch.set(newDoc, { id: newDoc.id, name: newName, ownerId: user.uid, addonIds: getLegacyAddonIdsForGroup(oldName), usePrice: true, min: 0, max: 0 });
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
                            await setDoc(newDoc, { id: newDoc.id, name: newAddonCategoryName.trim(), ownerId: user.uid, addonIds: [], usePrice: true, min: 0, max: 0 });
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
                          >R$ {(addon.price || 0).toFixed(2)}</TableCell>
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
                                  if (confirm("Excluir adicional da lista matriz? Isso remove do banco de dados.")) await deleteDoc(doc(db, 'addons', addon.id));
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

          {activeTab === 'dashboard' && (
            <div className="mt-6 space-y-6">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                {([['today', 'Hoje'], ['7d', '7 dias'], ['30d', '30 dias'], ['all', 'Tudo'], ['custom', 'Personalizado']] as const).map(([val, label]) => (
                  <Button
                    key={val}
                    variant={reportPeriod === val ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setReportPeriod(val)}
                    className="rounded-full"
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {reportPeriod === 'custom' && (
                <div className="flex flex-wrap items-end gap-3 p-3 bg-muted/30 rounded-xl">
                  <div className="space-y-1">
                    <Label className="text-xs">De</Label>
                    <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Até</Label>
                    <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-9" />
                  </div>
                  {(customFrom || customTo) && (
                    <Button size="sm" variant="ghost" onClick={() => { setCustomFrom(''); setCustomTo(''); }}>Limpar</Button>
                  )}
                </div>
              )}
            </div>

            {!reportData ? (
              <div className="py-20 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="rounded-2xl border-green-200 shadow-sm">
                    <CardContent className="p-5">
                      <p className="text-[10px] uppercase tracking-wider font-bold text-green-600">Faturamento</p>
                      <p className="text-3xl font-black text-green-700">R$ {reportData.revenue.toFixed(2)}</p>
                    </CardContent>
                  </Card>
                  <Card className="rounded-2xl border-blue-200 shadow-sm">
                    <CardContent className="p-5">
                      <p className="text-[10px] uppercase tracking-wider font-bold text-blue-600">Pedidos</p>
                      <p className="text-3xl font-black text-blue-700">{reportData.count}</p>
                    </CardContent>
                  </Card>
                  <Card className="rounded-2xl border-purple-200 shadow-sm">
                    <CardContent className="p-5">
                      <p className="text-[10px] uppercase tracking-wider font-bold text-purple-600">Ticket Médio</p>
                      <p className="text-3xl font-black text-purple-700">R$ {reportData.avgTicket.toFixed(2)}</p>
                    </CardContent>
                  </Card>
                </div>

                <Card className="rounded-2xl">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><BarChart3 className="h-5 w-5 text-primary" /> Vendas por dia</CardTitle></CardHeader>
                  <CardContent>
                    {reportData.dailyBreakdown.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">Sem vendas no período.</p>
                    ) : (
                      <div className="space-y-2">
                        {(() => {
                          const maxRev = Math.max(...reportData.dailyBreakdown.map(d => d.revenue));
                          return reportData.dailyBreakdown.map((d) => {
                            const pct = maxRev > 0 ? (d.revenue / maxRev) * 100 : 0;
                            const [y, m, day] = d.date.split('-');
                            const label = `${day}/${m}/${y}`;
                            return (
                              <div key={d.date} className="space-y-1">
                                <div className="flex items-center justify-between gap-2 text-sm">
                                  <span className="font-bold">{label}</span>
                                  <span className="text-muted-foreground text-xs">{d.count} pedido{d.count !== 1 ? 's' : ''} → <span className="font-black text-primary">R$ {d.revenue.toFixed(2)}</span></span>
                                </div>
                                <div className="h-2 bg-muted rounded-full overflow-hidden">
                                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-2xl">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><TrendingUp className="h-5 w-5 text-primary" /> Itens mais vendidos</CardTitle></CardHeader>
                  <CardContent>
                    {reportData.topItems.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">Sem vendas no período.</p>
                    ) : (
                      <div className="space-y-2">
                        {reportData.topItems.map((it, idx) => {
                          const isOpen = expandedItem === it.name;
                          return (
                            <div key={it.name} className="border rounded-xl overflow-hidden">
                              <button
                                onClick={() => setExpandedItem(isOpen ? null : it.name)}
                                className="w-full flex items-center justify-between gap-3 p-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  {isOpen ? <ChevronDown className="h-4 w-4 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 flex-shrink-0" />}
                                  <span className="text-lg font-black text-primary w-6">#{idx + 1}</span>
                                  <span className="font-bold truncate">{it.name}</span>
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <p className="text-sm font-black">{it.qty} un.</p>
                                  <p className="text-xs text-muted-foreground">R$ {it.revenue.toFixed(2)}</p>
                                </div>
                              </button>
                              {isOpen && (
                                <div className="p-3 space-y-2 bg-white border-t">
                                  {it.occurrences.map((oc: any, i: number) => (
                                    <div key={i} className="text-xs border-l-2 border-primary/30 pl-3 py-1">
                                      <div className="flex justify-between gap-2 flex-wrap">
                                        <span className="font-bold">{oc.customerName || '-'}</span>
                                        <span className="text-muted-foreground">{new Date(oc.orderDateTime).toLocaleString('pt-BR')}</span>
                                      </div>
                                      <div className="text-muted-foreground">
                                        <span className="font-mono">#{oc.orderId}</span> → {oc.customerPhone || '-'} → <span className="font-bold text-primary">{oc.quantity}x</span> R$ {((oc.unitPrice || 0) * (oc.quantity || 0)).toFixed(2)}
                                      </div>
                                      {oc.addons?.length > 0 && (
                                        <div className="pl-2 text-[11px] text-muted-foreground mt-0.5">
                                          {oc.addons.map((a: any, j: number) => (
                                            <div key={j}>+ {a.name}{typeof a.price === 'number' && a.price > 0 ? ` (R$ ${a.price.toFixed(2)})` : ''}</div>
                                          ))}
                                        </div>
                                      )}
                                      {oc.notes && (
                                        <div className="pl-2 text-[11px] italic text-muted-foreground">Obs: {oc.notes}</div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-2xl">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Users className="h-5 w-5 text-primary" /> Clientes ({reportData.customers.length})</CardTitle></CardHeader>
                  <CardContent>
                    {reportData.customers.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">Sem clientes no período.</p>
                    ) : (
                      <div className="space-y-2">
                        {reportData.customers.map((c) => {
                          const isOpen = expandedCustomer === c.key;
                          return (
                            <div key={c.key} className="border rounded-xl overflow-hidden">
                              <button
                                onClick={() => setExpandedCustomer(isOpen ? null : c.key)}
                                className="w-full flex items-center justify-between gap-3 p-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {isOpen ? <ChevronDown className="h-4 w-4 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 flex-shrink-0" />}
                                  <div className="min-w-0">
                                    <p className="font-bold truncate">{c.name}</p>
                                    <p className="text-xs text-muted-foreground truncate">{c.phone}</p>
                                  </div>
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <p className="text-sm font-black text-primary">R$ {c.total.toFixed(2)}</p>
                                  <p className="text-xs text-muted-foreground">{c.count} pedido{c.count > 1 ? 's' : ''}</p>
                                </div>
                              </button>
                              {isOpen && (
                                <div className="p-3 space-y-3 bg-white border-t">
                                  {c.orders.map((o: any) => {
                                    const sLabel =
                                      o.status === 'pending' ? 'Pendente' :
                                      o.status === 'received' ? 'Recebido' :
                                      o.status === 'ready' ? 'Pronto' :
                                      o.status === 'out_for_delivery' ? 'Saiu p/ entrega' :
                                      o.status === 'delivered' ? 'Concluído' : o.status;
                                    const sColor =
                                      o.status === 'pending' ? 'bg-yellow-100 text-yellow-700 border-yellow-300' :
                                      o.status === 'received' ? 'bg-blue-100 text-blue-700 border-blue-300' :
                                      o.status === 'ready' ? 'bg-green-100 text-green-700 border-green-300' :
                                      o.status === 'out_for_delivery' ? 'bg-purple-100 text-purple-700 border-purple-300' :
                                      'bg-gray-100 text-gray-700 border-gray-300';
                                    return (
                                      <div key={o.id} className="border rounded-xl p-3 bg-muted/10">
                                        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-xs font-mono font-bold text-muted-foreground">#{o.id}</span>
                                            <Badge className={`${sColor} border font-bold text-[10px] uppercase`}>{sLabel}</Badge>
                                            <Badge className="bg-slate-100 text-slate-700 border-slate-300 border font-bold text-[10px] uppercase">
                                              {o.orderType === 'pickup' ? '📦 Retirada' : '🚚 Entrega'}
                                            </Badge>
                                          </div>
                                          <span className="text-xs text-muted-foreground">{new Date(o.orderDateTime).toLocaleString('pt-BR')}</span>
                                        </div>
                                        {o.deliveryAddress && (
                                          <div className="flex items-start gap-1 text-xs text-muted-foreground mb-2">
                                            <MapPin className="h-3 w-3 mt-0.5 shrink-0" /> <span>{o.deliveryAddress}</span>
                                          </div>
                                        )}
                                        <div className="space-y-1.5">
                                          {(o.items || []).map((it: any, i: number) => (
                                            <div key={i} className="text-xs">
                                              <div className="flex justify-between gap-2">
                                                <span><span className="font-bold text-primary">{it.quantity}x</span> {it.name}</span>
                                                <span className="text-muted-foreground whitespace-nowrap">R$ {((it.unitPrice || 0) * (it.quantity || 0)).toFixed(2)}</span>
                                              </div>
                                              {it.addons?.length > 0 && (
                                                <div className="pl-3 text-[11px] text-muted-foreground">
                                                  {it.addons.map((a: any, j: number) => (
                                                    <div key={j}>+ {a.name}{typeof a.price === 'number' && a.price > 0 ? ` (R$ ${a.price.toFixed(2)})` : ''}</div>
                                                  ))}
                                                </div>
                                              )}
                                              {it.notes && (
                                                <div className="pl-3 text-[11px] italic text-muted-foreground">Obs: {it.notes}</div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                        <div className="mt-2 pt-2 border-t border-dashed flex justify-between items-center">
                                          <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Total</span>
                                          <span className="text-sm font-black text-primary">R$ {(o.totalAmount || 0).toFixed(2)}</span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
            </div>
          )}

          {activeTab === 'perfil_aparencia' && (
            <AppearanceTab db={db} user={user} storeProfile={storeProfile} />
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
        userId={user!.uid}
        storeName={storeProfile?.general?.name}
        onComplete={() => setWizardDismissed(true)}
      />
    )}
    </>
  );
}
