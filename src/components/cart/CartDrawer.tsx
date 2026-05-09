
"use client"

import React, { useState, useEffect, useCallback } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useCart } from '@/components/providers/CartProvider';
import { ShoppingCart, Trash2, Minus, Plus, Loader2, MapPin, Clock, Navigation } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useFirestore, useUser } from '@/firebase';
import { collection, doc, setDoc, getDoc, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AddressAutocomplete } from '@/components/ui/address-autocomplete';

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
  freeDeliveryOver?: number; // Frete grátis acima de
  paymentMethods?: PaymentMethodConfig[]; // Formas de pagamento configuradas pela loja
  isStoreOpen?: boolean;
  menuItems?: any[];
}

const DEFAULT_PAYMENT_METHODS: PaymentMethodConfig[] = [
  { id: 'dinheiro', label: 'Dinheiro', icon: '💵', active: true },
  { id: 'pix', label: 'Pix', icon: '📱', active: true },
  { id: 'debito', label: 'Débito', icon: '💳', active: true },
  { id: 'credito', label: 'Crédito', icon: '💳', active: true },
];

type Step = 'cart' | 'info';

export function CartDrawer({ storeOwnerId, deliveryFee = 0, storeAddress, deliveryFeeRules, maxDeliveryRadius = 0, freeDeliveryOver = 0, paymentMethods, isStoreOpen = true, menuItems = [] }: CartDrawerProps) {
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
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerBirthDate, setCustomerBirthDate] = useState('');
  const [orderType, setOrderType] = useState<'delivery' | 'pickup' | 'dine_in'>('delivery');
  
  // Pagamento
  const [paymentMethod, setPaymentMethod] = useState('');
  const [cashChange, setCashChange] = useState('');

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

  const isFreeDelivery = freeDeliveryOver > 0 && totalPrice >= freeDeliveryOver;
  const appliedDeliveryFee = orderType === 'delivery' && !isFreeDelivery ? (dynamicFee !== null ? dynamicFee : deliveryFee) : 0;
  const grandTotal = totalPrice + appliedDeliveryFee;
  
  // 🔍 DEBUG: Estado da taxa
  console.log('[CartDrawer] Taxa:', { orderType, dynamicFee, deliveryFee, appliedDeliveryFee, isFreeDelivery, grandTotal });

  const db = useFirestore();
  const { user } = useUser();

  const [profileLoaded, setProfileLoaded] = useState(false);
  const [savedStreet, setSavedStreet] = useState('');
  const [savedNumber, setSavedNumber] = useState('');
  useEffect(() => {
    if (!db || !user) { setProfileLoaded(false); return; }
    if (profileLoaded) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'customers', user.uid));
        if (snap.exists()) {
          const d = snap.data();
          setCustomerName(d.name || '');
          setCustomerPhone(d.phone || '');
          if (d.birthDate) setCustomerBirthDate(d.birthDate);
          // Carregar endereço salvo
          if (d.cep) setCep(d.cep);
          if (d.street) { setStreet(d.street); setSavedStreet(d.street); }
          if (d.number) { setNumber(d.number); setSavedNumber(d.number); }
          if (d.neighborhood) setNeighborhood(d.neighborhood);
          if (d.complement) setComplement(d.complement);
          if (d.city) setCity(d.city);
        }
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
        
        // Verificar se QUALQUER documento tem creditEnabled
        if (!snap.empty) {
          const hasCredit = snap.docs.some(d => d.data().creditEnabled === true);
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
            const hasCredit = snap2.docs.some(d => d.data().creditEnabled === true);
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
            const hasCredit = snap3.docs.some(d => d.data().creditEnabled === true);
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
        console.error('Erro no cálculo da taxa:', data.error);
        toast({ variant: 'destructive', title: 'Erro na taxa', description: data.error || 'Não foi possível calcular.' });
        setDynamicFee(null);
        setDistanceInfo(null);
        setDeliveryBlocked(false);
      }
    } catch (err) {
      console.error('Erro ao calcular taxa:', err);
    } finally {
      setCalculatingFee(false);
    }
  }, [storeAddress, deliveryFeeRules, maxDeliveryRadius, toast]);

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
    if (orderType === 'delivery' && selectedAddress) {
      if (selectedAddress.includes(',')) {
        calculateDeliveryFee(selectedAddress);
      } else {
        const fullAddr = [selectedAddress, number, neighborhood, city, 'Brasil'].filter(Boolean).join(', ');
        calculateDeliveryFee(fullAddr);
      }
    }
  }, [orderType, number, neighborhood, city, calculateDeliveryFee]);

  // Efeito para calcular taxa automaticamente quando o preenchimento automático (autofill) dispara
  // Detectamos se cidade E rua foram preenchidos (sinal clássico de autofill)
  useEffect(() => {
    if (orderType !== 'delivery') return;
    if (street && street.length > 3 && city && city.length > 3) {
      const timeout = setTimeout(() => {
        if (dynamicFee === null && !calculatingFee) {
          const fullAddr = [street, number, neighborhood, city, 'Brasil'].filter(Boolean).join(', ');
          calculateDeliveryFee(fullAddr);
        }
      }, 1000); // 1 segundo de espera após o preenchimento para acionar
      return () => clearTimeout(timeout);
    }
  }, [street, city, neighborhood, number, orderType, dynamicFee, calculatingFee, calculateDeliveryFee]);

  const fullDeliveryAddress = [street, number, complement, neighborhood, city, cep].filter(Boolean).join(', ');

  const goToCheckout = () => {
    if (!effectiveStoreOwnerId) {
      toast({ variant: "destructive", title: "Link da loja inválido", description: "Acesse pelo link de compartilhamento da loja." });
      return;
    }
    setStep('info');
  };



  const handleCheckout = async () => {
    if (!user || !db) {
      toast({ variant: "destructive", title: "Erro", description: "Usuário não autenticado." });
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
      // Salva/atualiza perfil do cliente
      await setDoc(doc(db, 'customers', user.uid), {
        uid: user.uid,
        name: customerName,
        phone: customerPhone,
        birthDate: customerBirthDate,
        address: fullDeliveryAddress,
        cep, street, number, neighborhood, complement, city,
        updatedAt: new Date().toISOString(),
      }, { merge: true });

      const orderId = Math.random().toString(36).substring(2, 10).toUpperCase();
      const orderRef = doc(collection(db, 'orders'), orderId);

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
          name: officialItem ? officialItem.name : item.name,
          quantity: item.quantity,
          unitPrice: safeUnitPrice,
          addons: addons.map(a => ({ name: a.name, price: a.price })),
          notes: item.customization?.notes || '',
        };
      });
      const safeGrandTotal = safeSubtotal + appliedDeliveryFee;

      const orderData = {
        id: orderId,
        customerIdentifier: customerPhone,
        ownerId: effectiveStoreOwnerId,
        customerName,
        customerPhone,
        customerBirthDate,
        customerEmail: user.email || '',
        deliveryAddress: orderType === 'delivery' ? fullDeliveryAddress : '',
        orderDateTime: new Date().toISOString(),
        createdAt: serverTimestamp(),
        status: 'pending',
        totalAmount: safeGrandTotal,
        subtotal: safeSubtotal,
        deliveryFee: appliedDeliveryFee,
        distanceKm: distanceInfo?.distanceKm || null,
        paymentStatus: 'pending',
        paymentMethod: paymentMethod === 'dinheiro' && cashChange ? `Dinheiro (Troco para R$ ${Number(cashChange).toFixed(2)})` : paymentMethod,
        orderType,
        items: safeItems
      };

      await setDoc(orderRef, orderData);

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

  const headerTitle = step === 'cart' ? 'Meu Pedido' : 'Dados de Entrega';

  return (
    <Sheet open={isOpen} onOpenChange={(open) => {
      setIsOpen(open);
      if (!open) setStep('cart');
    }}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="relative bg-white border-primary/20 text-primary hover:bg-primary/5 rounded-full h-12 w-12 shadow-md">
          <ShoppingCart className="h-6 w-6" />
          {totalItems > 0 && (
            <Badge className="absolute -top-2 -right-2 bg-accent text-accent-foreground rounded-full w-6 h-6 flex items-center justify-center p-0 border-2 border-white">
              {totalItems}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md flex flex-col h-full bg-[#FAFAF7]">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-xl font-bold flex items-center gap-2">
            {headerTitle}
            {step === 'cart' && <span className="text-muted-foreground font-normal">({totalItems})</span>}
          </SheetTitle>
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
                      <button onClick={() => updateQuantity(item.cartId, item.quantity + 1)} className="border rounded-md p-1"><Plus className="h-3 w-3" /></button>
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
          <ScrollArea className="flex-1 -mx-6 px-6 py-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Como você quer receber?</Label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => { 
                      setOrderType('delivery'); 
                      setDynamicFee(null); 
                      setDistanceInfo(null); 
                      setTimeout(() => document.getElementById('cust_name')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
                    }}
                    className={`border-2 rounded-xl p-3 text-center font-bold text-sm transition-all ${orderType === 'delivery' ? 'border-primary bg-primary/10 text-primary' : 'border-muted text-muted-foreground'}`}
                  >
                    🛵 Entrega
                  </button>
                  <button
                    type="button"
                    onClick={() => { 
                      setOrderType('pickup'); 
                      setDynamicFee(null); 
                      setDistanceInfo(null); 
                      setTimeout(() => document.getElementById('cust_name')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
                    }}
                    className={`border-2 rounded-xl p-3 text-center font-bold text-sm transition-all ${orderType === 'pickup' ? 'border-primary bg-primary/10 text-primary' : 'border-muted text-muted-foreground'}`}
                  >
                    🏪 Retirar
                  </button>
                  <button
                    type="button"
                    onClick={() => { 
                      setOrderType('dine_in'); 
                      setDynamicFee(null); 
                      setDistanceInfo(null); 
                      setTimeout(() => document.getElementById('cust_name')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
                    }}
                    className={`border-2 rounded-xl p-3 text-center font-bold text-sm transition-all ${orderType === 'dine_in' ? 'border-primary bg-primary/10 text-primary' : 'border-muted text-muted-foreground'}`}
                  >
                    🍽️ Local
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cust_name">Nome Completo</Label>
                <Input id="cust_name" autoComplete="name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="cust_phone">Telefone / WhatsApp</Label>
                  <Input id="cust_phone" type="tel" autoComplete="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cust_birth">Data de Nasc. (Opcional)</Label>
                  <Input id="cust_birth" placeholder="DD/MM/AAAA" value={customerBirthDate} onChange={(e) => setCustomerBirthDate(e.target.value)} />
                </div>
              </div>
              {orderType === 'delivery' && (
                <>
                  <div className="space-y-2">
                    <Label>Endereço de Entrega</Label>
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
                    {/* Hack para o navegador reconhecer o campo como rua no autofill */}
                    <input type="hidden" autoComplete="street-address" value={street} onChange={() => {}} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label htmlFor="cust_number">Número</Label>
                      <Input id="cust_number" autoComplete="address-line2" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="314" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cust_comp">Complemento</Label>
                      <Input id="cust_comp" value={complement} onChange={(e) => setComplement(e.target.value)} placeholder="Apto, Bloco..." />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label htmlFor="cust_neighborhood">Bairro</Label>
                      <Input id="cust_neighborhood" autoComplete="address-level3" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Centro" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cust_city">Cidade</Label>
                      <Input id="cust_city" autoComplete="address-level2" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Sua Cidade - SP" />
                    </div>
                  </div>
                  
                  {/* Informações de distância e taxa */}
                  {calculatingFee && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground bg-blue-50 p-3 rounded-xl border border-blue-100 animate-pulse">
                      <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                      <span>Calculando taxa de entrega...</span>
                    </div>
                  )}
                  {distanceInfo && !calculatingFee && (
                    <div className="bg-green-50 p-3 rounded-xl border border-green-200 space-y-1.5">
                      <div className="flex items-center gap-2 text-sm font-medium text-green-700">
                        <Navigation className="h-4 w-4" />
                        <span>Distância: {distanceInfo.distanceText}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-green-600">
                        <Clock className="h-4 w-4" />
                        <span>Tempo estimado: {distanceInfo.durationText}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm font-bold text-green-800">
                        <MapPin className="h-4 w-4" />
                        <span>Taxa de entrega: R$ {dynamicFee?.toFixed(2)}</span>
                      </div>
                      
                      {distanceInfo.originAddress && distanceInfo.destinationAddress && (
                        <div className="mt-2 pt-2 border-t border-green-200/50 space-y-1">
                          <p className="text-[10px] text-green-700/80 leading-tight">
                            <strong>De:</strong> {distanceInfo.originAddress}
                          </p>
                          <p className="text-[10px] text-green-700/80 leading-tight">
                            <strong>Para:</strong> {distanceInfo.destinationAddress}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Forma de Pagamento */}
              <div className="space-y-3 pt-4 border-t mt-4">
                <Label>Como você vai pagar?</Label>
                <div className="grid grid-cols-2 gap-2">
                  {activePaymentMethods.map(method => (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => { 
                        setPaymentMethod(method.id); 
                        setCashChange(''); 
                        if (method.id === 'dinheiro') {
                          setTimeout(() => {
                            const el = document.getElementById('troco-input');
                            if (el) {
                              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              el.focus();
                            }
                          }, 150);
                        } else {
                          setTimeout(() => {
                            document.getElementById('btn-finalizar')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }, 150);
                        }
                      }}
                      className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${paymentMethod === method.id ? 'border-primary bg-primary/10 text-primary scale-105' : 'border-muted text-muted-foreground'}`}
                    >
                      <span className="text-xl mb-1">{method.icon}</span>
                      <span className="font-bold text-sm">{method.label}</span>
                    </button>
                  ))}
                </div>

                {paymentMethod === 'dinheiro' && (
                  <div className="bg-amber-50 p-3 rounded-xl border border-amber-200 mt-2 space-y-2">
                    <Label htmlFor="troco-input" className="text-amber-800">Precisa de troco para quanto?</Label>
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
                      className="bg-white border-amber-300 text-lg font-bold"
                    />
                    {Number(cashChange) > 0 && (
                      <div className={`text-sm font-bold mt-1 ${Number(cashChange) >= grandTotal ? 'text-green-600' : 'text-red-500'}`}>
                        {Number(cashChange) >= grandTotal 
                          ? `Seu troco será: R$ ${(Number(cashChange) - grandTotal).toFixed(2)}` 
                          : `Falta R$ ${(grandTotal - Number(cashChange)).toFixed(2)} para completar o pedido`}
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>
          </ScrollArea>
        )}

        {cart.length > 0 && (
          <div className="pt-6 border-t space-y-4">
            {orderType === 'delivery' && step !== 'cart' && (
              <div className="space-y-1 text-sm">
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
            <div className="flex justify-between items-center text-lg">
              <span className="font-medium">Total</span>
              <span className="font-bold text-2xl text-primary">R$ {grandTotal.toFixed(2)}</span>
            </div>

            {step === 'cart' ? (
              <Button className="w-full h-14 bg-primary text-white font-bold" onClick={goToCheckout}>
                Continuar
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                {deliveryBlocked && orderType === 'delivery' && (
                  <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium border border-red-200 text-center mb-2">
                    Desculpe, este endereço está fora da nossa área de entrega (máx. {maxDeliveryRadius}km).
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 h-14" onClick={() => setStep('cart')}>Voltar</Button>
                  <Button 
                    id="btn-finalizar"
                    className="flex-[2] h-14 bg-accent text-white font-bold" 
                    onClick={handleCheckout} 
                    disabled={isSubmitting || calculatingFee || (orderType === 'delivery' && deliveryBlocked)}
                  >
                    {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Finalizar Pedido'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

