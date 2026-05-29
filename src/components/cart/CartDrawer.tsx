
"use client"

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useCart } from '@/components/providers/CartProvider';
import { ShoppingCart, Trash2, Minus, Plus, Loader2, MapPin, Clock, Navigation, Copy, QrCode, MessageSquareText } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { ensureAuthenticated } from '@/firebase/non-blocking-login';
import { useCustomerFirebase } from '@/firebase/customer-client';
import { collection, doc, setDoc, getDoc, serverTimestamp, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AddressAutocomplete } from '@/components/ui/address-autocomplete';
import { getTheme, themeToCssVars } from '@/lib/themes';
import { Textarea } from '@/components/ui/textarea';
import { validateCustomerCredit, normalizeCreditPhone, getPhoneVariants } from '@/lib/customer-credit';

interface PaymentMethodConfig {
  id: string;
  label: string;
  icon: string;
  active: boolean;
}

interface CartDrawerProps {
  storeOwnerId?: string | null;
  deliveryFee?: number; // Taxa fixa (fallback)
  storeAddress?: string; // Endereço do restaurante para cálculo de distância
  deliveryFeeRules?: Array<{ maxKm: number; fee: number; perKmExtra?: number }>; // Regras por distância
  maxDeliveryRadius?: number; // Limite de KM
  customAddressRules?: Array<{ keyword: string; fee: number }>; // Regras personalizadas por bairro/rua
  freeDeliveryOver?: number; // Frete grátis acima de

  paymentMethods?: PaymentMethodConfig[]; // Formas de pagamento configuradas pela loja
  pixKey?: string | null;
  pixName?: string | null;
  isStoreOpen?: boolean;
  menuItems?: any[];
  enableInventory?: boolean;
  themeId?: string | null;
  promoItemsMap?: Record<string, { promoPrice: number }>;
  disableDelivery?: boolean;
}

const DEFAULT_PAYMENT_METHODS: PaymentMethodConfig[] = [
  { id: 'dinheiro', label: 'Dinheiro', icon: '💵', active: true },
  { id: 'pix', label: 'Pix', icon: '📱', active: true },
  { id: 'debito', label: 'Débito', icon: '💳', active: true },
  { id: 'credito', label: 'Crédito', icon: '💳', active: true },
];

type Step = 'cart' | 'info';

const getManagedStock = (value: unknown): number | null => {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
};

const checkCartStock = (
  projectedCart: any[],
  menuItemsList: any[],
  enableInventory: boolean
): { allowed: boolean; message?: string } => {
  if (!enableInventory || !menuItemsList || menuItemsList.length === 0) return { allowed: true };

  const demand: Record<string, number> = {};

  projectedCart.forEach(item => {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) return;

    if (item.isCombo && item.comboItems) {
      item.comboItems.forEach((ci: any) => {
        demand[ci.itemId] = (demand[ci.itemId] || 0) + qty;
      });
    } else {
      demand[item.id] = (demand[item.id] || 0) + qty;
    }
  });

  for (const [productId, reqQty] of Object.entries(demand)) {
    const matchedProduct = menuItemsList.find(m => m.id === productId);
    if (!matchedProduct) continue;

    const rawStock = matchedProduct.stockQuantity;
    const availableStock = typeof rawStock === 'number' && Number.isFinite(rawStock) && rawStock >= 0 ? rawStock : null;

    if (availableStock !== null && reqQty > availableStock) {
      return {
        allowed: false,
        message: `"${matchedProduct.name}" tem apenas ${availableStock} unidade(s) disponível(is).`
      };
    }
  }

  return { allowed: true };
};

const formatPhone = (val: string) => {
  if (!val) return '';
  const raw = val.replace(/\D/g, '').slice(0, 11);
  let f = '';
  if (raw.length === 0) f = '';
  else if (raw.length <= 2) f = `(${raw}`;
  else if (raw.length <= 6) f = `(${raw.slice(0, 2)}) ${raw.slice(2)}`;
  else if (raw.length <= 10) f = `(${raw.slice(0, 2)}) ${raw.slice(2, 6)}-${raw.slice(6)}`;
  else f = `(${raw.slice(0, 2)}) ${raw.slice(2, 7)}-${raw.slice(7)}`;
  
  // Permite que o usuário digite o traço ou espaço manualmente no final sem apagar
  if (val.endsWith(' ') && raw.length === 2 && f === `(${raw}`) return f + ') ';
  if (val.endsWith('-') && (raw.length === 6 || raw.length === 7) && !f.endsWith('-')) return f + '-';
  
  return f;
};

const formatDate = (val: string) => {
  if (!val) return '';
  const raw = val.replace(/\D/g, '').slice(0, 8);
  let f = '';
  if (raw.length === 0) f = '';
  else if (raw.length <= 2) f = raw;
  else if (raw.length <= 4) f = `${raw.slice(0, 2)}/${raw.slice(2)}`;
  else f = `${raw.slice(0, 2)}/${raw.slice(2, 4)}/${raw.slice(4)}`;
  
  // Permite que o usuário digite a barra manualmente
  if (val.endsWith('/') && (raw.length === 2 || raw.length === 4) && f.length === raw.length) return f + '/';
  
  return f;
};

