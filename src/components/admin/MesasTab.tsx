'use client';

import React, { useState, useEffect, useMemo } from 'react';
import type { RegistrarLancamento } from '@/hooks/useCaixa';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import CaixaFechadoCard from '@/components/shared/CaixaFechadoCard';
import { Input } from '@/components/ui/input';
import { ShoppingCart, Plus, Minus, Search, Tag, X, CreditCard, Banknote, QrCode, Wallet, ArrowLeft, Printer, Globe, ArrowLeftRight, Flame } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import { collection, deleteField, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { printOrderReceipt } from '@/lib/order-receipt-html';
import { resolvePrintMode } from '@/lib/receipt-print';
import { QuickRegisterClientModal } from './QuickRegisterClientModal';
import { creditPhonesAreEqual, isCreditEnabled, isValidCreditPhone, maskCreditPhoneInput, normalizeCreditPhone } from '@/lib/customer-credit';
import { resolveContaCasa, registrarPagamentoSplits } from '@/lib/payments';
import { useCategoryScrollSpy } from '@/hooks/useCategoryScrollSpy';
import { usePromotions } from '@/hooks/usePromotions';
import { buildAdminMenuGroups } from '@/lib/menu-groups';
import { useCustomerLookup } from '@/hooks/useCustomerLookup';
import { CustomerSuggestions } from '@/components/admin/CustomerSuggestions';
import { itemNeedsCustomization, applyPromoPrice, addSimpleItemToCart, buildCustomizedCartItem, isWeightItem, makeWeightCartLine, setCartLineWeight, findUnweighedItem } from '@/lib/cart';
import { WeightInput } from '@/components/admin/WeightInput';
import { reconcileOrderStock, releaseOrderStock, InsufficientStockError, isOutOfStock } from '@/lib/inventory';
import { proposedCustomerId, syncCustomerFromOrder } from '@/lib/customers/customer-sync';
import { ContactAvatar } from '@/components/shared/ContactAvatar';
import { makeProfilePhotoLoader } from '@/lib/wapi/profile-photo';
import { resolveFormasPagamento } from './fechamento/payment-methods';
import { useFechamento } from './fechamento/useFechamento';
import { FechamentoModal } from './fechamento/FechamentoModal';
import { can, type PdvPermissions } from '@/lib/pdv-permissions';
import { usePdvAccess } from '@/contexts/PdvAccessContext';

import { MenuItemDialog } from '@/components/menu/MenuItemDialog';
import { brl } from '@/lib/utils';
import { generateOrderCode, getOrderCodePrefix } from '@/lib/order-code';

interface MesasTabProps {
  orders?: any[];
  categories?: any[];
  items?: any[];
  db?: any;
  user?: any;
  registrarLancamento?: RegistrarLancamento;
  caixaAberto?: boolean;
  storeInfo?: any;
  onOpenCaixa?: () => void;
  addons?: any[];
  addonCategories?: any[];
  onUnsavedChangesChange?: (hasChanges: boolean) => void;
  permissions: PdvPermissions;
}

interface MesasDraftMemory {
  selectedTable: number | null;
  cart: any[];
  originalCart: any[];
  activeOrderId: string | null;
  receiptPrinted: boolean;
  customerName: string;
  customerPhone: string;
  customerId: string | null;
  customerDirty: boolean;
}

const mesasDraftMemory = new Map<string, MesasDraftMemory>();
const discardDraftOnUnmount = new Set<string>();
const mountedDraftKeys = new Set<string>();

export function discardMesasDraft(userId: string): void {
  // O chamador conhece a identidade autenticada; a memória usa também o
  // tenant para impedir que uma eventual realocação de operador reaproveite
  // o rascunho da loja anterior.
  const keys = new Set<string>([userId]);
  for (const key of mesasDraftMemory.keys()) {
    if (key.startsWith(`${userId}:`)) keys.add(key);
  }
  for (const key of mountedDraftKeys) {
    if (key.startsWith(`${userId}:`)) keys.add(key);
  }

  for (const key of keys) {
    mesasDraftMemory.delete(key);
    // Only leave an unmount marker when that actor/tenant Mesa UI is actually
    // mounted. Otherwise the marker could survive logout and erase a future
    // draft when the same account signs in again in this SPA session.
    if (mountedDraftKeys.has(key)) {
      discardDraftOnUnmount.add(key);
    } else {
      discardDraftOnUnmount.delete(key);
    }
  }
}

export function MesasTab({ orders = [], categories = [], items = [], db, user, registrarLancamento, caixaAberto = false, storeInfo, onOpenCaixa, addons = [], addonCategories = [], onUnsavedChangesChange, permissions }: MesasTabProps) {
  const { ownerId, role } = usePdvAccess();
  const FORMAS_PAGAMENTO = resolveFormasPagamento(storeInfo);
  const { toast } = useToast();
  const canGerenciarMesa = can(permissions, 'actions.mesas.gerenciarMesa');
  const canLancarItens = can(permissions, 'actions.mesas.lancarItens');
  const canFecharComanda = can(permissions, 'actions.mesas.fecharComanda');
  const canAceitarPedidoOnline = can(permissions, 'actions.mesas.aceitarPedidoOnline');
  const notifyPermissionRemoved = () => toast({
    variant: 'destructive',
    title: 'Permissão removida pelo administrador',
  });
  const draftKey = `${user?.uid || 'anonymous'}:${ownerId}`;
  const initialDraftRef = React.useRef<MesasDraftMemory | null>(mesasDraftMemory.get(draftKey) || null);
  const initialDraft = initialDraftRef.current;
  const [activeSubTab, setActiveSubTab] = useState<'abertas' | 'finalizadas'>('abertas');
  const [searchTable, setSearchTable] = useState('');
  const [selectedTable, setSelectedTable] = useState<number | null>(initialDraft?.selectedTable ?? null);
  const [selectedItemForDialog, setSelectedItemForDialog] = useState<any | null>(null);

  // PDV States
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<any[]>(initialDraft?.cart ?? []);
  const [originalCart, setOriginalCart] = useState<any[]>(initialDraft?.originalCart ?? []);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(initialDraft?.activeOrderId ?? null);
  
  // Impressão e Pagamento

  const [reopenModalOpen, setReopenModalOpen] = useState(false);
  const [pendingItemToAdd, setPendingItemToAdd] = useState<any>(null);
  const [pendingTableMutation, setPendingTableMutation] = useState<(() => void) | null>(null);
  const [receiptPrinted, setReceiptPrinted] = useState(initialDraft?.receiptPrinted ?? false);

  const activeOrders = orders?.filter(o => o.orderType === 'dine_in' && o.status !== 'delivered' && o.status !== 'canceled') || [];
  const selectedActiveOrder = activeOrders.find(order => order.tableNumber === selectedTable);
  const tableNeedsReopen = selectedActiveOrder?.status === 'awaiting_payment' && receiptPrinted;
  const canEditTableItems = canLancarItens && (!tableNeedsReopen || canGerenciarMesa);

  useEffect(() => {
    if (selectedActiveOrder?.status === 'awaiting_payment') setReceiptPrinted(true);
  }, [selectedActiveOrder?.id, selectedActiveOrder?.status]);
  
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [quickRegisterModal, setQuickRegisterModal] = useState<{isOpen: boolean, name: string, phone: string, address: string} | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Cliente da comanda (autocomplete por nome/celular) — vincula a venda ao
  // cadastro e habilita o pagamento no Prazo, igual ao Balcao.
  const [customerName, setCustomerName] = useState(initialDraft?.customerName ?? '');
  const [customerPhone, setCustomerPhone] = useState(initialDraft?.customerPhone ?? '');
  const [customerId, setCustomerId] = useState<string | null>(initialDraft?.customerId ?? null);
  const [customerDirty, setCustomerDirty] = useState(initialDraft?.customerDirty ?? false);
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
  const isManualPrint = resolvePrintMode(storeInfo) === 'manual';

  const loadPhoto = useMemo(() => makeProfilePhotoLoader(user, ownerId), [ownerId, user]);

  // Cupom como HTML nativo via QZ (mesmo caminho da sangria), com fallback
  // para impressão pelo navegador (iframe) quando o QZ não estiver presente.
  const printReceiptNow = (order: any, isKitchen: boolean) => {
    printOrderReceipt({ order, storeInfo, isKitchen });
  };

  const lastSelectedTableRef = React.useRef<number | null>(initialDraft?.selectedTable ?? null);
  const hasUnsavedChanges = JSON.stringify(cart) !== JSON.stringify(originalCart) || customerDirty;
  const draftSnapshotRef = React.useRef<MesasDraftMemory>({
    selectedTable,
    cart,
    originalCart,
    activeOrderId,
    receiptPrinted,
    customerName,
    customerPhone,
    customerId,
    customerDirty,
  });
  draftSnapshotRef.current = {
    selectedTable,
    cart,
    originalCart,
    activeOrderId,
    receiptPrinted,
    customerName,
    customerPhone,
    customerId,
    customerDirty,
  };

  useEffect(() => {
    onUnsavedChangesChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChangesChange]);

  useEffect(() => {
    mountedDraftKeys.add(draftKey);
    return () => {
      mountedDraftKeys.delete(draftKey);
      const draft = draftSnapshotRef.current;
      const isDirty = JSON.stringify(draft.cart) !== JSON.stringify(draft.originalCart) || draft.customerDirty;
      if (discardDraftOnUnmount.delete(draftKey) || !isDirty) {
        mesasDraftMemory.delete(draftKey);
      } else {
        mesasDraftMemory.set(draftKey, draft);
      }
      onUnsavedChangesChange?.(false);
    };
  }, [draftKey, onUnsavedChangesChange]);

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
          // cartItemId determinístico por linha: mantém cart/originalCart idênticos
          // (preserva o "Salvo ✅") e evita colisão ao editar duas pesagens do
          // mesmo produto por kg na mesma comanda.
          const hydratedItems = (activeOrder.items || []).map((it: any, idx: number) => ({ ...it, cartItemId: it.cartItemId || `${it.id}-${idx}` }));
          setCart(hydratedItems);
          setOriginalCart(hydratedItems);
          setActiveOrderId(activeOrder.id);
          setReceiptPrinted(activeOrder.status === 'awaiting_payment');
          // Carrega o cliente vinculado à comanda (ignora o rótulo "Mesa N").
          const loadedName = activeOrder.customerName && !/^Mesa\s*\d+$/i.test(activeOrder.customerName) ? activeOrder.customerName : '';
          setCustomerName(loadedName);
          setCustomerPhone(maskCreditPhoneInput(activeOrder.customerPhone || ''));
          setCustomerId(activeOrder.clienteId || null);
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
        setCustomerId(null);
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
      setCustomerId(null);
      setCustomerDirty(false);
    }
  }, [selectedTable, orders]); // depends on orders to sync in real-time

  // ── Autocomplete de cliente (nome/celular) na comanda da mesa ──
  // Carga da lista + matches centralizados no hook (mesma fonte do Balcao).
  const { allCustomers, activeField: activeLookupField, setActiveField: setActiveLookupField, matches: customerMatches } =
    useCustomerLookup(db, role === 'owner' ? ownerId : undefined, customerName, customerPhone);

  // Cliente do cadastro que casa com o telefone atual — usado para indicar que o
  // Prazo está ativo (ao escolher na lista ou ao reabrir uma comanda vinculada).
  const creditCustomer = useMemo(() => {
    if (normalizeCreditPhone(customerPhone).length < 10 || allCustomers.length === 0) return null;
    const exactMatches = allCustomers.filter(c =>
      c.archived !== true && creditPhonesAreEqual(String(c.celular || ''), customerPhone));
    return exactMatches.length === 1 ? exactMatches[0] : null;
  }, [customerPhone, allCustomers]);

  const applyCustomer = (c: any) => {
    if (!can(permissions, 'actions.mesas.gerenciarMesa')) {
      notifyPermissionRemoved();
      return;
    }
    const name = String(c.nome || c.name || '').trim();
    const phone = String(c.celular || '');
    if (name) setCustomerName(name);
    if (phone) setCustomerPhone(maskCreditPhoneInput(phone));
    setCustomerId(c.id || null);
    setActiveLookupField(null);
    setCustomerDirty(true);
  };

  const clearCustomerFields = () => {
    if (!can(permissions, 'actions.mesas.gerenciarMesa')) {
      notifyPermissionRemoved();
      return;
    }
    setCustomerName('');
    setCustomerPhone('');
    setCustomerId(null);
    setActiveLookupField(null);
    setCustomerDirty(true);
  };

  const cartTotal = cart.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);

  // Fechamento centralizado (desconto/acréscimo, split, troco) — mesmo
  // estado/cálculo/modal em Balcão, Mesas e Delivery (components/admin/fechamento).
  const fechamento = useFechamento({
    subtotal: cartTotal,
    formasPagamento: FORMAS_PAGAMENTO,
    allowAdjustments: can(permissions, 'actions.mesas.descontoAcrescimo'),
    allowPrazo: can(permissions, 'actions.mesas.vendaPrazo'),
  });

  const { promoItemsMap, promoOnlyIds, hasActivePromos } = usePromotions(db, ownerId);

  // Os produtos sao sempre agrupados por categoria; clicar numa categoria
  // rola ate a secao e rolar a lista atualiza a pill ativa (igual cliente).
  const groupedItems = useMemo(
    () => buildAdminMenuGroups(items, categories, 'dine_in', searchTerm, { promoItemsMap, promoOnlyIds, hasActivePromos }),
    [items, categories, searchTerm, promoItemsMap, promoOnlyIds, hasActivePromos]
  );

  const { scrollContainerRef, categoryBarRef, setSectionRef, scrollToCategory, activeCategory } =
    useCategoryScrollSpy(groupedItems.map(g => g.id));
  // Filtro por categoria: ao escolher uma categoria, lista SÓ os produtos dela.
  // "Todos" (ou uma busca ativa) mantém a lista completa com rolagem/scroll-spy.
  const [selectedCat, setSelectedCat] = useState<string>('all');
  const activePill = selectedCat === 'all' ? activeCategory : selectedCat;
  const isSearching = searchTerm.trim() !== '';
  const visibleGroups =
    selectedCat === 'all' || isSearching ? groupedItems : groupedItems.filter(g => g.id === selectedCat);

  const addToCart = (item: any) => {
    if (!can(permissions, 'actions.mesas.lancarItens')) {
      notifyPermissionRemoved();
      return;
    }
    const effectiveItem = applyPromoPrice(item, promoItemsMap);

    if (activeOrderId) {
      if (tableNeedsReopen) {
        if (!can(permissions, 'actions.mesas.gerenciarMesa')) {
          notifyPermissionRemoved();
          return;
        }
        setPendingItemToAdd(effectiveItem);
        setPendingTableMutation(null);
        setReopenModalOpen(true);
        return;
      }
    }

    if (isWeightItem(effectiveItem)) {
      setCart(prev => [...prev, makeWeightCartLine(effectiveItem)]);
    } else if (itemNeedsCustomization(effectiveItem)) {
      setSelectedItemForDialog(effectiveItem);
    } else {
      setCart(prev => addSimpleItemToCart(prev, effectiveItem));
    }
  };

  const updateWeight = (cartItemId: string, grams: number) => {
    if (!can(permissions, 'actions.mesas.lancarItens')) {
      notifyPermissionRemoved();
      return;
    }
    setCart(prev => setCartLineWeight(prev, cartItemId, grams));
  };

  const handleDialogAddToCart = (item: any, quantity: number, options: any) => {
    if (!can(permissions, 'actions.mesas.lancarItens')) {
      notifyPermissionRemoved();
      return;
    }
    const effectiveItem = applyPromoPrice(item, promoItemsMap);
    const customizedItem = buildCustomizedCartItem(effectiveItem, quantity, options);
    if (tableNeedsReopen) {
      if (!can(permissions, 'actions.mesas.gerenciarMesa')) {
        notifyPermissionRemoved();
        return;
      }
      setPendingItemToAdd(null);
      setPendingTableMutation(() => () => setCart(prev => [...prev, customizedItem]));
      setReopenModalOpen(true);
      return;
    }
    setCart(prev => [...prev, customizedItem]);
  };

  const updateQuantity = (cartItemId: string, delta: number) => {
    if (!can(permissions, 'actions.mesas.lancarItens')) {
      notifyPermissionRemoved();
      return;
    }
    const mutation = () => setCart(prev => {
      return prev.map(i => {
        const key = i.cartItemId || i.id;
        if (key === cartItemId) {
          const newQ = i.quantity + delta;
          return newQ > 0 ? { ...i, quantity: newQ } : i;
        }
        return i;
      });
    });
    if (tableNeedsReopen) {
      if (!can(permissions, 'actions.mesas.gerenciarMesa')) {
        notifyPermissionRemoved();
        return;
      }
      setPendingItemToAdd(null);
      setPendingTableMutation(() => mutation);
      setReopenModalOpen(true);
      return;
    }
    mutation();
  };

  const removeFromCart = (cartItemId: string) => {
    if (!can(permissions, 'actions.mesas.lancarItens')) {
      notifyPermissionRemoved();
      return;
    }
    const mutation = () => setCart(prev => prev.filter(i => (i.cartItemId || i.id) !== cartItemId));
    if (tableNeedsReopen) {
      if (!can(permissions, 'actions.mesas.gerenciarMesa')) {
        notifyPermissionRemoved();
        return;
      }
      setPendingItemToAdd(null);
      setPendingTableMutation(() => mutation);
      setReopenModalOpen(true);
      return;
    }
    mutation();
  };

  const handleOpenTable = (tableNumber: number) => {
    const isExistingTable = activeOrders.some(order => order.tableNumber === tableNumber);
    if (!isExistingTable && !can(permissions, 'actions.mesas.gerenciarMesa')) {
      notifyPermissionRemoved();
      return;
    }
    setSelectedTable(tableNumber);
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
    if (!can(permissions, 'actions.mesas.gerenciarMesa')) {
      notifyPermissionRemoved();
      return;
    }
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
    if (!can(permissions, 'actions.mesas.aceitarPedidoOnline')) {
      notifyPermissionRemoved();
      return;
    }
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
    if (!can(permissions, 'actions.mesas.aceitarPedidoOnline')) {
      notifyPermissionRemoved();
      return;
    }
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
    if (!can(permissions, 'actions.mesas.gerenciarMesa')) {
      notifyPermissionRemoved();
      return;
    }
    if (tablePickerFor?.currentTable === null && !can(permissions, 'actions.mesas.aceitarPedidoOnline')) {
      notifyPermissionRemoved();
      return;
    }
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
    const itemsChanged = JSON.stringify(cart) !== JSON.stringify(originalCart);
    if (!activeOrderId && !can(permissions, 'actions.mesas.gerenciarMesa')) {
      notifyPermissionRemoved();
      return;
    }
    if (itemsChanged && !can(permissions, 'actions.mesas.lancarItens')) {
      notifyPermissionRemoved();
      return;
    }
    if (customerDirty && !can(permissions, 'actions.mesas.gerenciarMesa')) {
      notifyPermissionRemoved();
      return;
    }
    if ((itemsChanged || customerDirty) && tableNeedsReopen) {
      if (!can(permissions, 'actions.mesas.gerenciarMesa')) {
        notifyPermissionRemoved();
        return;
      }
      setPendingItemToAdd(null);
      setPendingTableMutation(null);
      setReopenModalOpen(true);
      toast({ title: 'Reabra a mesa', description: 'Confirme a reabertura antes de salvar alterações nesta comanda.' });
      return;
    }
    if (!db || !user || !selectedTable || cart.length === 0) return;
    if (customerPhone.trim() && !isValidCreditPhone(customerPhone)) {
      toast({ variant: 'destructive', title: 'Telefone inválido', description: 'Informe DDD + telefone (10 ou 11 dígitos), ou limpe o cliente.' });
      return;
    }
    const unweighed = findUnweighedItem(cart);
    if (unweighed) {
      toast({ variant: 'destructive', title: 'Peso não informado', description: `Digite o peso de "${unweighed.name}" antes de salvar.` });
      return;
    }
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
        saleUnit: i.saleUnit === 'kg' ? 'kg' : 'un',
        weightGrams: i.saleUnit === 'kg' ? (Number(i.weightGrams) || 0) : null,
        pricePerKg: i.saleUnit === 'kg' ? (Number(i.pricePerKg ?? i.price) || 0) : null,
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

      let finalOrderId = activeOrderId;
      const newOrderRef = activeOrderId ? null : doc(collection(db, 'orders'));
      if (newOrderRef) finalOrderId = newOrderRef.id;
      const newOrderCode = newOrderRef ? generateOrderCode() : activeOrder?.orderCode;

      const explicitCustomerId = customerDirty
        ? customerId
        : customerId || activeOrder?.clienteId || null;
      let resolvedCustomerId = explicitCustomerId || (role === 'owner' ? proposedCustomerId(ownerId, {
        id: finalOrderId,
        customerName,
        customerPhone,
      }) : null);
      const hasCustomerIdentity = !!customerName.trim() || isValidCreditPhone(customerPhone);
      if (role === 'owner' && hasCustomerIdentity && finalOrderId) {
        // A identidade do cliente nunca derruba a comanda — mesma regra do
        // balcão (ver NovoPedidoTab): o vínculo é desejável, salvar a comanda
        // é obrigatório. Sem ele a mesa segue com nome + telefone, como sempre.
        try {
          const identity = await syncCustomerFromOrder(db, {
            id: finalOrderId,
            ...(explicitCustomerId ? { clienteId: explicitCustomerId } : {}),
            customerName,
            customerPhone,
          }, {
            ownerId,
            countOrder: false,
            writeCustomer: false,
            linkCollection: null,
            allowArchivedCustomer: false,
          });
          resolvedCustomerId = identity.customerId;
          if (identity.ambiguous) {
            toast({
              variant: 'destructive',
              title: 'Cliente em conflito',
              description: 'A comanda será salva sem vínculo. Resolva o telefone duplicado na aba Clientes.',
            });
          }
        } catch (err) {
          console.error('[mesa] identidade do cliente falhou; comanda segue sem vínculo:', err);
        }
      }

      // Vínculo do cliente: quando houve edição, grava também vazio para o
      // botão "Limpar" efetivamente remover o vínculo da comanda.
      const clientPatch: any = {};
      if (customerDirty) {
        clientPatch.customerName = customerName;
        // Só dígitos: é esta a chave que liga o pedido ao cliente (Prazo,
        // cadastro, WhatsApp). Formato livre aqui quebra a busca lá.
        clientPatch.customerPhone = normalizeCreditPhone(customerPhone);
        clientPatch.clienteId = resolvedCustomerId || deleteField();
        clientPatch.customerIdentityPending = hasCustomerIdentity;
      }

      const orderSpec = activeOrderId
        ? {
            ref: doc(db, 'orders', activeOrderId),
            mode: 'update' as const,
            data: itemsChanged
              ? { items: sanitizedItems, totalAmount: cartTotal, subtotal: cartTotal, ...clientPatch }
              : clientPatch,
          }
        : (() => {
            // Id do próprio Firestore, como em todo o resto do app. O antigo era
            // `Math.random()` em 8 caracteres: além de gravar com `set` numa
            // coleção compartilhada pelas lojas, o espaço dos 5 primeiros
            // caracteres — que é por onde o caixa casa a venda — era 15x menor
            // que o do id normal, e a chance de dois pedidos colidirem cresce
            // com o quadrado do movimento.
            return {
              ref: newOrderRef!,
              mode: 'set' as const,
              data: {
                id: finalOrderId,
                orderCode: newOrderCode,
                ownerId,
                customerName: customerName || `Mesa ${selectedTable}`,
                customerPhone: normalizeCreditPhone(customerPhone),
                ...(resolvedCustomerId ? { clienteId: resolvedCustomerId } : {}),
                ...(hasCustomerIdentity ? { customerIdentityPending: true } : {}),
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
                // Hora do servidor, não do PC (relógio de máquina de loja erra).
                createdAt: serverTimestamp(),
              },
            };
          })();

      if (activeOrderId && !itemsChanged) {
        // Alteração somente do cliente: não regrava itens nem reconcilia
        // estoque, o que preserva o gate separado de lançamento de itens.
        await updateDoc(doc(db, 'orders', activeOrderId), clientPatch);
      } else {
        // Grava o pedido e abate o estoque (delta vs o que já estava reservado),
        // de forma atômica. Lança InsufficientStockError se faltar.
        await reconcileOrderStock(db, {
          enableInventory: !!storeInfo?.general?.enableInventory,
          targetItems: sanitizedItems,
          alreadyDeducted: activeOrder?.stockDeductedItems,
          order: orderSpec,
        });
      }

      // Depois que a comanda existe, materializa/atualiza o cadastro proposto e
      // confirma o vínculo. Se falhar, o pedido continua íntegro e conserva os
      // campos textuais para o fallback legado.
      if (role === 'owner' && resolvedCustomerId && finalOrderId) {
        try {
          await syncCustomerFromOrder(db, {
            id: finalOrderId,
            clienteId: resolvedCustomerId,
            customerName,
            customerPhone,
            totalAmount: cartTotal,
          }, { ownerId, countOrder: false });
        } catch (identityError) {
          console.warn('Erro ao materializar cliente da mesa:', identityError);
        }
      }

      // Atualiza o estado local imediatamente, sem depender do "eco" do onSnapshot.
      // Sem isso, ao criar uma mesa nova o activeOrderId continuava null até o
      // Firestore devolver o pedido em tempo real — e enquanto isso a mesa não
      // ficava marcada como ocupada, o botão "Receber" não aparecia e, ao sair
      // da tela, a comanda local era perdida.
      setActiveOrderId(finalOrderId);
      setCustomerId(resolvedCustomerId);
      setOriginalCart(cart);
      setCustomerDirty(false);

      if (newItemsToPrint.length > 0) {
        setReceiptPrinted(false); // Reseta o botão de "Receber" para "Imprimir Conta" pois a conta mudou
        printReceiptNow({
          id: finalOrderId,
          orderCode: newOrderCode,
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
    if (!can(permissions, 'actions.mesas.fecharComanda')) {
      notifyPermissionRemoved();
      return;
    }
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
    if (!can(permissions, 'actions.mesas.gerenciarMesa') || ((pendingItemToAdd || pendingTableMutation) && !can(permissions, 'actions.mesas.lancarItens'))) {
      notifyPermissionRemoved();
      return;
    }
    if (!db || !activeOrderId) return;
    try {
      setIsSubmitting(true);
      await updateDoc(doc(db, 'orders', activeOrderId), { status: 'pending' });
      setReceiptPrinted(false);
      setReopenModalOpen(false);
      
      if (pendingItemToAdd) {
        setCart(prev => {
          if (isWeightItem(pendingItemToAdd)) return [...prev, makeWeightCartLine(pendingItemToAdd)];
          const existing = prev.find(i => i.id === pendingItemToAdd.id);
          if (existing) return prev.map(i => i.id === pendingItemToAdd.id ? { ...i, quantity: i.quantity + 1 } : i);
          return [...prev, { id: pendingItemToAdd.id, name: pendingItemToAdd.name, quantity: 1, unitPrice: pendingItemToAdd.price, addons: [], notes: '' }];
        });
        setPendingItemToAdd(null);
      }
      pendingTableMutation?.();
      setPendingTableMutation(null);
      toast({ title: 'Mesa Reaberta', description: 'Pode adicionar novos itens à mesa.' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Falha ao reabrir a mesa.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenPayment = () => {
    if (!can(permissions, 'actions.mesas.fecharComanda')) {
      notifyPermissionRemoved();
      return;
    }
    const itemsChanged = JSON.stringify(cart) !== JSON.stringify(originalCart);
    if ((itemsChanged && !can(permissions, 'actions.mesas.lancarItens')) || (customerDirty && !can(permissions, 'actions.mesas.gerenciarMesa'))) {
      notifyPermissionRemoved();
      return;
    }
    fechamento.reset();
    setPaymentModalOpen(true);
  };

  const handleConfirmCheckout = async () => {
    if (!can(permissions, 'actions.mesas.fecharComanda')) {
      notifyPermissionRemoved();
      return;
    }
    const itemsChanged = JSON.stringify(cart) !== JSON.stringify(originalCart);
    if ((itemsChanged && !can(permissions, 'actions.mesas.lancarItens')) || (customerDirty && !can(permissions, 'actions.mesas.gerenciarMesa'))) {
      notifyPermissionRemoved();
      return;
    }
    if (fechamento.isSplitMode && fechamento.paymentSplits.length === 0 && !fechamento.selectedPayment) return;
    if (!fechamento.isSplitMode && !fechamento.selectedPayment) return;
    if (!db || !activeOrderId) return;

    if (!caixaAberto) {
      toast({ variant: 'destructive', title: 'Caixa Fechado', description: 'Você não pode finalizar mesas com o caixa fechado. Abra o caixa primeiro.' });
      return;
    }

    setIsSubmitting(true);
    try {
      // Splits + paymentString + desconto/acréscimo vêm do fechamento
      // centralizado (components/admin/fechamento) — igual em todos os canais.
      const { splitsToProcess, paymentString, discount, surcharge, finalTotal: totalCobrado } = fechamento.buildCheckout();

      const linkedName = (customerName || '').trim();
      const phone = customerPhone || quickRegisterModal?.phone || '';
      if (phone.trim() && !isValidCreditPhone(phone)) {
        toast({ variant: 'destructive', title: 'Telefone inválido', description: 'Informe DDD + telefone (10 ou 11 dígitos), ou limpe o cliente.' });
        return;
      }
      const contaCasa = await resolveContaCasa(db, { splits: splitsToProcess, ownerId, phone });
      if (contaCasa.kind === 'register') {
        setIsSubmitting(false);
        setQuickRegisterModal({ isOpen: true, name: linkedName || `Cliente Mesa ${selectedTable}`, phone: contaCasa.phone, address: '' });
        return;
      }
      if (contaCasa.kind === 'blocked') {
        toast({ variant: 'destructive', title: 'Prazo bloqueado', description: contaCasa.message });
        return;
      }
      const contaCasaCustomerId = contaCasa.kind === 'ok' ? contaCasa.customerId : null;
      const activeOrder = activeOrders.find(o => o.id === activeOrderId);
      const explicitCustomerId = contaCasaCustomerId || customerId || activeOrder?.clienteId || null;
      let resolvedCustomerId = explicitCustomerId || (role === 'owner' ? proposedCustomerId(ownerId, {
        id: activeOrderId,
        customerName: linkedName,
        customerPhone: phone,
      }) : null);
      if (role === 'owner' && (linkedName || isValidCreditPhone(phone))) {
        const identity = await syncCustomerFromOrder(db, {
          ...activeOrder,
          id: activeOrderId,
          ...(explicitCustomerId ? { clienteId: explicitCustomerId } : { clienteId: undefined }),
          customerName: linkedName,
          customerPhone: phone,
          totalAmount: totalCobrado,
        }, {
          ownerId,
          countOrder: false,
          writeCustomer: false,
          linkCollection: null,
          allowArchivedCustomer: false,
        });
        resolvedCustomerId = identity.customerId;
      }

      // Grava status + vínculo do cliente + desconto/acréscimo na mesma escrita
      // (totalAmount passa a ser o valor efetivamente cobrado; cupom já imprime
      // discount/surcharge).
      const finalizeData: any = {
        status: 'delivered',
        paymentMethod: paymentString,
        subtotal: cartTotal,
        discount: discount || 0,
        surcharge: surcharge || 0,
        totalAmount: totalCobrado,
      };
      if (linkedName) finalizeData.customerName = linkedName;
      if (phone) finalizeData.customerPhone = normalizeCreditPhone(phone);
      if (resolvedCustomerId) finalizeData.clienteId = resolvedCustomerId;
      if (linkedName || isValidCreditPhone(phone)) finalizeData.customerIdentityPending = true;
      await updateDoc(doc(db, 'orders', activeOrderId), finalizeData);

      await registrarPagamentoSplits(db, {
        splits: splitsToProcess,
        contaCasaCustomerId,
        registrarLancamento,
        caixaAberto,
        tituloVenda: `Mesa ${selectedTable} - Finalizada`,
        tituloPrazo: `Mesa ${selectedTable} - Finalizada (Prazo)`,
        creditDescription: `Mesa ${selectedTable}`,
        orderId: activeOrderId,
        channel: 'mesa',
        onContaCasaSemCliente: () => toast({ variant: 'destructive', title: 'Aviso', description: 'Conta da Casa: cliente não encontrado para lançar dívida.' }),
      });

      // Vincula/contabiliza a venda no cadastro do cliente (só com cliente
      // identificado por telefone; venda anônima de mesa é ignorada). Idempotente.
      if (role === 'owner' && (resolvedCustomerId || linkedName || isValidCreditPhone(phone))) {
        try {
          await syncCustomerFromOrder(db, {
            ...activeOrder,
            id: activeOrderId,
            ownerId,
            clienteId: resolvedCustomerId,
            customerName: linkedName,
            customerPhone: phone,
            totalAmount: totalCobrado,
          }, { ownerId, countOrder: true });
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
        {can(permissions, 'tabs.caixa') && can(permissions, 'actions.caixa.abrirCaixa') && (
          <Button
            onClick={() => onOpenCaixa ? onOpenCaixa() : toast({ title: 'Como abrir o caixa:', description: 'Clique no botão "Caixa / Admin" no canto superior direito da tela.' })}
            size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 font-bold"
          >
            Abrir Caixa
          </Button>
        )}
      </CaixaFechadoCard>
    );
  }

  const renderItemCard = (item: any) => {
    const qtyInCart = cart.filter(i => i.id === item.id).reduce((sum, i) => sum + i.quantity, 0);
    const outOfStock = isOutOfStock(item, { enableInventory: !!storeInfo?.general?.enableInventory, allItems: items || [] });
    return (
      <button
        key={item.id}
        onClick={outOfStock || !canEditTableItems ? undefined : () => addToCart(item)}
        disabled={outOfStock || !canEditTableItems}
        className={`text-left border p-3 rounded-lg transition-colors group flex items-center gap-3 min-h-[88px] relative ${outOfStock || !canEditTableItems ? 'opacity-50 grayscale cursor-not-allowed' : 'hover:border-primary hover:bg-primary/5'}`}
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
        <div className="flex flex-col flex-1 min-w-0 gap-1">
          <span className="text-sm font-bold text-slate-700 line-clamp-2 leading-tight group-hover:text-primary pr-6">{item.name}</span>
          {promoItemsMap[item.id] ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground line-through">{brl(item.price)}</span>
              <span className="text-sm font-black text-green-600">{brl(promoItemsMap[item.id].promoPrice)}{isWeightItem(item) ? '/kg' : ''}</span>
            </div>
          ) : (
            <span className="text-sm font-black text-green-600">{brl(item.price)}{isWeightItem(item) ? '/kg' : ''}</span>
          )}
        </div>
      </button>
    );
  };

  const suggestionsDropdown = (
    <CustomerSuggestions matches={customerMatches} onSelect={applyCustomer} />
  );

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
                      onClick={() => handleOpenTable(num)}
                      disabled={!isOpen && !canGerenciarMesa}
                      className={`
                        relative h-20 md:h-24 rounded-xl flex flex-col items-center justify-center transition-all border-2
                        ${selectedTable === num ? 'ring-2 ring-primary ring-offset-2 scale-95' : isOpen || canGerenciarMesa ? 'hover:scale-105 hover:shadow-md' : 'cursor-not-allowed opacity-65'}
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
                            <p className="text-[10px] text-slate-400">{time && `${time} · `}#{getOrderCodePrefix(o)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {needsAttention
                            ? <span className="text-[9px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded">NOVO</span>
                            : <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">ACEITO</span>}
                          {canAceitarPedidoOnline && <button
                            type="button"
                            onClick={() => handleRejectOnlineOrder(o)}
                            title="Excluir pedido"
                            className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:text-red-600 hover:bg-red-100 transition-colors"
                          >
                            <X className="h-4 w-4" />
                          </button>}
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
                          <span className="font-black text-green-600">{brl((o.totalAmount || 0))}</span>
                        </div>
                        <div className="flex gap-2">
                          {needsAttention && canAceitarPedidoOnline && (
                            <Button
                              size="sm"
                              className="flex-1 h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                              onClick={() => handleAcceptOnlineOrder(o)}
                              title={isManualPrint ? 'Aceitar e imprimir o ticket' : 'Aceitar o pedido'}
                            >
                              {isManualPrint ? <><Printer className="h-3.5 w-3.5 mr-1" /> Aceitar</> : 'Aceitar'}
                            </Button>
                          )}
                          {canAceitarPedidoOnline && canGerenciarMesa && <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 h-8 text-xs border-amber-400 text-amber-700 hover:bg-amber-100"
                            onClick={() => setTablePickerFor({ orderId: o.id, currentTable: null })}
                          >
                            Pôr na mesa
                          </Button>}
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
              {activeOrderId && canGerenciarMesa && (
                <Button variant="ghost" size="sm" className="text-white/90 hover:text-white hover:bg-white/20 text-xs gap-1" onClick={() => setTablePickerFor({ orderId: activeOrderId, currentTable: selectedTable })}>
                  <ArrowLeftRight className="h-3.5 w-3.5" /> Trocar Mesa
                </Button>
              )}
              {activeOrderId && canGerenciarMesa && (
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
              {canGerenciarMesa && <div className="p-2 border-b bg-white shrink-0">
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
                      onChange={e => { setCustomerName(e.target.value); setCustomerId(null); setCustomerDirty(true); }}
                      onFocus={() => setActiveLookupField('name')}
                      onBlur={() => window.setTimeout(() => setActiveLookupField(f => (f === 'name' ? null : f)), 150)}
                      className="h-8 text-xs" />
                    {activeLookupField === 'name' && suggestionsDropdown}
                  </div>
                  <div className="relative">
                    <Input autoComplete="new-password" inputMode="tel" placeholder="Telefone / WhatsApp" value={customerPhone}
                      onChange={e => { setCustomerPhone(maskCreditPhoneInput(e.target.value)); setCustomerId(null); setCustomerDirty(true); }}
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
                          <span className="font-semibold text-amber-600">· disponível {brl((limit - balance))} de {brl(limit)}</span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>}
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
                          <p className="text-sm text-green-600 font-bold">{brl(Number(item.unitPrice ?? item.price ?? 0))}</p>
                          {item.addons && item.addons.length > 0 && (
                            <div className="text-xs text-muted-foreground leading-tight mt-0.5">
                              {item.addons.map((a: any) => a.name).join(', ')}
                            </div>
                          )}
                          {item.notes && <div className="text-xs text-orange-500 mt-0.5">Obs: {item.notes}</div>}
                        </div>
                        {canEditTableItems ? <>
                          {isWeightItem(item) ? (
                            <WeightInput
                              grams={Number(item.weightGrams) || 0}
                              pricePerKg={Number(item.pricePerKg ?? item.price) || 0}
                              onChange={(g) => updateWeight(item.cartItemId || item.id, g)}
                              autoFocus
                            />
                          ) : (
                            <div className="flex items-center gap-2 bg-slate-100 rounded-md p-1 border">
                              <button onClick={() => updateQuantity(item.cartItemId || item.id, -1)} className="h-8 w-8 flex items-center justify-center bg-white rounded shadow-sm hover:text-primary"><Minus className="h-4 w-4" /></button>
                              <span className="w-8 text-center text-sm font-bold">{item.quantity}</span>
                              <button onClick={() => updateQuantity(item.cartItemId || item.id, 1)} className="h-8 w-8 flex items-center justify-center bg-white rounded shadow-sm hover:text-primary"><Plus className="h-4 w-4" /></button>
                            </div>
                          )}
                          <button onClick={() => removeFromCart(item.cartItemId || item.id)} className="h-9 w-9 flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 rounded shrink-0">
                            <X className="h-5 w-5" />
                          </button>
                        </> : <span className="rounded-md bg-slate-100 px-2 py-1 text-sm font-bold text-slate-600">{isWeightItem(item) ? `${Number(item.weightGrams) || 0} g` : `${item.quantity}×`}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Total e Ações */}
              <div className="p-4 bg-white shrink-0 space-y-3 border-t">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Subtotal:</span>
                  <span className="text-2xl font-black text-slate-800">{brl(cartTotal)}</span>
                </div>
                <div className="flex gap-2">
                  {(() => {
                    const hasUnsavedChanges = JSON.stringify(cart) !== JSON.stringify(originalCart) || customerDirty;
                    return (canLancarItens || canGerenciarMesa) && (
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
                  {activeOrderId && canFecharComanda && (
                    <div className="flex-[1.5] flex gap-2">
                      <Button 
                        variant="outline" 
                        className="px-3 border-slate-300 text-slate-600 hover:bg-slate-100"
                        onClick={handlePrintReceipt}
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
                    {group.id === '__promo__' ? (
                      <span className="flex items-center gap-1"><Flame className="h-3.5 w-3.5 text-orange-500 fill-orange-500 animate-pulse" /> {group.name}</span>
                    ) : group.name}
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

      {/* Modal Pagamento Mesa — fechamento centralizado (desconto/acréscimo, split, troco) */}
      <FechamentoModal
        open={paymentModalOpen}
        onOpenChange={setPaymentModalOpen}
        fechamento={fechamento}
        title="Encerrar Mesa"
        subtitle={`Mesa ${selectedTable ?? ''}`}
        items={cart}
        caixaAberto={caixaAberto}
        prazoCustomer={{
          name: customerName,
          phone: customerPhone,
          matched: !!creditCustomer,
          available: creditCustomer && Number(creditCustomer.creditLimit) > 0
            ? Math.max(0, (Number(creditCustomer.creditLimit) || 0) - (Number(creditCustomer.creditBalance) || 0))
            : null,
        }}
        isSubmitting={isSubmitting}
        onConfirm={handleConfirmCheckout}
        confirmLabel="✅ Encerrar Mesa"
      />

      {/* Modal Reabrir Mesa */}
      <Dialog open={reopenModalOpen} onOpenChange={(open) => {
        setReopenModalOpen(open);
        if (!open) {
          setPendingItemToAdd(null);
          setPendingTableMutation(null);
        }
      }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Reabrir Mesa {selectedTable}?</DialogTitle>
            <DialogDescription>
              A conta desta mesa já foi impressa e está aguardando pagamento. Tem certeza que deseja reabrir a mesa para adicionar novos itens?
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-end mt-4">
            <Button variant="outline" onClick={() => { setReopenModalOpen(false); setPendingItemToAdd(null); setPendingTableMutation(null); }}>
              Cancelar
            </Button>
            {canGerenciarMesa && (!(pendingItemToAdd || pendingTableMutation) || canLancarItens) && (
              <Button onClick={confirmReopenTable} disabled={isSubmitting}>
                Sim, Reabrir Mesa
              </Button>
            )}
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
              const assigningOnlineOrder = tablePickerFor?.currentTable === null;
              const permissionDenied = !canGerenciarMesa || (assigningOnlineOrder && !canAceitarPedidoOnline);
              const disabled = ocupada || isCurrent || isSubmitting || permissionDenied;
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
          canSubmit={() => can(permissions, 'actions.mesas.fecharComanda')
            && can(permissions, 'actions.mesas.vendaPrazo')
            && (JSON.stringify(cart) === JSON.stringify(originalCart) || can(permissions, 'actions.mesas.lancarItens'))
            && (!customerDirty || can(permissions, 'actions.mesas.gerenciarMesa'))}
          onSubmitBlocked={notifyPermissionRemoved}
          db={db}
          ownerId={ownerId}
          initialName={quickRegisterModal.name}
          initialPhone={quickRegisterModal.phone}
          initialAddress={quickRegisterModal.address}
        />
      )}
    </div>
  );
}
