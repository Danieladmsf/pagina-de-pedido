'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useFirestore, useCollection, useMemoFirebase, useUser, useDoc, useAuth } from '@/firebase';
import { collection, doc, deleteDoc, setDoc, updateDoc, orderBy, query, where, writeBatch, getDocs } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Pencil, Trash2, Plus, LayoutDashboard, Utensils, Tag, LogOut, Loader2, ShieldAlert, ShoppingBag, Clock, CheckCircle2, User, MapPin, Phone, ExternalLink, Upload, BarChart3, TrendingUp, Users, ChevronDown, ChevronRight, Wallet, Store, GripVertical } from 'lucide-react';
import { CaixaTab } from '@/components/caixa/CaixaTab';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { CurrencyInput } from '@/components/ui/currency-input';
import { DeliveryTab } from '@/components/admin/DeliveryTab';
import { NovoPedidoTab } from '@/components/admin/NovoPedidoTab';
import { MesasTab } from '@/components/admin/MesasTab';
import { StoreProfileTab } from '@/components/admin/StoreProfileTab';
import { CATS, ITEMS, ADDONS } from '@/lib/seedData';
import { ComboModal } from '@/components/admin/ComboModal';
import { ProductModal } from '@/components/admin/ProductModal';
import { useCaixa } from '@/hooks/useCaixa';
import { Switch } from '@/components/ui/switch';
import { Settings, MessageCircle, MapPinned, Box, Component } from 'lucide-react';

