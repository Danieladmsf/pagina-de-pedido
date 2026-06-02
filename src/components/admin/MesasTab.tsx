'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ShoppingCart, Plus, Minus, Search, Tag, X, CreditCard, Banknote, QrCode, Wallet, ArrowLeft, Printer, Calculator } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import { collection, doc, setDoc, updateDoc, deleteDoc, query, where, getDocs, increment, writeBatch, getDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { PrintReceipt } from './PrintReceipt';
import { QuickRegisterClientModal } from './QuickRegisterClientModal';
import { getPhoneVariants } from '@/lib/customer-credit';
import { isItemVisibleInChannel } from '@/lib/menu-visibility';

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

const getManagedStock = (value: unknown): number | null => {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
};

export function MesasTab({ orders = [], categories = [], items = [], db, user, registrarLancamento, caixaAberto = false, storeInfo, onOpenCaixa, addons = [], addonCategories = [], onUnsavedChangesChange }: MesasTabProps) {
  const FORMAS_PAGAMENTO = (storeInfo?.paymentMethods && storeInfo.paymentMethods.length > 0 ? storeInfo.paymentMethods : DEFAULT_FORMAS_PAGAMENTO).filter((m: any) => m.active && m.id !== 'conta_casa');
  const { toast } = useToast();
  const [activeSubTab, setActiveSubTab] = useState<'abertas' | 'finalizadas'>('abertas');
  const [searchTable, setSearchTable] = useState('');
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [selectedItemForDialog, setSelectedItemForDialog] = useState<any | null>(null);

  // PDV States
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<any[]>([]);
  const [originalCart, setOriginalCart] = useState<any[]>([]);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  
  // Impressão e Pagamento
  const [orderToPrint, setOrderToPrint] = useState<any>(null);
  const [isKitchenPrint, setIsKitchenPrint] = useState(false);
  
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

  // Derivando mesas
  const tables = Array.from({ length: 15 }, (_, i) => i + 1);
  
  const activeTableNumbers = activeOrders.map(o => o.tableNumber).filter(Boolean);

  const lastSelectedTableRef = React.useRef<number | null>(null);
  const hasUnsavedChanges = JSON.stringify(cart) !== JSON.stringify(originalCart);

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

      if (tableChanged || !hasUnsavedChanges) {
        if (activeOrder) {
          setCart(activeOrder.items || []);
          setOriginalCart(activeOrder.items || []);
          setActiveOrderId(activeOrder.id);
          setReceiptPrinted(activeOrder.status === 'awaiting_payment');
        } else {
          setCart([]);
          setOriginalCart([]);
          setActiveOrderId(null);
          setReceiptPrinted(false);
        }
      }
    } else {
      lastSelectedTableRef.current = null;
      setCart([]);
      setOriginalCart([]);
      setActiveOrderId(null);
      setReceiptPrinted(false);
    }
  }, [selectedTable, orders]); // depends on orders to sync in real-time

  const cartTotal = cart.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);

  const filteredItems = items?.filter(item => {
    if (item.isAvailable === false) return false;
    if (!isItemVisibleInChannel(item, 'dine_in')) return false;
    const matchesCat = activeCategory === 'all' || item.categoryId === activeCategory;
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCat && matchesSearch;
  });

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
        const batch = writeBatch(db);
        const orderCancelUpdate: any = { status: 'canceled', items: [], totalAmount: 0, subtotal: 0 };

        if (storeInfo?.general?.enableInventory) {
          const stockRestore: Record<string, number> = {};
          const activeOrder = activeOrders.find(o => o.id === activeOrderId);
          const hasExactMovements = activeOrder && Object.prototype.hasOwnProperty.call(activeOrder, 'stockDeductedItems');

          if (hasExactMovements) {
            Object.entries(activeOrder.stockDeductedItems || {}).forEach(([itemId, quantity]) => {
              const qty = Number(quantity) || 0;
              if (qty > 0) {
                stockRestore[itemId] = qty;
              }
            });
          } else {
            cart.forEach(item => {
              if (item.isCombo && item.comboItems) {
                item.comboItems.forEach((ci: any) => {
                  stockRestore[ci.itemId] = (stockRestore[ci.itemId] || 0) + item.quantity;
                });
              } else if (item.id) {
                stockRestore[item.id] = (stockRestore[item.id] || 0) + item.quantity;
              }
            });
          }

          for (const [itemId, qty] of Object.entries(stockRestore)) {
            const itemRef = doc(db, 'menuItems', itemId);
            const itemSnap = await getDoc(itemRef);
            const currentStock = itemSnap.exists() ? getManagedStock(itemSnap.data().stockQuantity) : null;
            if (currentStock !== null) {
              batch.update(itemRef, {
                stockQuantity: increment(qty)
              });
            }
          }
          orderCancelUpdate.stockDeducted = false;
          orderCancelUpdate.stockDeductedItems = {};
        }

        batch.update(doc(db, 'orders', activeOrderId), orderCancelUpdate);
        await batch.commit();
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

  const handleSaveOrder = async () => {
    if (!db || !user || !selectedTable || cart.length === 0) return;
    setIsSubmitting(true);
    
    // Calcula diferença para impressão da cozinha e controle de estoque
    const newItemsToPrint: any[] = [];
    const stockDiffs: Record<string, number> = {};
    let managedStockDiffs: Record<string, number> = {};

    cart.forEach(item => {
      const originalItem = originalCart.find(oi => (oi.cartItemId || oi.id) === (item.cartItemId || item.id));
      const diffQty = item.quantity - (originalItem ? originalItem.quantity : 0);
      if (diffQty > 0) {
        newItemsToPrint.push({ ...item, quantity: diffQty });
      }
      if (diffQty !== 0) {
        if (item.isCombo && item.comboItems) {
          item.comboItems.forEach((ci: any) => {
            stockDiffs[ci.itemId] = (stockDiffs[ci.itemId] || 0) + diffQty;
          });
        } else if (item.id) {
          stockDiffs[item.id] = (stockDiffs[item.id] || 0) + diffQty;
        }
      }
    });

    originalCart.forEach(oi => {
      const stillInCart = cart.find(item => (item.cartItemId || item.id) === (oi.cartItemId || oi.id));
      if (!stillInCart) {
        if (oi.isCombo && oi.comboItems) {
          oi.comboItems.forEach((ci: any) => {
            stockDiffs[ci.itemId] = (stockDiffs[ci.itemId] || 0) - oi.quantity;
          });
        } else if (oi.id) {
          stockDiffs[oi.id] = (stockDiffs[oi.id] || 0) - oi.quantity;
        }
      }
    });

    if (storeInfo?.general?.enableInventory) {
      const itemsToValidate = Object.entries(stockDiffs).filter(([_, diff]) => diff !== 0);
      if (itemsToValidate.length > 0) {
        try {
          for (const [itemId, diff] of itemsToValidate) {
            const itemRef = doc(db, 'menuItems', itemId);
            const itemSnap = await getDoc(itemRef);
            if (itemSnap.exists()) {
              const itemData = itemSnap.data();
              const currentStock = getManagedStock(itemData.stockQuantity);
              if (currentStock === null) continue;

              if (diff > 0 && diff > currentStock) {
                toast({
                  variant: 'destructive',
                  title: 'Estoque insuficiente',
                  description: `Não foi possível salvar. "${itemData.name || itemId}" tem apenas ${currentStock} unidade(s) disponível(is), mas você tentou adicionar ${diff}.`
                });
                setIsSubmitting(false);
                return;
              }

              managedStockDiffs[itemId] = diff;
            }
          }
        } catch (err) {
          console.error("Erro ao validar estoque:", err);
        }
      }
    }

    try {
      let finalOrderId = activeOrderId;
      const batch = writeBatch(db);
      const activeOrder = activeOrderId ? activeOrders.find(o => o.id === activeOrderId) : null;
      const nextStockDeductedItems: Record<string, number> = { ...(activeOrder?.stockDeductedItems || {}) };

      if (storeInfo?.general?.enableInventory) {
        Object.entries(managedStockDiffs).forEach(([itemId, diff]) => {
          const nextQty = (Number(nextStockDeductedItems[itemId]) || 0) + diff;
          if (nextQty > 0) {
            nextStockDeductedItems[itemId] = nextQty;
          } else {
            delete nextStockDeductedItems[itemId];
          }
        });
      }
      
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

      if (activeOrderId) {
        batch.update(doc(db, 'orders', activeOrderId), {
          items: sanitizedItems,
          totalAmount: cartTotal,
          subtotal: cartTotal,
          stockDeducted: !!storeInfo?.general?.enableInventory,
          stockDeductedItems: nextStockDeductedItems,
        });
      } else {
        finalOrderId = Math.random().toString(36).substring(2, 10).toUpperCase();
        batch.set(doc(db, 'orders', finalOrderId), {
          id: finalOrderId,
          ownerId: user?.uid || 'default',
          customerName: `Mesa ${selectedTable}`,
          tableNumber: selectedTable,
          orderType: 'dine_in',
          status: 'pending',
          paymentStatus: 'pending',
          // Marca que o pedido nasceu no PDV de mesa, que já imprime o ticket da
          // cozinha localmente. Sem isso, a impressão automática de novos pedidos
          // (page.tsx) imprimiria o mesmo cupom de novo — saía em duplicidade.
          source: 'pdv',
          items: sanitizedItems,
          totalAmount: cartTotal,
          subtotal: cartTotal,
          orderDateTime: new Date().toISOString(),
          createdAt: new Date(),
          stockDeducted: !!storeInfo?.general?.enableInventory,
          stockDeductedItems: nextStockDeductedItems,
        });
      }

      if (storeInfo?.general?.enableInventory) {
        Object.entries(managedStockDiffs).forEach(([itemId, diff]) => {
          if (diff !== 0) {
            batch.update(doc(db, 'menuItems', itemId), {
              stockQuantity: increment(-diff)
            });
          }
        });
      }

      await batch.commit();

      // Atualiza o estado local imediatamente, sem depender do "eco" do onSnapshot.
      // Sem isso, ao criar uma mesa nova o activeOrderId continuava null até o
      // Firestore devolver o pedido em tempo real — e enquanto isso a mesa não
      // ficava marcada como ocupada, o botão "Receber" não aparecia e, ao sair
      // da tela, a comanda local era perdida.
      setActiveOrderId(finalOrderId);
      setOriginalCart(cart);

      if (newItemsToPrint.length > 0) {
        setIsKitchenPrint(true);
        setReceiptPrinted(false); // Reseta o botão de "Receber" para "Imprimir Conta" pois a conta mudou
        setOrderToPrint({
          id: finalOrderId,
          customerName: `Mesa ${selectedTable}`,
          orderType: 'dine_in',
          items: newItemsToPrint,
          orderDateTime: new Date().toISOString(),
        });
        setTimeout(() => window.print(), 500);
        toast({ title: 'Sucesso', description: 'Pedido salvo e enviado para produção!' });
      } else {
        toast({ title: 'Sucesso', description: 'Mesa atualizada (sem novos itens).' });
      }

    } catch(e) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Não foi possível salvar.' });
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
      
      setIsKitchenPrint(false);
      setOrderToPrint(activeOrder);
      setReceiptPrinted(true);
      setTimeout(() => window.print(), 500);
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
      const hasContaCasa = splitsToProcess.some(s => s.methodId === 'conta_casa');
      if (hasContaCasa) {
          const phone = quickRegisterModal?.phone || ''; // Mesa usually doesn't have phone attached
          if (!phone || phone.length < 10) {
             setIsSubmitting(false);
             setQuickRegisterModal({ isOpen: true, name: `Cliente Mesa ${selectedTable}`, phone: '', address: '' });
             return;
          }
          const q = query(collection(db, 'clientes'), where('ownerId', '==', ownerId), where('celular', 'in', getPhoneVariants(phone)));
          const snap = await getDocs(q);
          if (snap.empty) {
             setIsSubmitting(false);
             setQuickRegisterModal({ isOpen: true, name: `Cliente Mesa ${selectedTable}`, phone, address: '' });
             return;
          }
      }

      await updateDoc(doc(db, 'orders', activeOrderId), {
        status: 'delivered',
        paymentMethod: paymentString,
      });

      for (const split of splitsToProcess) {
        if (split.methodId === 'conta_casa') {
             const ownerId = storeInfo?.id || user?.uid || 'default';
             const q = query(collection(db, 'clientes'), where('ownerId', '==', ownerId), where('celular', 'in', getPhoneVariants(quickRegisterModal?.phone || '')));
             const snap = await getDocs(q);
             if (!snap.empty) {
                const cId = snap.docs[0].id;
                const newTrans = doc(collection(db, 'clientes', cId, 'credit_transactions'));
                await setDoc(newTrans, {
                   id: newTrans.id,
                   type: 'debit',
                   amount: split.amount,
                   date: new Date().toISOString(),
                   description: `Mesa ${selectedTable}`
                });
                await updateDoc(doc(db, 'clientes', cId), { creditBalance: increment(split.amount) });
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
      <div className="flex justify-center">
        <div className="bg-white border rounded-2xl py-6 px-6 text-center space-y-3 max-w-sm w-full shadow-sm">
          <Calculator className="h-12 w-12 text-muted-foreground/30 mx-auto" />
          <h2 className="text-lg font-bold text-slate-700 uppercase tracking-wider">Caixa Fechado</h2>
          <div className="bg-slate-50 border rounded-xl p-3 text-xs text-muted-foreground space-y-0.5">
            <p>A operação de caixa de um pedido é lançada apenas quando ele é finalizado.</p>
            <p>O caixa precisa estar aberto para poder abrir e gerenciar mesas.</p>
            <p className="font-semibold text-slate-600">Acesse a aba <span className="text-slate-800">Caixa / Admin</span> no topo da tela para abrir o caixa.</p>
          </div>
          <div className="flex gap-3 justify-center">
            <Button 
              onClick={() => onOpenCaixa ? onOpenCaixa() : toast({ title: 'Como abrir o caixa:', description: 'Clique no botão "Caixa / Admin" no canto superior direito da tela.' })} 
              size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 font-bold"
            >
              Abrir Caixa
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 flex-1 overflow-hidden">
      
      {/* Grade de Mesas */}
      {!selectedTable && (
        <div className="flex-1 bg-white rounded-xl shadow-sm border p-4 flex flex-col h-full">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">Gerenciar Mesas</h2>
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

              return (
                <button
                  key={num}
                  onClick={() => setSelectedTable(num)}
                  className={`
                    h-20 md:h-24 rounded-xl flex flex-col items-center justify-center transition-all border-2
                    ${selectedTable === num ? 'ring-2 ring-primary ring-offset-2 scale-95' : 'hover:scale-105'}
                    ${isOpen ? (isAwaitingPayment ? 'bg-amber-500 border-amber-600 text-white shadow-md' : 'bg-teal-500 border-teal-600 text-white shadow-md') : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'}
                  `}
                >
                  <span className="text-2xl font-black">{num}</span>
                  {isOpen && <span className="text-[10px] uppercase font-bold bg-black/20 px-1.5 py-0.5 rounded mt-1 truncate max-w-[90%]">{isAwaitingPayment ? 'Aguardando Pagamento' : 'Ocupada'}</span>}
                </button>
              );
            })}
            </div>
          </div>
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
                    const hasUnsavedChanges = JSON.stringify(cart) !== JSON.stringify(originalCart);
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
                            setIsKitchenPrint(false);
                            setOrderToPrint(activeOrder);
                            setTimeout(() => window.print(), 500);
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
              <div className="p-3 border-b flex gap-2 overflow-x-auto custom-scrollbar shrink-0">
                <Badge 
                  variant="secondary" 
                  className={`cursor-pointer whitespace-nowrap text-sm py-1 px-3 ${activeCategory === 'all' ? 'bg-primary text-primary-foreground' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                  onClick={() => setActiveCategory('all')}
                >
                  Todos
                </Badge>
                {categories.map(cat => (
                  <Badge 
                    key={cat.id} 
                    variant="secondary" 
                    className={`cursor-pointer whitespace-nowrap text-sm py-1 px-3 ${activeCategory === cat.id ? 'bg-primary text-primary-foreground' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                    onClick={() => setActiveCategory(cat.id)}
                  >
                    {cat.name}
                  </Badge>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto p-3 custom-scrollbar grid grid-cols-2 md:grid-cols-3 gap-3 content-start">
                {filteredItems.map(item => {
                  const qtyInCart = cart.filter(i => i.id === item.id).reduce((sum, i) => sum + i.quantity, 0);
                  return (
                    <button 
                      key={item.id} 
                      onClick={() => addToCart(item)}
                      className="text-left border p-3 rounded-lg hover:border-primary hover:bg-primary/5 transition-colors group flex flex-col justify-between min-h-[90px] relative"
                    >
                      {qtyInCart > 0 && (
                        <Badge className="absolute top-2 right-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] px-1.5 py-0.5 rounded-full z-10">
                          {qtyInCart}
                        </Badge>
                      )}
                      <span className="text-sm font-bold text-slate-700 line-clamp-2 leading-tight group-hover:text-primary pr-6">{item.name}</span>
                      <span className="text-sm font-black text-green-600 mt-2">R$ {item.price.toFixed(2)}</span>
                    </button>
                  );
                })}
                {filteredItems.length === 0 && (
                  <div className="col-span-full text-center text-sm text-slate-400 py-8">Nenhum produto encontrado.</div>
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
                  <DialogTitle className="text-sm flex items-center justify-between">
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

      {/* Impressão Oculta */}
      {orderToPrint && (
        <PrintReceipt order={orderToPrint} storeInfo={storeInfo} isKitchen={isKitchenPrint} />
      )}
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
