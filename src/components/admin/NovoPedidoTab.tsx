'use client';

import React, { useState } from 'react';
import type { RegistrarLancamento } from '@/hooks/useCaixa';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import CaixaFechadoCard from '@/components/shared/CaixaFechadoCard';
import { ShoppingCart, Plus, Minus, Search, Tag, X, CreditCard, Banknote, QrCode, Wallet, Flame } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import { collection, doc, serverTimestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { printOrderReceipt } from '@/lib/order-receipt-html';
import { QuickRegisterClientModal } from './QuickRegisterClientModal';
import { AddressAutocomplete } from '@/components/ui/address-autocomplete';
import { useCallback, useMemo } from 'react';
import { MenuItemDialog } from '@/components/menu/MenuItemDialog';
import { findCreditCustomers, isCreditEnabled, isValidCreditPhone, maskCreditPhoneInput, normalizeCreditPhone } from '@/lib/customer-credit';
import { resolveContaCasa, registrarPagamentoSplits } from '@/lib/payments';
import { fetchDeliveryFee } from '@/lib/delivery-fee';
import { usePromotions } from '@/hooks/usePromotions';
import { buildAdminMenuGroups } from '@/lib/menu-groups';
import { useCustomerLookup } from '@/hooks/useCustomerLookup';
import { CustomerSuggestions } from '@/components/admin/CustomerSuggestions';
import { itemNeedsCustomization, applyPromoPrice, addSimpleItemToCart, buildCustomizedCartItem, isWeightItem, makeWeightCartLine, setCartLineWeight, findUnweighedItem } from '@/lib/cart';
import { WeightInput } from '@/components/admin/WeightInput';
import { useCategoryScrollSpy } from '@/hooks/useCategoryScrollSpy';
import { brl, neighborhoodMatchesQuery } from '@/lib/utils';
import { reconcileOrderStock, InsufficientStockError, isOutOfStock } from '@/lib/inventory';
import { proposedCustomerId, syncCustomerFromOrder } from '@/lib/customers/customer-sync';
import { resolveFormasPagamento } from './fechamento/payment-methods';
import { resolverIdentidadeDaVenda } from '@/lib/vendas/identidade-cliente';
import { useFechamento } from './fechamento/useFechamento';
import { FechamentoModal } from './fechamento/FechamentoModal';
import { can, type PdvPermissions } from '@/lib/pdv-permissions';
import { usePdvAccess } from '@/contexts/PdvAccessContext';
import { generateOrderCode, getOrderCodePrefix } from '@/lib/order-code';

interface NovoPedidoTabProps {
  categories: any[];
  items: any[];
  db: any;
  user: any;
  registrarLancamento?: RegistrarLancamento;
  caixaAberto?: boolean;
  storeProfile?: any;
  onOpenCaixa?: () => void;
  addons?: any[];
  addonCategories?: any[];
  permissions: PdvPermissions;
}

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
  addonCategories = [],
  permissions,
}: NovoPedidoTabProps) {
  const { ownerId, role } = usePdvAccess();
  const FORMAS_PAGAMENTO = resolveFormasPagamento(storeProfile);
  const { toast } = useToast();
  const canFinalizarVenda = can(permissions, 'actions.novo_pedido.finalizarVenda');
  const notifyPermissionRemoved = () => toast({
    variant: 'destructive',
    title: 'Permissão removida pelo administrador',
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItemForDialog, setSelectedItemForDialog] = useState<any | null>(null);
  const [quickRegisterModal, setQuickRegisterModal] = useState<{isOpen: boolean, name: string, phone: string, address: string} | null>(null);
  
  // Carrinho
  const [cart, setCart] = useState<any[]>([]);

  const addToCart = (item: any) => {
    const effectiveItem = applyPromoPrice(item, promoItemsMap);
    if (isWeightItem(effectiveItem)) {
      // Item por peso: cada clique abre uma nova linha para digitar o peso.
      setCart(prev => [...prev, makeWeightCartLine(effectiveItem)]);
    } else if (itemNeedsCustomization(effectiveItem)) {
      setSelectedItemForDialog(effectiveItem);
    } else {
      setCart(prev => addSimpleItemToCart(prev, effectiveItem));
    }
  };

  const updateWeight = (cartItemId: string, grams: number) => {
    setCart(prev => setCartLineWeight(prev, cartItemId, grams));
  };

  const handleDialogAddToCart = (item: any, quantity: number, options: any) => {
    const effectiveItem = applyPromoPrice(item, promoItemsMap);
    setCart(prev => [...prev, buildCustomizedCartItem(effectiveItem, quantity, options)]);
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
  const totalItens = cart.reduce((a: number, i: any) => a + (Number(i.quantity) || 0), 0);

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [deliveryFeeInput, setDeliveryFeeInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Estados para entrega
  const [orderType, setOrderType] = useState<'pickup' | 'delivery'>('pickup');

  // Fechamento centralizado (desconto/acréscimo, split, troco) — mesmo
  // estado/cálculo/modal em Balcão, Mesas e Delivery (components/admin/fechamento).
  const deliveryFee = orderType === 'delivery' ? (Number(deliveryFeeInput) || 0) : 0;
  const fechamento = useFechamento({
    subtotal: cartTotal,
    deliveryFee,
    formasPagamento: FORMAS_PAGAMENTO,
    allowAdjustments: can(permissions, 'actions.novo_pedido.descontoAcrescimo'),
    allowPrazo: can(permissions, 'actions.novo_pedido.vendaPrazo'),
  });
  const finalTotal = fechamento.finalTotal;
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerLookupStatus, setCustomerLookupStatus] = useState<CustomerLookupStatus>('idle');
  const [matchedCustomerName, setMatchedCustomerName] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const { promoItemsMap, promoOnlyIds, hasActivePromos } = usePromotions(db, ownerId);

  const groupedItems = useMemo(
    () => buildAdminMenuGroups(items, categories, orderType, searchTerm, { promoItemsMap, promoOnlyIds, hasActivePromos }),
    [items, categories, orderType, searchTerm, promoItemsMap, promoOnlyIds, hasActivePromos]
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
  
  // Endereço e cálculo de frete
  const storeAddress = storeProfile?.general?.address || '';
  const deliveryFeeRules = storeProfile?.feeRules || storeProfile?.fees?.feeRules || [];
  // Regras de taxa por bairro (têm prioridade sobre KM). Sem isso o PDV cobrava SEMPRE por KM.
  const customAddressRules = storeProfile?.customAddressRules || storeProfile?.fees?.customAddressRules || [];
  const maxDeliveryRadius = storeProfile?.fees?.maxDeliveryRadius || 0;
  const deliveryCities: string[] = storeProfile?.general?.deliveryCities || storeProfile?.fees?.deliveryCities || [];

  const [addressObj, setAddressObj] = useState<{street: string, number: string, neighborhood: string, city: string}>({ street: '', number: '', neighborhood: '', city: '' });
  const [calculatingFee, setCalculatingFee] = useState(false);
  const [deliveryBlocked, setDeliveryBlocked] = useState(false);
  const [distanceInfo, setDistanceInfo] = useState<{distanceKm: number, distanceText: string} | null>(null);
  const [dynamicFee, setDynamicFee] = useState<number | null>(null);
  const [showNeighborhoodSuggestions, setShowNeighborhoodSuggestions] = useState(false);

  // Calcula a taxa chamando a API
  const calculateDeliveryFee = useCallback(async (fullAddr: string, neighborhoodHint?: string) => {
    const hasRules = (deliveryFeeRules && deliveryFeeRules.length > 0) || (customAddressRules && customAddressRules.length > 0);
    if (!storeAddress || !hasRules) return;
    if (!fullAddr || fullAddr.length < 5) return;

    setCalculatingFee(true);
    try {
      const { ok, data } = await fetchDeliveryFee({
        storeAddress,
        customerAddress: fullAddr,
        feeRules: deliveryFeeRules,
        customAddressRules,
        neighborhoodHint: neighborhoodHint ?? addressObj.neighborhood,
      });
      if (ok) {
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
  }, [storeAddress, deliveryFeeRules, customAddressRules, maxDeliveryRadius, addressObj.neighborhood, toast]);

  React.useEffect(() => {
    const normalizedPhone = normalizeCreditPhone(customerPhone);
    if (role !== 'owner' || orderType !== 'delivery' || !db || !ownerId || normalizedPhone.length < 10) {
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

        const customerData = { id: customers[0].id, ...(customers[0].data || {}) };
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

        setSelectedCustomer(customerData);
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
  }, [calculateDeliveryFee, customerPhone, db, orderType, ownerId, role]);

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
        if (parsed.customerPhone) setCustomerPhone(maskCreditPhoneInput(parsed.customerPhone));
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

  // Autocomplete de cliente (carga da lista + matches) centralizado no hook.
  const { allCustomers, activeField: activeLookupField, setActiveField: setActiveLookupField, matches: customerMatches } =
    useCustomerLookup(db, role === 'owner' ? ownerId : undefined, customerName, customerPhone);

  // Quem é o cliente desta venda — e, por consequência, se o Prazo existe.
  // Ver lib/vendas/identidade-cliente e docs/PLANO_CLIENTE_NA_VENDA.md.
  const identidade = useMemo(
    () => resolverIdentidadeDaVenda({
      nome: customerName,
      telefone: customerPhone,
      clientes: allCustomers,
      clienteSelecionado: selectedCustomer,
    }),
    [customerName, customerPhone, allCustomers, selectedCustomer],
  );

  const applyCustomer = (c: any) => {
    setSelectedCustomer(c);
    const name = getCustomerDisplayName(c);
    const phone = String(c.celular || '');
    if (name) setCustomerName(name);
    if (phone) setCustomerPhone(maskCreditPhoneInput(phone));
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

  const handleCheckout = () => {
    if (!can(permissions, 'actions.novo_pedido.finalizarVenda')) {
      notifyPermissionRemoved();
      return;
    }
    if (cart.length === 0) return;
    const unweighed = findUnweighedItem(cart);
    if (unweighed) {
      toast({ variant: 'destructive', title: 'Peso não informado', description: `Digite o peso de "${unweighed.name}" antes de finalizar.` });
      return;
    }
    fechamento.reset();
    setPaymentModalOpen(true);
  };

  const handleConfirmCheckout = async () => {
    if (!can(permissions, 'actions.novo_pedido.finalizarVenda')) {
      notifyPermissionRemoved();
      return;
    }
    if (fechamento.isSplitMode && fechamento.paymentSplits.length === 0 && !fechamento.selectedPayment) return;
    if (!fechamento.isSplitMode && !fechamento.selectedPayment) return;
    if (!db || !user || cart.length === 0) return;

    if (customerPhone.trim() && !isValidCreditPhone(customerPhone)) {
      toast({
        variant: 'destructive',
        title: 'Telefone inválido',
        description: 'Informe DDD + telefone (10 ou 11 dígitos), ou deixe o campo vazio para venda sem cliente.',
      });
      return;
    }

    if (!caixaAberto) {
      toast({ variant: 'destructive', title: 'Caixa Fechado', description: 'Você não pode finalizar vendas com o caixa fechado. Abra o caixa primeiro.' });
      return;
    }

    // A validação de estoque é feita de forma atômica em reconcileOrderStock,
    // dentro da transação que grava o pedido (ver lib/inventory.ts).

    setIsSubmitting(true);

    try {
      // Splits + paymentString + desconto/acréscimo vêm do fechamento
      // centralizado (components/admin/fechamento) — igual em todos os canais.
      const { splitsToProcess, paymentString, payments, discount, surcharge, finalTotal: totalCobrado } = fechamento.buildCheckout();

      const fullDeliveryAddress = orderType === 'delivery' ? [addressObj.street, addressObj.number, addressObj.neighborhood, addressObj.city].filter(Boolean).join(', ') : '';

      const contaCasa = await resolveContaCasa(db, { splits: splitsToProcess, ownerId, phone: customerPhone || '' });
      if (contaCasa.kind === 'register') {
        setIsSubmitting(false);
        setQuickRegisterModal({ isOpen: true, name: customerName || '', phone: contaCasa.phone, address: fullDeliveryAddress });
        return;
      }
      if (contaCasa.kind === 'blocked') {
        toast({ variant: 'destructive', title: 'Prazo bloqueado', description: contaCasa.message });
        return;
      }
      const contaCasaCustomerId = contaCasa.kind === 'ok' ? contaCasa.customerId : null;

      const newOrderRef = doc(collection(db, 'orders'));
      const orderCode = generateOrderCode();

      const selectedClienteId = contaCasaCustomerId || selectedCustomer?.id || null;
      let clienteId = selectedClienteId || (role === 'owner' ? proposedCustomerId(ownerId, {
        id: newOrderRef.id,
        customerName: customerName || 'Cliente Balcão',
        customerPhone,
      }) : null);
      const hasCustomerIdentity = identidade.estado !== 'anonimo' && identidade.estado !== 'incompleto';
      if (role === 'owner' && hasCustomerIdentity) {
        // A IDENTIDADE DO CLIENTE NUNCA DERRUBA A VENDA. Em 01/08/2026 esta
        // chamada estava sem proteção: ao ler o id determinístico de um cliente
        // NOVO (documento que ainda não existe), as regras respondiam
        // permission-denied e o operador não conseguia vender. O vínculo é
        // desejável; o dinheiro entrar é obrigatório. Sem identidade a venda
        // segue pelo caminho antigo (nome + telefone no pedido).
        try {
          const identity = await syncCustomerFromOrder(db, {
            id: newOrderRef.id,
            ...(selectedClienteId ? { clienteId: selectedClienteId } : {}),
            customerName: customerName || 'Cliente Balcão',
            customerPhone,
            street: addressObj.street,
            number: addressObj.number,
            neighborhood: addressObj.neighborhood,
            city: addressObj.city,
          }, {
            ownerId,
            countOrder: false,
            writeCustomer: false,
            linkCollection: null,
            allowArchivedCustomer: false,
          });
          clienteId = identity.customerId;
          if (identity.ambiguous) {
            toast({
              variant: 'destructive',
              title: 'Cliente em conflito',
              description: 'A venda será salva sem vínculo: há mais de um cadastro para este telefone. Resolva na aba Clientes.',
            });
          }
        } catch (err) {
          console.error('[balcão] identidade do cliente falhou; venda segue sem vínculo:', err);
        }
      }

      const orderData = {
        id: newOrderRef.id,
        orderCode,
        ownerId,
        customerName: customerName || 'Cliente Balcão',
        // Só dígitos, como o cardápio público já grava. O campo é livre e o que
        // for digitado aqui vira a chave que liga o pedido ao cliente: com
        // "(16)992156780" a busca por telefone não achava o pedido, e a compra
        // ficava sem itens no extrato do Prazo.
        customerPhone: normalizeCreditPhone(customerPhone),
        ...(clienteId ? { clienteId } : {}),
        ...(hasCustomerIdentity ? { customerIdentityPending: true } : {}),
        deliveryAddress: fullDeliveryAddress || '',
        orderType: orderType,
        items: cart.map(i => ({
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
        })),
        status: orderType === 'delivery' ? 'received' : 'delivered',
        source: 'pdv', // origem: criado no PDV (Balcão/Retirada/Delivery interno)
        paymentRegistered: true, // Indica que o valor já foi lançado no caixa durante a criação no balcão
        subtotal: cartTotal || 0,
        deliveryFee,
        discount: discount || 0,
        surcharge: surcharge || 0,
        distanceKm: (distanceInfo && typeof distanceInfo.distanceKm === 'number') ? distanceInfo.distanceKm : null,
        totalAmount: totalCobrado || 0,
        paymentMethod: paymentString || '',
        // Pagamento em dado (uma linha por forma, com o valor), ao lado da
        // frase que o cupom imprime. Relatório soma, não interpreta texto.
        payments,
        orderDateTime: new Date().toISOString(),
        // Marca do servidor: é por ela que relatórios e filtros por data acham o
        // pedido. Sem isso as vendas do PDV sumiam de qualquer consulta por período.
        createdAt: serverTimestamp(),
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
        if (role === 'owner') {
          await syncCustomerFromOrder(db, { ...orderData }, {
            ownerId,
            countOrder: orderData.status === 'delivered',
          });
        }
      } catch (err) {
        console.error('Erro ao sincronizar cliente (balcão):', err);
      }

      // Registrar venda no caixa (1 ou mais partes) ou Conta da Casa
      const shortId = getOrderCodePrefix(orderData);
      await registrarPagamentoSplits(db, {
        splits: splitsToProcess,
        contaCasaCustomerId,
        registrarLancamento,
        caixaAberto,
        tituloVenda: `PDV #${shortId} - Balcão`,
        tituloPrazo: `PDV #${shortId} - Balcão (Prazo)`,
        creditDescription: `PDV #${shortId}`,
        orderId: newOrderRef.id,
        channel: 'balcao',
        onContaCasaSemCliente: () => toast({ variant: 'destructive', title: 'Aviso', description: 'Conta da Casa: cliente não encontrado para lançar dívida.' }),
      });

      toast({ title: '✅ Pedido finalizado!', description: `Venda ${brl(totalCobrado)} registrada em ${splitsToProcess.length} parte(s).` });
      
      // Cupom como HTML nativo via QZ (mesmo caminho da sangria), com fallback
      // para impressão pelo navegador (iframe) quando o QZ não estiver presente.
      printOrderReceipt({ order: orderData, storeInfo: storeProfile });
      setTimeout(() => {
        setCart([]);
        fechamento.reset();
        setCustomerName('');
        setCustomerPhone('');
        setSelectedCustomer(null);
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

  const suggestionsDropdown = (
    <CustomerSuggestions
      matches={customerMatches}
      onSelect={applyCustomer}
      getAddressLine={(c) => {
        const addr = getCustomerAddress(c);
        return [addr.street, addr.neighborhood].filter(Boolean).join(', ');
      }}
    />
  );

  const renderItemCard = (item: any) => {
    const needsCust = itemNeedsCustomization(item);
    const qtyInCart = cart.filter(i => i.id === item.id).reduce((sum, i) => sum + i.quantity, 0);
    const simpleItemInCart = cart.find(i => i.id === item.id && (!i.addons || i.addons.length === 0));
    const simpleCartItemId = simpleItemInCart ? (simpleItemInCart.cartItemId || simpleItemInCart.id) : item.id;
    const outOfStock = isOutOfStock(item, { enableInventory: !!storeProfile?.general?.enableInventory, allItems: items || [] });

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
            <div className="mt-auto pt-1 flex items-center gap-1.5 flex-wrap">
               {promoItemsMap[item.id] ? (
                 <>
                   <span className="text-[10px] text-muted-foreground line-through">{brl(item.price)}</span>
                   <Badge variant="destructive" className="text-[10px] bg-red-500 hover:bg-red-600 font-bold">{brl(promoItemsMap[item.id].promoPrice)}{isWeightItem(item) ? '/kg' : ''}</Badge>
                 </>
               ) : (
                 <Badge variant="destructive" className="text-[10px] bg-red-500 hover:bg-red-600 font-bold">{brl(item.price)}{isWeightItem(item) ? '/kg' : ''}</Badge>
               )}
            </div>
          </div>
        </div>

        <div className="border-t p-2" onClick={(e) => e.stopPropagation()}>
          {outOfStock ? (
            <Button variant="ghost" size="sm" disabled className="w-full h-8 text-xs font-bold text-slate-400 cursor-not-allowed">
               Sem estoque
            </Button>
          ) : (needsCust || isWeightItem(item)) ? (
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
              {group.id === '__promo__' ? (
                <span className="flex items-center gap-1"><Flame className="h-3.5 w-3.5 text-orange-500 fill-orange-500 animate-pulse" /> {group.name}</span>
              ) : group.name}
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
                      onChange={e => { setCustomerPhone(maskCreditPhoneInput(e.target.value)); setSelectedCustomer(null); }}
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
              {/* O estado da identificação fala por si: não digitar nada JÁ é a
                  venda anônima, então não existe botão para declarar isso. Falta
                  cadastro? O caminho aparece aqui, antes do fechamento — e não
                  como surpresa no confirmar. */}
              {identidade.estado === 'nao_encontrado' && (
                <div className="flex items-center justify-between gap-2 rounded border border-blue-200 bg-blue-50 px-2 py-1.5">
                  <span className="text-[10px] font-semibold text-blue-800">Sem cadastro com esses dados</span>
                  <button
                    type="button"
                    onClick={() => setQuickRegisterModal({
                      isOpen: true,
                      name: customerName || '',
                      phone: normalizeCreditPhone(customerPhone),
                      address: [addressObj.street, addressObj.number, addressObj.neighborhood, addressObj.city].filter(Boolean).join(', '),
                    })}
                    className="rounded border border-blue-500 bg-blue-600 px-2 py-1 text-[10px] font-bold text-white transition-colors hover:bg-blue-700"
                  >
                    Cadastrar cliente
                  </button>
                </div>
              )}
              {identidade.estado === 'conflito' && (
                <p className="rounded border border-rose-200 bg-rose-50 px-1.5 py-1 text-[10px] font-bold text-rose-700">
                  Há mais de um cadastro com este telefone. Resolva na aba Clientes para poder vender a prazo.
                </p>
              )}
              {identidade.estado === 'vinculado' && identidade.prazoVisivel && (
                <div className={`flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] font-bold ${
                  identidade.prazoBloqueado
                    ? 'border-slate-200 bg-slate-50 text-slate-500'
                    : 'border-amber-200 bg-amber-50 text-amber-700'
                }`}>
                  {identidade.prazoBloqueado ? (
                    <span>📝 {identidade.motivoPrazo}</span>
                  ) : (
                    <>
                      <span>📝 Prazo ativo</span>
                      {identidade.disponivel !== null && (
                        <span className="font-semibold text-amber-600">· disponível {brl(identidade.disponivel)}</span>
                      )}
                    </>
                  )}
                </div>
              )}
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
                    <div className="relative flex-1">
                      <Input
                        autoComplete="off"
                        placeholder="Bairro"
                        value={addressObj.neighborhood}
                        onChange={e => { setAddressObj(prev => ({...prev, neighborhood: e.target.value})); setShowNeighborhoodSuggestions(true); }}
                        onFocus={() => setShowNeighborhoodSuggestions(true)}
                        onBlur={() => {
                          window.setTimeout(() => setShowNeighborhoodSuggestions(false), 200);
                          if (addressObj.street && addressObj.neighborhood) {
                            const fullAddr = [addressObj.street, addressObj.number, addressObj.neighborhood, addressObj.city].filter(Boolean).join(', ');
                            calculateDeliveryFee(fullAddr);
                          }
                        }}
                        className="h-7 text-xs w-full"
                      />
                      {showNeighborhoodSuggestions && (() => {
                        const nbRules = (customAddressRules || []).filter((r: any) => (r?.type === 'neighborhood' || !r?.type) && r?.keyword);
                        const typed = addressObj.neighborhood.trim();
                        const filtered = typed.length > 0
                          ? nbRules.filter((r: any) => neighborhoodMatchesQuery(r.keyword, typed))
                          : nbRules;
                        if (filtered.length === 0) return null;
                        return (
                          <div className="absolute z-50 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg max-h-44 overflow-y-auto">
                            {filtered.map((rule: any, idx: number) => (
                              <button
                                key={rule.keyword + idx}
                                type="button"
                                className="w-full text-left px-2 py-1 text-[11px] hover:bg-blue-50 flex items-center justify-between gap-2 border-b last:border-0 transition-colors"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setAddressObj(prev => ({...prev, neighborhood: rule.keyword}));
                                  setShowNeighborhoodSuggestions(false);
                                  const fullAddr = [addressObj.street, addressObj.number, rule.keyword, addressObj.city].filter(Boolean).join(', ');
                                  calculateDeliveryFee(fullAddr, rule.keyword);
                                }}
                              >
                                <span className="font-medium text-slate-700 truncate">{rule.keyword}</span>
                                <span className="text-[10px] text-blue-600 font-bold shrink-0">{brl(Number(rule.fee))}</span>
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
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
                    {isWeightItem(item) ? (
                      <div className="mt-1">
                        <WeightInput
                          grams={Number(item.weightGrams) || 0}
                          pricePerKg={Number(item.pricePerKg ?? item.price) || 0}
                          onChange={(g) => updateWeight(item.cartItemId || item.id, g)}
                          size="sm"
                          autoFocus
                        />
                      </div>
                    ) : (
                      <>
                        <p className="text-[10px] text-muted-foreground">{brl((item.unitPrice || item.price))}</p>
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
                      </>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                     <span className="font-semibold text-xs">{brl(((item.unitPrice || item.price) * item.quantity))}</span>
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
                <span className="font-semibold text-slate-700">{brl(cartTotal)}</span>
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
              <span className="font-black text-red-500">{brl(finalTotal)}</span>
            </div>
            {canFinalizarVenda && (
              <Button className="w-full h-8 bg-green-500 hover:bg-green-600 text-sm font-bold" onClick={handleCheckout}>
                Finalizar
              </Button>
            )}
            {!caixaAberto && <p className="text-[10px] text-red-400 text-center mt-1">⚠️ Abra o caixa para vender</p>}
          </div>
        )}
      </div>

      {/* Modal Forma de Pagamento — fechamento centralizado (desconto/acréscimo, split, troco) */}
      <FechamentoModal
        open={paymentModalOpen}
        // Limpa ao fechar, como Delivery e Encomendas já fazem: sem isso o
        // desconto de um modal cancelado continuava descontando o Total do
        // carrinho, mas sumia quando o modal era reaberto (ele reseta na
        // abertura). O operador lia um valor e cobrava outro.
        onOpenChange={(open) => { setPaymentModalOpen(open); if (!open) fechamento.reset(); }}
        fechamento={fechamento}
        title="Pagamento"
        subtitle={`Balcão · ${totalItens} ${totalItens === 1 ? 'item' : 'itens'}`}
        items={cart}
        caixaAberto={caixaAberto}
        prazoCustomer={{
          name: identidade.cliente?.nome || customerName,
          phone: customerPhone,
          matched: identidade.estado === 'vinculado',
          available: identidade.disponivel,
        }}
        identidade={identidade}
        isSubmitting={isSubmitting}
        onConfirm={handleConfirmCheckout}
      />

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
          canSubmit={() => can(permissions, 'actions.novo_pedido.finalizarVenda')
            && can(permissions, 'actions.novo_pedido.vendaPrazo')}
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