export default function AdminPage() {
  const db = useFirestore();
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { user, isUserLoading } = useUser();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'caixa' | 'delivery' | 'novo_pedido' | 'mesas' | 'configuracoes'>('delivery');
  const [autoOpenAbrirCaixa, setAutoOpenAbrirCaixa] = useState(false);
  // Estados para modal de Categoria
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  
  // Estados para configuração de disponibilidade da categoria
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [isCategoryConfigModalOpen, setIsCategoryConfigModalOpen] = useState(false);
  
  // Estados para filtros de Produtos
  const [productSearch, setProductSearch] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState('todas');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };
  
  // Hook do Caixa compartilhado entre módulos
  const { caixaAberto, registrarLancamento, caixaAtual, setCaixaSelecionadoId } = useCaixa();
  
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

  const storeProfileRef = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return doc(db, 'store_profiles', user!.uid);
  }, [db, isRealUser]);

  const { data: storeProfile } = useDoc(storeProfileRef);

  const { data: categories, isLoading: loadingCats } = useCollection(categoriesQuery);
  const { data: items, isLoading: loadingItems } = useCollection(itemsQuery);
  const { data: ordersRaw, isLoading: loadingOrders, error: ordersError } = useCollection(ordersQuery);
  const orders = React.useMemo(() => {
    if (!ordersRaw) return [];
    
    let validOrders = [...ordersRaw];
    
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

    return validOrders.sort((a: any, b: any) => (b.orderDateTime || '').localeCompare(a.orderDateTime || ''));
  }, [ordersRaw, caixaAtual]);

  const filteredItems = React.useMemo(() => {
    if (!items) return [];
    let result = [...items];
    if (productCategoryFilter !== 'todas') {
      result = result.filter(item => item.categoryId === productCategoryFilter);
    }
    if (productSearch.trim()) {
      const s = productSearch.toLowerCase();
      result = result.filter(item => item.name.toLowerCase().includes(s));
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
    if (!ordersRaw) return;
    const currentIds = new Set((ordersRaw as any[]).map(o => o.id));
    if (seenOrderIdsRef.current === null) {
      seenOrderIdsRef.current = currentIds;
      return;
    }
    const newOnes = (ordersRaw as any[]).filter(o => !seenOrderIdsRef.current!.has(o.id) && o.status === 'pending' && o.orderType !== 'dine_in');
    if (newOnes.length > 0) {
      playNewOrderBeep();
      toast({ title: `Novo pedido recebido!`, description: `${newOnes.length} pedido(s) aguardando confirmação.` });
      try {
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          new Notification('Novo pedido!', { body: `${newOnes.length} pedido(s) aguardando confirmação.` });
        }
      } catch {}
    }
    seenOrderIdsRef.current = currentIds;
  }, [ordersRaw, playNewOrderBeep, toast]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

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

  useEffect(() => {
    if (!isUserLoading && (!user || user.isAnonymous)) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  // Ao sair da aba de configurações (onde o histórico do caixa é visto), voltar a visualizar o Caixa Aberto atual
  useEffect(() => {
    if (activeTab !== 'configuracoes') {
      setCaixaSelecionadoId(null);
    }
  }, [activeTab, setCaixaSelecionadoId]);

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

  const updateOrderStatus = async (orderId: string, statusOrUpdates: string | any) => {
    if (!db) return;
    try {
      const updates = typeof statusOrUpdates === 'string' ? { status: statusOrUpdates } : statusOrUpdates;
      await updateDoc(doc(db, 'orders', orderId), updates);
      toast({ title: "Status Atualizado", description: "O pedido foi atualizado." });
    } catch (err) {
      toast({ variant: "destructive", title: "Erro ao atualizar", description: "Falha na comunicação." });
    }
  };

  const handleSaveAddon = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !db) return;
    const formData = new FormData(e.currentTarget);
    const addonData = {
      name: formData.get('addonName') as string,
      price: parseFloat(formData.get('addonPrice') as string),
      ownerId: user.uid,
    };
    try {
      if (editingAddon?.id) {
        await updateDoc(doc(db, 'addons', editingAddon.id), addonData);
      } else {
        const newDoc = doc(collection(db, 'addons'));
        await setDoc(newDoc, { ...addonData, id: newDoc.id });
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

  const storeLink = typeof window !== 'undefined' ? `${window.location.origin}/?s=${user?.uid}` : '';

  return (
    <div className="admin-scale h-screen bg-slate-100 flex flex-col overflow-hidden">
      {/* Dark Top Navigation Bar */}
      <div className="bg-[#2a3042] text-slate-300 h-14 flex justify-between items-center px-4 shrink-0 shadow-sm z-10">
        <div className="flex h-full">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`px-6 h-full flex items-center text-sm font-medium transition-colors ${activeTab === 'dashboard' ? 'bg-slate-100 text-slate-800' : 'hover:bg-white/10'}`}
          >
            Dashboard
          </button>
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
          <button 
            onClick={() => setActiveTab('configuracoes')}
            className={`p-2 hover:text-white transition-colors rounded ${activeTab === 'configuracoes' ? 'bg-white/10 text-white' : ''}`}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 p-2 overflow-hidden flex flex-col min-h-0">
        
        {activeTab === 'dashboard' && (
          <div className="text-center p-20 flex flex-col items-center gap-4 text-slate-400">
            <LayoutDashboard className="h-16 w-16 opacity-50" />
            <p className="text-xl font-medium">Dashboard Estatístico em Desenvolvimento...</p>
          </div>
        )}

        {activeTab === 'delivery' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <DeliveryTab 
              db={db}
              orders={orders || []} 
              updateOrderStatus={updateOrderStatus} 
              registrarLancamento={registrarLancamento}
              caixaAberto={!!caixaAberto}
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
            onOpenCaixa={() => { setAutoOpenAbrirCaixa(true); setActiveTab('configuracoes'); }}
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
            onOpenCaixa={() => { setAutoOpenAbrirCaixa(true); setActiveTab('configuracoes'); }}
          />
          </div>
        )}

        {/* Módulo Administrativo Antigo */}
        <div className={activeTab === 'configuracoes' ? 'flex-1 overflow-y-auto custom-scrollbar' : 'hidden'}>
          <div className="max-w-[1600px] w-full mx-auto px-2 space-y-8 relative pb-12 mt-4">
            <Tabs defaultValue="products" className="w-full">
          <TabsList className="bg-white border shadow-sm p-1 rounded-xl h-12">
            <TabsTrigger value="products" className="rounded-lg px-6 flex gap-2">
              <Utensils className="h-4 w-4" /> Produtos
            </TabsTrigger>
            <TabsTrigger value="categories" className="rounded-lg px-6 flex gap-2">
              <Tag className="h-4 w-4" /> Categorias
            </TabsTrigger>
            <TabsTrigger value="addons" className="rounded-lg px-6 flex gap-2">
              <Plus className="h-4 w-4" /> Adicionais
            </TabsTrigger>
            <TabsTrigger value="profile" className="rounded-lg px-6 flex gap-2">
              <Store className="h-4 w-4" /> Perfil da Empresa
            </TabsTrigger>
          </TabsList>


          <TabsContent value="products" className="mt-6">
            {editingProduct !== null ? (
              <ProductModal 
                db={db} user={user} addons={addons || []} 
                editingProduct={editingProduct} setEditingProduct={setEditingProduct} 
                categories={categories || []} 
              />
            ) : editingCombo !== null ? (
              <ComboModal 
                db={db} user={user} items={items || []} 
                editingCombo={editingCombo} setEditingCombo={setEditingCombo} 
                categories={categories || []} 
              />
            ) : (
            <Card className="border shadow-md rounded-2xl overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between border-b bg-white">
                <CardTitle className="text-lg">Gerenciar Cardápio</CardTitle>
                <div className="flex gap-2">
                  <Button onClick={async () => {
                    if (!db || !user) return;
                    if (!confirm("Isso apagará o cardápio atual e reimportará a NOVA BASE extraída do Bysell (300+ itens). Tem certeza?")) return;
                    toast({ title: 'Limpeza e Importação Iniciadas. Aguarde...' });
                    try {
                      const oldCatsSnap = await getDocs(query(collection(db, 'categories'), where('ownerId', '==', user.uid)));
                      const oldItemsSnap = await getDocs(query(collection(db, 'menuItems'), where('ownerId', '==', user.uid)));
                      for (const doc of oldCatsSnap.docs) await deleteDoc(doc.ref);
                      for (const doc of oldItemsSnap.docs) await deleteDoc(doc.ref);

                      const oldAddonsSnap = await getDocs(query(collection(db, 'addons'), where('ownerId', '==', user.uid)));
                      for (const doc of oldAddonsSnap.docs) await deleteDoc(doc.ref);

                      const res = await fetch('/menu.json');
                      const data = await res.json();

                      const catMap: Record<string,string> = {};
                      for (let i = 0; i < data.categories.length; i++) {
                        const ref = doc(collection(db as any, 'categories'));
                        await setDoc(ref, { id:ref.id, name:data.categories[i], ownerId:user.uid, displayOrder:i, description:'' });
                        catMap[data.categories[i]] = ref.id;
                      }
                      
                      const addonMap: Record<string,string> = {};
                      let okAddons = 0;
                      for (const a of data.addons) {
                        const ref = doc(collection(db as any, 'addons'));
                        await setDoc(ref, { id:ref.id, name:a.name, price:a.price, group:a.group, ownerId:user.uid, isAvailable:true });
                        addonMap[a.id] = ref.id;
                        okAddons++;
                      }

                      let ok = 0;
                      for (const it of data.items) {
                        const catId = catMap[it.category];
                        if (!catId) continue;

                        const finalAddonGroups = it.addonGroups.map((group: any) => ({
                          ...group,
                          addonIds: group.addonIds.map((oldId: string) => addonMap[oldId]).filter(Boolean)
                        }));

                        const ref = doc(collection(db as any, 'menuItems'));
                        await setDoc(ref, { 
                          id:ref.id, 
                          name:it.name, 
                          description:it.description, 
                          price:it.price, 
                          categoryId:catId, 
                          ownerId:user.uid, 
                          isAvailable:true, 
                          isMarmita: it.isMarmita || false,
                          addonGroups: finalAddonGroups,
                          fixedItems: [],
                          isRecommended:false, 
                          imageUrl:'', 
                          addonIds:[] 
                        });
                        ok++;
                      }
                      toast({ title: `Importação concluída! ${data.categories.length} categorias, ${ok} produtos e ${okAddons} adicionais.` });
                    } catch (e: any) {
                      console.error(e);
                      toast({ title: 'Erro na importação', description: e.message, variant: 'destructive' });
                    }
                  }} className="bg-emerald-600 text-white hover:bg-emerald-700">
                    Importar Base Bysell
                  </Button>
                  <Button onClick={() => setEditingProduct({})} className="bg-primary text-white">
                    <Plus className="mr-2 h-4 w-4" /> Novo Produto
                  </Button>

                <Button onClick={() => setEditingCombo({})} className="bg-purple-600 hover:bg-purple-700 text-white h-10 px-4 flex gap-2">
                  <Box className="h-4 w-4" /> Criar Combo
                </Button>
                
                <Button onClick={() => setEditingProduct({ isMarmita: true })} className="bg-orange-600 hover:bg-orange-700 text-white h-10 px-4 flex gap-2">
                  <Component className="h-4 w-4" /> Criar Marmita
                </Button>
              </div>
            </CardHeader>
              <CardContent className="p-0">
                <div className="p-4 border-b bg-slate-50 flex flex-col md:flex-row gap-4 items-center">
                  <select 
                    className="h-10 px-3 py-2 rounded-md border border-input bg-background text-sm min-w-[200px]"
                    value={productCategoryFilter}
                    onChange={(e) => setProductCategoryFilter(e.target.value)}
                  >
                    <option value="todas">Todas Categorias</option>
                    {categories?.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                  <Input 
                    placeholder="Procurar por..." 
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="w-full"
                  />
                </div>
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
                      <TableHead className="w-[200px] cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSort('categoryName')}>
                        <div className="flex items-center">Categoria {sortConfig?.key === 'categoryName' ? <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${sortConfig.direction === 'asc' ? 'rotate-180' : ''}`} /> : <ChevronDown className="ml-1 h-3 w-3 opacity-20" />}</div>
                      </TableHead>
                      <TableHead className="w-[100px] text-center">Ativo</TableHead>
                      <TableHead className="text-right pr-6 w-[120px]">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems?.map((item) => {
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
                          </TableCell>
                          <TableCell className="text-muted-foreground">R$ {(item.price || 0).toFixed(2)}</TableCell>
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
                          <TableCell className="text-right pr-6 space-x-1">
                            <Button variant="ghost" size="icon" onClick={() => {
                              if (item.isCombo) {
                                setEditingCombo(item);
                              } else {
                                setEditingProduct(item);
                              }
                            }}>
                              <Pencil className="h-4 w-4 text-blue-500" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={async () => {
                              if (!db) return;
                              if (confirm("Excluir item?")) await deleteDoc(doc(db, 'menuItems', item.id));
                            }}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            )}
          </TabsContent>

          <TabsContent value="categories" className="mt-6">
            <Card className="border shadow-md rounded-2xl overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between border-b bg-white">
                <CardTitle className="text-lg">Categorias</CardTitle>
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
          </TabsContent>

          <TabsContent value="addons" className="mt-6">
            <Card className="border shadow-md rounded-2xl overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between border-b bg-white">
                <CardTitle className="text-lg">Adicionais Disponíveis</CardTitle>
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
                        <Label htmlFor="addonPrice">Preço (R$)</Label>
                        <CurrencyInput id="addonPrice" name="addonPrice" defaultValue={editingAddon?.price} required placeholder="0,00" />
                      </div>
                      <DialogFooter>
                        <Button type="submit" className="w-full h-12 font-bold">Salvar</Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="pl-6">Nome</TableHead>
                      <TableHead>Preço</TableHead>
                      <TableHead className="text-right pr-6">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!addons || addons.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center py-10 text-muted-foreground">
                          Nenhum adicional cadastrado. Crie opções como "Bacon", "Queijo", "Molho Picante" para usar nos produtos.
                        </TableCell>
                      </TableRow>
                    ) : (
                      addons.map((addon) => (
                        <TableRow key={addon.id}>
                          <TableCell className="font-bold pl-6">{addon.name}</TableCell>
                          <TableCell className="text-primary font-semibold">R$ {(addon.price || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-right pr-6 space-x-1">
                            <Button variant="ghost" size="icon" onClick={() => setEditingAddon(addon)}>
                              <Pencil className="h-4 w-4 text-blue-500" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={async () => {
                              if (!db) return;
                              if (confirm("Excluir adicional?")) await deleteDoc(doc(db, 'addons', addon.id));
                            }}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reports" className="mt-6 space-y-6">
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
          </TabsContent>

          <TabsContent value="profile" className="mt-6">
            <StoreProfileTab db={db} user={user} />
          </TabsContent>
        </Tabs>
          </div>
        </div>
      </div>

    </div>
  );
}