export function CartDrawer({ storeOwnerId, deliveryFee = 0, storeAddress, deliveryFeeRules, customAddressRules, maxDeliveryRadius = 0, freeDeliveryOver = 0, paymentMethods, pixKey, pixName, isStoreOpen = true, menuItems = [], enableInventory = false, themeId, promoItemsMap, disableDelivery = false }: CartDrawerProps) {
  const cartTheme = getTheme(themeId);
  // 🔍 DEBUG: Verificar props recebidas
  console.log('[CartDrawer] Props recebidas:', {
    storeAddress: storeAddress?.substring(0, 30),
    deliveryFee,
    deliveryFeeRules,
    maxDeliveryRadius,
    freeDeliveryOver,
    rulesCount: deliveryFeeRules?.length || 0,
    disableDelivery
  });
  const [contaCasaEnabled, setContaCasaEnabled] = useState(false);
  
  const basePaymentMethods = (paymentMethods && paymentMethods.length > 0 ? paymentMethods : DEFAULT_PAYMENT_METHODS).filter(m => m.active);
  const activePaymentMethods = contaCasaEnabled 
    ? [...basePaymentMethods, { id: 'conta_casa', label: 'Sua conta (Prazo)', icon: '📝', active: true }]
    : basePaymentMethods;
    
  const { cart, removeFromCart, updateQuantity, updateItemNotes, totalPrice, totalItems, clearCart } = useCart();
  const effectiveStoreOwnerId = storeOwnerId || ((cart as any[]).find((i) => i.ownerId)?.ownerId ?? null);
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState<Step>('cart');
  const [checkoutStep, setCheckoutStep] = useState<1 | 2 | 3>(1);
  const [editingNoteCartId, setEditingNoteCartId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerBirthDate, setCustomerBirthDate] = useState('');
  const [orderType, setOrderType] = useState<'delivery' | 'pickup' | 'dine_in'>(disableDelivery ? 'pickup' : 'delivery');

  // Synchronize history state for back-button handling in CartDrawer
  useEffect(() => {
    if (!isOpen) return;

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state;
      if (state && state.type === 'cart-drawer') {
        setStep(state.step);
        setCheckoutStep(state.checkoutStep || 1);
      } else {
        setIsOpen(false);
        setStep('cart');
        setCheckoutStep(1);
      }
    };

    window.addEventListener('popstate', handlePopState);
    
    // Initial push for the drawer
    window.history.pushState({ type: 'cart-drawer', step: 'cart', checkoutStep: 1 }, '');

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isOpen]);

  // Push new state when step or checkoutStep changes, so we can back out of them
  useEffect(() => {
    if (!isOpen) return;
    
    const currentState = window.history.state;
    if (currentState && currentState.type === 'cart-drawer') {
      if (currentState.step !== step || (step === 'info' && currentState.checkoutStep !== checkoutStep)) {
        window.history.pushState({ type: 'cart-drawer', step, checkoutStep }, '');
      }
    }
  }, [isOpen, step, checkoutStep]);

  useEffect(() => {
    if (disableDelivery && orderType === 'delivery') {
      setOrderType('pickup');
    }
  }, [disableDelivery, orderType]);
  
  // Pagamento
  const [paymentMethod, setPaymentMethod] = useState('');
  const [cashChange, setCashChange] = useState('');
  const [payDeliverySeparately, setPayDeliverySeparately] = useState(false);

  // Campos de endereço
  const [cep, setCep] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [complement, setComplement] = useState('');
  const [city, setCity] = useState('');
  const [loadingCep, setLoadingCep] = useState(false);

  // Taxa de entrega dinâmica
  const [dynamicFee, setDynamicFee] = useState<number | null>(null);
  const [distanceInfo, setDistanceInfo] = useState<{ distanceText: string; durationText: string; distanceKm: number; originAddress?: string; destinationAddress?: string } | null>(null);
  const [calculatingFee, setCalculatingFee] = useState(false);
  const [deliveryBlocked, setDeliveryBlocked] = useState(false);
  const [showNeighborhoodSuggestions, setShowNeighborhoodSuggestions] = useState(false);
  const lastAttemptedAddressRef = useRef<string>('');

  const isFreeDelivery = freeDeliveryOver > 0 && totalPrice >= freeDeliveryOver;
  const baseDeliveryFee = orderType === 'delivery' && !isFreeDelivery ? (dynamicFee !== null ? dynamicFee : deliveryFee) : 0;
  const appliedDeliveryFee = (paymentMethod === 'conta_casa' && payDeliverySeparately) ? 0 : baseDeliveryFee;
  const grandTotal = totalPrice + appliedDeliveryFee;

  const openItemNoteEditor = (item: any) => {
    setEditingNoteCartId(item.cartId);
    setNoteDraft(item.customization?.notes || '');
  };

  const closeItemNoteEditor = () => {
    setEditingNoteCartId(null);
    setNoteDraft('');
  };

  const saveItemNote = () => {
    if (!editingNoteCartId) return;
    updateItemNotes(editingNoteCartId, noteDraft.trim());
    closeItemNoteEditor();
  };
  
  // 🔍 DEBUG: Estado da taxa
  console.log('[CartDrawer] Taxa:', { orderType, dynamicFee, deliveryFee, appliedDeliveryFee, isFreeDelivery, grandTotal });

  const { firestore: db, auth, user } = useCustomerFirebase();

  const [profileLoaded, setProfileLoaded] = useState(false);
  const [savedStreet, setSavedStreet] = useState('');
  const [savedNumber, setSavedNumber] = useState('');
  useEffect(() => {
    if (profileLoaded) return;
    (async () => {
      try {
        let d: any = {};
        if (db && user) {
          const snap = await getDoc(doc(db, 'customers', user.uid));
          if (snap.exists()) d = snap.data();
        }

        // Fallback local: se o user ainda não foi criado (visitante novo) ou se o doc estiver vazio
        let localProfile: any = {};
        try {
          const savedStr = localStorage.getItem('customer_profile');
          if (savedStr) localProfile = JSON.parse(savedStr);
        } catch {}

        setCustomerName(d.name || localProfile.name || '');
        setCustomerPhone(d.phone || localProfile.phone || localStorage.getItem('customer_phone') || '');
        if (d.birthDate || localProfile.birthDate) setCustomerBirthDate(d.birthDate || localProfile.birthDate || '');
        
        // Carregar endereço salvo
        const cepToSet = d.cep || localProfile.cep;
        if (cepToSet) setCep(cepToSet);
        
        const streetToSet = d.street || localProfile.street;
        if (streetToSet) { setStreet(streetToSet); setSavedStreet(streetToSet); }
        
        const numberToSet = d.number || localProfile.number;
        if (numberToSet) { setNumber(numberToSet); setSavedNumber(numberToSet); }
        
        const neighborhoodToSet = d.neighborhood || localProfile.neighborhood;
        if (neighborhoodToSet) setNeighborhood(neighborhoodToSet);
        
        const complementToSet = d.complement || localProfile.complement;
        if (complementToSet) setComplement(complementToSet);
        
        const cityToSet = d.city || localProfile.city;
        if (cityToSet) setCity(cityToSet);

        setProfileLoaded(true);
      } catch (e) {
        console.warn('load customer profile failed', e);
      }
    })();
  }, [db, user, profileLoaded]);

  // Verificar Conta da Casa quando o telefone muda
  useEffect(() => {
    if (!db || !effectiveStoreOwnerId || customerPhone.length < 10) {
      setContaCasaEnabled(false);
      return;
    }
    const checkCredit = async () => {
      try {
        const creditCheck = await validateCustomerCredit(db, effectiveStoreOwnerId, customerPhone, 0);
        setContaCasaEnabled(creditCheck.allowed);
      } catch (err) {
        console.warn('Erro ao verificar Conta da Casa:', err);
        setContaCasaEnabled(false);
      }
    };
    const timer = setTimeout(checkCredit, 500);
    return () => clearTimeout(timer);
  }, [customerPhone, db, effectiveStoreOwnerId]);

  // Calcular taxa de entrega quando endereço é selecionado do autocomplete
  const calculateDeliveryFee = useCallback(async (customerAddress: string, neighborhoodHint?: string) => {
    const effectiveNeighborhood = neighborhoodHint || neighborhood;
    console.log('[CartDrawer] calculateDeliveryFee chamado:', { customerAddress, effectiveNeighborhood, storeAddress: storeAddress?.substring(0, 30), rulesCount: deliveryFeeRules?.length, rules: deliveryFeeRules });
    
    const hasRules = (deliveryFeeRules && deliveryFeeRules.length > 0) || (customAddressRules && customAddressRules.length > 0);
    if (!storeAddress || !hasRules) {
      console.warn('[CartDrawer] ABORTANDO cálculo - falta dados:', { storeAddress: !!storeAddress, rulesCount: deliveryFeeRules?.length, customRulesCount: customAddressRules?.length });
      return;
    }
    if (!customerAddress || customerAddress.length < 5) {
      console.warn('[CartDrawer] ABORTANDO - endereço curto:', customerAddress);
      return;
    }

    setCalculatingFee(true);
    try {
      const res = await fetch('/api/delivery-fee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeAddress,
          customerAddress,
          feeRules: deliveryFeeRules,
          customAddressRules,
          neighborhoodHint: effectiveNeighborhood,
        }),
      });
      const data = await res.json();
      console.log('[CartDrawer] Resposta da API delivery-fee:', data);
      if (res.ok) {
        if (maxDeliveryRadius > 0 && data.distanceKm > maxDeliveryRadius) {
          setDeliveryBlocked(true);
          setDynamicFee(null);
          setDistanceInfo(null);
          toast({ variant: 'destructive', title: 'Fora da área de entrega', description: `O restaurante entrega apenas até ${maxDeliveryRadius}km. A distância é de ${data.distanceKm}km.` });
        } else {
          setDeliveryBlocked(false);
          setDynamicFee(data.fee);
          setDistanceInfo({
            distanceText: data.distanceText,
            durationText: data.durationText,
            distanceKm: data.distanceKm,
            originAddress: data.originAddress,
            destinationAddress: data.destinationAddress
          });
        }
      } else {
        console.warn('[CartDrawer] API taxa indisponível, usando taxa fixa. Motivo:', data.error);
        // Fallback silencioso para a taxa fixa configurada
        setDynamicFee(null);
        setDistanceInfo(null);
        setDeliveryBlocked(false);
      }
    } catch (err) {
      console.error('Erro ao calcular taxa:', err);
    } finally {
      setCalculatingFee(false);
    }
  }, [storeAddress, deliveryFeeRules, customAddressRules, maxDeliveryRadius, neighborhood, toast]);

  // Auto-calcular taxa quando AMBOS o endereço salvo E as regras da loja estiverem prontos
  const [autoCalcDone, setAutoCalcDone] = useState(false);
  useEffect(() => {
    if (autoCalcDone) return;
    if (!savedStreet || savedStreet.length < 5) return;
    const hasRules = (deliveryFeeRules && deliveryFeeRules.length > 0) || (customAddressRules && customAddressRules.length > 0);
    if (!storeAddress || !hasRules) return;
    
    console.log('[CartDrawer] ✅ Auto-cálculo: endereço salvo + regras prontos. Calculando taxa...');
    const addr = [savedStreet, savedNumber, neighborhood, city, 'Brasil'].filter(Boolean).join(', ');
    calculateDeliveryFee(addr);
    setAutoCalcDone(true);
  }, [savedStreet, savedNumber, neighborhood, city, storeAddress, deliveryFeeRules, autoCalcDone, calculateDeliveryFee]);

  // Busca automática de CEP via ViaCEP
  const searchCep = useCallback(async (rawCep: string) => {
    const cleaned = rawCep.replace(/\D/g, '');
    if (cleaned.length !== 8) return;

    setLoadingCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cleaned}/json/`);
      const data = await res.json();
      if (data.erro) {
        toast({ variant: 'destructive', title: 'CEP não encontrado', description: 'Verifique e tente novamente.' });
        return;
      }
      setStreet(data.logradouro || '');
      setNeighborhood(data.bairro || '');
      setCity(`${data.localidade} - ${data.uf}` || '');
      
      // Auto-calcular taxa após buscar CEP
      if (data.logradouro) {
        const addr = [data.logradouro, number, data.bairro, `${data.localidade} - ${data.uf}`, 'Brasil'].filter(Boolean).join(', ');
        setTimeout(() => calculateDeliveryFee(addr), 300);
      }
    } catch {
      toast({ variant: 'destructive', title: 'Erro', description: 'Falha ao buscar CEP.' });
    } finally {
      setLoadingCep(false);
    }
  }, [toast, number, calculateDeliveryFee]);

  // Callback: quando o cliente seleciona um endereço do autocomplete ou perde o foco
  const handleAddressSelected = useCallback((selectedAddress: string) => {
    console.log('[CartDrawer] handleAddressSelected chamado:', { selectedAddress, neighborhoodAtual: neighborhood, cityAtual: city });
    if (!selectedAddress) return;

    if (selectedAddress.includes(',')) {
      const parts = selectedAddress.split(',').map(p => p.trim());
      const isBrasil = parts[parts.length - 1].toLowerCase() === 'brasil';
      const relevantParts = isBrasil ? parts.slice(0, -1) : parts;
      
      let newStreet = selectedAddress;
      let newNeighborhood = neighborhood;
      let newCity = city;

      if (relevantParts.length >= 3) {
        newStreet = relevantParts[0];
        newNeighborhood = relevantParts[1];
        newCity = relevantParts.slice(2).join(', ');
      } else if (relevantParts.length === 2) {
        newStreet = relevantParts[0];
        newCity = relevantParts[1];
      } else {
        newStreet = relevantParts[0];
      }

      console.log('[CartDrawer] handleAddressSelected parseou:', { newStreet, newNeighborhood, newCity, relevantParts });

      setStreet(newStreet);
      setNeighborhood(newNeighborhood);
      setCity(newCity);

      if (orderType === 'delivery') {
        const fullAddr = [newStreet, number, newNeighborhood, newCity, 'Brasil'].filter(Boolean).join(', ');
        console.log('[CartDrawer] handleAddressSelected montou fullAddr:', fullAddr);
        setTimeout(() => calculateDeliveryFee(fullAddr), 300);
      }
    } else {
      setStreet(selectedAddress);
      if (orderType === 'delivery') {
        const fullAddr = [selectedAddress, number, neighborhood, city, 'Brasil'].filter(Boolean).join(', ');
        console.log('[CartDrawer] handleAddressSelected (sem vírgula) montou fullAddr:', fullAddr);
        calculateDeliveryFee(fullAddr);
      }
    }
  }, [orderType, number, neighborhood, city, calculateDeliveryFee]);

  const handlePlaceSelected = useCallback(async (placeId: string, description: string) => {
    console.log('[CartDrawer] handlePlaceSelected chamado:', { placeId, description });
    try {
      const res = await fetch(`/api/place-details?placeId=${placeId}`);
      if (!res.ok) throw new Error('Falha ao buscar detalhes do endereço');
      const data = await res.json();
      console.log('[CartDrawer] handlePlaceSelected recebeu do place-details:', data);
      
      let newStreet = data.street || description.split(',')[0];
      let newNeighborhood = data.neighborhood || neighborhood;
      let newCity = data.city || city;

      console.log('[CartDrawer] handlePlaceSelected atualizando states:', { newStreet, newNeighborhood, newCity });

      setStreet(newStreet);
      if (data.neighborhood) setNeighborhood(data.neighborhood);
      if (data.city) setCity(data.city);

      if (orderType === 'delivery') {
        const fullAddr = [newStreet, number, newNeighborhood, newCity, 'Brasil'].filter(Boolean).join(', ');
        console.log('[CartDrawer] handlePlaceSelected chamando calculateDeliveryFee com fullAddr:', fullAddr);
        setTimeout(() => calculateDeliveryFee(fullAddr), 300);
      }
    } catch (err) {
      console.error('[CartDrawer] Erro ao buscar detalhes do place:', err);
      handleAddressSelected(description);
    }
  }, [orderType, number, neighborhood, city, calculateDeliveryFee, handleAddressSelected]);

  // Efeito para calcular taxa automaticamente quando o preenchimento automático (autofill) dispara
  // Detectamos se cidade E rua foram preenchidos (sinal clássico de autofill)
  useEffect(() => {
    if (orderType !== 'delivery') return;
    if (!(street && street.length > 3 && city && city.length > 3)) return;
    const fullAddr = [street, number, neighborhood, city, 'Brasil'].filter(Boolean).join(', ');
    if (lastAttemptedAddressRef.current === fullAddr) return;
    const timeout = setTimeout(() => {
      lastAttemptedAddressRef.current = fullAddr;
      calculateDeliveryFee(fullAddr);
    }, 1000);
    return () => clearTimeout(timeout);
  }, [street, city, neighborhood, number, orderType, calculateDeliveryFee]);

  const fullDeliveryAddress = [street, number, complement, neighborhood, city, cep].filter(Boolean).join(', ');

  const goToCheckout = () => {
    if (!effectiveStoreOwnerId) {
      toast({ variant: "destructive", title: "Link da loja inválido", description: "Acesse pelo link de compartilhamento da loja." });
      return;
    }
    setStep('info');
    setCheckoutStep(1);
  };

  const validateStep = (s: 1 | 2 | 3): string | null => {
    if (s === 1) {
      if (!customerName.trim()) return 'Informe seu nome.';
      if (!customerPhone.trim() || customerPhone.replace(/\D/g, '').length < 10) return 'Informe um telefone válido.';
      return null;
    }
    if (s === 2) {
      if (orderType !== 'delivery') return null;
      if (!street.trim()) return 'Informe a rua.';
      if (!number.trim()) return 'Informe o número.';
      if (!neighborhood.trim()) return 'Informe o bairro.';
      if (!city.trim()) return 'Informe a cidade.';
      if (deliveryBlocked) return 'Endereço fora da área de entrega.';
      
      const hasRules = (deliveryFeeRules && deliveryFeeRules.length > 0) || (customAddressRules && customAddressRules.length > 0);
      if (hasRules && dynamicFee === null && !calculatingFee) {
        return 'A taxa de entrega não pôde ser calculada. Verifique se o endereço foi preenchido corretamente.';
      }

      return null;
    }
    if (s === 3) {
      if (!paymentMethod) return 'Selecione uma forma de pagamento.';
      return null;
    }
    return null;
  };

  const goNextStep = () => {
    const err = validateStep(checkoutStep);
    if (err) {
      toast({ variant: 'destructive', title: 'Atenção', description: err });
      return;
    }
    if (checkoutStep === 1) {
      setCheckoutStep(orderType === 'delivery' ? 2 : 3);
    } else if (checkoutStep === 2) {
      setCheckoutStep(3);
    }
  };

  const goPrevStep = () => {
    if (checkoutStep === 1) {
      setStep('cart');
    } else if (checkoutStep === 2) {
      setCheckoutStep(1);
    } else if (checkoutStep === 3) {
      setCheckoutStep(orderType === 'delivery' ? 2 : 1);
    }
  };

  const handleCheckout = async () => {
    if (!db || !auth) {
      toast({ variant: "destructive", title: "Erro", description: "Sistema indisponível. Recarregue a página." });
      return;
    }
    if (!customerName || !customerPhone) {
      toast({ variant: "destructive", title: "Campos obrigatórios", description: "Preencha nome e telefone." });
      return;
    }
    if (orderType === 'delivery') {
      if (!street) {
        toast({ variant: "destructive", title: "Endereço obrigatório", description: "Informe a rua de entrega." });
        return;
      }
      if (!neighborhood) {
        toast({ variant: "destructive", title: "Endereço obrigatório", description: "O preenchimento do bairro é obrigatório." });
        return;
      }
    }
    if (!paymentMethod) {
      toast({ variant: "destructive", title: "Pagamento", description: "Selecione uma forma de pagamento." });
      return;
    }
    if (!effectiveStoreOwnerId) {
      toast({ variant: "destructive", title: "Link da loja inválido", description: "Acesse pelo link de compartilhamento da loja." });
      return;
    }
    if (!isStoreOpen) {
      toast({ variant: "destructive", title: "Loja Fechada", description: "A loja está fechada no momento." });
      return;
    }
    if (cart.length === 0) {
      toast({ variant: "destructive", title: "Carrinho Vazio", description: "Adicione itens antes de finalizar." });
      return;
    }
    if (orderType === 'delivery') {
      const hasRules = (deliveryFeeRules && deliveryFeeRules.length > 0) || (customAddressRules && customAddressRules.length > 0);
      if (hasRules && dynamicFee === null) {
        toast({ variant: "destructive", title: "Taxa de Entrega", description: "A taxa de entrega não pôde ser calculada. Verifique se o endereço foi preenchido corretamente." });
        return;
      }
    }
    if (orderType === 'delivery' && maxDeliveryRadius > 0) {
      if (!distanceInfo) {
        toast({ variant: "destructive", title: "Endereço Inválido", description: "Não foi possível traçar a rota. Verifique seu endereço." });
        return;
      }
      if (distanceInfo.distanceKm > maxDeliveryRadius) {
        toast({ variant: "destructive", title: "Fora da área", description: `Desculpe, só entregamos até ${maxDeliveryRadius}km de distância.` });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const cashRegisterSnap = await getDocs(query(
        collection(db, 'cash_registers'),
        where('ownerId', '==', effectiveStoreOwnerId)
      ));
      const hasOpenCashRegister = cashRegisterSnap.docs.some((cashRegister) => cashRegister.data().status === 'aberto');
      if (!hasOpenCashRegister) {
        toast({ variant: "destructive", title: "Caixa Fechado", description: "Abra o caixa antes de aceitar pedidos pelo cardapio." });
        return;
      }

      const authUser = await ensureAuthenticated(auth);
      console.log('[CartDrawer] 🚀 Enviando pedido com uid:', authUser.uid, authUser.isAnonymous ? '(anônimo)' : `(email: ${authUser.email})`);
      // Salva/atualiza perfil do cliente no Firebase
      await setDoc(doc(db, 'customers', authUser.uid), {
        uid: authUser.uid,
        name: customerName,
        phone: customerPhone,
        birthDate: customerBirthDate,
        address: fullDeliveryAddress,
        cep, street, number, neighborhood, complement, city,
        updatedAt: new Date().toISOString(),
      }, { merge: true });

      // Sincroniza também com a coleção de clientes (Painel Admin)
      try {
        const normalizedPhone = normalizeCreditPhone(customerPhone);
        const variants = getPhoneVariants(customerPhone);
        const qClientes = query(collection(db, 'clientes'), where('ownerId', '==', effectiveStoreOwnerId), where('celular', 'in', variants));
        const snapClientes = await getDocs(qClientes);
        
        let docId = normalizedPhone ? `${effectiveStoreOwnerId}_${normalizedPhone}` : doc(collection(db, 'clientes')).id;
        if (!snapClientes.empty) {
          docId = snapClientes.docs[0].id;
        }

        const clienteRef = doc(db, 'clientes', docId);
        const clienteData: any = {
          id: docId,
          ownerId: effectiveStoreOwnerId,
          nome: customerName,
          celular: normalizedPhone,
          dataNascimento: customerBirthDate,
          logradouro: street,
          logradouroNumero: number,
          complemento: complement,
          bairro: neighborhood,
          cidade: city,
          updatedAt: new Date().toISOString(),
        };
        
        if (snapClientes.empty) {
          clienteData.createdAt = new Date().toISOString();
          clienteData.totalPedidos = 0;
          clienteData.totalPontos = 0;
          clienteData.ticketMedio = 0;
          clienteData.creditBalance = 0;
          clienteData.clienteDesde = new Date().toLocaleDateString('pt-BR');
        }
        await setDoc(clienteRef, clienteData, { merge: true });
      } catch (err) {
        console.warn('Erro ao sincronizar cliente para painel admin:', err);
      }

      // Salva em localStorage como fallback de robustez (Sessões anônimas)
      try {
        localStorage.setItem('customer_profile', JSON.stringify({
          name: customerName,
          phone: customerPhone,
          birthDate: customerBirthDate,
          address: fullDeliveryAddress,
          cep, street, number, neighborhood, complement, city,
        }));
      } catch (e) {
        console.warn('Erro ao salvar local profile fallback', e);
      }

      const orderId = Math.random().toString(36).substring(2, 10).toUpperCase();
      const orderRef = doc(collection(db, 'orders'), orderId);

      // Validação de estoque antes de enviar
      if (enableInventory) {
        // Find all unique product IDs we need to check stock for
        const uniqueProductIds = new Set<string>();
        cart.forEach(item => {
          if (item.isCombo && item.comboItems) {
            item.comboItems.forEach((ci: any) => uniqueProductIds.add(ci.itemId));
          } else {
            uniqueProductIds.add(item.id);
          }
        });

        // Fetch latest stock quantities from Firestore
        const latestStocks: Record<string, { stock: number | null; name: string }> = {};
        for (const pId of Array.from(uniqueProductIds)) {
          const itemDoc = await getDoc(doc(db, 'menuItems', pId));
          if (itemDoc.exists()) {
            const data = itemDoc.data();
            const rawStock = data.stockQuantity;
            const stock = typeof rawStock === 'number' && Number.isFinite(rawStock) && rawStock >= 0 ? rawStock : null;
            latestStocks[pId] = { stock, name: data.name || pId };
          }
        }

        // Calculate aggregated demand in current cart
        const demand: Record<string, number> = {};
        cart.forEach(item => {
          const qty = Number(item.quantity) || 0;
          if (qty <= 0) return;

          if (item.isCombo && item.comboItems) {
            item.comboItems.forEach((ci: any) => {
              demand[ci.itemId] = (demand[ci.itemId] || 0) + qty;
            });
          } else {
            demand[item.id] = (demand[item.id] || 0) + qty;
          }
        });

        // Validate
        for (const [pId, reqQty] of Object.entries(demand)) {
          const info = latestStocks[pId];
          if (info && info.stock !== null && reqQty > info.stock) {
            toast({
              variant: "destructive",
              title: "Estoque insuficiente",
              description: `"${info.name}" tem apenas ${info.stock} unidade(s) disponível(is).`
            });
            setIsSubmitting(false);
            return;
          }
        }
      }

      // Validação de Preço Segura (Cruza com menuItems oficial se disponível)
      let safeSubtotal = 0;
      const safeItems = cart.map(item => {
        const officialItem = menuItems.find(mi => mi.id === item.id);
        const promo = promoItemsMap?.[item.id];
        const basePrice = promo ? promo.promoPrice : (officialItem ? officialItem.price : item.price);
        
        const addons = item.customization?.addons || [];
        const addonsTotal = addons.reduce((a, b) => a + b.price, 0);
        
        const safeUnitPrice = basePrice + addonsTotal;
        safeSubtotal += safeUnitPrice * item.quantity;
        
        return {
          id: item.id,
          name: officialItem ? officialItem.name : item.name,
          quantity: item.quantity,
          unitPrice: safeUnitPrice,
          addons: addons.map(a => ({ name: a.name, price: a.price })),
          notes: item.customization?.notes || '',
          isCombo: !!officialItem?.isCombo,
          comboItems: officialItem?.comboItems || null,
        };
      });
      const safeGrandTotal = safeSubtotal + appliedDeliveryFee;

      // Normalizar telefone: remover +55, espaços, traços, parênteses
      const normalizedPhone = customerPhone.replace(/[\s\-\(\)\+]/g, '').replace(/^55(\d{10,11})$/, '$1');

      if (paymentMethod === 'conta_casa') {
        const creditCheck = await validateCustomerCredit(db, effectiveStoreOwnerId, normalizedPhone, safeGrandTotal);
        if (!creditCheck.allowed) {
          if (creditCheck.reason !== 'over_limit') {
            setContaCasaEnabled(false);
            setPaymentMethod('');
          }
          toast({
            variant: "destructive",
            title: "Prazo bloqueado",
            description: creditCheck.message || "Este pedido nao pode ser comprado a prazo.",
          });
          return;
        }
      }

      const orderData = {
        id: orderId,
        customerIdentifier: normalizedPhone,
        ownerId: effectiveStoreOwnerId,
        customerName,
        customerPhone: normalizedPhone,
        customerBirthDate,
        customerEmail: authUser.email || '',
        deliveryAddress: orderType === 'delivery' ? fullDeliveryAddress : '',
        orderDateTime: new Date().toISOString(),
        createdAt: serverTimestamp(),
        status: 'pending',
        totalAmount: safeGrandTotal,
        subtotal: safeSubtotal,
        deliveryFee: baseDeliveryFee,
          payDeliveryToMotoboy: paymentMethod === 'conta_casa' && payDeliverySeparately,
        distanceKm: distanceInfo?.distanceKm || null,
        paymentStatus: 'pending',
        paymentMethod: paymentMethod === 'dinheiro' && cashChange ? `Dinheiro (Troco para R$ ${Number(cashChange).toFixed(2)})` : paymentMethod,
        orderType,
        stockDeducted: false,
        items: safeItems
      };

      const batch = writeBatch(db);
      batch.set(orderRef, orderData);

      await batch.commit();

      toast({ title: "Pedido Enviado!", description: `Pedido #${orderId} foi recebido.` });

      // Salva o telefone no localStorage e notifica outros componentes
      try {
        localStorage.setItem('customer_phone', customerPhone);
        window.dispatchEvent(new CustomEvent('customer_phone_updated', { detail: customerPhone }));
      } catch {}

      clearCart();
      const pushedCount = step === 'cart' ? 1 : (1 + checkoutStep);
      window.history.go(-pushedCount);

      setDynamicFee(null);
      setDistanceInfo(null);
    } catch (error: any) {
      console.error(error);
      toast({ variant: "destructive", title: "Erro ao enviar", description: error?.message || "Erro ao processar o pedido." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepLabels: Record<1 | 2 | 3, string> = {
    1: orderType === 'delivery' ? 'Entrega e contato' : orderType === 'pickup' ? 'Retirada e contato' : 'Mesa e contato',
    2: 'Endereço de entrega',
    3: 'Pagamento',
  };
  const totalSteps = orderType === 'delivery' ? 3 : 2;
  const visualStep = checkoutStep === 3 && orderType !== 'delivery' ? 2 : checkoutStep;
  const headerTitle = step === 'cart' ? 'Meu Pedido' : stepLabels[checkoutStep];

  return (
    <Sheet open={isOpen} onOpenChange={(open) => {
      if (!open) {
        if (isOpen) {
          const pushedCount = step === 'cart' ? 1 : (1 + checkoutStep);
          window.history.go(-pushedCount);
        }
      } else {
        setIsOpen(true);
      }
    }}>
      <SheetTrigger asChild>
        <Button data-cart-trigger variant="outline" size="icon" className="relative bg-white border-primary/20 text-primary hover:bg-primary/5 rounded-full h-12 w-12 shadow-md">
          <ShoppingCart className="h-6 w-6" />
          {totalItems > 0 && (
            <Badge className="absolute -top-2 -right-2 bg-accent text-accent-foreground rounded-full w-6 h-6 flex items-center justify-center p-0 border-2 border-white">
              {totalItems}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md flex flex-col h-full" style={themeToCssVars(cartTheme)}>
        <SheetHeader className="pb-2">
          <SheetTitle className="text-base font-bold flex items-center gap-2">
            {headerTitle}
            {step === 'cart' && <span className="text-muted-foreground font-normal text-sm">({totalItems})</span>}
          </SheetTitle>
          {step === 'info' && (
            <div className="flex items-center gap-2 pt-1">
              <div className="flex items-center gap-1 flex-1">
                {Array.from({ length: totalSteps }, (_, i) => i + 1).map((n) => {
                  const done = n < visualStep;
                  const current = n === visualStep;
                  return (
                    <React.Fragment key={n}>
                      <div className={`h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                        done ? 'bg-primary text-white' :
                        current ? 'bg-primary/15 text-primary ring-2 ring-primary' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {done ? '✓' : n}
                      </div>
                      {n < totalSteps && (
                        <div className={`flex-1 h-0.5 rounded-full ${n < visualStep ? 'bg-primary' : 'bg-muted'}`} />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider whitespace-nowrap">
                {visualStep}/{totalSteps}
              </span>
            </div>
          )}
        </SheetHeader>

        <Separator />

        {cart.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-4">
            <ShoppingCart className="h-12 w-12 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-semibold">Seu carrinho está vazio</h3>
          </div>
        ) : step === 'cart' ? (
          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="py-4 space-y-6">
              {cart.map((item) => {
                const addons = item.customization?.addons || [];
                const addonsTotal = addons.reduce((a, b) => a + b.price, 0);
                const unitPrice = item.price + addonsTotal;
                return (
                  <div key={item.cartId} className="flex flex-col gap-2 pb-4 border-b border-muted last:border-0">
                    <div className="flex justify-between items-start">
                      <h4 className="font-bold">{item.name}</h4>
                      <span className="font-semibold text-primary">R$ {(unitPrice * item.quantity).toFixed(2)}</span>
                    </div>
                    {addons.length > 0 && (
                      <div className="text-xs text-muted-foreground pl-2 space-y-0.5">
                        {addons.map(a => (
                          <div key={a.id}>+ {a.name} (R$ {a.price.toFixed(2)})</div>
                        ))}
                      </div>
                    )}
                    {item.customization?.notes && (
                      <div className="text-xs text-muted-foreground italic pl-2">
                        Obs: {item.customization.notes}
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <button onClick={() => updateQuantity(item.cartId, item.quantity - 1)} className="border rounded-md p-1"><Minus className="h-3 w-3" /></button>
                      <span className="text-sm font-bold">{item.quantity}</span>
                      <button onClick={() => {
                        if (enableInventory) {
                          const projectedCart = cart.map(i =>
                            i.cartId === item.cartId ? { ...i, quantity: i.quantity + 1 } : i
                          );
                          const check = checkCartStock(projectedCart, menuItems, enableInventory);
                          if (!check.allowed) {
                            toast({
                              title: "Estoque insuficiente",
                              description: check.message,
                              variant: "destructive"
                            });
                            return;
                          }
                        }
                        updateQuantity(item.cartId, item.quantity + 1);
                      }} className="border rounded-md p-1"><Plus className="h-3 w-3" /></button>
                      <div className="ml-auto flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-slate-500 hover:text-primary"
                          onClick={() => openItemNoteEditor(item)}
                          title="Adicionar observacao"
                        >
                          <MessageSquareText className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => {
                            if (editingNoteCartId === item.cartId) closeItemNoteEditor();
                            removeFromCart(item.cartId);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {editingNoteCartId === item.cartId && (
                      <div className="rounded-lg border bg-slate-50 p-2.5 space-y-2">
                        <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Observacao do item</Label>
                        <Textarea
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          placeholder="Ex: sem cebola, molho separado..."
                          className="min-h-[70px] resize-none bg-white text-xs"
                        />
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={closeItemNoteEditor}>
                            Cancelar
                          </Button>
                          <Button type="button" size="sm" className="h-8 text-xs" onClick={saveItemNote}>
                            Salvar
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        ) : (
          <ScrollArea className="flex-1 -mx-6 px-6 py-3">
            <div className="space-y-3">
              {checkoutStep === 1 && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">Como você quer receber?</Label>
                    <div className={`grid ${disableDelivery ? 'grid-cols-2' : 'grid-cols-3'} gap-1.5`}>
                      {!disableDelivery && (
                        <button
                          type="button"
                          onClick={() => { setOrderType('delivery'); setDynamicFee(null); setDistanceInfo(null); }}
                          className={`border-2 rounded-lg p-2 text-center font-bold text-xs transition-all ${orderType === 'delivery' ? 'border-primary bg-primary/10 text-primary' : 'border-muted text-muted-foreground'}`}
                        >
                          🛵 Entrega
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { setOrderType('pickup'); setDynamicFee(null); setDistanceInfo(null); }}
                        className={`border-2 rounded-lg p-2 text-center font-bold text-xs transition-all ${orderType === 'pickup' ? 'border-primary bg-primary/10 text-primary' : 'border-muted text-muted-foreground'}`}
                      >
                        🏪 Retirar
                      </button>
                      <button
                        type="button"
                        onClick={() => { setOrderType('dine_in'); setDynamicFee(null); setDistanceInfo(null); }}
                        className={`border-2 rounded-lg p-2 text-center font-bold text-xs transition-all ${orderType === 'dine_in' ? 'border-primary bg-primary/10 text-primary' : 'border-muted text-muted-foreground'}`}
                      >
                        🍽️ Local
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="cust_name" className="text-xs font-bold">Nome Completo</Label>
                    <Input id="cust_name" autoComplete="name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="h-9 text-sm" placeholder="Seu nome" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="cust_phone" className="text-xs font-bold">Telefone / WhatsApp</Label>
                      <Input id="cust_phone" type="tel" autoComplete="tel" maxLength={15} value={customerPhone} onChange={(e) => setCustomerPhone(formatPhone(e.target.value))} className="h-9 text-sm" placeholder="(00) 90000-0000" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="cust_birth" className="text-xs font-bold">Nascimento <span className="font-normal opacity-60">(opcional)</span></Label>
                      <Input id="cust_birth" type="text" maxLength={10} placeholder="DD/MM/AAAA" value={customerBirthDate} onChange={(e) => setCustomerBirthDate(formatDate(e.target.value))} className="h-9 text-sm" />
                    </div>
                  </div>
                </>
              )}

              {checkoutStep === 2 && orderType === 'delivery' && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold">Endereço</Label>
                    <AddressAutocomplete
                      id="cust_street"
                      value={street}
                      onChange={(val) => {
                        setStreet(val);
                        if (dynamicFee !== null) {
                          setDynamicFee(null);
                        }
                        if (distanceInfo !== null) {
                          setDistanceInfo(null);
                        }
                        if (deliveryBlocked) setDeliveryBlocked(false);
                      }}
                      onSelect={handleAddressSelected}
                      onSelectPlace={handlePlaceSelected}
                      onBlur={() => {
                        if (street && street.length > 5 && dynamicFee === null && !calculatingFee && !distanceInfo) {
                          const fullAddr = [street, number, neighborhood, city].filter(Boolean).join(', ');
                          handleAddressSelected(fullAddr);
                        }
                      }}
                      forceClose={distanceInfo !== null || deliveryBlocked}
                      locationContext={city || undefined}
                      placeholder="Digite rua, bairro ou cidade..."
                    />
                    <input type="hidden" autoComplete="street-address" value={street} onChange={() => {}} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="cust_number" className="text-xs font-bold">Número</Label>
                      <Input 
                        id="cust_number" 
                        autoComplete="address-line2" 
                        value={number} 
                        onChange={(e) => setNumber(e.target.value)} 
                        onBlur={() => {
                          if (street && number) {
                            const fullAddr = [street, number, neighborhood, city].filter(Boolean).join(', ');
                            calculateDeliveryFee(fullAddr);
                          }
                        }}
                        placeholder="314" 
                        className="h-9 text-sm" 
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="cust_comp" className="text-xs font-bold">Complemento</Label>
                      <Input id="cust_comp" value={complement} onChange={(e) => setComplement(e.target.value)} placeholder="Apto, Bloco..." className="h-9 text-sm" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1 relative">
                      <Label htmlFor="cust_neighborhood" className="text-xs font-bold">Bairro</Label>
                      <Input 
                        id="cust_neighborhood" 
                        autoComplete="off" 
                        value={neighborhood} 
                        onChange={(e) => {
                          setNeighborhood(e.target.value);
                          setShowNeighborhoodSuggestions(true);
                        }}
                        onFocus={() => setShowNeighborhoodSuggestions(true)}
                        onBlur={() => {
                          // Delay para permitir click na sugestão
                          setTimeout(() => setShowNeighborhoodSuggestions(false), 200);
                          if (street && neighborhood) {
                            const fullAddr = [street, number, neighborhood, city].filter(Boolean).join(', ');
                            calculateDeliveryFee(fullAddr);
                          }
                        }}
                        placeholder="Digite o bairro..." 
                        className="h-9 text-sm" 
                      />
                      {showNeighborhoodSuggestions && (() => {
                        const neighborhoodRules = (customAddressRules || []).filter((r: any) => r.type === 'neighborhood' && r.keyword);
                        const filtered = neighborhood.trim().length > 0
                          ? neighborhoodRules.filter((r: any) => r.keyword.toLowerCase().includes(neighborhood.toLowerCase().trim()))
                          : neighborhoodRules;
                        if (filtered.length === 0) return null;
                        return (
                          <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                            {filtered.map((rule: any, idx: number) => (
                              <button
                                key={rule.keyword + idx}
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-green-50 flex items-center justify-between border-b last:border-0 transition-colors"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setNeighborhood(rule.keyword);
                                  setShowNeighborhoodSuggestions(false);
                                  if (street) {
                                    const fullAddr = [street, number, rule.keyword, city].filter(Boolean).join(', ');
                                    calculateDeliveryFee(fullAddr, rule.keyword);
                                  }
                                }}
                              >
                                <span className="font-medium">{rule.keyword}</span>
                                <span className="text-xs text-green-600 font-bold">R$ {Number(rule.fee).toFixed(2)}</span>
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="cust_city" className="text-xs font-bold">Cidade</Label>
                      <Input 
                        id="cust_city" 
                        autoComplete="address-level2" 
                        value={city} 
                        onChange={(e) => setCity(e.target.value)} 
                        onBlur={() => {
                          if (street && city) {
                            const fullAddr = [street, number, neighborhood, city].filter(Boolean).join(', ');
                            calculateDeliveryFee(fullAddr);
                          }
                        }}
                        placeholder="Sua Cidade - SP" 
                        className="h-9 text-sm" 
                      />
                    </div>
                  </div>

                  {calculatingFee && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-blue-50 p-2 rounded-lg border border-blue-100 animate-pulse">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                      <span>Calculando taxa de entrega...</span>
                    </div>
                  )}
                  {distanceInfo && !calculatingFee && (
                    <div className="bg-green-50 p-2.5 rounded-lg border border-green-200 space-y-1">
                      <div className="flex items-center justify-between text-xs font-medium text-green-700">
                        <span className="flex items-center gap-1.5">
                          <Navigation className="h-3.5 w-3.5" />
                          {distanceInfo.distanceText} <span className="opacity-70">· {distanceInfo.durationText}</span>
                        </span>
                        <span className="font-bold text-green-800">R$ {dynamicFee?.toFixed(2)}</span>
                      </div>
                    </div>
                  )}
                </>
              )}

              {checkoutStep === 3 && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">Como você vai pagar?</Label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {activePaymentMethods.map(method => (
                        <button
                          key={method.id}
                          type="button"
                          onClick={() => { setPaymentMethod(method.id); setCashChange(''); }}
                          className={`flex flex-col items-center justify-center p-2 rounded-lg border-2 transition-all ${paymentMethod === method.id ? 'border-primary bg-primary/10 text-primary' : 'border-muted text-muted-foreground'}`}
                        >
                          <span className="text-base leading-none mb-0.5">{method.icon}</span>
                          <span className="font-bold text-[11px] leading-tight text-center">{method.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {paymentMethod === 'dinheiro' && (
                    <div className="bg-amber-50 p-2 rounded-lg border border-amber-200 space-y-1.5">
                      <Label htmlFor="troco-input" className="text-amber-800 text-xs font-bold flex flex-col gap-0.5">
                        <span>Precisa de troco para quanto?</span>
                        <span className="text-[10px] font-normal opacity-80">(Opcional)</span>
                      </Label>
                      <Input
                        id="troco-input"
                        type="text"
                        inputMode="numeric"
                        placeholder="R$ 0,00"
                        value={cashChange ? `R$ ${cashChange.replace('.', ',')}` : ''}
                        onChange={(e) => {
                          let val = e.target.value.replace(/\D/g, '');
                          if (!val) setCashChange('');
                          else setCashChange((Number(val) / 100).toFixed(2));
                        }}
                        className="bg-white border-amber-300 h-9 text-sm font-bold"
                      />
                      {Number(cashChange) > 0 && (
                        <div className={`text-xs font-bold ${Number(cashChange) >= grandTotal ? 'text-green-600' : 'text-red-500'}`}>
                          {Number(cashChange) >= grandTotal
                            ? `Troco: R$ ${(Number(cashChange) - grandTotal).toFixed(2)}`
                            : `Falta R$ ${(grandTotal - Number(cashChange)).toFixed(2)}`}
                        </div>
                      )}
                    </div>
                  )}

                  {paymentMethod === 'pix' && (
                    <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-200 space-y-2">
                      <div className="flex items-center gap-1.5 text-emerald-800 text-xs font-bold">
                        <QrCode className="h-4 w-4" /> Pagamento via PIX
                      </div>
                      <p className="text-[11px] text-emerald-700 leading-tight">
                        Você pode copiar a chave PIX abaixo agora ou aguardar a mensagem no seu WhatsApp. <b>Lembre-se de enviar o comprovante no WhatsApp da loja para agilizar!</b>
                      </p>
                      {(pixKey || pixName) && (
                        <div className="bg-white p-2 rounded border border-emerald-100 text-[11px] space-y-1">
                          {pixKey && (
                            <div className="flex justify-between items-center">
                              <span className="text-slate-500">Chave PIX:</span>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold">{pixKey}</span>
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-6 w-6 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(pixKey);
                                    toast({ title: 'Copiado!', description: 'Chave PIX copiada para a área de transferência.' });
                                  }}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          )}
                          {pixName && (
                            <div className="flex justify-between items-center">
                              <span className="text-slate-500">Titular:</span>
                              <span className="font-bold text-slate-800">{pixName}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Resumo do pedido */}
                  <div className="bg-slate-50 rounded-lg border border-slate-200 p-2.5 space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Resumo do pedido</p>
                    <div className="text-xs text-slate-600 flex justify-between">
                      <span>{customerName || '—'}</span>
                      <span>{customerPhone || '—'}</span>
                    </div>
                    {orderType === 'delivery' && (
                      <div className="text-xs text-slate-600 leading-tight">
                        📍 {[street, number, neighborhood, city].filter(Boolean).join(', ') || '—'}
                      </div>
                    )}
                    {orderType === 'pickup' && <div className="text-xs text-slate-600">🏪 Retirada no local</div>}
                    {orderType === 'dine_in' && <div className="text-xs text-slate-600">🍽️ Consumo no local</div>}
                  </div>
                </>
              )}
            </div>
          </ScrollArea>
        )}

        {cart.length > 0 && (
          <div className="pt-3 border-t space-y-2">
            {orderType === 'delivery' && (
              <div className="space-y-0.5 text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>R$ {totalPrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Taxa de entrega {distanceInfo ? `(${distanceInfo.distanceText})` : ''}</span>
                  {isFreeDelivery ? (
                    <span className="text-green-600 font-bold">Grátis</span>
                  ) : (
                    <span>R$ {appliedDeliveryFee.toFixed(2)}</span>
                  )}
                </div>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="font-medium text-sm">Total</span>
              <span className="font-bold text-xl text-primary">R$ {grandTotal.toFixed(2)}</span>
            </div>

            {step === 'cart' ? (
              <Button className="w-full h-11 bg-primary text-white font-bold" onClick={goToCheckout}>
                Continuar
              </Button>
            ) : (
              <div className="flex flex-col gap-1.5">
                {deliveryBlocked && orderType === 'delivery' && checkoutStep === 2 && (
                  <div className="bg-red-50 text-red-600 p-2 rounded-lg text-xs font-medium border border-red-200 text-center">
                    Endereço fora da área de entrega (máx. {maxDeliveryRadius}km).
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 h-11" onClick={goPrevStep}>
                    {checkoutStep === 1 ? 'Voltar' : '← Voltar'}
                  </Button>
                  {checkoutStep === 3 ? (
                    <Button
                      id="btn-finalizar"
                      className="flex-[2] h-11 bg-accent text-white font-bold"
                      onClick={handleCheckout}
                      disabled={isSubmitting || calculatingFee || (orderType === 'delivery' && deliveryBlocked)}
                    >
                      {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Finalizar Pedido'}
                    </Button>
                  ) : (
                    <Button
                      className="flex-[2] h-11 bg-primary text-white font-bold"
                      onClick={goNextStep}
                      disabled={checkoutStep === 2 && (calculatingFee || deliveryBlocked)}
                    >
                      Continuar →
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

