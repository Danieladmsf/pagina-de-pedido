'use client';

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import CaixaFechadoCard from '@/components/shared/CaixaFechadoCard';
import { ShoppingCart, Plus, Minus, Search, Tag, X, CreditCard, Banknote, QrCode, Wallet } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import { collection, doc, setDoc, updateDoc, increment, getDocs, query, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { printOrderReceipt } from '@/lib/order-receipt-html';
import { QuickRegisterClientModal } from './QuickRegisterClientModal';
import { AddressAutocomplete } from '@/components/ui/address-autocomplete';
import { useCallback } from 'react';
import { MenuItemDialog } from '@/components/menu/MenuItemDialog';
import { findCreditCustomers, normalizeCreditPhone, validateCustomerCredit, sumPendingCreditOrdersForOwner, isCreditEnabled } from '@/lib/customer-credit';
import { isItemVisibleInChannel } from '@/lib/menu-visibility';
import { useCategoryScrollSpy } from '@/hooks/useCategoryScrollSpy';
import { removeAccents, normalizeSearch } from '@/lib/utils';
import { reconcileOrderStock, InsufficientStockError } from '@/lib/inventory';
import { syncCustomerFromOrder } from '@/lib/customers/customer-sync';

interface NovoPedidoTabProps {
  categories: any[];
  items: any[];
  db: any;
  user: any;
  registrarLancamento?: (params: { tipo: 'venda'; titulo: string; valor: number; formaPagamento: string }) => Promise<void>;
  caixaAberto?: boolean;
  storeProfile?: any;
  onOpenCaixa?: () => void;
  addons?: any[];
  addonCategories?: any[];
}

const DEFAULT_FORMAS_PAGAMENTO = [
  { id: 'dinheiro', label: 'Dinheiro', icon: '💵', active: true },
  { id: 'pix', label: 'Pix', icon: '📱', active: true },
  { id: 'debito', label: 'Débito', icon: '💳', active: true },
  { id: 'credito', label: 'Crédito', icon: '💳', active: true },
];

type CustomerLookupStatus = 'idle' | 'searching' | 'found' | 'not_found' | 'error';

const asText = (value: unknown) => value === undefined || value === null ? '' : String(value);

const getCustomerDisplayName = (customerData: any) => {
  return asText(customerData?.nome || customerData?.name || customerData?.customerName).trim();
};

const getCustomerAddress = (customerData: any) => {
  return {
    street: asText(customerData?.logradouro || customerData?.street || customerData?.address?.street).trim(),
    number: asText(customerData?.logradouroNumero || customerData?.numero || customerData?.number || customerData?.address?.number).trim(),
    neighborhood: asText(customerData?.bairro || customerData?.neighborhood || customerData?.address?.neighborhood).trim(),
    city: asText(customerData?.cidade || customerData?.city || customerData?.address?.city).trim(),
  };
};

const hasAddressData = (address: { street: string; number: string; neighborhood: string; city: string }) => {
  return !!(address.street || address.number || address.neighborhood || address.city);
};

const buildAddressLine = (address: { street: string; number: string; neighborhood: string; city: string }) => {
  return [address.street, address.number, address.neighborhood, address.city].filter(Boolean).join(', ');
};

export function NovoPedidoTab({ categories, items, db, user, registrarLancamento,
  caixaAberto = false,
  storeProfile,
  onOpenCaixa,
  addons = [],
  addonCategories = []
}: NovoPedidoTabProps) {
  const FORMAS_PAGAMENTO = (storeProfile?.paymentMethods && storeProfile.paymentMethods.length > 0 ? storeProfile.paymentMethods : DEFAULT_FORMAS_PAGAMENTO).filter((m: any) => m.active);
  if (!FORMAS_PAGAMENTO.find((m: any) => m.id === 'conta_casa')) {
    FORMAS_PAGAMENTO.push({ id: 'conta_casa', label: 'Prazo', icon: '📝', active: true });
  }
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItemForDialog, setSelectedItemForDialog] = useState<any | null>(null);
  const [quickRegisterModal, setQuickRegisterModal] = useState<{isOpen: boolean, name: string, phone: string, address: string} | null>(null);
  
  // Carrinho
  const [cart, setCart] = useState<any[]>([]);

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

  const cartTotal = cart.reduce((sum, item) => sum + ((item.unitPrice || item.price) * item.quantity), 0);

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [paymentSplits, setPaymentSplits] = useState<{methodId: string, label: string, amount: number, received?: number}[]>([]);
  const [selectedPayment, setSelectedPayment] = useState('');
  const [valorRecebido, setValorRecebido] = useState<string>('');
  const [deliveryFeeInput, setDeliveryFeeInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Estados para entrega
  const [orderType, setOrderType] = useState<'pickup' | 'delivery'>('pickup');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerLookupStatus, setCustomerLookupStatus] = useState<CustomerLookupStatus>('idle');
  const [matchedCustomerName, setMatchedCustomerName] = useState('');
  const [allCustomers, setAllCustomers] = useState<any[]>([]);
  const [activeLookupField, setActiveLookupField] = useState<null | 'name' | 'phone'>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const filteredItems = items?.filter(item => {
    if (item.isAvailable === false) return false;
    if (!isItemVisibleInChannel(item, orderType)) return false;
    const matchesSearch = normalizeSearch(item.name).includes(normalizeSearch(searchTerm));
    return matchesSearch;
  });

  // Os produtos sao sempre agrupados por categoria (na mesma ordem dos
  // filtros). Clicar numa categoria rola ate a secao; rolar a lista
  // atualiza a pill ativa — igual ao cardapio do cliente.
  const groupedItems = (categories || [])
    .map((cat: any) => ({
      id: cat.id,
      name: cat.name,
      items: (filteredItems || []).filter(it => it.categoryId === cat.id),
    }))
    .filter(group => group.items.length > 0);
  const uncategorizedItems = (filteredItems || []).filter(
    it => !categories?.some((c: any) => c.id === it.categoryId)
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
  
  // Endereço e cálculo de frete
  const storeAddress = storeProfile?.general?.address || '';
  const deliveryFeeRules = storeProfile?.feeRules || storeProfile?.fees?.feeRules || [];
  const maxDeliveryRadius = storeProfile?.fees?.maxDeliveryRadius || 0;
  const deliveryCities: string[] = storeProfile?.general?.deliveryCities || storeProfile?.fees?.deliveryCities || [];

  const [addressObj, setAddressObj] = useState<{street: string, number: string, neighborhood: string, city: string}>({ street: '', number: '', neighborhood: '', city: '' });
  const [calculatingFee, setCalculatingFee] = useState(false);
  const [deliveryBlocked, setDeliveryBlocked] = useState(false);
  const [distanceInfo, setDistanceInfo] = useState<{distanceKm: number, distanceText: string} | null>(null);
  const [dynamicFee, setDynamicFee] = useState<number | null>(null);

  // Calcula a taxa chamando a API
  const calculateDeliveryFee = useCallback(async (fullAddr: string) => {
    if (!storeAddress || !deliveryFeeRules || deliveryFeeRules.length === 0) return;
    if (!fullAddr || fullAddr.length < 5) return;

    setCalculatingFee(true);
    try {
      const res = await fetch('/api/delivery-fee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeAddress,
          customerAddress: fullAddr,
          feeRules: deliveryFeeRules,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (maxDeliveryRadius > 0 && data.distanceKm > maxDeliveryRadius) {
          setDeliveryBlocked(true);
          setDynamicFee(null);
          setDistanceInfo(null);
          toast({ variant: 'destructive', title: 'Fora da área de entrega', description: `O restaurante entrega apenas até ${maxDeliveryRadius}km.` });
        } else {
          setDeliveryBlocked(false);
          setDynamicFee(data.fee);
          setDistanceInfo({
            distanceKm: data.distanceKm,
            distanceText: data.distanceText
          });
          // Preenche input manual para refletir o cálculo
          setDeliveryFeeInput(data.fee.toFixed(2));
        }
      } else {
        toast({ variant: 'destructive', title: 'Erro na taxa', description: data.error || 'Falha ao calcular.' });
        setDynamicFee(null);
        setDistanceInfo(null);
        setDeliveryBlocked(false);
      }
    } catch (err) {
      console.error('Erro:', err);
    } finally {
      setCalculatingFee(false);
    }
  }, [storeAddress, deliveryFeeRules, maxDeliveryRadius, toast]);

  React.useEffect(() => {
    const normalizedPhone = normalizeCreditPhone(customerPhone);
    const ownerId = storeProfile?.id || user?.uid || 'default';

    if (orderType !== 'delivery' || !db || !ownerId || normalizedPhone.length < 10) {
      setCustomerLookupStatus('idle');
      setMatchedCustomerName('');
      return;
    }

    let ignore = false;
    const lookupTimeout = window.setTimeout(async () => {
      setCustomerLookupStatus('searching');
      setMatchedCustomerName('');

      try {
        const customers = await findCreditCustomers(db, ownerId, customerPhone);
        if (ignore) return;

        if (customers.length === 0) {
          setCustomerLookupStatus('not_found');
          return;
        }

        const customerData = customers[0].data || {};
        const displayName = getCustomerDisplayName(customerData);
        const savedAddress = getCustomerAddress(customerData);

        if (displayName) {
          setCustomerName(displayName);
          setMatchedCustomerName(displayName);
        }

        if (hasAddressData(savedAddress)) {
          setAddressObj(prev => ({
            street: savedAddress.street || prev.street,
            number: savedAddress.number || prev.number,
            neighborhood: savedAddress.neighborhood || prev.neighborhood,
            city: savedAddress.city || prev.city,
          }));
          setDynamicFee(null);
          setDistanceInfo(null);
          setDeliveryBlocked(false);

          const fullAddr = buildAddressLine(savedAddress);
          if (fullAddr) {
            calculateDeliveryFee(fullAddr);
          }
        }

        setCustomerLookupStatus('found');
      } catch (err) {
        if (ignore) return;
        console.error('Erro ao buscar cliente pelo telefone:', err);
        setCustomerLookupStatus('error');
      }
    }, 500);

    return () => {
      ignore = true;
      window.clearTimeout(lookupTimeout);
    };
  }, [customerPhone, orderType, db, storeProfile?.id, user?.uid, calculateDeliveryFee]);

  // Efeito para calcular taxa automaticamente quando o preenchimento automático (autofill) dispara
  React.useEffect(() => {
    if (orderType !== 'delivery') return;
    if (addressObj.street && addressObj.street.length > 3 && addressObj.city && addressObj.city.length > 3) {
      const timeout = setTimeout(() => {
        if (dynamicFee === null && !calculatingFee) {
          const fullAddr = [addressObj.street, addressObj.number, addressObj.neighborhood, addressObj.city].filter(Boolean).join(', ');
          calculateDeliveryFee(fullAddr);
        }
      }, 1000); // 1 segundo de espera
      return () => clearTimeout(timeout);
    }
  }, [addressObj.street, addressObj.city, addressObj.neighborhood, addressObj.number, orderType, dynamicFee, calculatingFee, calculateDeliveryFee]);

  // Efeito para carregar o rascunho salvo do localStorage na inicialização (somente cliente)
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('balcao_draft_order');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.cart) setCart(parsed.cart);
        if (parsed.customerName && parsed.customerName !== 'Cliente Balcão') setCustomerName(parsed.customerName);
        if (parsed.customerPhone) setCustomerPhone(parsed.customerPhone);
        // orderType nao e restaurado: a pagina sempre abre em Balcao/Retirada (pickup)
        if (parsed.addressObj) setAddressObj(parsed.addressObj);
        if (parsed.deliveryFeeInput) setDeliveryFeeInput(parsed.deliveryFeeInput);
        if (parsed.distanceInfo) setDistanceInfo(parsed.distanceInfo);
        if (parsed.dynamicFee) setDynamicFee(parsed.dynamicFee);
      }
    } catch (e) {
      console.error('Erro ao ler rascunho do balcão:', e);
    }
  }, []);

  // Efeito para salvar o rascunho no localStorage a cada alteração
  React.useEffect(() => {
    try {
      const draft = {
        cart,
        customerName,
        customerPhone,
        orderType,
        addressObj,
        deliveryFeeInput,
        distanceInfo,
        dynamicFee
      };
      localStorage.setItem('balcao_draft_order', JSON.stringify(draft));
    } catch (e) {
      console.error('Erro ao salvar rascunho do balcão:', e);
    }
  }, [cart, customerName, customerPhone, orderType, addressObj, deliveryFeeInput, distanceInfo, dynamicFee]);

  const handleAddressSelected = (addr: string) => {
    setAddressObj(prev => ({ ...prev, street: addr }));
    const fullAddr = addressObj.number ? `${addr}, ${addressObj.number}` : addr;
    calculateDeliveryFee(fullAddr);
  };

  // Carrega a lista de clientes (uma vez) para o autocomplete por nome/telefone
  React.useEffect(() => {
    const ownerId = storeProfile?.id || user?.uid;
    if (!db || !ownerId) return;
    let ignore = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'clientes'), where('ownerId', '==', ownerId)));
        if (!ignore) setAllCustomers(snap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error('Erro ao carregar clientes para autocomplete:', e);
      }
    })();
    return () => { ignore = true; };
  }, [db, storeProfile?.id, user?.uid]);

  // Sugestões de cliente conforme o campo ativo (nome ou telefone)
  const customerMatches = React.useMemo(() => {
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

  const applyCustomer = (c: any) => {
    setSelectedCustomer(c);
    const name = getCustomerDisplayName(c);
    const phone = String(c.celular || '');
    if (name) setCustomerName(name);
    if (phone) setCustomerPhone(phone);
    if (orderType === 'delivery') {
      const addr = getCustomerAddress(c);
      if (hasAddressData(addr)) {
        setAddressObj(prev => ({
          street: addr.street || prev.street,
          number: addr.number || prev.number,
          neighborhood: addr.neighborhood || prev.neighborhood,
          city: addr.city || prev.city,
        }));
        setDynamicFee(null);
        setDistanceInfo(null);
        setDeliveryBlocked(false);
        const fullAddr = [addr.street, addr.number, addr.neighborhood, addr.city].filter(Boolean).join(', ');
        if (fullAddr) calculateDeliveryFee(fullAddr);
      }
    }
    setActiveLookupField(null);
  };

  // Limpa os dados do cliente/endereço de uma vez (para atender outro cliente)
  const clearCustomerFields = () => {
    setCustomerName('');
    setCustomerPhone('');
    setAddressObj({ street: '', number: '', neighborhood: '', city: '' });
    setDeliveryFeeInput('');
    setDynamicFee(null);
    setDistanceInfo(null);
    setDeliveryBlocked(false);
    setCustomerLookupStatus('idle');
    setMatchedCustomerName('');
    setActiveLookupField(null);
    setSelectedCustomer(null);
  };

  const deliveryFee = orderType === 'delivery' ? (Number(deliveryFeeInput) || 0) : 0;
  const finalTotal = cartTotal + deliveryFee;

  const handleAddSplit = () => {
    if (!selectedPayment) return;
    const remaining = Math.max(0, finalTotal - paymentSplits.reduce((sum, s) => sum + s.amount, 0));
    let amount = remaining;
    let received: number | undefined = undefined;
    if (selectedPayment === 'dinheiro' && valorRecebido) {
      const valRec = Number(valorRecebido);
      if (valRec >= remaining) {
        received = valRec;
        amount = remaining;
      } else {
        amount = valRec;
        received = valRec;
      }
    } else if (valorRecebido) {
      const valRec = Number(valorRecebido);
      if (valRec > 0) {
        amount = Math.min(valRec, remaining);
      }
    }

    if (amount <= 0) return;

    let label = FORMAS_PAGAMENTO.find((f: any) => f.id === selectedPayment)?.label || selectedPayment;
    if (selectedPayment === 'conta_casa') label = 'Prazo';
    setPaymentSplits(prev => [...prev, { methodId: selectedPayment, label, amount, received }]);
    setSelectedPayment('');
    setValorRecebido('');
  };

  const handleCheckout = () => {
    if (cart.length === 0) return;
    setSelectedPayment('');
    setValorRecebido('');
    setPaymentSplits([]);
    setIsSplitMode(false);
    setPaymentModalOpen(true);
  };

  const handleConfirmCheckout = async () => {
    if (isSplitMode && paymentSplits.length === 0 && !selectedPayment) return;
    if (!isSplitMode && !selectedPayment) return;
    if (!db || !user || cart.length === 0) return;
    
    if (!caixaAberto) {
      toast({ variant: 'destructive', title: 'Caixa Fechado', description: 'Você não pode finalizar vendas com o caixa fechado. Abra o caixa primeiro.' });
      return;
    }

    // A validação de estoque é feita de forma atômica em reconcileOrderStock,
    // dentro da transação que grava o pedido (ver lib/inventory.ts).

    setIsSubmitting(true);

    try {
      let paymentString = '';
      const splitsToProcess = isSplitMode ? [...paymentSplits] : [];

      if (!isSplitMode) {
        // Fluxo SIMPLES
        let received = undefined;
        let change = 0;
        if (selectedPayment === 'dinheiro' && valorRecebido) {
           const valRec = Number(valorRecebido);
           if (valRec > finalTotal) {
             change = valRec - finalTotal;
           }
        }
        let label = FORMAS_PAGAMENTO.find((f:any) => f.id === selectedPayment)?.label || selectedPayment;
        if (selectedPayment === 'conta_casa') label = 'Prazo';
        paymentString = selectedPayment === 'dinheiro' && change > 0 
           ? `${label} (Troco para R$ ${Number(valorRecebido).toFixed(2)})` 
           : label;
        splitsToProcess.push({ methodId: selectedPayment, label, amount: finalTotal });
      } else {
        // Fluxo SPLIT
        if (selectedPayment) {
          const remaining = Math.max(0, finalTotal - splitsToProcess.reduce((sum, s) => sum + s.amount, 0));
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
        if (totalReceived > finalTotal) {
           paymentString += ` (Troco para R$ ${totalReceived.toFixed(2)})`;
        }
      }

      const ownerId = storeProfile?.id || user?.uid || 'default';
      const hasContaCasa = splitsToProcess.some(s => s.methodId === 'conta_casa');
      let contaCasaCustomerId: string | null = null;
      if (hasContaCasa) {
        const phone = customerPhone || '';
        const fullDeliveryAddress = orderType === 'delivery' ? [addressObj.street, addressObj.number, addressObj.neighborhood, addressObj.city].filter(Boolean).join(', ') : '';
        const contaCasaAmount = splitsToProcess
          .filter(s => s.methodId === 'conta_casa')
          .reduce((sum, split) => sum + split.amount, 0);

        if (!phone || phone.replace(/\D/g, '').length < 10) {
          setIsSubmitting(false);
          setQuickRegisterModal({ isOpen: true, name: customerName || '', phone: '', address: fullDeliveryAddress });
          return;
        }

        // Pedidos a prazo em andamento também consomem o limite
        const pendingAmount = await sumPendingCreditOrdersForOwner(db, ownerId, phone);
        const creditCheck = await validateCustomerCredit(db, ownerId, phone, contaCasaAmount, { pendingAmount });
        if (!creditCheck.allowed) {
          if (creditCheck.reason === 'not_found') {
            setIsSubmitting(false);
            setQuickRegisterModal({ isOpen: true, name: customerName || '', phone, address: fullDeliveryAddress });
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

      const newOrderRef = doc(collection(db, 'orders'));
      const fullDeliveryAddress = orderType === 'delivery' ? [addressObj.street, addressObj.number, addressObj.neighborhood, addressObj.city].filter(Boolean).join(', ') : '';

      const orderData = {
        id: newOrderRef.id,
        ownerId: user?.uid || 'default',
        customerName: customerName || 'Cliente Balcão',
        customerPhone: customerPhone || '',
        deliveryAddress: fullDeliveryAddress || '',
        orderType: orderType,
        items: cart.map(i => ({
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
        })),
        status: orderType === 'delivery' ? 'received' : 'delivered',
        source: 'pdv', // origem: criado no PDV (Balcão/Retirada/Delivery interno)
        paymentRegistered: true, // Indica que o valor já foi lançado no caixa durante a criação no balcão
        subtotal: cartTotal || 0,
        deliveryFee,
        distanceKm: (distanceInfo && typeof distanceInfo.distanceKm === 'number') ? distanceInfo.distanceKm : null,
        totalAmount: finalTotal || 0,
        paymentMethod: paymentString || '',
        orderDateTime: new Date().toISOString(),
      };

      // Grava o pedido e abate o estoque de forma atômica (valida e lança
      // InsufficientStockError se faltar — tratado no catch abaixo).
      await reconcileOrderStock(db, {
        enableInventory: !!storeProfile?.general?.enableInventory,
        targetItems: cart,
        order: { ref: newOrderRef, mode: 'set', data: orderData },
      });

      // Sincroniza/contabiliza o cliente (balcão com cliente identificado).
      // Vendas anônimas ("Cliente Balcão" sem telefone) são ignoradas pela função.
      try {
        await syncCustomerFromOrder(db, { ...orderData }, { ownerId: user?.uid || 'default', countOrder: true });
      } catch (err) {
        console.error('Erro ao sincronizar cliente (balcão):', err);
      }

      // Registrar venda no caixa (1 ou mais partes) ou Conta da Casa
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
                 description: `PDV #${newOrderRef.id.substring(0,5)}`
              });
              await updateDoc(doc(db, 'clientes', cId), { creditBalance: increment(split.amount) });
              // Registra também no caixa (forma "Prazo") para aparecer na lista e
              // participar do fechamento/conferência. Não entra no dinheiro da gaveta.
              if (registrarLancamento && caixaAberto) {
                await registrarLancamento({
                  tipo: 'venda',
                  titulo: `PDV #${newOrderRef.id.substring(0, 5)} - Balcão (Prazo)`,
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
            titulo: `PDV #${newOrderRef.id.substring(0, 5)} - Balcão`,
            valor: split.amount,
            formaPagamento: split.methodId,
          });
        }
      }

      toast({ title: '✅ Pedido finalizado!', description: `Venda R$ ${finalTotal.toFixed(2)} registrada em ${splitsToProcess.length} parte(s).` });
      
      // Cupom como HTML nativo via QZ (mesmo caminho da sangria), com fallback
      // para impressão pelo navegador (iframe) quando o QZ não estiver presente.
      printOrderReceipt({ order: orderData, storeInfo: storeProfile });
      setTimeout(() => {
        setCart([]);
        setCustomerName('');
        setCustomerPhone('');
        setDeliveryFeeInput('');
        setAddressObj({ street: '', number: '', neighborhood: '', city: '' });
        setDynamicFee(null);
        setDistanceInfo(null);
        setPaymentModalOpen(false);
        try {
          localStorage.removeItem('balcao_draft_order');
        } catch (e) {
          console.error(e);
        }
      }, 500);

    } catch (e: any) {
      const isStock = e instanceof InsufficientStockError;
      toast({ variant: 'destructive', title: isStock ? 'Estoque insuficiente' : 'Erro', description: e.message });
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
            <p>O caixa precisa estar aberto para registrar vendas no balcão.</p>
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

  const suggestionsDropdown = customerMatches.length > 0 ? (
    <div className="absolute z-30 left-0 right-0 bottom-full mb-1 bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto custom-scrollbar">
      {customerMatches.map((c: any) => {
        const addr = getCustomerAddress(c);
        const addrLine = [addr.street, addr.neighborhood].filter(Boolean).join(', ');
        return (
          <button
            type="button"
            key={c.id}
            onMouseDown={(e) => { e.preventDefault(); applyCustomer(c); }}
            className="w-full text-left px-2 py-1.5 hover:bg-emerald-50 border-b last:border-b-0"
          >
            <div className="text-xs font-semibold text-slate-800">{getCustomerDisplayName(c) || 'Sem nome'}</div>
            <div className="text-[10px] text-slate-500">{c.celular || 'sem telefone'}{addrLine ? ` · ${addrLine}` : ''}</div>
          </button>
        );
      })}
    </div>
  ) : null;

  const renderItemCard = (item: any) => {
    const needsCust = itemNeedsCustomization(item);
    const qtyInCart = cart.filter(i => i.id === item.id).reduce((sum, i) => sum + i.quantity, 0);
    const simpleItemInCart = cart.find(i => i.id === item.id && (!i.addons || i.addons.length === 0));
    const simpleCartItemId = simpleItemInCart ? (simpleItemInCart.cartItemId || simpleItemInCart.id) : item.id;
    const outOfStock = !!storeProfile?.general?.enableInventory && typeof item.stockQuantity === 'number' && item.stockQuantity <= 0;

    return (
      <Card key={item.id} className={`overflow-hidden transition-all flex flex-col group border-slate-200 relative ${outOfStock ? 'opacity-50 grayscale cursor-not-allowed' : 'hover:shadow-md cursor-pointer'}`} onClick={outOfStock ? undefined : () => addToCart(item)}>
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

        <div className="flex gap-2 p-2">
          {item.imageUrl ? (
            <div className="relative w-20 h-20 rounded-lg overflow-hidden shrink-0">
              <Image src={item.imageUrl} alt={item.name} fill className="object-cover" sizes="80px" />
            </div>
          ) : (
            <div className="w-20 h-20 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
              <Tag className="h-6 w-6 text-slate-300" />
            </div>
          )}
          <div className="flex flex-col flex-1 py-1">
            <h3 className="font-bold text-sm leading-tight text-slate-800 line-clamp-2">{item.name}</h3>
            <div className="mt-auto pt-1">
               <Badge variant="destructive" className="text-[10px] bg-red-500 hover:bg-red-600">R$ {item.price.toFixed(2)}</Badge>
            </div>
          </div>
        </div>

        <div className="border-t p-2" onClick={(e) => e.stopPropagation()}>
          {outOfStock ? (
            <Button variant="ghost" size="sm" disabled className="w-full h-8 text-xs font-bold text-slate-400 cursor-not-allowed">
               Sem estoque
            </Button>
          ) : needsCust ? (
            <Button variant="ghost" size="sm" className="w-full h-8 text-xs font-bold text-slate-500 group-hover:bg-primary group-hover:text-white transition-colors" onClick={() => addToCart(item)}>
               <ShoppingCart className="h-3 w-3 mr-2" /> Adicionar
            </Button>
          ) : (
            qtyInCart > 0 ? (
              <div className="flex justify-between items-center px-4 h-8 bg-slate-50 rounded">
                 <Button variant="outline" size="icon" className="h-6 w-6 rounded-full" onClick={() => updateQuantity(simpleCartItemId, -1)}>
                   <Minus className="h-3 w-3" />
                 </Button>
                 <span className="font-bold text-sm">{qtyInCart}</span>
                 <Button variant="default" size="icon" className="h-6 w-6 rounded-full" onClick={() => updateQuantity(simpleCartItemId, 1)}>
                   <Plus className="h-3 w-3" />
                 </Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" className="w-full h-8 text-xs font-bold text-slate-500 group-hover:bg-primary group-hover:text-white transition-colors" onClick={() => addToCart(item)}>
                 <ShoppingCart className="h-3 w-3 mr-2" /> Adicionar
              </Button>
            )
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="flex flex-col md:flex-row gap-4 flex-1 w-full overflow-hidden">
      {/* Coluna Esquerda: Produtos e Filtros */}
      <div className="w-full md:w-2/3 flex flex-col h-full overflow-hidden bg-white rounded-xl shadow-sm border p-4">
        
        <div className="relative mb-3 shrink-0">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar"
            className="pl-9 h-10 bg-slate-50"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div ref={categoryBarRef} className="flex items-center gap-2 mb-4 overflow-x-auto custom-scrollbar pb-2 shrink-0">
          <Badge
            data-cat-tab="all"
            variant={activePill === 'all' ? 'default' : 'outline'}
            className="cursor-pointer h-8 px-4 flex-shrink-0"
            onClick={() => { setSearchTerm(''); setSelectedCat('all'); scrollToCategory('all'); }}
          >
            Todos
          </Badge>
          {groupedItems.map(group => (
            <Badge
              key={group.id}
              data-cat-tab={group.id}
              variant={activePill === group.id ? 'default' : 'outline'}
              className="cursor-pointer h-8 px-4 flex-shrink-0"
              onClick={() => { setSelectedCat(group.id); scrollToCategory(group.id); }}
            >
              {group.name}
            </Badge>
          ))}
        </div>

        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto custom-scrollbar">
          {visibleGroups.length === 0 ? (
            <div className="text-center text-sm text-slate-400 py-8">Nenhum produto encontrado.</div>
          ) : (
            visibleGroups.map(group => (
              <div key={group.id} ref={setSectionRef(group.id)} className="mb-4">
                <h2 className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm py-1.5 mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  {group.name}
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pr-2">
                  {group.items.map(renderItemCard)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Coluna Direita: Carrinho */}
      <div className="w-full md:w-1/3 bg-white rounded-xl shadow-sm border flex flex-col h-full">
        <div className="p-2 border-b bg-slate-50 flex justify-between items-center">
          <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-1.5">
            <ShoppingCart className="h-3.5 w-3.5 text-primary" />
            Pedido Atual
          </h2>
          <Badge variant="secondary" className="text-[10px] py-0">{cart.length} itens</Badge>
        </div>

        <div className="flex-1 overflow-y-auto p-2 custom-scrollbar space-y-2">
          
          {/* Dados do Cliente e Tipo de Pedido */}
          <div className={`space-y-2 p-2 rounded border shadow-sm transition-colors ${orderType === 'delivery' ? 'border-blue-300 bg-blue-50/50' : 'border-amber-200 bg-amber-50/40'}`}>
            <div className="flex bg-slate-100 p-0.5 rounded gap-0.5">
              <button
                onClick={() => {
                  setOrderType('pickup');
                  setDeliveryFeeInput('');
                  setDynamicFee(null);
                  setDistanceInfo(null);
                }}
                className={`flex-1 text-sm font-bold py-1.5 rounded transition-colors ${orderType === 'pickup' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                🏪 Balcão / Retirada
              </button>
              <button
                onClick={() => {
                  setOrderType('delivery');
                  if (addressObj.street) {
                    const addr = addressObj.number ? `${addressObj.street}, ${addressObj.number}` : addressObj.street;
                    calculateDeliveryFee(addr);
                  }
                }}
                className={`flex-1 text-sm font-bold py-1.5 rounded transition-colors ${orderType === 'delivery' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                🛵 Delivery
              </button>
            </div>

            {(customerName || customerPhone || addressObj.street || addressObj.number || addressObj.neighborhood || addressObj.city) && (
              <div className="flex justify-end -mb-0.5">
                <button
                  type="button"
                  onClick={clearCustomerFields}
                  className="flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-red-600 transition-colors"
                  title="Limpar dados do cliente e endereço"
                >
                  <X className="h-3 w-3" /> Limpar
                </button>
              </div>
            )}

            <div className="space-y-1.5">
              {(() => {
                const nameField = (
                  <div className="relative">
                    <Input autoComplete="new-password" placeholder="Nome do Cliente" value={customerName}
                      onChange={e => { setCustomerName(e.target.value); setSelectedCustomer(null); }}
                      onFocus={() => setActiveLookupField('name')}
                      onBlur={() => window.setTimeout(() => setActiveLookupField(f => (f === 'name' ? null : f)), 150)}
                      className="h-7 text-xs" />
                    {activeLookupField === 'name' && suggestionsDropdown}
                  </div>
                );
                const phoneField = (
                  <div className="relative">
                    <Input autoComplete="new-password" inputMode="tel" placeholder="Telefone / WhatsApp" value={customerPhone}
                      onChange={e => { setCustomerPhone(e.target.value); setSelectedCustomer(null); }}
                      onFocus={() => setActiveLookupField('phone')}
                      onBlur={() => window.setTimeout(() => setActiveLookupField(f => (f === 'phone' ? null : f)), 150)}
                      className={`h-7 text-xs ${orderType === 'delivery' ? 'border-blue-300 focus-visible:ring-blue-400 font-semibold' : ''}`} />
                    {activeLookupField === 'phone' && suggestionsDropdown}
                  </div>
                );
                return orderType === 'delivery'
                  ? (<>{phoneField}{nameField}</>)
                  : (<>{nameField}{phoneField}</>);
              })()}
              {selectedCustomer && isCreditEnabled(selectedCustomer) && (() => {
                const limit = Number(selectedCustomer.creditLimit) || 0;
                const balance = Number(selectedCustomer.creditBalance) || 0;
                return (
                  <div className="flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-1">
                    <span>📝 Prazo ativo</span>
                    {limit > 0 && (
                      <span className="font-semibold text-amber-600">· disponível R$ {(limit - balance).toFixed(2)} de R$ {limit.toFixed(2)}</span>
                    )}
                  </div>
                );
              })()}
              {orderType === 'delivery' && customerLookupStatus !== 'idle' && (
                <p
                  aria-live="polite"
                  className={`text-[10px] font-bold ${
                    customerLookupStatus === 'not_found' || customerLookupStatus === 'error'
                      ? 'text-red-600'
                      : customerLookupStatus === 'found'
                        ? 'text-emerald-600'
                        : 'text-slate-500'
                  }`}
                >
                  {customerLookupStatus === 'searching' && 'Buscando cadastro...'}
                  {customerLookupStatus === 'found' && `Cadastro encontrado${matchedCustomerName ? `: ${matchedCustomerName}` : ''}.`}
                  {customerLookupStatus === 'not_found' && 'Sem cadastro para este telefone.'}
                  {customerLookupStatus === 'error' && 'Nao foi possivel consultar cadastro.'}
                </p>
              )}
              
              {orderType === 'delivery' && (
                <div className="pt-1.5 border-t space-y-1.5 mt-1.5">
                  <AddressAutocomplete
                    id="np_street"
                    value={addressObj.street}
                    onChange={(val) => {
                      setAddressObj(prev => ({...prev, street: val}));
                      if (dynamicFee !== null) {
                        setDynamicFee(null);
                        setDistanceInfo(null);
                      }
                    }}
                    onSelect={handleAddressSelected}
                    onBlur={() => {
                      if (addressObj.street && addressObj.street.length > 5 && dynamicFee === null && !calculatingFee && !distanceInfo) {
                        const fullAddr = [addressObj.street, addressObj.number, addressObj.neighborhood, addressObj.city].filter(Boolean).join(', ');
                        handleAddressSelected(fullAddr);
                      }
                    }}
                    forceClose={distanceInfo !== null || deliveryBlocked}
                    disableSearch={!!addressObj.city && !!addressObj.neighborhood}
                    locationContext={(addressObj.city?.trim() || deliveryCities.join(', ')) || undefined}
                    placeholder="Buscar endereço no Maps..."
                  />
                  <input type="hidden" autoComplete="street-address" value={addressObj.street} onChange={() => {}} />
                  <div className="flex gap-1.5">
                    <Input autoComplete="address-line2" placeholder="Número" value={addressObj.number} onChange={e => {
                      setAddressObj(prev => ({...prev, number: e.target.value}));
                    }} onBlur={() => {
                      if (addressObj.street) calculateDeliveryFee(`${addressObj.street}, ${addressObj.number}`);
                    }} className="h-7 text-xs w-1/3" />
                    <Input autoComplete="address-level3" placeholder="Bairro" value={addressObj.neighborhood} onChange={e => setAddressObj(prev => ({...prev, neighborhood: e.target.value}))} className="h-7 text-xs flex-1" />
                    <Input autoComplete="address-level2" placeholder="Cidade" value={addressObj.city} onChange={e => setAddressObj(prev => ({...prev, city: e.target.value}))} className="h-7 text-xs flex-1" />
                  </div>
                  {distanceInfo && (
                    <div className="text-[10px] text-teal-600 font-bold bg-teal-50 p-1.5 rounded text-center border border-teal-100">
                      Distância: {distanceInfo.distanceKm} km ({distanceInfo.distanceText})
                    </div>
                  )}
                  {deliveryBlocked && (
                    <div className="text-[10px] text-red-600 font-bold bg-red-50 p-1.5 rounded text-center border border-red-100">
                      ⚠️ Fora da área de entrega permitida ({maxDeliveryRadius}km)
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Produtos do Carrinho */}
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-slate-300 py-6">
              <ShoppingCart className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-xs font-medium">Adicione produtos</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cart.map((item) => (
                <div key={item.cartItemId || item.id} className="flex justify-between items-start border-b pb-2">
                  <div className="flex-1">
                    <h4 className="font-semibold text-xs text-slate-800">{item.name}</h4>
                    <p className="text-[10px] text-muted-foreground">R$ {(item.unitPrice || item.price).toFixed(2)}</p>
                    {item.addons && item.addons.length > 0 && (
                      <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                        {item.addons.map((a: any) => a.name).join(', ')}
                      </div>
                    )}
                    {item.notes && <div className="text-[10px] text-orange-500 mt-0.5">Obs: {item.notes}</div>}
                    <div className="flex items-center gap-1 mt-1">
                      <Button variant="outline" size="icon" className="h-4 w-4 rounded-full" onClick={() => updateQuantity(item.cartItemId || item.id, -1)}>
                        <Minus className="h-2 w-2" />
                      </Button>
                      <span className="text-[10px] font-bold w-3 text-center">{item.quantity}</span>
                      <Button variant="outline" size="icon" className="h-4 w-4 rounded-full" onClick={() => updateQuantity(item.cartItemId || item.id, 1)}>
                        <Plus className="h-2 w-2" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                     <span className="font-semibold text-xs">R$ {((item.unitPrice || item.price) * item.quantity).toFixed(2)}</span>
                     <Button variant="ghost" size="icon" className="h-5 w-5 text-red-400 hover:text-red-500" onClick={() => removeFromCart(item.cartItemId || item.id)}>
                        <X className="h-3 w-3" />
                     </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {cart.length > 0 && (
          <div className="p-2 bg-slate-50 border-t space-y-2">
            <div className="space-y-1 pb-2 border-b">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500">Subtotal</span>
                <span className="font-semibold text-slate-700">R$ {cartTotal.toFixed(2)}</span>
              </div>
              {orderType === 'delivery' && (
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 flex items-center gap-1">
                    Taxa Entrega {calculatingFee && <span className="text-[9px] text-teal-600">(Calculando...)</span>}
                  </span>
                  <div className="flex items-center gap-1 w-20">
                    <span className="text-slate-400 text-[10px]">R$</span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={deliveryFeeInput}
                      onChange={(e) => {
                        let val = e.target.value.replace(/[^0-9.]/g, '');
                        setDeliveryFeeInput(val);
                        setDynamicFee(null); // O usuário sobrescreveu manualmente
                      }}
                      className={`h-6 text-xs text-right px-1 font-semibold ${dynamicFee !== null ? 'text-teal-600 bg-teal-50 border-teal-200' : 'text-slate-700'}`}
                    />
                  </div>
                </div>
              )}
            </div>
            
            <div className="flex justify-between items-center text-sm">
              <span className="font-semibold text-slate-600">Total</span>
              <span className="font-black text-red-500">R$ {finalTotal.toFixed(2)}</span>
            </div>
            <Button className="w-full h-8 bg-green-500 hover:bg-green-600 text-sm font-bold" onClick={handleCheckout}>
              Finalizar
            </Button>
            {!caixaAberto && <p className="text-[10px] text-red-400 text-center mt-1">⚠️ Abra o caixa para vender</p>}
          </div>
        )}
      </div>

      {/* Modal Forma de Pagamento */}
      <Dialog open={paymentModalOpen} onOpenChange={setPaymentModalOpen}>
        <DialogContent className="sm:max-w-[380px] p-4">
          {(() => {
            const totalPaid = paymentSplits.reduce((sum, s) => sum + s.amount, 0);
            const remaining = Math.max(0, finalTotal - totalPaid);
            const isFullyPaid = remaining <= 0;

            return (
              <>
                <DialogHeader className="pb-1 border-b">
                  <DialogTitle className="text-sm flex items-center justify-between pr-6">
                    <span>💰 Pagamento Balcão</span>
                    <div className="flex flex-col items-end">
                      <span className="text-xs text-muted-foreground font-normal">Total: R$ {finalTotal.toFixed(2)}</span>
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
                        <div className={`text-center p-1.5 rounded font-bold text-sm ${Number(valorRecebido) >= finalTotal ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                          {Number(valorRecebido) >= finalTotal 
                            ? `Troco: R$ ${(Number(valorRecebido) - finalTotal).toFixed(2)}`
                            : `Falta: R$ ${(finalTotal - Number(valorRecebido)).toFixed(2)}`
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
                      {isSubmitting ? '...' : '✅ Confirmar Pedido'}
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
                      {isSubmitting ? '...' : '✅ Confirmar Pedido'}
                    </Button>
                  </DialogFooter>
                </>
              )}
            </>
          );
        })()}
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
        enableInventory={storeProfile?.general?.enableInventory || false}
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
          ownerId={storeProfile?.id || user?.uid || 'default'}
          initialName={quickRegisterModal.name}
          initialPhone={quickRegisterModal.phone}
          initialAddress={quickRegisterModal.address}
        />
      )}
    </div>
  );
}
