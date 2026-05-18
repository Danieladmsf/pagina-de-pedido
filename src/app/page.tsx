'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useFirestore, useCollection, useMemoFirebase, useUser, useDoc, useAuth } from '@/firebase';
import { collection, doc, deleteDoc, setDoc, updateDoc, orderBy, query, where, writeBatch, getDocs, getDoc, increment } from 'firebase/firestore';
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
import { FreelanceTab } from '@/components/admin/FreelanceTab';
import { CATS, ITEMS, ADDONS } from '@/lib/seedData';
import { ComboModal } from '@/components/admin/ComboModal';
import { ProductModal } from '@/components/admin/ProductModal';
import { useCaixa } from '@/hooks/useCaixa';
import { Switch } from '@/components/ui/switch';
import { Settings, MessageCircle, MapPinned, Box, Menu } from 'lucide-react';
import { buildStoreLink, formatWorkingHours, getWhatsAppMessages, renderWhatsAppTemplate } from '@/lib/whatsapp-messages';
import { removeAccents } from '@/lib/utils';

const getManagedStock = (value: unknown): number | null => {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
};

export default function AdminPage() {
  const db = useFirestore();
  const auth = useAuth();
  const router = useRouter();
  const { toast, dismiss } = useToast();
  const { user, isUserLoading } = useUser();
  const [activeTab, setActiveTab] = useState<string>('delivery');
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
    console.log('[admin] building ordersQuery for uid:', user!.uid);
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
    for (const order of orders) merged.set(order.id, order);

    if (!caixaSelecionadoId) {
      for (const order of ordersRawSorted) {
        if (!['delivered', 'canceled'].includes(order.status)) {
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

  useEffect(() => {
    console.log('[admin] user:', user?.uid, 'isRealUser:', isRealUser);
    console.log('[admin] orders loading:', loadingOrders, 'count:', ordersRaw?.length, 'error:', ordersError);
    if (ordersRaw) console.log('[admin] orders data:', ordersRaw);
  }, [user, isRealUser, loadingOrders, ordersRaw, ordersError]);

  const seenOrderIdsRef = useRef<Set<string> | null>(null);
  const whatsappWebhookSyncRef = useRef(false);

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

  const playLoudAudio = React.useCallback(async (volumeMultiplier = 4.0) => {
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
      source.start(0);
    } catch (e) {
      console.error('Erro ao tocar audio:', e);
    }
  }, []);

  const playNewOrderBeep = React.useCallback(() => {
    playLoudAudio(4.0);
  }, [playLoudAudio]);

  useEffect(() => {
    if (!ordersRaw || !db || !user) return;
    const currentIds = new Set((ordersRaw as any[]).map(o => o.id));
    if (seenOrderIdsRef.current === null) {
      seenOrderIdsRef.current = currentIds;
      return;
    }
    
    // Todos os pedidos novos que entraram agora
    const allNewOnes = (ordersRaw as any[]).filter(o => !seenOrderIdsRef.current!.has(o.id));
    
    // Filtro para apitar: apenas pendentes e que não sejam de mesa
    const pendingNewOnes = allNewOnes.filter(o => o.status === 'pending' && o.orderType !== 'dine_in');
    
    if (pendingNewOnes.length > 0) {
      playNewOrderBeep();
      toast({ title: `Novo pedido recebido!`, description: `${pendingNewOnes.length} pedido(s) aguardando confirmação.` });
      try {
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          new Notification('Novo pedido!', { body: `${pendingNewOnes.length} pedido(s) aguardando confirmação.` });
        }
      } catch {}

      // ── Impressão Automática de Pedidos ──
      if (typeof window !== 'undefined' && !storeProfile?.general?.manualPrint) {
        const ps = storeProfile?.general?.printerSize || '80mm';
        const mw = ps === '58mm' ? '58mm' : '80mm';
        const fs = ps === '58mm' ? '10px' : '12px';
        const sn = storeProfile?.general?.name || 'Loja';
        pendingNewOnes.forEach((ord: any) => {
          const itemsHtml = (ord.items || []).map((it: any) => {
            const adds = (it.addons || []).map((a: any) => `<div style="padding-left:8px;font-size:10px;">&gt; ${a.name}${a.price > 0 ? ` (+R$ ${a.price.toFixed(2)})` : ''}</div>`).join('');
            const nts = it.notes ? `<div style="padding-left:8px;font-size:10px;font-style:italic;font-weight:bold;">Obs: ${it.notes}</div>` : '';
            return `<tr><td style="vertical-align:top;padding:2px 0;">${it.quantity}</td><td style="padding:2px 0;"><b>${it.name}</b>${adds}${nts}</td><td style="text-align:right;vertical-align:top;padding:2px 0;">R$ ${((it.unitPrice||0)*it.quantity).toFixed(2)}</td></tr>`;
          }).join('');
          const dt = new Date(ord.orderDateTime || Date.now());
          const tp = ord.orderType === 'pickup' ? '*** RETIRADA ***' : ord.orderType === 'dine_in' ? '*** COMER NO LOCAL ***' : '*** ENTREGA ***';
          const bdy = `<div style="text-align:center;margin-bottom:4px;"><h1 style="font-size:14px;font-weight:bold;text-transform:uppercase;">${sn}</h1><p style="font-size:11px;">Pedido: #${(ord.id||'').substring(0,5)}</p><p style="font-size:11px;">Data: ${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</p></div><div style="text-align:center;font-weight:bold;margin:4px 0;text-transform:uppercase;">${tp}</div><div style="border-top:1px dashed #000;padding-top:4px;margin-bottom:4px;"><p style="font-weight:bold;">Dados do Cliente</p><p>Nome: ${ord.customerName||'-'}</p><p>Celular: ${ord.customerPhone||'-'}</p>${ord.deliveryAddress?`<p>Endereço: ${ord.deliveryAddress}</p>`:''}</div><table style="width:100%;border-collapse:collapse;border-top:1px dashed #000;margin-bottom:4px;"><thead><tr style="border-bottom:1px solid #000;"><th style="text-align:left;padding:2px 0;">Qtd</th><th style="text-align:left;padding:2px 0;">Item</th><th style="text-align:right;padding:2px 0;">Valor</th></tr></thead><tbody>${itemsHtml}</tbody></table><div style="border-top:1px dashed #000;padding-top:4px;"><div style="display:flex;justify-content:space-between;font-weight:bold;font-size:14px;"><span>TOTAL</span><span>R$ ${(ord.totalAmount||0).toFixed(2)}</span></div><p style="margin-top:4px;">Forma: ${ord.paymentMethod||'Não informado'}</p></div><div style="text-align:center;margin-top:12px;font-size:10px;"><p>Obrigado pela preferência!</p><p>${sn}</p></div>`;
          const css = `*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Courier New',Courier,monospace;padding:8px;color:#000;font-size:${fs};line-height:1.4;max-width:${mw};margin:0 auto;background:#fff;}@media print{body{padding:0;width:${mw}!important;max-width:${mw}!important;}@page{size:${mw} auto!important;margin:0!important;}}`;
          const ifr = document.createElement('iframe');
          ifr.style.display = 'none';
          document.body.appendChild(ifr);
          const iDoc = ifr.contentWindow?.document;
          if (iDoc) {
            iDoc.write(`<html><head><title>Pedido</title><style>${css}</style></head><body>${bdy}</body></html>`);
            iDoc.close();
            setTimeout(() => { ifr.contentWindow?.focus(); ifr.contentWindow?.print(); setTimeout(() => { if (document.body.contains(ifr)) document.body.removeChild(ifr); }, 2000); }, 500);
          }
        });
      }
    }

    // Lógica para cadastrar clientes e disparar confetes
    allNewOnes.forEach(async (order) => {
      const rawTelefone = (order.customerPhone || '').trim();
      // Normalizar telefone: remover +55, espaços, traços, parênteses
      const telefone = rawTelefone.replace(/[\s\-\(\)\+]/g, '').replace(/^55(\d{10,11})$/, '$1');
      const nome = (order.customerName || '').trim();
      
      if (telefone || nome) {
        const clientesRef = collection(db, 'clientes');
        let q;
        if (telefone) {
          q = query(clientesRef, where('ownerId', '==', user.uid), where('celular', '==', telefone));
        } else {
          q = query(clientesRef, where('ownerId', '==', user.uid), where('nome', '==', nome));
        }
        
        try {
          const snap = await getDocs(q);
          if (snap.empty) {
            // É um CLIENTE NOVO!
            const hoje = new Date().toLocaleDateString('pt-BR');
            const newRef = doc(clientesRef);
            await setDoc(newRef, {
              id: newRef.id,
              ownerId: user.uid,
              nome: nome,
              celular: telefone,
              logradouro: order.address?.street || '',
              logradouroNumero: order.address?.number || '',
              complemento: order.address?.complement || '',
              bairro: order.address?.neighborhood || '',
              cidade: order.address?.city || '',
              dataNascimento: order.customerBirthDate || '',
              clienteDesde: hoje,
              ultimoPedido: hoje,
              totalPedidos: 0, // Será incrementado quando o pedido for entregue
              totalPontos: 0,
              ticketMedio: 0
            });
            
            // Comemorar cliente novo no delivery!
            if (order.orderType === 'delivery') {
              setIsCelebrating(true);
              const { id } = toast({ 
                title: "🎉 CLIENTE NOVO!", 
                description: `${nome} acabou de fazer o primeiro pedido!`,
                className: "bg-gradient-to-r from-emerald-500 to-teal-500 text-white border-none shadow-lg",
                duration: 999999
              });
              newClientToastIdRef.current = id;
            }
          }
        } catch (err) {
          console.error("Erro ao verificar/cadastrar cliente automático:", err);
        }
      }
    });

    seenOrderIdsRef.current = currentIds;
  }, [ordersRaw, playNewOrderBeep, toast, db, user]);

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
    if (!ordersRaw) return;
    const hasPending = (ordersRaw as any[]).some(o => o.status === 'pending' && o.orderType !== 'dine_in');
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
  }, [ordersRaw, playLoudAudio]);
  const { data: addons } = useCollection(addonsQuery);

  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [editingCombo, setEditingCombo] = useState<any>(null);
  const [editingAddon, setEditingAddon] = useState<any>(null);
  const [addonSearchTerm, setAddonSearchTerm] = useState('');
  const [addonCategoryFilter, setAddonCategoryFilter] = useState('all');
  const [selectedAddonIds, setSelectedAddonIds] = useState<Set<string>>(new Set());
  const [isBulkCategoryModalOpen, setIsBulkCategoryModalOpen] = useState(false);
  const [bulkCategoryName, setBulkCategoryName] = useState('');
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

  // Debounce o redirect para login para evitar que flutuações temporárias de auth
  // (ex: outra aba abrindo o cardápio do cliente) desloguem o admin indevidamente.
  const wasEverLoggedIn = useRef(false);
  useEffect(() => {
    if (user && !user.isAnonymous) {
      wasEverLoggedIn.current = true;
    }
  }, [user]);

  useEffect(() => {
    if (isUserLoading) return; // Ainda carregando, não faz nada
    if (user && !user.isAnonymous) return; // Logado normalmente, tudo certo

    // Se o user sumiu mas ele JÁ ESTAVA logado, espera 2s antes de redirecionar
    // para dar tempo do Firebase Auth se estabilizar entre abas
    const delay = wasEverLoggedIn.current ? 2000 : 0;
    const timer = setTimeout(() => {
      // Re-checa o auth atual antes de redirecionar
      if (!auth?.currentUser || auth.currentUser.isAnonymous) {
        router.push('/login');
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [user, isUserLoading, router, auth]);

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

  const sendOrderWhatsAppNotification = async (order: any, status: string) => {
    if (!user || !order?.customerPhone) return;
    if (!['received', 'ready', 'out_for_delivery'].includes(status)) return;

    const firstName = order.customerName ? order.customerName.split(' ')[0] : 'Cliente';
    const shortId = order.id ? order.id.slice(-6).toUpperCase() : '000000';
    const totalStr = typeof order.totalAmount === 'number' ? order.totalAmount.toFixed(2).replace('.', ',') : '0,00';
    
    let itemsList = '';
    if (order.items && Array.isArray(order.items)) {
      itemsList = order.items.map((item: any) => {
         const qty = item.quantity || 1;
         const price = typeof item.unitPrice === 'number' ? (item.unitPrice * qty).toFixed(2).replace('.', ',') : '0,00';
         return `${qty} x ${item.name} - ${price}`;
      }).join('\n');
    }
    
    let paymentText = order.paymentMethod || 'Dinheiro';
    if (order.paymentMethod === 'credit_card') paymentText = 'Cartão de Crédito';
    if (order.paymentMethod === 'debit_card') paymentText = 'Cartão de Débito';
    if (order.paymentMethod === 'pix') paymentText = 'PIX';
    if (order.paymentMethod === 'cash') paymentText = 'Dinheiro';

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
        tempo_estimado: status === 'received'
          ? (
              order.orderType === 'delivery' && storeProfile?.fees?.deliveryTime
                ? `\n\u23f3 Tempo estimado de entrega: ${storeProfile.fees.deliveryTime}`
                : order.orderType === 'pickup' && storeProfile?.fees?.pickupTime
                  ? `\n\u23f3 Tempo estimado para retirada: ${storeProfile.fees.pickupTime}`
                  : ''
            )
          : '',
        loja: storeProfile?.general?.name || storeProfile?.storeName || 'Minha loja',
        link: buildStoreLink(storeProfile, user.uid, typeof window !== 'undefined' ? window.location.origin : undefined),
        horarios: formatWorkingHours(storeProfile?.workingHours),
      });
    }

    if (!message) return;

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
      if (!response.ok) {
        console.warn('[WhatsApp] API recusou notificacao do pedido:', await response.text());
      }
    } catch (error) {
      console.warn('[WhatsApp] Falha ao enviar notificacao do pedido:', error);
    }
  };

  const updateOrderStatus = async (orderId: string, statusOrUpdates: string | any) => {
    if (!db || !user) return;
    try {
      const updates = typeof statusOrUpdates === 'string' ? { status: statusOrUpdates } : statusOrUpdates;
      const currentOrder = (ordersRaw as any[])?.find(o => o.id === orderId);
      const finalizingSale = updates.status === 'delivered' && currentOrder && currentOrder.status !== 'delivered';
      const shouldDeductStock = !!(finalizingSale && storeProfile?.general?.enableInventory && currentOrder.stockDeducted !== true);
      let stockDeductionUpdates: Array<{ itemRef: any; quantity: number }> = [];

      const orderItemQuantities = (order: any) => {
        const quantities = new Map<string, number>();
        for (const item of order?.items || []) {
          const quantity = Number(item.quantity) || 0;
          if (item.id && quantity > 0) {
            quantities.set(item.id, (quantities.get(item.id) || 0) + quantity);
          }
        }
        return quantities;
      };

      if (shouldDeductStock) {
        for (const [itemId, quantity] of orderItemQuantities(currentOrder)) {
          const itemRef = doc(db, 'menuItems', itemId);
          const itemSnap = await getDoc(itemRef);
          if (!itemSnap.exists()) continue;

          const itemData = itemSnap.data();
          const currentStock = getManagedStock(itemData.stockQuantity);
          if (currentStock === null) continue;

          if (quantity > currentStock) {
            toast({
              variant: 'destructive',
              title: 'Estoque insuficiente',
              description: `Não foi possível finalizar. "${itemData.name || itemId}" tem apenas ${currentStock} unidade(s).`
            });
            return false;
          }

          stockDeductionUpdates.push({ itemRef, quantity });
        }
      }
      
      // Sincronização de Cliente se o pedido for movido para 'delivered'
      if (updates.status === 'delivered') {
        const order = currentOrder;
        // Só sincroniza se o pedido existe e não estava como entregue antes
        if (order && order.status !== 'delivered') {
          const rawTelefone = (order.customerPhone || '').trim();
          // Normalizar telefone: remover +55, espaços, traços, parênteses
          const telefone = rawTelefone.replace(/[\s\-\(\)\+]/g, '').replace(/^55(\d{10,11})$/, '$1');
          const nome = (order.customerName || '').trim();
          const hoje = new Date().toLocaleDateString('pt-BR');
          const valor = order.totalAmount || 0;

          if (telefone || nome) {
            const clientesRef = collection(db, 'clientes');
            let q;
            if (telefone) {
              q = query(clientesRef, where('ownerId', '==', user.uid), where('celular', '==', telefone));
            } else {
              q = query(clientesRef, where('ownerId', '==', user.uid), where('nome', '==', nome));
            }
            
            const snap = await getDocs(q);
            if (!snap.empty) {
              const docRef = snap.docs[0].ref;
              const data = snap.docs[0].data();
              const oldPedidos = data.totalPedidos || 0;
              const oldTicket = data.ticketMedio || 0;
              const oldBirth = data.dataNascimento || '';
              
              const totalGastoAnterior = oldPedidos * oldTicket;
              const novoTotalPedidos = oldPedidos + 1;
              const novoTicket = (totalGastoAnterior + valor) / novoTotalPedidos;
              
              const updateData: any = {
                totalPedidos: novoTotalPedidos,
                ticketMedio: novoTicket,
                ultimoPedido: hoje
              };

              // Atualiza data de nascimento se o cliente informou agora e antes não tinha
              if (order.customerBirthDate && !oldBirth) {
                updateData.dataNascimento = order.customerBirthDate;
              }

              await updateDoc(docRef, updateData);
            } else {
              const newRef = doc(clientesRef);
              await setDoc(newRef, {
                id: newRef.id,
                ownerId: user.uid,
                nome: nome,
                celular: telefone,
                logradouro: order.address?.street || '',
                logradouroNumero: order.address?.number || '',
                complemento: order.address?.complement || '',
                bairro: order.address?.neighborhood || '',
                cidade: order.address?.city || '',
                dataNascimento: order.customerBirthDate || '',
                clienteDesde: hoje,
                ultimoPedido: hoje,
                totalPedidos: 1,
                totalPontos: 0,
                ticketMedio: valor
              });
            }
          }
        }
      }

      if (updates.status === 'canceled' && currentOrder && currentOrder.status !== 'canceled') {
        if (storeProfile?.general?.enableInventory && currentOrder.stockDeducted === true) {
          const batch = writeBatch(db);
          batch.update(doc(db, 'orders', orderId), { ...updates, stockDeducted: false });
          for (const [itemId, quantity] of orderItemQuantities(currentOrder)) {
            const itemRef = doc(db, 'menuItems', itemId);
            const itemSnap = await getDoc(itemRef);
            const currentStock = itemSnap.exists() ? getManagedStock(itemSnap.data().stockQuantity) : null;
            if (currentStock !== null) {
              batch.update(itemRef, {
                stockQuantity: increment(quantity)
              });
            }
          }
          await batch.commit();
          toast({ title: "Status Atualizado", description: "O pedido foi cancelado e o estoque foi retornado." });
          return true;
        }

        await updateDoc(doc(db, 'orders', orderId), updates);
        toast({ title: "Status Atualizado", description: "O pedido foi cancelado." });
        return true;
      }

      if (shouldDeductStock) {
        const batch = writeBatch(db);
        for (const stockUpdate of stockDeductionUpdates) {
          batch.update(stockUpdate.itemRef, {
            stockQuantity: increment(-stockUpdate.quantity)
          });
        }
        batch.update(doc(db, 'orders', orderId), {
          ...updates,
          stockDeducted: stockDeductionUpdates.length > 0
        });
        await batch.commit();
      } else {
        await updateDoc(doc(db, 'orders', orderId), updates);
      }
      toast({ title: "Status Atualizado", description: "O pedido foi atualizado." });
      if (updates.status && currentOrder?.status !== updates.status) {
        void sendOrderWhatsAppNotification(currentOrder, updates.status);
      }
      return true;
    } catch (err) {
      console.error(err);
      toast({ variant: "destructive", title: "Erro ao atualizar", description: "Falha na comunicação." });
      return false;
    }
  };

  const handleSaveAddon = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !db) return;
    const formData = new FormData(e.currentTarget);
    const selectedGroup = formData.get('addonGroup') as string || 'Geral';
    const addonData = {
      name: formData.get('addonName') as string,
      description: ((formData.get('addonDescription') as string) || '').trim(),
      price: parseFloat(formData.get('addonPrice') as string),
      group: selectedGroup,
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
      if (savedAddonId && selectedGroup) {
        const categorySnap = await getDocs(query(collection(db, 'addonCategories'), where('ownerId', '==', user.uid), where('name', '==', selectedGroup)));
        if (categorySnap.empty) {
          const newCategoryDoc = doc(collection(db, 'addonCategories'));
          await setDoc(newCategoryDoc, { id: newCategoryDoc.id, name: selectedGroup, ownerId: user.uid, addonIds: [savedAddonId], usePrice: true });
        } else {
          const categoryDoc = categorySnap.docs[0];
          const categoryData = categoryDoc.data();
          const currentIds = categoryData.addonIds || [];
          const removedAddonIds = (categoryData.removedAddonIds || []).filter((id: string) => id !== savedAddonId);
          if (!currentIds.includes(savedAddonId)) {
            await updateDoc(doc(db, 'addonCategories', categoryDoc.id), { addonIds: [...currentIds, savedAddonId], removedAddonIds });
          } else if (removedAddonIds.length !== (categoryData.removedAddonIds || []).length) {
            await updateDoc(doc(db, 'addonCategories', categoryDoc.id), { removedAddonIds });
          }
        }
      }
      setEditingAddon(null);
      toast({ title: "Sucesso", description: "Adicional salvo." });
    } catch (err: any) {
      console.error('Erro ao salvar adicional:', err);
      toast({ variant: "destructive", title: "Erro", description: err?.message || "Falha ao salvar adicional." });
    }
  };

  if (isUserLoading || loadingRole || !db) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (user && !adminRole && !loadingRole) {
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
      <SidebarNav activeTab={activeTab} setActiveTab={setActiveTab} isOpen={isSidebarOpen} setIsOpen={setIsSidebarOpen} storeName={storeProfile?.general?.name} storeLogo={storeProfile?.general?.logoUrl} />
      <div className="flex-1 flex flex-col min-w-0 transition-all duration-300 relative z-0">
        {/* Dark Top Navigation Bar */}
        <div className="bg-[#2a3042] text-slate-300 h-14 flex justify-between items-center pr-4 pl-14 shrink-0 shadow-sm z-10">
          <div className="flex h-full items-center">
            <button
              onClick={() => setActiveTab('caixa')}
              className={`px-6 h-full flex items-center text-sm font-medium transition-colors ${activeTab === 'caixa' ? 'bg-slate-100 text-slate-800' : 'hover:bg-white/10'}`}
            >
            Caixa
          </button>
          <button 
            onClick={() => setActiveTab('delivery')}
            className={`px-6 h-full flex items-center text-sm font-medium transition-colors ${activeTab === 'delivery' ? 'bg-slate-100 text-slate-800' : 'hover:bg-white/10'}`}
          >
            Delivery
          </button>
          <button 
            onClick={() => setActiveTab('novo_pedido')}
            className={`px-6 h-full flex items-center text-sm font-medium transition-colors ${activeTab === 'novo_pedido' ? 'bg-slate-100 text-slate-800' : 'hover:bg-white/10'}`}
          >
            Balcão
          </button>
          <button 
            onClick={() => setActiveTab('mesas')}
            className={`px-6 h-full flex items-center text-sm font-medium transition-colors ${activeTab === 'mesas' ? 'bg-slate-100 text-slate-800' : 'hover:bg-white/10'}`}
          >
            Mesa
          </button>
        </div>
        
        <div className="flex items-center gap-4 h-full">
          <div className="flex items-center gap-2">
            <Badge className={`border-0 rounded-sm px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider ${caixaAberto ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-red-500 hover:bg-red-600'}`}>
              {caixaAberto ? 'Aberto' : 'Fechado'}
            </Badge>
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
              onOpenCaixa={() => { setAutoOpenAbrirCaixa(true); setActiveTab('caixa'); }}
              storeProfile={storeProfile}
            />
          </div>
        )}

        {activeTab === 'caixa' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <CaixaTab 
              storeProfile={storeProfile} 
              orders={orders || []} 
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
            categories={categories || []} 
            items={items || []} 
            db={db} 
            user={user}
            registrarLancamento={registrarLancamento}
            caixaAberto={!!caixaAberto}
            storeProfile={storeProfile}
            addons={addons || []}
            addonCategories={addonCategories || []}
            onOpenCaixa={() => { setAutoOpenAbrirCaixa(true); setActiveTab('caixa'); }}
          />
          </div>
        )}

        {activeTab === 'mesas' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <MesasTab 
            orders={orders || []} 
            categories={categories || []}
            items={items || []}
            db={db}
            user={user}
            registrarLancamento={registrarLancamento}
            caixaAberto={!!caixaAberto}
            addons={addons || []}
            addonCategories={addonCategories || []}
            onOpenCaixa={() => { setAutoOpenAbrirCaixa(true); setActiveTab('caixa'); }}
          />
          </div>
        )}

        {/* Módulo Administrativo (Nova Gestão) */}
        {activeTab === 'whatsapp' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <WhatsAppTab user={user} storeProfile={storeProfile} db={db} />
          </div>
        )}

        {activeTab === 'promocoes' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <PromotionsTab 
              db={db} user={user} items={items || []} categories={categories || []} 
              setEditingCombo={(combo) => {
                setEditingCombo(combo);
                if (combo) {
                  setActiveTab('produtos');
                }
              }} 
            />
          </div>
        )}

        <div className={
          activeTab === 'produtos'
            ? 'flex-1 min-h-0 flex flex-col overflow-hidden'
            : ['categorias', 'addons', 'clientes', 'freelance'].includes(activeTab) || activeTab.startsWith('perfil_')
              ? 'flex-1 min-h-0 overflow-y-auto custom-scrollbar'
              : 'hidden'
        }>
          <div className={
            activeTab === 'produtos'
              ? 'max-w-[1600px] w-full mx-auto px-2 mt-4 flex-1 min-h-0 flex flex-col'
              : 'max-w-[1600px] w-full mx-auto px-2 space-y-8 relative pb-12 mt-4'
          }>

          {activeTab === 'produtos' && (
            <div className={`mt-6 flex-1 min-h-0 flex flex-col ${(editingProduct !== null || editingCombo !== null) ? 'overflow-y-auto custom-scrollbar' : ''}`}>
              {editingCombo === null && (
                <div className="mb-6 px-2 shrink-0">
                  <h1 className="text-3xl font-black tracking-tight text-slate-800">
                    {editingProduct !== null ? (editingProduct.isMarmita ? 'Editar Marmita' : 'Editar Produto') : 'Produtos e Marmitas'}
                  </h1>
                  <p className="text-muted-foreground mt-1 font-medium">
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
                  items={items || []}
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
              <CardHeader className="flex flex-col gap-3 border-b bg-white p-4 shrink-0">
                <div className="flex flex-wrap justify-end gap-2">
                  <Button onClick={() => setEditingProduct({})} className="bg-primary text-white">
                    <Plus className="mr-2 h-4 w-4" /> Novo Produto
                  </Button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                  <button
                    type="button"
                    onClick={() => setProductCategoryFilter('todas')}
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
                      onClick={() => setProductCategoryFilter(cat.id)}
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
                <div className="p-4 border-b bg-slate-50 flex items-center shrink-0">
                  <Input
                    placeholder="Procurar produto ou marmita..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="w-full"
                  />
                </div>
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
                      <TableHead className="w-[100px] text-center">Ativo</TableHead>
                      <TableHead className="text-right pr-6 w-[120px]">Ações</TableHead>
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
                      const isAvailable = item.isAvailable !== false; // Default is true se não estiver definido
                      
                      return (
                        <TableRow key={item.id} className={!isAvailable ? 'opacity-60 bg-slate-50/50' : ''}>
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
                          <TableCell className="text-muted-foreground">R$ {(item.price || 0).toFixed(2)}</TableCell>
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
                            <Switch 
                              checked={isAvailable}
                              onCheckedChange={async (checked) => {
                                if (!db) return;
                                await updateDoc(doc(db, 'menuItems', item.id), { isAvailable: checked });
                                toast({ title: checked ? 'Produto Ativado' : 'Produto Desativado' });
                              }}
                            />
                          </TableCell>
                          <TableCell className="text-right pr-6 space-x-1 whitespace-nowrap">
                            <Button variant="ghost" size="icon" onClick={() => {
                              if (item.isCombo) {
                                setEditingCombo(item);
                              } else {
                                setEditingProduct(item);
                              }
                            }} title="Editar">
                              <Pencil className="h-4 w-4 text-blue-500" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={async () => {
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
                            <Button variant="ghost" size="icon" onClick={async () => {
                              if (!db) return;
                              if (confirm("Excluir item?")) await deleteDoc(doc(db, 'menuItems', item.id));
                            }} title="Excluir">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
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

          {activeTab === 'categorias' && (
            <div className="mt-6">
              <div className="mb-6 px-2">
                <h1 className="text-3xl font-black tracking-tight text-slate-800">Categorias do Cardápio</h1>
                <p className="text-muted-foreground mt-1 font-medium">Organize os seus produtos, defina a ordem de exibição e limite horários de disponibilidade.</p>
              </div>
              <Card className="border shadow-md rounded-2xl overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-end border-b bg-white p-4">
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
              <CardContent className="p-0">
                <div className="max-h-[65vh] overflow-y-auto">
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
            const allGroups = Array.from(new Set([...explicitGroups, ...implicitGroups])).sort() as string[];
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
              if (!addonSortConfig) return 0;
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
            <div className="mt-6">
              <div className="mb-6 px-2">
                <h1 className="text-3xl font-black tracking-tight text-slate-800">Grupos de Adicionais</h1>
                <p className="text-muted-foreground mt-1 font-medium">Crie itens extras que podem ser vinculados aos seus produtos (ex: Bacon, Molho Extra, Adicionais da Marmita).</p>
              </div>
              <Card className="border shadow-md rounded-2xl overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between border-b bg-white p-4 gap-4 flex-wrap">
                <div className="w-full flex flex-col md:flex-row items-start md:items-center justify-between border-b mb-4 pb-2 gap-4">
                  <div className="flex items-center gap-2 overflow-x-auto flex-1 w-full md:w-auto">
                    <Button 
                      variant={addonCategoryFilter === 'all' ? 'default' : 'outline'}
                      onClick={() => setAddonCategoryFilter('all')}
                      size="sm"
                      className="whitespace-nowrap rounded-full"
                    >
                      Lista Matriz
                    </Button>
                    {allGroups.map(g => (
                      <Button 
                        key={g}
                        variant={addonCategoryFilter === g ? 'default' : 'outline'}
                        onClick={() => setAddonCategoryFilter(g)}
                        size="sm"
                        className="whitespace-nowrap rounded-full flex items-center group"
                      >
                        {g}
                        <span className="ml-2 rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[10px]">
                          {getContainerAddonIds(g).length}
                        </span>
                        {addonCategoryFilter === g && (
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditCategoryName(g);
                              setEditCategoryNewName(g);
                              setIsEditCategoryModalOpen(true);
                            }}
                            className="ml-1 bg-primary-foreground/20 hover:bg-primary-foreground/40 text-primary-foreground p-1 rounded-full transition-colors cursor-pointer"
                            title="Editar Container"
                          >
                            <Pencil className="h-3 w-3" />
                          </div>
                        )}
                      </Button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Dialog open={isAddonCategoryModalOpen} onOpenChange={(open) => {
                      setIsAddonCategoryModalOpen(open);
                      if (!open) setNewAddonCategoryName('');
                    }}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="whitespace-nowrap rounded-full border-dashed text-primary border-primary/50 hover:bg-primary/10">
                          <Plus className="mr-1 h-3 w-3" /> Novo Container
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
                              await setDoc(newDoc, { id: newDoc.id, name: newAddonCategoryName.trim(), ownerId: user.uid, addonIds: [], usePrice: true });
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
                                  batch.set(newDoc, { id: newDoc.id, name: newName, ownerId: user.uid, addonIds: getLegacyAddonIdsForGroup(oldName), usePrice: true });
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

                {addonCategoryFilter !== 'all' && (() => {
                  const category = addonCategoryByName.get(addonCategoryFilter) as any;
                  const usePrice = category?.usePrice !== false;
                  return (
                    <div className="flex w-full flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-bold text-slate-700">Configuração do container: {addonCategoryFilter}</p>
                        <p className="text-slate-500">Define se os itens deste container somam preço no pedido.</p>
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
                        className={`h-8 rounded-full px-3 text-xs font-bold transition-colors ${
                          usePrice
                            ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                            : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                        }`}
                      >
                        {usePrice ? 'Usa preço' : 'Sem preço'}
                      </button>
                    </div>
                  );
                })()}
                
                <div className="flex gap-2 flex-1 min-w-[300px]">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Buscar adicionais..." value={addonSearchTerm} onChange={(e) => setAddonSearchTerm(e.target.value)} className="pl-9" />
                  </div>
                </div>
                <div className="flex gap-2">
                  {selectedAddonIds.size > 0 && (
                    <Button 
                      onClick={() => setIsBulkCategoryModalOpen(true)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <Tag className="mr-2 h-4 w-4" /> 
                      Adicionar ao Container ({selectedAddonIds.size})
                    </Button>
                  )}
                  <Dialog open={editingAddon !== null} onOpenChange={(open) => { if (!open) setEditingAddon(null); }}>
                    <DialogTrigger asChild>
                      <Button onClick={() => setEditingAddon({})} className="bg-primary text-white">
                        <Plus className="mr-2 h-4 w-4" /> Novo Adicional
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[400px]">
                      <DialogHeader>
                        <DialogTitle>{editingAddon?.id ? 'Editar Adicional' : 'Novo Adicional'}</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleSaveAddon} className="space-y-4 pt-4">
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
                          <Label htmlFor="addonGroup">Categoria</Label>
                          <select 
                            id="addonGroup" 
                            name="addonGroup" 
                            className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                            defaultValue={editingAddon?.group || ''}
                            required
                          >
                            <option value="">Selecione uma categoria...</option>
                            {allGroups.map(g => (
                              <option key={g} value={g}>{g}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="addonPrice">Preço (R$)</Label>
                          <CurrencyInput id="addonPrice" name="addonPrice" defaultValue={editingAddon?.price} required placeholder="0,00" />
                        </div>
                        <DialogFooter>
                          <Button type="submit" className="w-full h-12 font-bold">Salvar</Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                  <Dialog open={isBulkCategoryModalOpen} onOpenChange={(open) => {
                    setIsBulkCategoryModalOpen(open);
                    if (!open) setBulkCategoryName('');
                  }}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Adicionar {selectedAddonIds.size} itens ao container</DialogTitle>
                      </DialogHeader>
                      <div className="py-4 space-y-2">
                        <Label>Container</Label>
                        <select
                          className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                          value={bulkCategoryName}
                          onChange={(e) => setBulkCategoryName(e.target.value)}
                        >
                          <option value="">Selecione a categoria...</option>
                          {allGroups.map(g => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                        </select>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsBulkCategoryModalOpen(false)}>Cancelar</Button>
                        <Button onClick={async () => {
                          if (!db || !bulkCategoryName || selectedAddonIds.size === 0) return;
                          try {
                            const currentIds = getContainerAddonIds(bulkCategoryName);
                            const nextIds = Array.from(new Set([...currentIds, ...Array.from(selectedAddonIds)]));
                            const { ref } = await ensureAddonCategory(bulkCategoryName, currentIds);
                            const existing = addonCategoryByName.get(bulkCategoryName) as any;
                            const removedAddonIds = (existing?.removedAddonIds || []).filter((id: string) => !selectedAddonIds.has(id));
                            await updateDoc(ref, { addonIds: nextIds, removedAddonIds });
                            toast({ title: 'Itens adicionados ao container sem duplicar.' });
                            setIsBulkCategoryModalOpen(false);
                            setSelectedAddonIds(new Set());
                            setBulkCategoryName('');
                          } catch (err: any) {
                            toast({ variant: 'destructive', title: 'Erro', description: err.message });
                          }
                        }} className="bg-emerald-600 text-white hover:bg-emerald-700">
                          Aplicar Container
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className={`border-b px-4 py-2 text-xs font-semibold ${
                  isContainerView
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-50 text-slate-600'
                }`}>
                  {isContainerView
                    ? `Container "${addonCategoryFilter}": a lixeira remove so deste container; Ativo/Pausado altera o item globalmente.`
                    : 'Lista Matriz: editar, pausar ou excluir aqui altera o adicional globalmente.'}
                </div>
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
                      <TableHead className="cursor-pointer hover:bg-slate-100 transition-colors select-none" onClick={() => handleAddonSort('group')}>
                        Categoria {addonSortConfig?.key === 'group' && (addonSortConfig.direction === 'asc' ? '↑' : '↓')}
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
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                          {addons?.length === 0 ? 'Nenhum adicional cadastrado.' : 'Nenhum adicional encontrado na busca.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredAddons.map((addon: any) => {
                        let rowClass = selectedAddonIds.has(addon.id) ? 'bg-emerald-50/30' : '';
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
                          <TableCell className="font-bold">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <span className={addon.active === false ? 'line-through text-red-400' : ''}>{addon.name}</span>
                                {addon.active === false && <span className="bg-red-100 text-red-700 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">Pausado</span>}
                                {unusedDuplicateIds.has(addon.id) && <span className="bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide ml-2">S/ USO (DUPLICADO)</span>}
                              </div>
                              {addon.description && (
                                <div className="text-[11px] text-slate-500 mt-0.5 font-normal max-w-[200px] sm:max-w-xs md:max-w-md line-clamp-2">
                                  {addon.description}
                                </div>
                              )}
                              {addonUsageMap.has(addon.id) && addonUsageMap.get(addon.id)!.size > 0 && (
                                <div className="text-[10px] text-muted-foreground mt-0.5 font-normal max-w-[200px] sm:max-w-xs md:max-w-md truncate" title={Array.from(addonUsageMap.get(addon.id)!).join(', ')}>
                                  <span className="font-semibold text-slate-500">Usado em:</span> {Array.from(addonUsageMap.get(addon.id)!).join(', ')}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">{getAddonContainerNames(addon).join(', ')}</TableCell>
                          <TableCell className="text-primary font-semibold">R$ {(addon.price || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-right pr-6">
                            {isContainerView ? (
                              <div className="flex items-center justify-end gap-2">
                                <div
                                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-1"
                                  title="Ativo/Pausado global"
                                >
                                  <Switch
                                    checked={addon.active !== false}
                                    onCheckedChange={(checked) => setAddonGlobalActive(addon, checked)}
                                    aria-label="Ativo/Pausado global"
                                    className="scale-75 data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-red-500"
                                  />
                                  <span className={`text-[10px] font-medium uppercase ${addon.active !== false ? 'text-green-600' : 'text-red-500'}`}>{addon.active !== false ? 'Ativo' : 'Pausado'}</span>
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
                                <Button variant="ghost" size="icon" onClick={() => setEditingAddon(addon)}>
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
