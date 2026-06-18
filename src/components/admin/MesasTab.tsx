'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import CaixaFechadoCard from '@/components/shared/CaixaFechadoCard';
import { Input } from '@/components/ui/input';
import { ShoppingCart, Plus, Minus, Search, Tag, X, CreditCard, Banknote, QrCode, Wallet, ArrowLeft, Printer, Globe, ArrowLeftRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import { collection, doc, setDoc, updateDoc, query, where, getDocs, increment } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { printOrderReceipt } from '@/lib/order-receipt-html';
import { QuickRegisterClientModal } from './QuickRegisterClientModal';
import { getPhoneVariants, normalizeCreditPhone, validateCustomerCredit, sumPendingCreditOrdersForOwner, isCreditEnabled } from '@/lib/customer-credit';
import { isItemVisibleInChannel } from '@/lib/menu-visibility';
import { useCategoryScrollSpy } from '@/hooks/useCategoryScrollSpy';
import { normalizeSearch, removeAccents } from '@/lib/utils';
import { reconcileOrderStock, releaseOrderStock, InsufficientStockError } from '@/lib/inventory';
import { syncCustomerFromOrder } from '@/lib/customers/customer-sync';
import { ContactAvatar } from '@/components/shared/ContactAvatar';
import { makeProfilePhotoLoader } from '@/lib/wapi/profile-photo';

import { MenuItemDialog } from '@/components/menu/MenuItemDialog';

interface MesasTabProps {
  orders?: any[];
  categories?: any[];
  items?: any[];
  db?: any;
  user?: any;
  registrarLancamento?: (params: { tipo: 'venda'; titulo: string; valor: number; formaPagamento: string }) => Promise<void>;
  caixaAberto?: boolean;
  storeInfo?: any;
  onOpenCaixa?: () => void;
  addons?: any[];
  addonCategories?: any[];
  onUnsavedChangesChange?: (hasChanges: boolean) => void;
}

const DEFAULT_FORMAS_PAGAMENTO = [
  { id: 'dinheiro', label: 'Dinheiro', icon: '💵', active: true },
  { id: 'pix', label: 'Pix', icon: '📱', active: true },
  { id: 'debito', label: 'Débito', icon: '💳', active: true },
  { id: 'credito', label: 'Crédito', icon: '💳', active: true },
];

export function MesasTab({ orders = [], categories = [], items = [], db, user, registrarLancamento, caixaAberto = false, storeInfo, onOpenCaixa, addons = [], addonCategories = [], onUnsavedChangesChange }: MesasTabProps) {
  const FORMAS_PAGAMENTO = (storeInfo?.paymentMethods && storeInfo.paymentMethods.length > 0 ? storeInfo.paymentMethods : DEFAULT_FORMAS_PAGAMENTO).filter((m: any) => m.active);
  if (!FORMAS_PAGAMENTO.find((m: any) => m.id === 'conta_casa')) {
    FORMAS_PAGAMENTO.push({ id: 'conta_casa', label: 'Prazo', icon: '📝', active: true });
  }
  const { toast } = useToast();
  const [activeSubTab, setActiveSubTab] = useState<'abertas' | 'finalizadas'>('abertas');
  const [searchTable, setSearchTable] = useState('');
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [selectedItemForDialog, setSelectedItemForDialog] = useState<any | null>(null);

  // PDV States
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<any[]>([]);
  const [originalCart, setOriginalCart] = useState<any[]>([]);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  
  // Impressão e Pagamento

  const [reopenModalOpen, setReopenModalOpen] = useState(false);
  const [pendingItemToAdd, setPendingItemToAdd] = useState<any>(null);
  const [receiptPrinted, setReceiptPrinted] = useState(false);

  const activeOrders = orders?.filter(o => o.orderType === 'dine_in' && o.status !== 'delivered' && o.status !== 'canceled') || [];
  
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [paymentSplits, setPaymentSplits] = useState<{methodId: string, label: string, amount: number, received?: number}[]>([]);
  const [selectedPayment, setSelectedPayment] = useState('');
  const [valorRecebido, setValorRecebido] = useState<string>('');
  const [quickRegisterModal, setQuickRegisterModal] = useState<{isOpen: boolean, name: string, phone: string, address: string} | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Cliente da comanda (autocomplete por nome/celular) — vincula a venda ao
  // cadastro e habilita o pagamento no Prazo, igual ao Balcao.
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [allCustomers, setAllCustomers] = useState<any[]>([]);
  const [activeLookupField, setActiveLookupField] = useState<null | 'name' | 'phone'>(null);
  const [customerDirty, setCustomerDirty] = useState(false);
  // Seletor de mesa: usado tanto para "Trocar de mesa" (currentTable preenchido)
  // quanto para "Atribuir mesa" a um pedido online sem mesa (currentTable null).
  const [tablePickerFor, setTablePickerFor] = useState<{ orderId: string; currentTable: number | null } | null>(null);

  // Derivando mesas
  const tables = Array.from({ length: 15 }, (_, i) => i + 1);
  
  const activeTableNumbers = activeOrders.map(o => o.tableNumber).filter(Boolean);
  // Pedidos de mesa ativos que ainda não têm mesa (ex.: pedido online quando todas
  // as mesas estavam ocupadas no momento da auto-atribuição).
  const ordersSemMesa = activeOrders.filter(o => !o.tableNumber);
  // Modo manual = sem impressão automática (o operador imprime ao aceitar).
  const isManualPrint = !!(storeInfo?.general?.manualPrint || storeInfo?.manualPrint);

  const loadPhoto = useMemo(() => makeProfilePhotoLoader(user), [user]);

  // Cupom como HTML nativo via QZ (mesmo caminho da sangria), com fallback
  // para impressão pelo navegador (iframe) quando o QZ não estiver presente.
  const printReceiptNow = (order: any, isKitchen: boolean) => {
    printOrderReceipt({ order, storeInfo, isKitchen });
  };

  const lastSelectedTableRef = React.useRef<number | null>(null);
  const hasUnsavedChanges = JSON.stringify(cart) !== JSON.stringify(originalCart) || customerDirty;

  useEffect(() => {
    onUnsavedChangesChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChangesChange]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (selectedTable) {
      const activeOrder = activeOrders.find(o => o.tableNumber === selectedTable);
      const tableChanged = lastSelectedTableRef.current !== selectedTable;
      lastSelectedTableRef.current = selectedTable;

      if (activeOrder) {
        // Sincroniza com o pedido do servidor (a menos que haja edições locais
        // ainda não salvas, para não sobrescrever o que o operador está digitando).
        if (tableChanged || !hasUnsavedChanges) {
          setCart(activeOrder.items || []);
          setOriginalCart(activeOrder.items || []);
          setActiveOrderId(activeOrder.id);
          setReceiptPrinted(activeOrder.status === 'awaiting_payment');
          // Carrega o cliente vinculado à comanda (ignora o rótulo "Mesa N").
          const loadedName = activeOrder.customerName && !/^Mesa\s*\d+$/i.test(activeOrder.customerName) ? activeOrder.customerName : '';
          setCustomerName(loadedName);
          setCustomerPhone(activeOrder.customerPhone || '');
          setCustomerDirty(false);
        }
      } else if (tableChanged) {
        // Só limpamos ao TROCAR para uma mesa que está realmente vazia.
        // Importante: se continuamos na MESMA mesa e o pedido ainda não aparece no
        // snapshot, NÃO limpamos — pode ser um pedido recém-criado que ainda não
        // voltou pelo tempo real. Sem isso, a comanda era apagada logo após salvar.
        setCart([]);
        setOriginalCart([]);
        setActiveOrderId(null);
        setReceiptPrinted(false);
        setCustomerName('');
        setCustomerPhone('');
        setCustomerDirty(false);
      }
    } else {
      lastSelectedTableRef.current = null;
      setCart([]);
      setOriginalCart([]);
      setActiveOrderId(null);
      setReceiptPrinted(false);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerDirty(false);
    }
  }, [selectedTable, orders]); // depends on orders to sync in real-time

  // ── Autocomplete de cliente (nome/celular) na comanda da mesa ──
  // Carrega a lista de clientes uma vez (mesma fonte do Balcao).
  useEffect(() => {
    const ownerId = storeInfo?.id || user?.uid;
    if (!db || !ownerId) return;
    let ignore = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'clientes'), where('ownerId', '==', ownerId)));
        if (!ignore) setAllCustomers(snap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error('Erro ao carregar clientes (mesas):', e);
      }
    })();
    return () => { ignore = true; };
  }, [db, storeInfo?.id, user?.uid]);

  const customerMatches = useMemo(() => {
    if (!activeLookupField || allCustomers.length === 0) return [] as any[];
    if (activeLookupField === 'phone') {
      const term = normalizeCreditPhone(customerPhone);
      if (term.length < 3) return [];
      return allCustomers.filter(c => normalizeCreditPhone(String(c.celular || '')).includes(term)).slice(0, 6);
    }
    const term = removeAccents(customerName.toLowerCase()).trim();
    if (term.length < 2) return [];
    return allCustomers
      .filter(c => removeAccents(String(c.nome || c.name || '').toLowerCase()).includes(term))
      .slice(0, 6);
  }, [activeLookupField, customerName, customerPhone, allCustomers]);

  // Cliente do cadastro que casa com o telefone atual — usado para indicar que o
  // Prazo está ativo (ao escolher na lista ou ao reabrir uma comanda vinculada).
  const creditCustomer = useMemo(() => {
    if (normalizeCreditPhone(customerPhone).length < 10 || allCustomers.length === 0) return null;
    const variants = new Set(getPhoneVariants(customerPhone));
    return allCustomers.find(c => variants.has(String(c.celular || ''))) || null;
  }, [customerPhone, allCustomers]);

  const applyCustomer = (c: any) => {
    const name = String(c.nome || c.name || '').trim();
    const phone = String(c.celular || '');
    if (name) setCustomerName(name);
    if (phone) setCustomerPhone(phone);
    setActiveLookupField(null);
    setCustomerDirty(true);
  };

  const clearCustomerFields = () => {
    setCustomerName('');
    setCustomerPhone('');
    setActiveLookupField(null);
    setCustomerDirty(true);
  };

  const cartTotal = cart.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);

  const filteredItems = items?.filter(item => {
    if (item.isAvailable === false) return false;
    if (!isItemVisibleInChannel(item, 'dine_in')) return false;
    const matchesSearch = normalizeSearch(item.name).includes(normalizeSearch(searchTerm));
    return matchesSearch;
  }) || [];

  // Os produtos sao sempre agrupados por categoria; clicar numa categoria
  // rola ate a secao e rolar a lista atualiza a pill ativa (igual cliente).
  const groupedItems = (categories || [])
    .map((cat: any) => ({
      id: cat.id,
      name: cat.name,
      items: filteredItems.filter((it: any) => it.categoryId === cat.id),
    }))
    .filter(group => group.items.length > 0);
  const uncategorizedItems = filteredItems.filter(
    (it: any) => !categories?.some((c: any) => c.id === it.categoryId)
  );
  if (uncategorizedItems.length > 0) {
    groupedItems.push({ id: '__none__', name: 'Outros', items: uncategorizedItems });
  }
  const { scrollContainerRef, categoryBarRef, setSectionRef, scrollToCategory, activeCategory } =
    useCategoryScrollSpy(groupedItems.map(g => g.id));
  // Filtro por categoria: ao escolher uma categoria, lista SÓ os produtos dela.
  // "Todos" (ou uma busca ativa) mantém a lista completa com rolagem/scroll-spy.
  const [selectedCat, setSelectedCat] = useState<string>('all');
  const activePill = selectedCat === 'all' ? activeCategory : selectedCat;
  const isSearching = searchTerm.trim() !== '';
  const visibleGroups =
    selectedCat === 'all' || isSearching ? groupedItems : groupedItems.filter(g => g.id === selectedCat);

  const itemNeedsCustomization = (item: any) => {
    const hasNormalAddons = Array.isArray(item.addonIds) && item.addonIds.length > 0;
    const hasAddonGroups = Array.isArray(item.addonGroups) && item.addonGroups.some((group: any) => {
      return (Array.isArray(group.addonIds) && group.addonIds.length > 0)
        || group.addonCategoryId
        || group.addonCategoryName;
    });
    return hasNormalAddons || hasAddonGroups;
  };

  const addToCart = (item: any) => {
    if (activeOrderId) {
      const activeOrder = activeOrders.find(o => o.tableNumber === selectedTable);
      if (activeOrder && activeOrder.status === 'awaiting_payment') {
        setPendingItemToAdd(item);
        setReopenModalOpen(true);
        return;
      }
    }
    
    if (itemNeedsCustomization(item)) {
      setSelectedItemForDialog(item);
    } else {
      setCart(prev => {
        const existingIndex = prev.findIndex(i => i.id === item.id && (!i.addons || i.addons.length === 0));
        if (existingIndex > -1) {
          return prev.map((i, idx) => idx === existingIndex ? { ...i, quantity: i.quantity + 1 } : i);
        } else {
          return [
            ...prev,
            {
              ...item,
              cartItemId: `${item.id}-${Date.now()}`,
              quantity: 1,
              addons: [],
              notes: '',
              unitPrice: item.price
            }
          ];
        }
      });
    }
  };

  const handleDialogAddToCart = (item: any, quantity: number, options: any) => {
    const cartItemId = `${item.id}-${Date.now()}`;
    const unitPrice = item.price + (options.addons || []).reduce((acc: number, a: any) => acc + (a.price || 0), 0);
    setCart(prev => [
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

  const updateQuantity = (cartItemId: string, delta: number) => {
    setCart(prev => {
      return prev.map(i => {
        const key = i.cartItemId || i.id;
        if (key === cartItemId) {
          const newQ = i.quantity + delta;
          return newQ > 0 ? { ...i, quantity: newQ } : i;
        }
        return i;
      });
    });
  };

  const removeFromCart = (cartItemId: string) => {
    setCart(prev => prev.filter(i => (i.cartItemId || i.id) !== cartItemId));
  };

  const handleBackToGrid = () => {
    if (hasUnsavedChanges) {
      if (confirm(`Você tem alterações não salvas na Mesa ${selectedTable}! Deseja realmente sair sem salvar?`)) {
        setSelectedTable(null);
      }
    } else {
      setSelectedTable(null);
    }
  };

  const handleCancelTable = async () => {
    if (!db || !selectedTable) return;
    if (!confirm(`Cancelar a Mesa ${selectedTable}? Todos os itens serão removidos e a comanda será fechada.`)) return;
    
    try {
      if (activeOrderId) {
        const activeOrder = activeOrders.find(o => o.id === activeOrderId);
        // Devolve ao estoque exatamente o que o pedido reservou e grava o
        // cancelamento na mesma transação.
        await releaseOrderStock(db, {
          enableInventory: !!storeInfo?.general?.enableInventory,
          alreadyDeducted: activeOrder?.stockDeductedItems,
          order: {
            ref: doc(db, 'orders', activeOrderId),
            mode: 'update',
            data: { status: 'canceled', items: [], totalAmount: 0, subtotal: 0 },
          },
        });
      }
      setCart([]);
      setOriginalCart([]);
      setActiveOrderId(null);
      setReceiptPrinted(false);
      toast({ title: `Mesa ${selectedTable} cancelada com sucesso.` });
      setSelectedTable(null);
    } catch (err: any) {
      console.error('Erro ao cancelar mesa:', err);
      toast({ title: 'Erro ao cancelar mesa', description: err?.message || '', variant: 'destructive' });
    }
  };

  // Aceita um pedido online (comer no local): imprime o ticket de produção e
  // marca como aceito — o que para o alarme (gate em page.tsx) e tira o piscar.
  const handleAcceptOnlineOrder = async (order: any) => {
    if (!db || !order?.id) return;
    try {
      // No modo automático o ticket já foi impresso na chegada — não reimprime.
      // No modo manual, imprime agora.
      if (isManualPrint) {
        setReceiptPrinted(false);
        printReceiptNow({
          id: order.id,
          customerName: order.customerName || 'Cliente',
          orderType: 'dine_in',
          items: order.items || [],
          orderDateTime: order.orderDateTime || new Date().toISOString(),
          tableNumber: order.tableNumber || null,
        }, true);
      }
      await updateDoc(doc(db, 'orders', order.id), { accepted: true });
      toast({ title: 'Pedido aceito', description: isManualPrint ? 'Ticket enviado para produção.' : 'Pedido confirmado.' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível aceitar o pedido.' });
    }
  };

  // Exclui (cancela) um pedido online da fila. Segue o mesmo caminho do
  // cancelamento de mesa: devolve o estoque reservado e marca como canceled,
  // o que o tira da fila (activeOrders exclui status 'canceled').
  const handleRejectOnlineOrder = async (order: any) => {
    if (!db || !order?.id) return;
    if (!confirm(`Excluir o pedido online de ${order.customerName || 'Cliente'}? O pedido será cancelado e os itens devolvidos ao estoque.`)) return;
    try {
      await releaseOrderStock(db, {
        enableInventory: !!storeInfo?.general?.enableInventory,
        alreadyDeducted: order?.stockDeductedItems,
        order: {
          ref: doc(db, 'orders', order.id),
          mode: 'update',
          data: { status: 'canceled', items: [], totalAmount: 0, subtotal: 0 },
        },
      });
      toast({ title: 'Pedido excluído', description: 'O pedido online foi cancelado.' });
    } catch (e: any) {
      console.error('Erro ao excluir pedido online:', e);
      toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível excluir o pedido.' });
    }
  };

  const handlePickTable = async (orderId: string, targetTable: number) => {
    if (!db || !orderId) return;
    try {
      setIsSubmitting(true);
      const estavaNaMesa = tablePickerFor?.currentTable;
      // Pôr na mesa também aceita o pedido (para o alarme caso ainda não tenha aceitado).
      await updateDoc(doc(db, 'orders', orderId), { tableNumber: targetTable, accepted: true });
      toast({ title: `Pedido movido para a Mesa ${targetTable}.` });
      setTablePickerFor(null);
      // Se estávamos com uma mesa aberta (troca de mesa), volta para a grade para
      // refletir o novo layout sem depender do eco do tempo real.
      if (estavaNaMesa) {
        setSelectedTable(null);
      }
    } catch (e) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível mover o pedido.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveOrder = async () => {
    if (!db || !user || !selectedTable || cart.length === 0) return;
    setIsSubmitting(true);
    
    // Itens NOVOS (diferença vs comanda atual) para imprimir na cozinha.
    const newItemsToPrint: any[] = [];
    cart.forEach(item => {
      const originalItem = originalCart.find(oi => (oi.cartItemId || oi.id) === (item.cartItemId || item.id));
      const diffQty = item.quantity - (originalItem ? originalItem.quantity : 0);
      if (diffQty > 0) newItemsToPrint.push({ ...item, quantity: diffQty });
    });

    try {
      const activeOrder = activeOrderId ? activeOrders.find(o => o.id === activeOrderId) : null;

      const sanitizedItems = cart.map(i => ({
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

      // Vínculo do cliente: só grava campos preenchidos, para nunca sobrescrever
      // um cadastro existente (ou o rótulo "Mesa N") com vazio.
      const clientPatch: any = {};
      if (customerName) clientPatch.customerName = customerName;
      if (customerPhone) clientPatch.customerPhone = customerPhone;

      let finalOrderId = activeOrderId;
      const orderSpec = activeOrderId
        ? {
            ref: doc(db, 'orders', activeOrderId),
            mode: 'update' as const,
            data: { items: sanitizedItems, totalAmount: cartTotal, subtotal: cartTotal, ...clientPatch },
          }
        : (() => {
            finalOrderId = Math.random().toString(36).substring(2, 10).toUpperCase();
            return {
              ref: doc(db, 'orders', finalOrderId),
              mode: 'set' as const,
              data: {
                id: finalOrderId,
                ownerId: user?.uid || 'default',
                customerName: customerName || `Mesa ${selectedTable}`,
                customerPhone: customerPhone || '',
                tableNumber: selectedTable,
                orderType: 'dine_in',
                status: 'pending',
                paymentStatus: 'pending',
                // Marca que o pedido nasceu no PDV de mesa, que já imprime o ticket
                // da cozinha localmente. Sem isso, a impressão automática de novos
                // pedidos (page.tsx) imprimiria o mesmo cupom de novo (duplicidade).
                source: 'pdv',
                items: sanitizedItems,
                totalAmount: cartTotal,
                subtotal: cartTotal,
                orderDateTime: new Date().toISOString(),
                createdAt: new Date(),
              },
            };
          })();

      // Grava o pedido e abate o estoque (delta vs o que já estava reservado),
      // de forma atômica. Lança InsufficientStockError se faltar.
      await reconcileOrderStock(db, {
        enableInventory: !!storeInfo?.general?.enableInventory,
        targetItems: sanitizedItems,
        alreadyDeducted: activeOrder?.stockDeductedItems,
        order: orderSpec,
      });

      // Atualiza o estado local imediatamente, sem depender do "eco" do onSnapshot.
      // Sem isso, ao criar uma mesa nova o activeOrderId continuava null até o
      // Firestore devolver o pedido em tempo real — e enquanto isso a mesa não
      // ficava marcada como ocupada, o botão "Receber" não aparecia e, ao sair
      // da tela, a comanda local era perdida.
      setActiveOrderId(finalOrderId);
      setOriginalCart(cart);
      setCustomerDirty(false);

      if (newItemsToPrint.length > 0) {
        setReceiptPrinted(false); // Reseta o botão de "Receber" para "Imprimir Conta" pois a conta mudou
        printReceiptNow({
          id: finalOrderId,
          customerName: `Mesa ${selectedTable}`,
          orderType: 'dine_in',
          tableNumber: selectedTable,
          items: newItemsToPrint,
          orderDateTime: new Date().toISOString(),
        }, true);
        toast({ title: 'Sucesso', description: 'Pedido salvo e enviado para produção!' });
      } else {
        toast({ title: 'Sucesso', description: 'Mesa atualizada (sem novos itens).' });
      }

    } catch(e: any) {
      const isStock = e instanceof InsufficientStockError;
      toast({ variant: 'destructive', title: isStock ? 'Estoque insuficiente' : 'Erro', description: isStock ? e.message : 'Não foi possível salvar.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrintReceipt = async () => {
    const activeOrder = activeOrders.find(o => o.tableNumber === selectedTable);
    if (!activeOrder) return;

    try {
      setIsSubmitting(true);
      if (activeOrder.status !== 'awaiting_payment') {
        await updateDoc(doc(db, 'orders', activeOrder.id), {
          status: 'awaiting_payment'
        });
      }
      
      setReceiptPrinted(true);
      printReceiptNow(activeOrder, false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Falha ao atualizar mesa.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmReopenTable = async () => {
    if (!db || !activeOrderId) return;
    try {
      setIsSubmitting(true);
      await updateDoc(doc(db, 'orders', activeOrderId), { status: 'pending' });
      setReceiptPrinted(false);
      setReopenModalOpen(false);
      
      if (pendingItemToAdd) {
        setCart(prev => {
          const existing = prev.find(i => i.id === pendingItemToAdd.id);
          if (existing) return prev.map(i => i.id === pendingItemToAdd.id ? { ...i, quantity: i.quantity + 1 } : i);
          return [...prev, { id: pendingItemToAdd.id, name: pendingItemToAdd.name, quantity: 1, unitPrice: pendingItemToAdd.price, addons: [], notes: '' }];
        });
        setPendingItemToAdd(null);
      }
      toast({ title: 'Mesa Reaberta', description: 'Pode adicionar novos itens à mesa.' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Falha ao reabrir a mesa.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenPayment = () => {
    setSelectedPayment('');
    setValorRecebido('');
    setPaymentSplits([]);
    setIsSplitMode(false);
    setPaymentModalOpen(true);
  };

  const handleConfirmCheckout = async () => {
    if (isSplitMode && paymentSplits.length === 0 && !selectedPayment) return;
    if (!isSplitMode && !selectedPayment) return;
    if (!db || !activeOrderId) return;
    
    if (!caixaAberto) {
      toast({ variant: 'destructive', title: 'Caixa Fechado', description: 'Você não pode finalizar mesas com o caixa fechado. Abra o caixa primeiro.' });
      return;
    }

    setIsSubmitting(true);
    try {
      let paymentString = '';
      const splitsToProcess = isSplitMode ? [...paymentSplits] : [];

      if (!isSplitMode) {
        let change = 0;
        if (selectedPayment === 'dinheiro' && valorRecebido) {
          const valRec = Number(valorRecebido);
          if (valRec > cartTotal) {
            change = valRec - cartTotal;
          }
        }
        let label = FORMAS_PAGAMENTO.find((f:any) => f.id === selectedPayment)?.label || selectedPayment;
        if (selectedPayment === 'conta_casa') label = 'Prazo';
        paymentString = selectedPayment === 'dinheiro' && change > 0 
           ? `${label} (Troco para R$ ${Number(valorRecebido).toFixed(2)})` 
           : label;
        splitsToProcess.push({ methodId: selectedPayment, label, amount: cartTotal });
      } else {
        if (selectedPayment) {
          const remaining = Math.max(0, cartTotal - splitsToProcess.reduce((sum, s) => sum + s.amount, 0));
          let amount = remaining;
          let received = undefined;
          if (selectedPayment === 'dinheiro' && valorRecebido) {
            const valRec = Number(valorRecebido);
            if (valRec >= remaining) {
              received = valRec;
              amount = remaining;
            } else {
              amount = valRec;
              received = valRec;
            }
          }
          if (amount > 0) {
             let label = FORMAS_PAGAMENTO.find((f:any) => f.id === selectedPayment)?.label || selectedPayment;
             if (selectedPayment === 'conta_casa') label = 'Prazo';
             splitsToProcess.push({ methodId: selectedPayment, label, amount, received });
          }
        }

        paymentString = splitsToProcess.map(s => `${s.label}: R$ ${s.amount.toFixed(2)}`).join(' | ');
        const totalReceived = splitsToProcess.reduce((acc, s) => acc + (s.received || s.amount), 0);
        if (totalReceived > cartTotal) {
           paymentString += ` (Troco para R$ ${totalReceived.toFixed(2)})`;
        }
      }

      const ownerId = storeInfo?.id || user?.uid || 'default';
      const linkedName = (customerName || '').trim();
      const phone = customerPhone || quickRegisterModal?.phone || '';
      const hasContaCasa = splitsToProcess.some(s => s.methodId === 'conta_casa');
      let contaCasaCustomerId: string | null = null;
      if (hasContaCasa) {
          const contaCasaAmount = splitsToProcess
            .filter(s => s.methodId === 'conta_casa')
            .reduce((sum, split) => sum + split.amount, 0);

          if (!phone || phone.replace(/\D/g, '').length < 10) {
             setIsSubmitting(false);
             setQuickRegisterModal({ isOpen: true, name: linkedName || `Cliente Mesa ${selectedTable}`, phone: '', address: '' });
             return;
          }

          // Mesma validação do Balcão: limite + vencimento + pedidos em andamento.
          const pendingAmount = await sumPendingCreditOrdersForOwner(db, ownerId, phone);
          const creditCheck = await validateCustomerCredit(db, ownerId, phone, contaCasaAmount, { pendingAmount });
          if (!creditCheck.allowed) {
            if (creditCheck.reason === 'not_found') {
              setIsSubmitting(false);
              setQuickRegisterModal({ isOpen: true, name: linkedName || `Cliente Mesa ${selectedTable}`, phone, address: '' });
              return;
            }
            toast({ variant: 'destructive', title: 'Prazo bloqueado', description: creditCheck.message || 'Este pedido passa do limite de prazo do cliente.' });
            return;
          }
          contaCasaCustomerId = creditCheck.customer?.id || null;
      }

      // Grava status + vínculo do cliente (se identificado) na mesma escrita.
      const finalizeData: any = { status: 'delivered', paymentMethod: paymentString };
      if (linkedName) finalizeData.customerName = linkedName;
      if (phone) finalizeData.customerPhone = phone;
      await updateDoc(doc(db, 'orders', activeOrderId), finalizeData);

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
                   description: `Mesa ${selectedTable}`
                });
                await updateDoc(doc(db, 'clientes', cId), { creditBalance: increment(split.amount) });
                // Registra também no caixa (forma "Prazo") para aparecer na lista e
                // participar do fechamento/conferência. Não entra no dinheiro da gaveta.
                if (caixaAberto) {
                  await registrarLancamento?.({
                    tipo: 'venda',
                    titulo: `Mesa ${selectedTable} - Finalizada (Prazo)`,
                    valor: split.amount,
                    formaPagamento: 'conta_casa',
                  });
                }
             } else {
                toast({ variant: 'destructive', title: 'Aviso', description: 'Conta da Casa: cliente não encontrado para lançar dívida.' });
             }
        } else {
            await registrarLancamento?.({
              tipo: 'venda',
              titulo: `Mesa ${selectedTable} - Finalizada`,
              valor: split.amount,
              formaPagamento: split.methodId,
            });
        }
      }

      // Vincula/contabiliza a venda no cadastro do cliente (só com cliente
      // identificado por telefone; venda anônima de mesa é ignorada). Idempotente.
      if (phone) {
        try {
          const activeOrder = activeOrders.find(o => o.id === activeOrderId);
          await syncCustomerFromOrder(db, {
            ...activeOrder,
            id: activeOrderId,
            ownerId: user?.uid || 'default',
            customerName: linkedName,
            customerPhone: phone,
            totalAmount: cartTotal,
          }, { ownerId: user?.uid || 'default', countOrder: true });
        } catch (err) {
          console.error('Erro ao sincronizar cliente (mesa):', err);
        }
      }

      toast({ title: 'Sucesso', description: splitsToProcess.length > 1 ? `Mesa finalizada em ${splitsToProcess.length} partes!` : 'Mesa finalizada!' });
      setPaymentModalOpen(false);
      setSelectedTable(null);
    } catch(e) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Falha ao encerrar.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddSplit = () => {
    if (!selectedPayment) return;
    const remaining = Math.max(0, cartTotal - paymentSplits.reduce((sum, s) => sum + s.amount, 0));
    let amount = remaining;
    let received: number | undefined = undefined;
    const valRec = valorRecebido ? Number(valorRecebido) : 0;

    if (selectedPayment === 'dinheiro') {
      if (valRec > 0) {
        if (valRec >= remaining) {
          received = valRec;
          amount = remaining;
        } else {
          amount = valRec;
          received = valRec;
        }
      }
    } else if (valRec > 0) {
      amount = Math.min(valRec, remaining);
    }
    
    if (amount <= 0) return;
    
    let label = FORMAS_PAGAMENTO.find((f:any) => f.id === selectedPayment)?.label || selectedPayment;
    if (selectedPayment === 'conta_casa') label = 'Prazo';
    setPaymentSplits(prev => [...prev, { methodId: selectedPayment, label, amount, received }]);
    setSelectedPayment('');
    setValorRecebido('');
  };

  if (!caixaAberto) {
    return (
      <CaixaFechadoCard
        description={
          <>
            <p>A operação de caixa de um pedido é lançada apenas quando ele é finalizado.</p>
            <p>O caixa precisa estar aberto para poder abrir e gerenciar mesas.</p>
            <p className="font-semibold text-slate-600">Acesse a aba <span className="text-slate-800">Caixa / Admin</span> no topo da tela para abrir o caixa.</p>
          </>
        }
      >
        <Button
          onClick={() => onOpenCaixa ? onOpenCaixa() : toast({ title: 'Como abrir o caixa:', description: 'Clique no botão "Caixa / Admin" no canto superior direito da tela.' })}
          size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 font-bold"
        >
          Abrir Caixa
        </Button>
      </CaixaFechadoCard>
    );
  }

  const renderItemCard = (item: any) => {
    const qtyInCart = cart.filter(i => i.id === item.id).reduce((sum, i) => sum + i.quantity, 0);
    const outOfStock = !!storeInfo?.general?.enableInventory && typeof item.stockQuantity === 'number' && item.stockQuantity <= 0;
    return (
      <button
        key={item.id}
        onClick={outOfStock ? undefined : () => addToCart(item)}
        disabled={outOfStock}
        className={`text-left border p-3 rounded-lg transition-colors group flex items-center gap-3 min-h-[88px] relative ${outOfStock ? 'opacity-50 grayscale cursor-not-allowed' : 'hover:border-primary hover:bg-primary/5'}`}
      >
        {outOfStock && (
          <Badge className="absolute top-2 left-2 bg-slate-700 text-white font-bold text-[10px] px-1.5 py-0.5 rounded z-10">
            Sem estoque
          </Badge>
        )}
        {qtyInCart > 0 && (
          <Badge className="absolute top-2 right-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] px-1.5 py-0.5 rounded-full z-10">
            {qtyInCart}
          </Badge>
        )}
        {item.imageUrl ? (
          <div className="relative w-16 h-16 rounded-lg overflow-hidden shrink-0">
            <Image src={item.imageUrl} alt={item.name} fill className="object-cover" sizes="64px" />
          </div>
        ) : (
          <div className="w-16 h-16 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
            <Tag className="h-6 w-6 text-slate-300" />
          </div>
        )}
        <div className="flex flex-col flex-1 min-w-0 gap-1.5">
          <span className="text-sm font-bold text-slate-700 line-clamp-2 leading-tight group-hover:text-primary pr-6">{item.name}</span>
          <span className="text-sm font-black text-green-600">R$ {item.price.toFixed(2)}</span>
        </div>
      </button>
    );
  };

  const suggestionsDropdown = customerMatches.length > 0 ? (
    <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto custom-scrollbar">
      {customerMatches.map((c: any) => (
        <button
          type="button"
          key={c.id}
          onMouseDown={(e) => { e.preventDefault(); applyCustomer(c); }}
          className="w-full text-left px-2 py-1.5 hover:bg-emerald-50 border-b last:border-b-0"
        >
          <div className="text-xs font-semibold text-slate-800">{String(c.nome || c.name || '').trim() || 'Sem nome'}</div>
          <div className="text-[10px] text-slate-500">{c.celular || 'sem telefone'}</div>
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className="flex gap-4 flex-1 overflow-hidden">

      {/* Visão de gestão: mapa de mesas (esquerda) + fila de pedidos online (direita) */}
      {!selectedTable && (
        <div className="flex flex-col lg:flex-row gap-4 flex-1 overflow-hidden w-full">

          {/* ── Mapa de Mesas ── */}
          <div className="flex-1 bg-white rounded-xl shadow-sm border p-4 flex flex-col h-full overflow-hidden min-w-0">
            <div className="flex justify-between items-center mb-4 shrink-0">
              <h2 className="text-xl font-bold text-slate-800">Mapa de Mesas</h2>
              <div className="flex gap-2">
                <Badge variant="outline" className="bg-teal-50 text-teal-700 border-teal-200">Abertas: {activeTableNumbers.length}</Badge>
                <Badge variant="outline" className="bg-slate-50 text-slate-500">Livres: {tables.length - activeTableNumbers.length}</Badge>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                {tables.map(num => {
                  const activeOrder = activeOrders.find(o => o.tableNumber === num);
                  const isOpen = !!activeOrder;
                  const isAwaitingPayment = activeOrder?.status === 'awaiting_payment';
                  const isOnline = activeOrder?.source === 'cardapio';

                  return (
                    <button
                      key={num}
                      onClick={() => setSelectedTable(num)}
                      className={`
                        relative h-20 md:h-24 rounded-xl flex flex-col items-center justify-center transition-all border-2
                        ${selectedTable === num ? 'ring-2 ring-primary ring-offset-2 scale-95' : 'hover:scale-105 hover:shadow-md'}
                        ${isOpen ? (isAwaitingPayment ? 'bg-amber-500 border-amber-600 text-white shadow-md' : 'bg-teal-500 border-teal-600 text-white shadow-md') : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'}
                      `}
                    >
                      {isOnline && (
                        <span className="absolute top-1.5 left-1.5 flex items-center gap-0.5 bg-white/25 rounded px-1 py-0.5" title="Pedido feito pelo cardápio (online)">
                          <Globe className="h-3 w-3" />
                          <span className="text-[8px] font-bold uppercase">Online</span>
                        </span>
                      )}
                      <span className="text-2xl font-black leading-none">{num}</span>
                      {isOpen && <span className="text-[9px] uppercase font-bold bg-black/20 px-1.5 py-0.5 rounded mt-1 truncate max-w-[95%]">{isAwaitingPayment ? 'Aguardando Pagamento' : 'Ocupada'}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Fila de Pedidos Online (purgatório) ── */}
          <aside className="w-full lg:w-[340px] shrink-0 bg-white rounded-xl shadow-sm border flex flex-col h-full overflow-hidden">
            <div className="px-4 py-3 border-b shrink-0 bg-gradient-to-r from-amber-50 to-white">
              <h3 className="text-sm font-bold text-amber-800 flex items-center gap-1.5">
                <Globe className="h-4 w-4" /> Pedidos online
                {ordersSemMesa.length > 0 && (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 text-white text-xs font-bold px-1.5">{ordersSemMesa.length}</span>
                )}
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">Comer no local pelo app · aceite e leve a uma mesa</p>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
              {ordersSemMesa.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-2 py-10 text-slate-300">
                  <Globe className="h-10 w-10" />
                  <p className="text-xs text-slate-400">Nenhum pedido online no momento</p>
                </div>
              ) : (
                ordersSemMesa.map(o => {
                  const needsAttention = o.status === 'pending' && !o.accepted;
                  const itemCount = (o.items || []).reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0);
                  const time = o.orderDateTime ? new Date(o.orderDateTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
                  return (
                    <div
                      key={o.id}
                      className={`rounded-xl border bg-white overflow-hidden shadow-sm ${needsAttention ? 'border-red-300 ring-2 ring-red-200 animate-pulse' : 'border-slate-200'}`}
                    >
                      {/* Cabeçalho do pedido */}
                      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b">
                        <div className="flex min-w-0 items-center gap-2">
                          <ContactAvatar
                            phone={o.customerPhone || ''}
                            initials={(o.customerName || '?').split(' ').map((w: string) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                            loadPhoto={loadPhoto}
                            className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 text-[10px] font-bold text-white"
                          />
                          <div className="min-w-0">
                            <p className="font-bold text-sm text-slate-800 truncate">{o.customerName || 'Cliente'}</p>
                            <p className="text-[10px] text-slate-400">{time && `${time} · `}#{o.id?.substring(0, 5)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {needsAttention
                            ? <span className="text-[9px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded">NOVO</span>
                            : <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">ACEITO</span>}
                          <button
                            type="button"
                            onClick={() => handleRejectOnlineOrder(o)}
                            title="Excluir pedido"
                            className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:text-red-600 hover:bg-red-100 transition-colors"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {/* Produtos */}
                      <div className="px-3 py-2 space-y-1 max-h-44 overflow-y-auto custom-scrollbar">
                        {(o.items || []).map((it: any, idx: number) => (
                          <div key={idx} className="flex items-start gap-2 text-xs">
                            <span className="font-bold text-slate-700 shrink-0">{it.quantity}x</span>
                            <div className="min-w-0">
                              <span className="text-slate-700">{it.name}</span>
                              {(it.addons || []).length > 0 && (
                                <span className="block text-[10px] text-slate-400 leading-tight">{(it.addons || []).map((a: any) => a.name).join(', ')}</span>
                              )}
                              {it.notes && <span className="block text-[10px] text-orange-500 italic leading-tight">Obs: {it.notes}</span>}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Total + ações */}
                      <div className="px-3 py-2 border-t">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-[11px] text-slate-400">{itemCount} {itemCount === 1 ? 'item' : 'itens'}</span>
                          <span className="font-black text-green-600">R$ {(o.totalAmount || 0).toFixed(2)}</span>
                        </div>
                        <div className="flex gap-2">
                          {needsAttention && (
                            <Button
                              size="sm"
                              className="flex-1 h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                              onClick={() => handleAcceptOnlineOrder(o)}
                              title={isManualPrint ? 'Aceitar e imprimir o ticket' : 'Aceitar o pedido'}
                            >
                              {isManualPrint ? <><Printer className="h-3.5 w-3.5 mr-1" /> Aceitar</> : 'Aceitar'}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 h-8 text-xs border-amber-400 text-amber-700 hover:bg-amber-100"
                            onClick={() => setTablePickerFor({ orderId: o.id, currentTable: null })}
                          >
                            Pôr na mesa
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        </div>
      )}

      {/* PDV - Consumo da Mesa Expandido */}
      {selectedTable && (
        <div className="flex-1 bg-white rounded-xl shadow-sm border flex flex-col h-full overflow-hidden shrink-0">
          
          <div className="bg-slate-800 text-white p-3 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" onClick={handleBackToGrid}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h3 className="font-bold text-lg">Mesa {selectedTable}</h3>
                <p className="text-xs text-slate-300">{activeOrderId ? 'Comanda Aberta' : 'Nova Comanda'}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {activeOrderId && (
                <Button variant="ghost" size="sm" className="text-white/90 hover:text-white hover:bg-white/20 text-xs gap-1" onClick={() => setTablePickerFor({ orderId: activeOrderId, currentTable: selectedTable })}>
                  <ArrowLeftRight className="h-3.5 w-3.5" /> Trocar Mesa
                </Button>
              )}
              {activeOrderId && (
                <Button variant="ghost" size="sm" className="text-red-300 hover:text-red-100 hover:bg-red-500/30 text-xs gap-1" onClick={handleCancelTable}>
                  <X className="h-3.5 w-3.5" /> Cancelar Mesa
                </Button>
              )}
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" onClick={handleBackToGrid}>
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            
            {/* Lista do Carrinho */}
            <div className="w-full md:w-1/2 flex flex-col border-r overflow-hidden">
              {/* Cliente da comanda: vincula a venda ao cadastro e habilita o Prazo */}
              <div className="p-2 border-b bg-white shrink-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">👤 Cliente <span className="font-normal normal-case text-slate-400">(opcional)</span></span>
                  {(customerName || customerPhone) && (
                    <button type="button" onClick={clearCustomerFields} className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-red-600 transition-colors" title="Limpar cliente">
                      <X className="h-3 w-3" /> Limpar
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  <div className="relative">
                    <Input autoComplete="new-password" placeholder="Nome do Cliente" value={customerName}
                      onChange={e => { setCustomerName(e.target.value); setCustomerDirty(true); }}
                      onFocus={() => setActiveLookupField('name')}
                      onBlur={() => window.setTimeout(() => setActiveLookupField(f => (f === 'name' ? null : f)), 150)}
                      className="h-8 text-xs" />
                    {activeLookupField === 'name' && suggestionsDropdown}
                  </div>
                  <div className="relative">
                    <Input autoComplete="new-password" inputMode="tel" placeholder="Telefone / WhatsApp" value={customerPhone}
                      onChange={e => { setCustomerPhone(e.target.value); setCustomerDirty(true); }}
                      onFocus={() => setActiveLookupField('phone')}
                      onBlur={() => window.setTimeout(() => setActiveLookupField(f => (f === 'phone' ? null : f)), 150)}
                      className="h-8 text-xs" />
                    {activeLookupField === 'phone' && suggestionsDropdown}
                  </div>
                  {creditCustomer && isCreditEnabled(creditCustomer) && (() => {
                    const limit = Number(creditCustomer.creditLimit) || 0;
                    const balance = Number(creditCustomer.creditBalance) || 0;
                    return (
                      <div className="flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-1">
                        <span>📝 Prazo ativo</span>
                        {limit > 0 && (
                          <span className="font-semibold text-amber-600">· disponível R$ {(limit - balance).toFixed(2)} de R$ {limit.toFixed(2)}</span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3 bg-slate-50 custom-scrollbar">
                {cart.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
                    <ShoppingCart className="h-10 w-10 text-slate-300" />
                    <p className="text-sm">Mesa livre. Adicione itens para abrir a comanda.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {cart.map((item, index) => (
                      <div key={item.cartItemId || item.id || index} className="bg-white p-3 border rounded-lg flex items-center justify-between gap-3 shadow-sm">
                        <div className="flex-1 min-w-0">
                          <p className="text-base font-bold text-slate-800 truncate">{item.name}</p>
                          <p className="text-sm text-green-600 font-bold">R$ {(item.unitPrice || item.price).toFixed(2)}</p>
                          {item.addons && item.addons.length > 0 && (
                            <div className="text-xs text-muted-foreground leading-tight mt-0.5">
                              {item.addons.map((a: any) => a.name).join(', ')}
                            </div>
                          )}
                          {item.notes && <div className="text-xs text-orange-500 mt-0.5">Obs: {item.notes}</div>}
                        </div>
                        <div className="flex items-center gap-2 bg-slate-100 rounded-md p-1 border">
                          <button onClick={() => updateQuantity(item.cartItemId || item.id, -1)} className="h-8 w-8 flex items-center justify-center bg-white rounded shadow-sm hover:text-primary"><Minus className="h-4 w-4" /></button>
                          <span className="w-8 text-center text-sm font-bold">{item.quantity}</span>
                          <button onClick={() => updateQuantity(item.cartItemId || item.id, 1)} className="h-8 w-8 flex items-center justify-center bg-white rounded shadow-sm hover:text-primary"><Plus className="h-4 w-4" /></button>
                        </div>
                        <button onClick={() => removeFromCart(item.cartItemId || item.id)} className="h-9 w-9 flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 rounded shrink-0">
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Total e Ações */}
              <div className="p-4 bg-white shrink-0 space-y-3 border-t">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Subtotal:</span>
                  <span className="text-2xl font-black text-slate-800">R$ {cartTotal.toFixed(2)}</span>
                </div>
                <div className="flex gap-2">
                  {(() => {
                    const hasUnsavedChanges = JSON.stringify(cart) !== JSON.stringify(originalCart) || customerDirty;
                    return (
                      <Button 
                        variant={hasUnsavedChanges ? "outline" : "secondary"} 
                        className={`flex-1 h-12 font-bold text-lg ${hasUnsavedChanges ? 'border-primary text-primary hover:bg-primary/5' : 'bg-slate-100 text-slate-400 pointer-events-none'}`}
                        onClick={handleSaveOrder}
                        disabled={cart.length === 0 || isSubmitting || !hasUnsavedChanges}
                      >
                        {isSubmitting ? 'Salvando...' : hasUnsavedChanges ? 'Salvar Pedido' : 'Salvo ✅'}
                      </Button>
                    );
                  })()}
                  {activeOrderId && (
                    <div className="flex-[1.5] flex gap-2">
                      <Button 
                        variant="outline" 
                        className="px-3 border-slate-300 text-slate-600 hover:bg-slate-100"
                        onClick={() => {
                          const activeOrder = activeOrders.find(o => o.tableNumber === selectedTable);
                          if (activeOrder) {
                            printReceiptNow(activeOrder, false);
                          }
                        }}
                        title="Imprimir Parcial"
                        disabled={isSubmitting}
                      >
                        <Printer className="h-5 w-5" />
                      </Button>
                      
                      <Button 
                        className="flex-1 bg-orange-500 hover:bg-orange-600 font-bold text-white shadow-sm text-lg"
                        onClick={handleOpenPayment}
                        disabled={isSubmitting}
                      >
                        Receber
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Menu Rápido (Bottom / Right) */}
            <div className="w-full md:w-1/2 flex flex-col shrink-0 bg-white">
              <div className="p-3 pb-0 shrink-0">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar produto..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 h-9 bg-slate-50"
                  />
                </div>
              </div>
              <div ref={categoryBarRef} className="p-3 border-b flex gap-2 overflow-x-auto custom-scrollbar shrink-0">
                <Badge
                  data-cat-tab="all"
                  variant="secondary"
                  className={`cursor-pointer whitespace-nowrap text-sm py-1 px-3 ${activePill === 'all' ? 'bg-primary text-primary-foreground' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                  onClick={() => { setSearchTerm(''); setSelectedCat('all'); scrollToCategory('all'); }}
                >
                  Todos
                </Badge>
                {groupedItems.map(group => (
                  <Badge
                    key={group.id}
                    data-cat-tab={group.id}
                    variant="secondary"
                    className={`cursor-pointer whitespace-nowrap text-sm py-1 px-3 ${activePill === group.id ? 'bg-primary text-primary-foreground' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                    onClick={() => { setSelectedCat(group.id); scrollToCategory(group.id); }}
                  >
                    {group.name}
                  </Badge>
                ))}
              </div>
              <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                {visibleGroups.length === 0 ? (
                  <div className="text-center text-sm text-slate-400 py-8">Nenhum produto encontrado.</div>
                ) : (
                  visibleGroups.map(group => (
                    <div key={group.id} ref={setSectionRef(group.id)} className="mb-4">
                      <h2 className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm py-1.5 mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                        {group.name}
                      </h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 content-start">
                        {group.items.map(renderItemCard)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Modal Pagamento Mesa */}
      <Dialog open={paymentModalOpen} onOpenChange={setPaymentModalOpen}>
        <DialogContent className="sm:max-w-[380px] p-4">
          {(() => {
            const totalPaid = paymentSplits.reduce((sum, s) => sum + s.amount, 0);
            const remaining = Math.max(0, cartTotal - totalPaid);
            const isFullyPaid = remaining <= 0;

            return (
              <>
                <DialogHeader className="pb-1 border-b">
                  <DialogTitle className="text-sm flex items-center justify-between pr-6">
                    <span>💰 Encerrar Mesa {selectedTable}</span>
                    <div className="flex flex-col items-end">
                      <span className="text-xs text-muted-foreground font-normal">Total: R$ {cartTotal.toFixed(2)}</span>
                      <span className={`text-lg font-black ${remaining > 0 ? 'text-red-500' : 'text-green-600'}`}>
                        {remaining > 0 ? `Falta R$ ${remaining.toFixed(2)}` : 'Pago ✅'}
                      </span>
                    </div>
                  </DialogTitle>
                  <DialogDescription className="text-xs">
                    {!caixaAberto && <span className="text-red-500 block mb-1">⚠️ Caixa fechado — venda não será registrada nele.</span>}
                  </DialogDescription>
                </DialogHeader>

              {!isSplitMode ? (
                <>
                  <div className="grid grid-cols-4 gap-2 py-2">
                    {FORMAS_PAGAMENTO.map((fp: any) => (
                      <button
                        key={fp.id}
                        type="button"
                        onClick={() => { setSelectedPayment(fp.id); setValorRecebido(''); }}
                        className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 font-bold text-xs transition-all ${
                          selectedPayment === fp.id 
                            ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary/30' 
                            : 'border-muted text-muted-foreground hover:border-slate-300'
                        }`}
                      >
                        <span className="text-lg">{fp.icon}</span>
                        {fp.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => { setIsSplitMode(true); setSelectedPayment(''); setValorRecebido(''); }}
                      className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 font-bold text-xs transition-all border-muted text-muted-foreground hover:border-slate-300`}
                    >
                      <span className="text-lg">🔀</span>
                      Múltiplos
                    </button>
                  </div>

                  {selectedPayment === 'dinheiro' && (
                    <div className="bg-amber-50 p-2 rounded-lg border border-amber-200 space-y-1.5">
                      <label className="text-xs font-medium text-amber-800">💵 Valor recebido (R$)</label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        placeholder="R$ 0,00"
                        value={valorRecebido ? `R$ ${valorRecebido.replace('.', ',')}` : ''}
                        onChange={(e) => {
                          let val = e.target.value.replace(/\D/g, '');
                          if (!val) setValorRecebido('');
                          else setValorRecebido((Number(val) / 100).toFixed(2));
                        }}
                        className="text-sm font-bold text-center bg-white h-9"
                        autoFocus
                      />
                      {Number(valorRecebido) > 0 && (
                        <div className={`text-center p-1.5 rounded font-bold text-sm ${Number(valorRecebido) >= cartTotal ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                          {Number(valorRecebido) >= cartTotal 
                            ? `Troco: R$ ${(Number(valorRecebido) - cartTotal).toFixed(2)}`
                            : `Falta: R$ ${(cartTotal - Number(valorRecebido)).toFixed(2)}`
                          }
                        </div>
                      )}
                    </div>
                  )}

                  <DialogFooter className="pt-2 gap-2 border-t mt-2">
                    <Button variant="outline" size="sm" onClick={() => setPaymentModalOpen(false)}>Cancelar</Button>
                    <Button 
                      size="sm"
                      disabled={!selectedPayment || isSubmitting} 
                      onClick={handleConfirmCheckout}
                      className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white"
                    >
                      {isSubmitting ? '...' : '✅ Encerrar Mesa'}
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <button 
                    onClick={() => setIsSplitMode(false)}
                    className="text-xs text-blue-600 hover:underline mb-2 flex items-center gap-1"
                  >
                    ← Voltar ao Pagamento Simples
                  </button>

                  {paymentSplits.length > 0 && (
                    <div className="py-2 space-y-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Pagamentos Adicionados:</span>
                      {paymentSplits.map((split, idx) => (
                        <div key={idx} className="flex justify-between items-center bg-slate-50 border p-1.5 rounded text-xs">
                          <span className="font-medium text-slate-700 flex items-center gap-1">
                            {split.label}
                            {split.received && split.received > split.amount && <span className="text-[9px] text-muted-foreground">(Recebeu R$ {split.received.toFixed(2)})</span>}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-green-600">R$ {split.amount.toFixed(2)}</span>
                            <button onClick={() => setPaymentSplits(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600">✕</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {!isFullyPaid && (
                    <>
                      <div className="grid grid-cols-4 gap-2 py-2">
                        {FORMAS_PAGAMENTO.map((fp: any) => (
                          <button
                            key={fp.id}
                            type="button"
                            onClick={() => { setSelectedPayment(fp.id); setValorRecebido(''); }}
                            className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 font-bold text-xs transition-all ${
                              selectedPayment === fp.id 
                                ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary/30' 
                                : 'border-muted text-muted-foreground hover:border-slate-300'
                            }`}
                          >
                            <span className="text-lg">{fp.icon}</span>
                            {fp.label}
                          </button>
                        ))}
                      </div>

                      {selectedPayment && (
                        <div className="bg-blue-50 p-2 rounded-lg border border-blue-200 space-y-1.5">
                          <label className="text-xs font-medium text-blue-800">Valor a ser pago em {selectedPayment === 'conta_casa' ? 'Prazo' : FORMAS_PAGAMENTO.find((f:any)=>f.id===selectedPayment)?.label || selectedPayment} (R$)</label>
                          <div className="flex gap-2">
                            <Input
                              type="text"
                              inputMode="numeric"
                              placeholder={`R$ ${remaining.toFixed(2).replace('.', ',')}`}
                              value={valorRecebido ? `R$ ${valorRecebido.replace('.', ',')}` : ''}
                              onChange={(e) => {
                                let val = e.target.value.replace(/\D/g, '');
                                if (!val) setValorRecebido('');
                                else setValorRecebido((Number(val) / 100).toFixed(2));
                              }}
                              className="text-sm font-bold text-center bg-white h-9"
                              autoFocus
                            />
                            <Button onClick={handleAddSplit} className="h-9 whitespace-nowrap bg-blue-600 hover:bg-blue-700 text-white" size="sm">
                              Adicionar
                            </Button>
                          </div>
                          {selectedPayment === 'dinheiro' && Number(valorRecebido) > remaining && (
                            <div className="text-center p-1 font-bold text-xs bg-amber-100 text-amber-700 rounded">
                              Troco: R$ {(Number(valorRecebido) - remaining).toFixed(2)}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  <DialogFooter className="pt-2 gap-2 border-t mt-2">
                    <Button variant="outline" size="sm" onClick={() => setPaymentModalOpen(false)}>Cancelar</Button>
                    <Button 
                      size="sm"
                      disabled={(paymentSplits.length === 0 && !selectedPayment) || isSubmitting || (!isFullyPaid && !selectedPayment)} 
                      onClick={handleConfirmCheckout}
                      className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white"
                    >
                      {isSubmitting ? '...' : '✅ Encerrar Mesa'}
                    </Button>
                  </DialogFooter>
                </>
              )}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Modal Reabrir Mesa */}
      <Dialog open={reopenModalOpen} onOpenChange={setReopenModalOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Reabrir Mesa {selectedTable}?</DialogTitle>
            <DialogDescription>
              A conta desta mesa já foi impressa e está aguardando pagamento. Tem certeza que deseja reabrir a mesa para adicionar novos itens?
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-end mt-4">
            <Button variant="outline" onClick={() => { setReopenModalOpen(false); setPendingItemToAdd(null); }}>
              Cancelar
            </Button>
            <Button onClick={confirmReopenTable} disabled={isSubmitting}>
              Sim, Reabrir Mesa
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Trocar / Atribuir Mesa */}
      <Dialog open={!!tablePickerFor} onOpenChange={(open) => { if (!open) setTablePickerFor(null); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {tablePickerFor?.currentTable ? `Trocar Mesa ${tablePickerFor.currentTable} para:` : 'Atribuir pedido a uma mesa:'}
            </DialogTitle>
            <DialogDescription>Escolha uma mesa livre (as ocupadas ficam desabilitadas).</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 py-2">
            {tables.map(num => {
              const ocupada = activeTableNumbers.includes(num);
              const isCurrent = tablePickerFor?.currentTable === num;
              const disabled = ocupada || isCurrent || isSubmitting;
              return (
                <button
                  key={num}
                  disabled={disabled}
                  onClick={() => tablePickerFor && handlePickTable(tablePickerFor.orderId, num)}
                  className={`h-14 rounded-lg border-2 font-black text-lg transition-all ${
                    disabled
                      ? 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed'
                      : 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  {num}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <MenuItemDialog
        item={selectedItemForDialog}
        isOpen={!!selectedItemForDialog}
        onClose={() => setSelectedItemForDialog(null)}
        allAddons={addons}
        addonCategories={addonCategories}
        onAddToCart={handleDialogAddToCart}
        menuItems={items}
        enableInventory={storeInfo?.general?.enableInventory || false}
      />
      {quickRegisterModal && (
        <QuickRegisterClientModal
          isOpen={quickRegisterModal.isOpen}
          onClose={() => setQuickRegisterModal(null)}
          onSuccess={() => {
            setQuickRegisterModal(null);
            handleConfirmCheckout();
          }}
          db={db}
          ownerId={storeInfo?.id || user?.uid || 'default'}
          initialName={quickRegisterModal.name}
          initialPhone={quickRegisterModal.phone}
          initialAddress={quickRegisterModal.address}
        />
      )}
    </div>
  );
}
