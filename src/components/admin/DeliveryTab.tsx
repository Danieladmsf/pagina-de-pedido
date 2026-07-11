'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, setDoc, updateDoc, increment } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import CaixaFechadoCard from '@/components/shared/CaixaFechadoCard';
import { Badge } from '@/components/ui/badge';
import { Clock, CheckCircle2, User, MapPin, Phone, Printer, Info, CreditCard, Banknote, QrCode, Wallet, Bike, Plus, X, Minus, ShoppingCart, Tag } from 'lucide-react';
import Image from 'next/image';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { printOrderReceipt } from '@/lib/order-receipt-html';
import { QuickRegisterClientModal } from './QuickRegisterClientModal';
import { validateCustomerCredit } from '@/lib/customer-credit';
import { normalizeSearch } from '@/lib/utils';
import { reconcileOrderStock, InsufficientStockError } from '@/lib/inventory';
import { MenuItemDialog } from '@/components/menu/MenuItemDialog';
import { useCategoryScrollSpy } from '@/hooks/useCategoryScrollSpy';
import { ContactAvatar } from '@/components/shared/ContactAvatar';
import { makeProfilePhotoLoader } from '@/lib/wapi/profile-photo';
import { resolveFormasPagamento } from './fechamento/payment-methods';
import { useFechamento } from './fechamento/useFechamento';
import { FechamentoModal } from './fechamento/FechamentoModal';

interface DeliveryTabProps {
  orders: any[];
  updateOrderStatus: (orderId: string, statusOrUpdates: string | any) => Promise<boolean | void> | boolean | void;
  registrarLancamento?: (params: { tipo: 'venda'; titulo: string; valor: number; formaPagamento: string }) => Promise<void>;
  caixaAberto?: boolean;
  isCaixaHistorico?: boolean;
  onOpenCaixa?: () => void;
  storeProfile?: any;
  db?: any;
  user?: any;
  items?: any[];
  categories?: any[];
  addons?: any[];
  addonCategories?: any[];
}

