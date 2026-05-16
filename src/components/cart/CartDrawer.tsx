
"use client"

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useCart } from '@/components/providers/CartProvider';
import { ShoppingCart, Trash2, Minus, Plus, Loader2, MapPin, Clock, Navigation, Copy } from 'lucide-react';
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
  isStoreOpen?: boolean;
  menuItems?: any[];
  enableInventory?: boolean;
  themeId?: string | null;
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

export function CartDrawer({ storeOwnerId, deliveryFee = 0, storeAddress, deliveryFeeRules, customAddressRules, maxDeliveryRadius = 0, freeDeliveryOver = 0, paymentMethods, isStoreOpen = true, menuItems = [], enableInventory = false, themeId }: CartDrawerProps) {
  const cartTheme = getTheme(themeId);
  // 🔍 DEBUG: Verificar props recebidas
  console.log('[CartDrawer] Props recebidas:', {
    storeAddress: storeAddress?.substring(0, 30),
    deliveryFee,
    deliveryFeeRules,
    maxDeliveryRadius,
    freeDeliveryOver,
    rulesCount: deliveryFeeRules?.length || 0
  });
  const [contaCasaEnabled, setContaCasaEnabled] = useState(false);
  
  const basePaymentMethods = (paymentMethods && paymentMethods.length > 0 ? paymentMethods : DEFAULT_PAYMENT_METHODS).filter(m => m.active);
  const activePaymentMethods = contaCasaEnabled 
    ? [...basePaymentMethods, { id: 'conta_casa', label: 'Sua conta (Prazo)', icon: '📝', active: true }]
    : basePaymentMethods;
    
  const { cart, removeFromCart, updateQuantity, totalPrice, totalItems, clearCart } = useCart();
  const effectiveStoreOwnerId = storeOwnerId || ((cart as any[]).find((i) => i.ownerId)?.ownerId ?? null);
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState<Step>('cart');
  const [checkoutStep, setCheckoutStep] = useState<1 | 2 | 3>(1);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerBirthDate, setCustomerBirthDate] = useState('');
  const [orderType, setOrderType] = useState<'delivery' | 'pickup' | 'dine_in'>('delivery');
  
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
  const lastAttemptedAddressRef = useRef<string>('');

  const isFreeDelivery = freeDeliveryOver > 0 && totalPrice >= freeDeliveryOver;
  const baseDeliveryFee = orderType === 'delivery' && !isFreeDelivery ? (dynamicFee !== null ? dynamicFee : deliveryFee) : 0;
  const appliedDeliveryFee = (paymentMethod === 'conta_casa' && payDeliverySeparately) ? 0 : baseDeliveryFee;
  const grandTotal = totalPrice + appliedDeliveryFee;
  
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
        // Normalizar telefone: remover espaços, traços, parênteses e +55
        const normalizedPhone = customerPhone.replace(/[\s\-\(\)\+]/g, '').replace(/^55/, '');
        
        // Buscar TODOS os documentos do cliente (pode haver duplicatas)
        const q = query(
          collection(db, 'clientes'),
          where('ownerId', '==', effectiveStoreOwnerId),
          where('celular', '==', normalizedPhone)
        );
        const snap = await getDocs(q);
        
        const isCreditValid = (d: any) => {
          const data = d.data();
          if (!data.creditEnabled) return false;
          
          const balance = data.creditBalance || 0;
          const limit = data.creditLimit || 0;
          const payDay = data.creditPayDay || 0;
          
          // Bloqueia se o limite for atingido ou ultrapassado
          if (limit > 0 && balance >= limit) return false;
          
          // Bloqueia se passou do dia do pagamento e há saldo devedor
          if (payDay > 0 && balance > 0) {
            const today = new Date().getDate();
            if (today > payDay) {
               return false; // Dívida em aberto após data limite
            }
          }
          
          return true;
        };

        // Verificar se QUALQUER documento tem creditEnabled
        if (!snap.empty) {
          const hasCredit = snap.docs.some(isCreditValid);
          if (hasCredit) {
            setContaCasaEnabled(true);
            return;
          }
        }
        
        // Fallback: tentar com telefone original (caso salvo com formatação diferente)
        if (normalizedPhone !== customerPhone) {
          const q2 = query(
            collection(db, 'clientes'),
            where('ownerId', '==', effectiveStoreOwnerId),
            where('celular', '==', customerPhone)
          );
          const snap2 = await getDocs(q2);
          if (!snap2.empty) {
            const hasCredit = snap2.docs.some(isCreditValid);
            if (hasCredit) {
              setContaCasaEnabled(true);
              return;
            }
          }
        }

        // Fallback 2: tentar com +55 prefixo
        const withPrefix = '+55' + normalizedPhone;
        if (withPrefix !== customerPhone && withPrefix !== normalizedPhone) {
          const q3 = query(
            collection(db, 'clientes'),
            where('ownerId', '==', effectiveStoreOwnerId),
            where('celular', '==', withPrefix)
          );
          const snap3 = await getDocs(q3);
          if (!snap3.empty) {
            const hasCredit = snap3.docs.some(isCreditValid);
            if (hasCredit) {
              setContaCasaEnabled(true);
              return;
            }
          }
        }
        
        setContaCasaEnabled(false);
      } catch (err) {
        console.warn('Erro ao verificar Conta da Casa:', err);
      }
    };
    const timer = setTimeout(checkCredit, 500);
    return () => clearTimeout(timer);
  }, [customerPhone, db, effectiveStoreOwnerId]);

  // Calcular taxa de entrega quando endereço é selecionado do autocomplete
  const calculateDeliveryFee = useCallback(async (customerAddress: string) => {
    console.log('[CartDrawer] calculateDeliveryFee chamado:', { customerAddress, storeAddress: storeAddress?.substring(0, 30), rulesCount: deliveryFeeRules?.length, rules: deliveryFeeRules });
    if (!storeAddress || !deliveryFeeRules || deliveryFeeRules.length === 0) {
      console.warn('[CartDrawer] ABORTANDO cálculo - falta dados:', { storeAddress: !!storeAddress, rules: deliveryFeeRules?.length });
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
  }, [storeAddress, deliveryFeeRules, customAddressRules, maxDeliveryRadius, toast]);

  // Auto-calcular taxa quando AMBOS o endereço salvo E as regras da loja estiverem prontos
  const [autoCalcDone, setAutoCalcDone] = useState(false);
  useEffect(() => {
    if (autoCalcDone) return;
    if (!savedStreet || savedStreet.length < 5) return;
    if (!storeAddress || !deliveryFeeRules || deliveryFeeRules.length === 0) return;
    
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
    if (!selectedAddress) return;

    if (selectedAddress.includes(',')) {
      // O Google Places retorna no formato: "Rua X, Bairro Y, Cidade - Estado, Brasil"
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

      setStreet(newStreet);
      setNeighborhood(newNeighborhood);
      setCity(newCity);

      if (orderType === 'delivery') {
        // Monta o endereço completo para garantir que o Bairro atualizado seja enviado e avaliado na API
        const fullAddr = [newStreet, number, newNeighborhood, newCity, 'Brasil'].filter(Boolean).join(', ');
        setTimeout(() => calculateDeliveryFee(fullAddr), 300);
      }
    } else {
      setStreet(selectedAddress);
      if (orderType === 'delivery') {
        const fullAddr = [selectedAddress, number, neighborhood, city, 'Brasil'].filter(Boolean).join(', ');
        calculateDeliveryFee(fullAddr);
      }
    }
  }, [orderType, number, neighborhood, city, calculateDeliveryFee]);

  const handlePlaceSelected = useCallback(async (placeId: string, description: string) => {
    try {
      const res = await fetch(`/api/place-details?placeId=${placeId}`);
      if (!res.ok) throw new Error('Falha ao buscar detalhes do endereço');
      const data = await res.json();
      
      let newStreet = data.street || description.split(',')[0];
      let newNeighborhood = data.neighborhood || neighborhood;
      let newCity = data.city || city;

      setStreet(newStreet);
      if (data.neighborhood) setNeighborhood(data.neighborhood);
      if (data.city) setCity(data.city);

      if (orderType === 'delivery') {
        const fullAddr = [newStreet, number, newNeighborhood, newCity, 'Brasil'].filter(Boolean).join(', ');
        setTimeout(() => calculateDeliveryFee(fullAddr), 300);
      }
    } catch (err) {
      console.error('[CartDrawer] Erro ao buscar detalhes do place:', err);
      // Fallback para o comportamento padrão sem details
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
    if (orderType === 'delivery' && !street) {
      toast({ variant: "destructive", title: "Endereço obrigatório", description: "Informe o endereço de entrega." });
      return;
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
        const normalizedPhone = customerPhone.replace(/[\s\-\(\)\+]/g, '').replace(/^55(\d{10,11})$/, '$1');
        const qClientes = query(collection(db, 'clientes'), where('ownerId', '==', effectiveStoreOwnerId), where('celular', '==', normalizedPhone));
        const snapClientes = await getDocs(qClientes);
        let clienteRef;
        const clienteData: any = {
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
        
        if (!snapClientes.empty) {
          clienteRef = doc(db, 'clientes', snapClientes.docs[0].id);
        } else {
          clienteRef = doc(collection(db, 'clientes'));
          clienteData.id = clienteRef.id;
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
        const stockByItem: Record<string, number> = {};
        cart.forEach(item => {
          stockByItem[item.id] = (stockByItem[item.id] || 0) + item.quantity;
        });
        for (const [itemId, requestedQty] of Object.entries(stockByItem)) {
          const itemDoc = await getDoc(doc(db, 'menuItems', itemId));
          if (itemDoc.exists()) {
            const currentStock = getManagedStock(itemDoc.data().stockQuantity);
            if (currentStock !== null && requestedQty > currentStock) {
              const itemName = itemDoc.data().name || itemId;
              toast({ variant: "destructive", title: "Estoque insuficiente", description: `"${itemName}" tem apenas ${currentStock} unidade(s) disponível(is).` });
              setIsSubmitting(false);
              return;
            }
          }
        }
      }

      // Validação de Preço Segura (Cruza com menuItems oficial se disponível)
      let safeSubtotal = 0;
      const safeItems = cart.map(item => {
        const officialItem = menuItems.find(mi => mi.id === item.id);
        const basePrice = officialItem ? officialItem.price : item.price;
        
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
        };
      });
      const safeGrandTotal = safeSubtotal + appliedDeliveryFee;

      // Normalizar telefone: remover +55, espaços, traços, parênteses
      const normalizedPhone = customerPhone.replace(/[\s\-\(\)\+]/g, '').replace(/^55(\d{10,11})$/, '$1');

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
      setIsOpen(false);
      setStep('cart');

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
      setIsOpen(open);
      if (!open) { setStep('cart'); setCheckoutStep(1); }
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
                          const menuItem = menuItems.find(m => m.id === item.id);
                          const managedStock = menuItem ? getManagedStock(menuItem.stockQuantity) : null;
                          if (managedStock !== null) {
                            const currentTotal = cart.filter(i => i.id === item.id).reduce((sum, i) => sum + i.quantity, 0);
                            if (currentTotal + 1 > managedStock) {
                              toast({ title: "Estoque insuficiente", description: `Temos apenas ${managedStock} unidades disponíveis no momento.`, variant: "destructive" });
                              return;
                            }
                          }
                        }
                        updateQuantity(item.cartId, item.quantity + 1);
                      }} className="border rounded-md p-1"><Plus className="h-3 w-3" /></button>
                      <Button variant="ghost" size="sm" className="text-destructive ml-auto" onClick={() => removeFromCart(item.cartId)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
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
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() => { setOrderType('delivery'); setDynamicFee(null); setDistanceInfo(null); }}
                        className={`border-2 rounded-lg p-2 text-center font-bold text-xs transition-all ${orderType === 'delivery' ? 'border-primary bg-primary/10 text-primary' : 'border-muted text-muted-foreground'}`}
                      >
                        🛵 Entrega
                      </button>
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
                      <Input id="cust_phone" type="tel" autoComplete="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className="h-9 text-sm" placeholder="(00) 90000-0000" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="cust_birth" className="text-xs font-bold">Nascimento <span className="font-normal opacity-60">(opcional)</span></Label>
                      <Input id="cust_birth" placeholder="DD/MM/AAAA" value={customerBirthDate} onChange={(e) => setCustomerBirthDate(e.target.value)} className="h-9 text-sm" />
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
                          setDistanceInfo(null);
                        }
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
                      disableSearch={!!city && !!neighborhood}
                      placeholder="Digite rua, bairro ou cidade..."
                    />
                    <input type="hidden" autoComplete="street-address" value={street} onChange={() => {}} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="cust_number" className="text-xs font-bold">Número</Label>
                      <Input id="cust_number" autoComplete="address-line2" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="314" className="h-9 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="cust_comp" className="text-xs font-bold">Complemento</Label>
                      <Input id="cust_comp" value={complement} onChange={(e) => setComplement(e.target.value)} placeholder="Apto, Bloco..." className="h-9 text-sm" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="cust_neighborhood" className="text-xs font-bold">Bairro</Label>
                      <Input id="cust_neighborhood" autoComplete="address-level3" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Centro" className="h-9 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="cust_city" className="text-xs font-bold">Cidade</Label>
                      <Input id="cust_city" autoComplete="address-level2" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Sua Cidade - SP" className="h-9 text-sm" />
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
            {orderType === 'delivery' && step !== 'cart' && (
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