export function DeliveryTab({ orders, updateOrderStatus, registrarLancamento, caixaAberto, isCaixaHistorico = false, onOpenCaixa, storeProfile, db, user, items = [], categories = [], addons = [], addonCategories = [] }: DeliveryTabProps) {
  const FORMAS_PAGAMENTO = resolveFormasPagamento(storeProfile);
  // A aba Delivery acompanha pedidos que precisam de acompanhamento/fulfillment:
  // - qualquer pedido de entrega (delivery), de qualquer origem;
  // - pickup do app do cliente (source 'cardapio'), que ainda precisa ser preparado.
  // - pickup que ainda NAO foi finalizado (ex.: um delivery que o cliente avisou
  //   que vem buscar e o atendente clicou "Retirada no Local"). Esse pedido nasceu
  //   no Delivery e DEVE terminar aqui mesmo, sem mudar de aba. O balcao normal do
  //   PDV nasce 'delivered', entao continua de fora (ja finalizado no caixa).
  const onlyDeliveryAppOrders = orders?.filter(o =>
    o.orderType === 'delivery'
    || (o.orderType === 'pickup' && o.source === 'cardapio')
    || (o.orderType === 'pickup' && !['delivered', 'canceled'].includes(o.status))
  ) || [];

  const loadPhoto = useMemo(() => makeProfilePhotoLoader(user), [user]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(onlyDeliveryAppOrders.length > 0 ? onlyDeliveryAppOrders[0].id : null);
  const [paymentModalOrder, setPaymentModalOrder] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showMotoboyModal, setShowMotoboyModal] = useState<any>(null);
  const [selectedMotoboyId, setSelectedMotoboyId] = useState<string>('');
  const [quickRegisterModal, setQuickRegisterModal] = useState<{isOpen: boolean, name: string, phone: string, address: string} | null>(null);

  // Estados para edição de itens do pedido
  const [isEditItemsOpen, setIsEditItemsOpen] = useState(false);
  const [editItemsCart, setEditItemsCart] = useState<any[]>([]);
  const [editSearch, setEditSearch] = useState<string>('');
  const [selectedItemForDialog, setSelectedItemForDialog] = useState<any | null>(null);
  const [isSavingItems, setIsSavingItems] = useState(false);
  // Regra fixa: pagamento a Prazo ⇒ a taxa de entrega é paga na entrega, direto
  // ao motoboy — sai da cobrança automaticamente, sem perguntar nada.
  // payDeliveryToMotoboy === true no pedido = frete já nasceu fora do total (cardápio).
  const orderFee = Number(paymentModalOrder?.deliveryFee) || 0;
  const feeAlreadyOffTotal = paymentModalOrder?.payDeliveryToMotoboy === true;
  // Subtotal dos itens derivado do que o pedido cobra hoje (desconta ajustes
  // já aplicados na criação): totalAmount − frete quando o frete está no total.
  const orderSubtotal = Math.max(0, (Number(paymentModalOrder?.totalAmount) || 0) - (feeAlreadyOffTotal ? 0 : orderFee));
  // Fechamento centralizado (desconto/acréscimo, split, troco) — mesmo
  // estado/cálculo/modal em Balcão, Mesas e Delivery (components/admin/fechamento).
  const fechamento = useFechamento({
    subtotal: orderSubtotal,
    deliveryFee: orderFee,
    feeAlreadyOffTotal,
    feePaidToMotoboyOnPrazo: true,
    formasPagamento: FORMAS_PAGAMENTO,
  });
  const { toast } = useToast();
  const isReadOnlyHistorico = isCaixaHistorico;
  
  // Clientes Online
  const [onlineCount, setOnlineCount] = useState(0);

  // Rastreia usuários ativos no cardápio
  useEffect(() => {
    if (!db) return;
    
    // Observa sessões ativas da loja
    const q = collection(db, 'active_sessions');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      // Filtra localmente os que deram sinal de vida no último 1 minuto (60000 ms)
      const activeThreshold = Date.now() - 60000;
      let count = 0;
      
      snapshot.forEach(doc => {
        const data = doc.data();
        const matchesStore = !storeProfile?.id || data.storeId === storeProfile.id || data.storeId === 'default' || !data.storeId;
        
        if (data.lastActive && data.lastActive >= activeThreshold && matchesStore) {
          count++;
        }
      });
      setOnlineCount(count);
    });

    return () => unsubscribe();
  }, [db, storeProfile?.id]);

  const filteredOrders = onlyDeliveryAppOrders.filter(o =>
    o.id.includes(searchTerm) ||
    normalizeSearch(o.customerName).includes(normalizeSearch(searchTerm)) ||
    o.customerPhone?.includes(searchTerm)
  );

  const selectedOrder = onlyDeliveryAppOrders?.find(o => o.id === selectedOrderId);

  // Auto-selecionar o primeiro se a busca mudar e o selecionado atual não estiver na lista
  React.useEffect(() => {
    if (filteredOrders.length > 0 && (!selectedOrderId || !filteredOrders.find(o => o.id === selectedOrderId))) {
      setSelectedOrderId(filteredOrders[0].id);
    }
  }, [filteredOrders, selectedOrderId]);

  const getStatusLabel = (status: string, type?: string) => {
    switch (status) {
      case 'pending': return 'Pendente';
      case 'received': return 'Em preparo';
      case 'ready': return 'Pronto';
      case 'out_for_delivery': 
        if (type === 'pickup') return 'Pronto para Retirada';
        if (type === 'dine_in') return 'Prato disponível!';
        return 'Saiu p/ entrega';
      case 'delivered': return 'Foi entregue';
      case 'canceled': return 'Cancelado';
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500 text-white';
      case 'received': return 'bg-blue-500 text-white';
      case 'ready': return 'bg-green-500 text-white';
      case 'out_for_delivery': return 'bg-purple-500 text-white';
      case 'delivered': return 'bg-teal-500 text-white';
      case 'canceled': return 'bg-red-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  const proceedToPayment = (order: any) => {
    if (isReadOnlyHistorico) {
      toast({ title: 'Sessão histórica', description: 'Abra o caixa atual para alterar ou finalizar pedidos.' });
      return;
    }

    if (order.paymentRegistered) {
      // Se já foi pago no Balcão (paymentRegistered = true), não cobra de novo. Apenas marca como entregue.
      updateOrderStatus(order.id, 'delivered');
      toast({ title: 'Pedido entregue!', description: 'Status atualizado (pagamento já havia sido registrado no balcão).' });
      return;
    }
    setPaymentModalOrder(order);
    fechamento.reset();
  };

  const handleOpenEditItems = () => {
    if (!selectedOrder) return;
    setEditItemsCart(
      (selectedOrder.items || []).map((i: any) => ({
        ...i,
        cartItemId: i.cartItemId || `${i.id}-${Date.now()}-${Math.random()}`
      }))
    );
    setEditSearch('');
    setIsEditItemsOpen(true);
  };

  const handleEditDialogAddToCart = (item: any, quantity: number, options: any) => {
    const cartItemId = `${item.id}-${Date.now()}`;
    const unitPrice = item.price + (options.addons || []).reduce((acc: number, a: any) => acc + (a.price || 0), 0);
    setEditItemsCart(prev => [
      ...prev,
      {
        ...item,
        cartItemId,
        quantity,
        addons: options.addons || [],
        notes: options.notes || '',
        unitPrice
      }
    ]);
  };

  const updateEditQuantity = (cartItemId: string, delta: number) => {
    setEditItemsCart(prev => {
      return prev.map(i => {
        if ((i.cartItemId || i.id) === cartItemId) {
          const newQ = i.quantity + delta;
          return newQ > 0 ? { ...i, quantity: newQ } : i;
        }
        return i;
      });
    });
  };

  const removeFromEditCart = (cartItemId: string) => {
    setEditItemsCart(prev => prev.filter(i => (i.cartItemId || i.id) !== cartItemId));
  };

  const handleSaveEditedItems = async () => {
    if (!db || !selectedOrder) return;
    setIsSavingItems(true);

    try {
      const sanitizedItems = editItemsCart.map(i => ({
        id: i.id || '',
        name: i.name || '',
        quantity: Number(i.quantity) || 1,
        unitPrice: Number(i.unitPrice ?? i.price) || 0,
        addons: (i.addons || []).map((addon: any) => ({
          id: addon.id || '',
          name: addon.name || '',
          description: addon.description || '',
          price: Number(addon.price) || 0
        })),
        notes: i.notes || '',
        isCombo: !!i.isCombo,
        comboItems: i.comboItems || null
      }));

      const subtotal = sanitizedItems.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
      const deliveryFee = Number(selectedOrder.deliveryFee) || 0;
      const totalAmount = subtotal + deliveryFee;

      // Grava os itens e ajusta o estoque pelo DELTA (devolve o que foi removido,
      // abate o que foi adicionado), de forma atômica.
      await reconcileOrderStock(db, {
        enableInventory: !!storeProfile?.general?.enableInventory,
        targetItems: sanitizedItems,
        alreadyDeducted: selectedOrder.stockDeductedItems,
        order: {
          ref: doc(db, 'orders', selectedOrder.id),
          mode: 'update',
          data: { items: sanitizedItems, subtotal, totalAmount },
        },
      });

      toast({ title: 'Sucesso', description: 'Itens do pedido atualizados!' });
      setIsEditItemsOpen(false);
    } catch (err: any) {
      console.error('Erro ao salvar edição de itens:', err);
      const isStock = err instanceof InsufficientStockError;
      toast({ variant: 'destructive', title: isStock ? 'Estoque insuficiente' : 'Erro', description: err.message || 'Falha ao atualizar itens.' });
    } finally {
      setIsSavingItems(false);
    }
  };

  // Ao clicar "Marcar Entregue", abre o modal de pagamento
  const handleMarkDelivered = (order: any) => {
    if (isReadOnlyHistorico) {
      toast({ title: 'Sessão histórica', description: 'Pedidos de caixas anteriores ficam apenas para consulta.' });
      return;
    }

    if (order.status === 'delivered') {
      toast({ title: 'Aviso', description: 'Este pedido já foi finalizado e registrado no caixa.' });
      return;
    }
    
    // Se pular direto para Entregue sem informar motoboy, força a escolha do motoboy primeiro
    if (order.orderType === 'delivery' && !order.motoboyId) {
      setShowMotoboyModal({ 
        order, 
        dispatch: false, 
        onConfirm: () => proceedToPayment(order) 
      });
      return;
    }

    proceedToPayment(order);
  };

  if (!caixaAberto && !isCaixaHistorico) {
    return (
      <CaixaFechadoCard
        description={
          <>
            <p>A operação de caixa de um pedido é lançada apenas quando ele é finalizado.</p>
            <p>O caixa precisa estar aberto para registrar vendas de delivery.</p>
            <p className="font-semibold text-slate-600">Abra o caixa antes de finalizar pedidos.</p>
          </>
        }
      >
        <Button
          onClick={() => onOpenCaixa ? onOpenCaixa() : toast({ title: 'Como abrir o caixa:', description: 'Acesse a aba Caixa para abrir o caixa.' })}
          size="sm"
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 font-bold"
        >
          Abrir Caixa
        </Button>
      </CaixaFechadoCard>
    );
  }

  // Confirmar pagamento + registrar no caixa
  const handleConfirmPayment = async () => {
    if (fechamento.isSplitMode && fechamento.paymentSplits.length === 0 && !fechamento.selectedPayment) return;
    if (!fechamento.isSplitMode && !fechamento.selectedPayment) return;
    if (!paymentModalOrder) return;

    setIsProcessing(true);
    try {
      // Splits + paymentString + desconto/acréscimo + regra do Prazo (frete
      // pago direto ao motoboy) vêm do fechamento centralizado
      // (components/admin/fechamento) — igual em todos os canais.
      const { splitsToProcess, paymentString, discount, surcharge, finalTotal: totalCobrado, feeOffApplied } = fechamento.buildCheckout();

      const ownerId = storeProfile?.id || paymentModalOrder.ownerId || (user as any)?.uid || 'default';
      const hasContaCasa = splitsToProcess.some(s => s.methodId === 'conta_casa');
      let contaCasaCustomerId: string | null = null;
      if (hasContaCasa) {
        const phone = paymentModalOrder.customerPhone || '';
        const contaCasaAmount = splitsToProcess
          .filter(s => s.methodId === 'conta_casa')
          .reduce((sum, split) => sum + split.amount, 0);

        if (!phone || phone.replace(/\D/g, '').length < 10) {
          setIsProcessing(false);
          setQuickRegisterModal({ isOpen: true, name: paymentModalOrder.customerName || '', phone: '', address: paymentModalOrder.deliveryAddress || '' });
          return;
        }

        const creditCheck = await validateCustomerCredit(db, ownerId, phone, contaCasaAmount);
        if (!creditCheck.allowed) {
          if (creditCheck.reason === 'not_found') {
            setIsProcessing(false);
            setQuickRegisterModal({ isOpen: true, name: paymentModalOrder.customerName || '', phone, address: paymentModalOrder.deliveryAddress || '' });
            return;
          }

          toast({
            variant: 'destructive',
            title: 'Prazo bloqueado',
            description: creditCheck.message || 'Este pedido passa do limite de prazo do cliente.',
          });
          return;
        }
        contaCasaCustomerId = creditCheck.customer?.id || null;
      }

      // 1. Atualizar status do pedido para 'delivered' e salvar paymentMethod composto.
      // Desconto/acréscimo dados agora acumulam sobre os que o pedido já tinha e
      // totalAmount passa a ser o valor efetivamente cobrado (cupom já imprime).
      const updates: any = { status: 'delivered', paymentMethod: paymentString };
      if (discount > 0 || surcharge > 0) {
        updates.discount = (Number(paymentModalOrder.discount) || 0) + discount;
        updates.surcharge = (Number(paymentModalOrder.surcharge) || 0) + surcharge;
      }
      if (feeOffApplied) {
        updates.payDeliveryToMotoboy = true;
      }
      if (feeOffApplied || discount > 0 || surcharge > 0) {
        updates.totalAmount = totalCobrado;
      }
      const statusUpdated = await updateOrderStatus(paymentModalOrder.id, updates);
      if (statusUpdated === false) return;
      
      // 2. Registrar venda no caixa (se caixa estiver aberto) ou Conta da Casa
      if (caixaAberto) {
        for (const split of splitsToProcess) {
          if (split.methodId === 'conta_casa') {
             if (contaCasaCustomerId) {
                const cId = contaCasaCustomerId;
                const newTrans = doc(collection(db, 'clientes', cId, 'credit_transactions'));
                await setDoc(newTrans, {
                   id: newTrans.id,
                   type: 'debit',
                   amount: split.amount,
                   date: new Date().toISOString(),
                   description: `Delivery #${paymentModalOrder.id.substring(0,5)}`
                });
                await updateDoc(doc(db, 'clientes', cId), { creditBalance: increment(split.amount) });
                // Registra também no caixa (forma "Prazo") para aparecer na lista e
                // participar do fechamento/conferência. Não entra no dinheiro da gaveta.
                if (registrarLancamento) {
                  await registrarLancamento({
                    tipo: 'venda',
                    titulo: `Delivery #${paymentModalOrder.id.substring(0, 5)} - ${paymentModalOrder.customerName} (Prazo)`,
                    valor: split.amount,
                    formaPagamento: 'conta_casa',
                  });
                }
             } else {
                toast({ variant: 'destructive', title: 'Aviso', description: 'Conta da Casa: cliente não encontrado para lançar dívida.' });
             }
          } else if (registrarLancamento) {
            await registrarLancamento({
              tipo: 'venda',
              titulo: `Delivery #${paymentModalOrder.id.substring(0, 5)} - ${paymentModalOrder.customerName}`,
              valor: split.amount,
              formaPagamento: split.methodId,
            });
          }
        }
        toast({ title: 'Pedido finalizado!', description: splitsToProcess.length > 1 ? `Venda registrada em ${splitsToProcess.length} partes.` : `Venda registrada (${paymentString}).` });
      } else {
        toast({ title: 'Pedido finalizado!', description: caixaAberto === false ? 'Caixa fechado - venda não registrada.' : 'Status updated.' });
      }
      setPaymentModalOrder(null);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err.message || 'Falha ao registrar.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const triggerPrint = (order: any) => {
    // Cupom como HTML nativo via QZ (mesmo caminho da sangria), com fallback
    // para impressão pelo navegador (iframe) quando o QZ não estiver presente.
    printOrderReceipt({ order, storeInfo: storeProfile });
  };

  const assignMotoboy = () => {
    if (!showMotoboyModal || !selectedMotoboyId) return;
    
    const updates: any = {};
    let msg = '';
    
    if (selectedMotoboyId === 'retirada') {
      updates.motoboyId = null;
      updates.orderType = 'pickup';
      msg = 'Pedido alterado para Retirada no Local.';
    } else {
      updates.motoboyId = selectedMotoboyId;
      msg = 'O motoboy foi atribuído com sucesso.';
    }

    if (showMotoboyModal.dispatch) {
      updates.status = 'out_for_delivery';
      msg += ' Status alterado para Saiu para Entrega/Retirada.';
    }
    
    updateOrderStatus(showMotoboyModal.order.id, updates);
    const onConfirmCallback = showMotoboyModal.onConfirm;
    
    setShowMotoboyModal(null);
    setSelectedMotoboyId('');
    toast({ title: 'Sucesso', description: msg });

    if (onConfirmCallback) {
      setTimeout(() => onConfirmCallback(), 300);
    }
  };

  // Lista de itens do dialogo "Adicionar / Remover Itens", agrupada por
  // categoria quando o filtro esta em "Todos".
  const editFilteredItems = (items || []).filter((item: any) => {
    if (item.isAvailable === false) return false;
    const matchesSearch = normalizeSearch(item.name).includes(normalizeSearch(editSearch));
    return matchesSearch;
  });
  const editGroupedItems = (categories || [])
    .map((cat: any) => ({
      id: cat.id,
      name: cat.name,
      items: editFilteredItems.filter((it: any) => it.categoryId === cat.id),
    }))
    .filter(group => group.items.length > 0);
  const editUncategorizedItems = editFilteredItems.filter(
    (it: any) => !categories?.some((c: any) => c.id === it.categoryId)
  );
  if (editUncategorizedItems.length > 0) {
    editGroupedItems.push({ id: '__none__', name: 'Outros', items: editUncategorizedItems });
  }
  const { scrollContainerRef, categoryBarRef, setSectionRef, scrollToCategory, activeCategory: editCategory } =
    useCategoryScrollSpy(editGroupedItems.map(g => g.id));
  // Filtro por categoria: ao escolher uma categoria, lista SÓ os produtos dela.
  // "Todos" (ou uma busca ativa) mantém a lista completa com rolagem/scroll-spy.
  const [editSelectedCat, setEditSelectedCat] = useState<string>('all');
  const editActivePill = editSelectedCat === 'all' ? editCategory : editSelectedCat;
  const editIsSearching = editSearch.trim() !== '';
  const editVisibleGroups =
    editSelectedCat === 'all' || editIsSearching ? editGroupedItems : editGroupedItems.filter(g => g.id === editSelectedCat);
  const renderEditItemCard = (item: any) => {
    const outOfStock = !!storeProfile?.general?.enableInventory && typeof item.stockQuantity === 'number' && item.stockQuantity <= 0;
    return (
      <button
        key={item.id}
        onClick={outOfStock ? undefined : () => setSelectedItemForDialog(item)}
        disabled={outOfStock}
        className={`text-left border bg-white p-2.5 rounded-lg transition-colors group flex items-center gap-3 min-h-[80px] relative ${outOfStock ? 'opacity-50 grayscale cursor-not-allowed' : 'hover:border-primary hover:bg-primary/5'}`}
      >
        {outOfStock && (
          <Badge className="absolute top-1.5 left-1.5 bg-slate-700 text-white font-bold text-[9px] px-1.5 py-0.5 rounded z-10">
            Sem estoque
          </Badge>
        )}
        {item.imageUrl ? (
          <div className="relative w-14 h-14 rounded-lg overflow-hidden shrink-0">
            <Image src={item.imageUrl} alt={item.name} fill className="object-cover" sizes="56px" />
          </div>
        ) : (
          <div className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
            <Tag className="h-5 w-5 text-slate-300" />
          </div>
        )}
        <div className="flex flex-col flex-1 min-w-0 gap-1">
          <span className="text-xs font-bold text-slate-700 line-clamp-2 leading-tight group-hover:text-primary">{item.name}</span>
          <span className="text-xs font-black text-green-600">R$ {item.price.toFixed(2)}</span>
        </div>
      </button>
    );
  };

  return (
    <>
    <div className="flex flex-col md:flex-row gap-4 flex-1 w-full overflow-hidden">
      {/* Coluna Esquerda: Lista de Pedidos */}
      <div className="w-full md:w-1/3 flex flex-col gap-3 bg-muted/30 p-2 rounded-xl border h-full">
        <div className="p-2 bg-white rounded-lg shadow-sm border flex gap-2">
          <Input 
            placeholder="Nº do pedido, celular ou nome" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1"
          />
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
          {filteredOrders.length === 0 ? (
            <div className="text-center p-8 text-muted-foreground">Nenhum pedido encontrado.</div>
          ) : (
            filteredOrders.map(order => (
              <div 
                key={order.id} 
                onClick={() => setSelectedOrderId(order.id)}
                className={`px-2 py-1.5 bg-white border-l-3 rounded-r cursor-pointer hover:bg-slate-50 transition-colors ${selectedOrderId === order.id ? 'ring-1 ring-primary/50 bg-blue-50' : ''} ${order.status === 'pending' ? 'border-l-yellow-500' : order.status === 'canceled' ? 'border-l-red-500' : 'border-l-teal-500'}`}
              >
                <div className="flex items-center gap-2">
                  <ContactAvatar
                    phone={order.customerPhone || ''}
                    initials={(order.customerName || '?').split(' ').map((w: string) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                    loadPhoto={loadPhoto}
                    className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 text-[10px] font-bold text-white"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">#{order.id.substring(0, 5)}</span>
                        <span className="text-xs font-semibold text-slate-800 truncate">{order.customerName}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-xs font-black text-green-600">R$ {order.totalAmount?.toFixed(2)}</span>
                        <Badge className={`text-[8px] uppercase font-bold px-1.5 py-0 h-4 leading-none ${getStatusColor(order.status)}`}>
                          {getStatusLabel(order.status, order.orderType)}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">{order.customerPhone}</span>
                      <span className="text-[10px] text-slate-400">· {new Date(order.orderDateTime).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        
        <div className="bg-white p-2.5 rounded-lg shadow-sm border flex justify-between items-center font-bold text-base">
          <div className="bg-red-500 text-white px-4 py-2 rounded-md">
            Total: R$ {filteredOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0).toFixed(2)}
          </div>
          <div className="bg-green-500 text-white px-4 py-2 rounded-md flex items-center gap-2">
            {onlineCount} Cliente{onlineCount !== 1 ? 's' : ''} online <Clock className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Coluna Direita: Detalhes do Pedido Selecionado */}
      <div className="w-full md:w-2/3 bg-white rounded-xl shadow-sm border p-4 flex flex-col h-full overflow-y-auto custom-scrollbar">
        {!selectedOrder ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground flex-col gap-2">
            <Info className="h-10 w-10 text-slate-300" />
            <p>Selecione um pedido para ver os detalhes</p>
          </div>
        ) : (
          <>
            {/* Cabeçalho do Pedido */}
            <div className="flex justify-between items-center border-b pb-2 mb-2">
              <div>
                <h2 className="text-base font-bold text-slate-800">
                  Pedido #{selectedOrder.id.substring(0, 5)} <span className="text-muted-foreground font-normal text-xs">({selectedOrder.id})</span>
                </h2>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>CPF: Não informado</span>
                  {selectedOrder.motoboyId && (
                    <span className="font-medium text-amber-600">
                      🏍️ {storeProfile?.motoboys?.find((m:any) => m.id === selectedOrder.motoboyId)?.name || 'Desconhecido'}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-teal-50 text-teal-700 border-teal-200 text-[10px]">{new Date(selectedOrder.orderDateTime).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}</Badge>
                <Button size="icon" className="bg-amber-500 hover:bg-amber-600 text-white h-8 w-8" onClick={() => setShowMotoboyModal({ order: selectedOrder, dispatch: false })} disabled={isReadOnlyHistorico}>
                  <Bike className="h-4 w-4" />
                </Button>
                <Button size="icon" className="bg-blue-500 hover:bg-blue-600 text-white h-8 w-8" onClick={() => triggerPrint(selectedOrder)}>
                  <Printer className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Timeline compacta */}
            <div className="flex items-center gap-1 mb-2 px-1 py-1.5 bg-slate-50 rounded-lg">
              <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-slate-200 -z-10"></div>
              {[
                { key: 'received', label: 'Recebido', active: ['received','ready','out_for_delivery','delivered'].includes(selectedOrder.status), action: () => { 
                  updateOrderStatus(selectedOrder.id, 'received'); 
                  if (storeProfile?.general?.manualPrint || storeProfile?.manualPrint) triggerPrint(selectedOrder); 
                } },
                { key: 'ready', label: 'Pronto', active: ['ready','out_for_delivery','delivered'].includes(selectedOrder.status), action: () => updateOrderStatus(selectedOrder.id, 'ready') },
                { key: 'out', label: selectedOrder.orderType === 'pickup' ? 'Retirada' : selectedOrder.orderType === 'dine_in' ? 'Disponível' : 'Saiu entrega', active: ['out_for_delivery','delivered'].includes(selectedOrder.status), action: () => {
                  if (selectedOrder.orderType === 'delivery' && !selectedOrder.motoboyId) {
                    setShowMotoboyModal({ order: selectedOrder, dispatch: true });
                  } else {
                    updateOrderStatus(selectedOrder.id, 'out_for_delivery');
                  }
                } },
                { key: 'delivered', label: 'Entregue', active: selectedOrder.status === 'delivered', action: () => handleMarkDelivered(selectedOrder) },
              ].map(step => (
                <button 
                  key={step.key} 
                  onClick={step.action} 
                  disabled={isReadOnlyHistorico || selectedOrder.status === 'delivered' || selectedOrder.status === 'canceled'}
                  className={`flex-1 flex items-center justify-center gap-1 py-1 rounded text-[10px] font-bold transition-colors ${step.active ? 'bg-teal-500 text-white' : 'bg-white border text-slate-500 hover:bg-teal-50'} disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  <div className={`h-2.5 w-2.5 rounded-full ${step.active ? 'bg-white' : 'bg-slate-300'}`}></div>
                  {step.label}
                </button>
              ))}
              <button 
                onClick={() => updateOrderStatus(selectedOrder.id, 'canceled')} 
                disabled={isReadOnlyHistorico || selectedOrder.status === 'delivered' || selectedOrder.status === 'canceled'}
                className={`flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-colors ${selectedOrder.status === 'canceled' ? 'bg-red-500 text-white' : 'bg-white border border-red-200 text-red-500 hover:bg-red-50'} disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                ✕
              </button>
            </div>

            {/* Endereço + Resumo Financeiro - Linha compacta */}
            <div className="flex items-center gap-2 mb-2 text-xs">
              <div className="border rounded px-2 py-1 text-red-500 font-medium flex items-center gap-1 flex-1 truncate">
                {selectedOrder.orderType === 'pickup' ? '🏪 Retirar no Local' : selectedOrder.orderType === 'dine_in' ? '🍽️ Comer no Local' : `🛵 ${selectedOrder.deliveryAddress}`}
              </div>
              <div className="bg-[#f05a66] text-white px-3 py-1 rounded font-bold whitespace-nowrap">
                R$ {selectedOrder.totalAmount?.toFixed(2)}
              </div>
              <div className="border px-3 py-1 rounded text-slate-700 font-medium whitespace-nowrap">
                {selectedOrder.paymentMethod === 'conta_casa' ? 'Prazo' : (selectedOrder.paymentMethod || 'Não definido')}
              </div>
              {selectedOrder.orderType === 'delivery' && (
                <div className="border border-teal-200 bg-teal-50 px-3 py-1 rounded text-teal-700 font-bold whitespace-nowrap">
                  🛵 Frete: R$ {selectedOrder.deliveryFee?.toFixed(2) || '0.00'}
                  {selectedOrder.distanceKm && <span className="text-[10px] font-normal ml-1">({selectedOrder.distanceKm}km)</span>}
                  {selectedOrder.payDeliveryToMotoboy === true && <span className="text-[10px] font-normal ml-1">· pago ao motoboy</span>}
                </div>
              )}
            </div>

            <div className="flex justify-between items-center mb-1.5 shrink-0">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Itens do Pedido</span>
              {!isReadOnlyHistorico && selectedOrder.status !== 'delivered' && selectedOrder.status !== 'canceled' && (
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="h-7 text-xs border-primary text-primary hover:bg-primary/5 font-bold gap-1 px-2.5"
                  onClick={handleOpenEditItems}
                >
                  <Plus className="h-3.5 w-3.5" /> Adicionar / Remover Itens
                </Button>
              )}
            </div>

            {/* Tabela de Itens */}
            <div className="flex-1 overflow-y-auto border rounded-lg">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-700 uppercase bg-slate-50 border-b">
                  <tr>
                    <th className="px-4 py-3 w-16">Qtde</th>
                    <th className="px-4 py-3">Título</th>
                    <th className="px-4 py-3">Descrição</th>
                    <th className="px-4 py-3 text-right">Valor unitário</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3">OBS</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedOrder.items?.map((item: any, idx: number) => (
                    <tr key={idx} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="px-4 py-3 text-center">{item.quantity}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{item.name}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {item.addons?.map((a: any) => `1x ${a.name}${a.price > 0 ? ` - R$ ${a.price.toFixed(2)}` : ''}`).join('\n')}
                      </td>
                      <td className="px-4 py-3 text-right">R$ {item.unitPrice?.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-medium">R$ {(item.unitPrice * item.quantity).toFixed(2)}</td>
                      <td className="px-4 py-3 text-xs text-red-500">{item.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </>
        )}
      </div>
    </div>

    {/* Modal: Forma de Pagamento para Concluir Pedido — fechamento centralizado
        (desconto/acréscimo, split, troco, Prazo/frete ao motoboy) */}
    <FechamentoModal
      open={!!paymentModalOrder}
      onOpenChange={(open) => { if (!open) { setPaymentModalOrder(null); fechamento.reset(); } }}
      fechamento={fechamento}
      title={`Pagamento #${paymentModalOrder?.id?.substring(0, 5) || ''}`}
      subtitle={paymentModalOrder?.customerName ? `${paymentModalOrder.orderType === 'pickup' ? 'Retirada' : 'Delivery'} · ${paymentModalOrder.customerName}` : undefined}
      items={paymentModalOrder?.items || []}
      caixaAberto={caixaAberto}
      isSubmitting={isProcessing}
      onConfirm={handleConfirmPayment}
    />

      {/* Modal Vincular Entregador */}
      <Dialog open={!!showMotoboyModal} onOpenChange={(open) => !open && setShowMotoboyModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Informe o Entregador</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <Select value={selectedMotoboyId} onValueChange={setSelectedMotoboyId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um motoboy ou Retirada..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="retirada" className="text-amber-600 font-bold">Retirou no local</SelectItem>
                {storeProfile?.motoboys?.map((m: any) => (
                  <SelectItem key={m.id} value={m.id}>{m.name} (R$ {Number(m.fee || 0).toFixed(2)})</SelectItem>
                ))}
                {(!storeProfile?.motoboys || storeProfile.motoboys.length === 0) && (
                  <SelectItem value="none" disabled>Nenhum motoboy cadastrado</SelectItem>
                )}
              </SelectContent>
            </Select>
            {showMotoboyModal?.dispatch && (
              <p className="text-xs text-muted-foreground bg-slate-50 p-2 rounded border border-slate-100">
                O pedido será marcado como <strong>{selectedMotoboyId === 'retirada' ? 'Retirada no Local' : 'Saiu para Entrega'}</strong> após confirmar.
              </p>
            )}
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setShowMotoboyModal(null)}>Cancelar</Button>
            <Button variant="default" className="bg-teal-500 hover:bg-teal-600" onClick={assignMotoboy} disabled={!selectedMotoboyId || selectedMotoboyId === 'none'}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {quickRegisterModal && (
        <QuickRegisterClientModal
          isOpen={quickRegisterModal.isOpen}
          onClose={() => setQuickRegisterModal(null)}
          onSuccess={() => {
            setQuickRegisterModal(null);
            handleConfirmPayment();
          }}
          db={db}
          ownerId={storeProfile?.id || (user as any)?.uid || 'default'}
          initialName={quickRegisterModal.name}
          initialPhone={quickRegisterModal.phone}
          initialAddress={quickRegisterModal.address}
        />
      )}
      
      {/* Modal: Editar Itens do Pedido */}
      <Dialog open={isEditItemsOpen} onOpenChange={setIsEditItemsOpen}>
        <DialogContent className="max-w-none w-screen h-screen m-0 rounded-none border-none p-0 flex flex-col">
          <DialogHeader className="p-4 border-b shrink-0 bg-slate-50">
            <DialogTitle className="text-base font-bold text-slate-800 flex justify-between items-center gap-3 pr-8">
              <span>🛒 Editar Itens do Pedido #{selectedOrder?.id?.substring(0, 5)}</span>
              <span className="text-xs font-normal text-muted-foreground">Preços e adicionais do cardápio ativo</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Adicione novos itens do cardápio ou ajuste as quantidades dos itens já incluídos neste pedido.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* Esquerda: Carrinho/Itens do Pedido atualizado localmente */}
            <div className="w-1/2 flex flex-col border-r bg-slate-50/50 min-h-0 overflow-hidden">
              <div className="p-3 border-b shrink-0 bg-slate-100 flex justify-between items-center">
                <span className="text-xs font-bold text-slate-600 uppercase">Resumo da Comanda</span>
                <span className="text-xs font-bold text-slate-500">Qtd Itens: {editItemsCart.reduce((sum, i) => sum + i.quantity, 0)}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                {editItemsCart.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
                    <ShoppingCart className="h-10 w-10 text-slate-300" />
                    <p className="text-sm">Nenhum item no pedido. Adicione itens do cardápio ao lado.</p>
                  </div>
                ) : (
                  editItemsCart.map((item, index) => (
                    <div key={item.cartItemId || item.id || index} className="bg-white p-3 border rounded-lg flex items-center justify-between gap-3 shadow-sm font-medium">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{item.name}</p>
                        <p className="text-xs text-green-600 font-bold">R$ {(item.unitPrice || item.price).toFixed(2)}</p>
                        {item.addons && item.addons.length > 0 && (
                          <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                            {item.addons.map((a: any) => a.name).join(', ')}
                          </div>
                        )}
                        {item.notes && <div className="text-[10px] text-orange-500 mt-0.5">Obs: {item.notes}</div>}
                      </div>
                      <div className="flex items-center gap-1.5 bg-slate-100 rounded-md p-0.5 border shrink-0">
                        <button onClick={() => updateEditQuantity(item.cartItemId || item.id, -1)} className="h-6 w-6 flex items-center justify-center bg-white rounded shadow-sm hover:text-primary"><Minus className="h-3 w-3" /></button>
                        <span className="w-6 text-center text-xs font-bold">{item.quantity}</span>
                        <button onClick={() => updateEditQuantity(item.cartItemId || item.id, 1)} className="h-6 w-6 flex items-center justify-center bg-white rounded shadow-sm hover:text-primary"><Plus className="h-3 w-3" /></button>
                      </div>
                      <button onClick={() => removeFromEditCart(item.cartItemId || item.id)} className="h-8 w-8 flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 rounded shrink-0">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="p-4 border-t bg-white shrink-0">
                <div className="flex justify-between items-center text-sm font-black text-slate-800 mb-1">
                  <span>Subtotal:</span>
                  <span>R$ {editItemsCart.reduce((sum, item) => sum + ((item.unitPrice || item.price) * item.quantity), 0).toFixed(2)}</span>
                </div>
                {selectedOrder?.orderType === 'delivery' && (
                  <div className="flex justify-between items-center text-xs text-muted-foreground mb-3">
                    <span>Taxa de Entrega:</span>
                    <span>R$ {Number(selectedOrder.deliveryFee || 0).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-base font-black text-slate-900 border-t pt-2">
                  <span>Total Geral:</span>
                  <span>R$ {(editItemsCart.reduce((sum, item) => sum + ((item.unitPrice || item.price) * item.quantity), 0) + Number(selectedOrder?.deliveryFee || 0)).toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Direita: Seleção rápida de itens do cardápio */}
            <div className="w-1/2 flex flex-col bg-white min-h-0 overflow-hidden">
              <div ref={categoryBarRef} className="p-3 border-b shrink-0 flex gap-2 overflow-x-auto custom-scrollbar bg-slate-50">
                <Badge
                  data-cat-tab="all"
                  variant="secondary"
                  className={`cursor-pointer whitespace-nowrap text-xs py-1 px-2.5 ${editActivePill === 'all' ? 'bg-primary text-primary-foreground' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                  onClick={() => { setEditSearch(''); setEditSelectedCat('all'); scrollToCategory('all'); }}
                >
                  Todos
                </Badge>
                {editGroupedItems.map(group => (
                  <Badge
                    key={group.id}
                    data-cat-tab={group.id}
                    variant="secondary"
                    className={`cursor-pointer whitespace-nowrap text-xs py-1 px-2.5 ${editActivePill === group.id ? 'bg-primary text-primary-foreground' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                    onClick={() => { setEditSelectedCat(group.id); scrollToCategory(group.id); }}
                  >
                    {group.name}
                  </Badge>
                ))}
              </div>
              <div className="p-3 border-b shrink-0 flex items-center bg-white">
                <Input
                  placeholder="Pesquisar produto..."
                  value={editSearch}
                  onChange={(e) => setEditSearch(e.target.value)}
                  className="h-8 text-xs font-medium"
                />
              </div>
              <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-3 custom-scrollbar bg-slate-50/30">
                {editVisibleGroups.length === 0 ? (
                  <div className="text-center text-sm text-slate-400 py-8">Nenhum produto encontrado.</div>
                ) : (
                  editVisibleGroups.map(group => (
                    <div key={group.id} ref={setSectionRef(group.id)} className="mb-4">
                      <h2 className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm py-1.5 mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                        {group.name}
                      </h2>
                      <div className="grid grid-cols-2 gap-2 content-start">
                        {group.items.map(renderEditItemCard)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="p-3 border-t shrink-0 bg-slate-50 flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsEditItemsOpen(false)}>Cancelar</Button>
            <Button 
              size="sm"
              disabled={isSavingItems} 
              onClick={handleSaveEditedItems}
              className="bg-green-600 hover:bg-green-700 text-white font-bold"
            >
              {isSavingItems ? 'Salvando...' : '💾 Salvar Alterações'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MenuItemDialog
        item={selectedItemForDialog}
        isOpen={!!selectedItemForDialog}
        onClose={() => setSelectedItemForDialog(null)}
        allAddons={addons}
        addonCategories={addonCategories}
        onAddToCart={handleEditDialogAddToCart}
        menuItems={items}
        enableInventory={storeProfile?.general?.enableInventory || false}
      />
    </>
  );
}
