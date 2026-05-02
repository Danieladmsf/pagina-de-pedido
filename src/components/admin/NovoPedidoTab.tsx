'use client';

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShoppingCart, Plus, Minus, Search, Tag, X, CreditCard, Banknote, QrCode, Wallet, Calculator } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import { collection, doc, setDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { PrintReceipt } from './PrintReceipt';
import { AddressAutocomplete } from '@/components/ui/address-autocomplete';
import { useCallback } from 'react';

interface NovoPedidoTabProps {
  categories: any[];
  items: any[];
  db: any;
  user: any;
  registrarLancamento?: (params: { tipo: 'venda'; titulo: string; valor: number; formaPagamento: string }) => Promise<void>;
  caixaAberto?: boolean;
  storeProfile?: any;
  onOpenCaixa?: () => void;
}

const DEFAULT_FORMAS_PAGAMENTO = [
  { id: 'dinheiro', label: 'Dinheiro', icon: '💵', active: true },
  { id: 'pix', label: 'Pix', icon: '📱', active: true },
  { id: 'debito', label: 'Débito', icon: '💳', active: true },
  { id: 'credito', label: 'Crédito', icon: '💳', active: true },
];

export function NovoPedidoTab({ categories, items, db, user, registrarLancamento,
  caixaAberto = false,
  storeProfile,
  onOpenCaixa
}: NovoPedidoTabProps) {
  const FORMAS_PAGAMENTO = (storeProfile?.paymentMethods && storeProfile.paymentMethods.length > 0 ? storeProfile.paymentMethods : DEFAULT_FORMAS_PAGAMENTO).filter((m: any) => m.active);
  const { toast } = useToast();
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Carrinho
  const [cart, setCart] = useState<any[]>([]);

  const filteredItems = items?.filter(item => {
    if (item.isAvailable === false) return false;
    const matchesCat = activeCategory === 'all' || item.categoryId === activeCategory;
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const addToCart = (item: any) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === item.id);
      if (existing) {
        return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { ...item, quantity: 1, addons: [], notes: '' }];
    });
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => {
      return prev.map(i => {
        if (i.id === id) {
          const newQ = i.quantity + delta;
          return newQ > 0 ? { ...i, quantity: newQ } : i;
        }
        return i;
      });
    });
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(i => i.id !== id));
  };

  const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState('');
  const [valorRecebido, setValorRecebido] = useState<string>('');
  const [deliveryFeeInput, setDeliveryFeeInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderToPrint, setOrderToPrint] = useState<any>(null);

  // Estados para entrega
  const [orderType, setOrderType] = useState<'pickup' | 'delivery'>('pickup');
  const [customerName, setCustomerName] = useState('Cliente Balcão');
  const [customerPhone, setCustomerPhone] = useState('');
  
  // Endereço e cálculo de frete
  const storeAddress = storeProfile?.general?.address || '';
  const deliveryFeeRules = storeProfile?.feeRules || storeProfile?.fees?.feeRules || [];
  const maxDeliveryRadius = storeProfile?.fees?.maxDeliveryRadius || 0;
  
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

  const handleAddressSelected = (addr: string) => {
    setAddressObj(prev => ({ ...prev, street: addr }));
    const fullAddr = addressObj.number ? `${addr}, ${addressObj.number}` : addr;
    calculateDeliveryFee(fullAddr);
  };

  const finalTotal = cartTotal + (Number(deliveryFeeInput) || 0);

  const handleCheckout = () => {
    if (cart.length === 0) return;
    setSelectedPayment('');
    setValorRecebido('');
    setPaymentModalOpen(true);
  };

  const handleConfirmCheckout = async () => {
    if (!db || !user || cart.length === 0 || !selectedPayment) return;
    
    if (!caixaAberto) {
      toast({ variant: 'destructive', title: 'Caixa Fechado', description: 'Você não pode finalizar vendas com o caixa fechado. Abra o caixa primeiro.' });
      return;
    }

    setIsSubmitting(true);

    try {
      const newOrderRef = doc(collection(db, 'orders'));
      const fullDeliveryAddress = orderType === 'delivery' ? [addressObj.street, addressObj.number, addressObj.neighborhood, addressObj.city].filter(Boolean).join(', ') : '';

      const orderData = {
        id: newOrderRef.id,
        ownerId: user.uid,
        customerName: customerName || 'Cliente Balcão',
        customerPhone: customerPhone || '',
        deliveryAddress: fullDeliveryAddress,
        orderType: orderType,
        items: cart.map(i => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.price,
          addons: i.addons,
          notes: i.notes
        })),
        status: 'delivered',
        subtotal: cartTotal,
        deliveryFee: Number(deliveryFeeInput) || 0,
        distanceKm: distanceInfo?.distanceKm || null,
        totalAmount: finalTotal,
        paymentMethod: selectedPayment === 'dinheiro' && valorRecebido ? `Dinheiro (Troco para R$ ${Number(valorRecebido).toFixed(2)})` : selectedPayment,
        orderDateTime: new Date().toISOString(),
      };

      await setDoc(newOrderRef, orderData);

      // Registrar venda no caixa
      await registrarLancamento({
        tipo: 'venda',
        titulo: `PDV #${newOrderRef.id.substring(0, 5)} - Balcão`,
        valor: finalTotal,
        formaPagamento: selectedPayment,
      });

      toast({ title: '✅ Pedido finalizado!', description: `Venda R$ ${finalTotal.toFixed(2)} (${selectedPayment}) registrada.` });
      
      setOrderToPrint(orderData);
      setTimeout(() => {
        window.print();
        setCart([]);
        setCustomerName('');
        setCustomerPhone('');
        setDeliveryFeeInput('');
        setAddressObj({ street: '', number: '', neighborhood: '', city: '' });
        setDynamicFee(null);
        setDistanceInfo(null);
        setPaymentModalOpen(false);
      }, 500);

    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erro', description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!caixaAberto) {
    return (
      <div className="flex justify-center">
        <div className="bg-white border rounded-2xl py-6 px-6 text-center space-y-3 max-w-sm w-full shadow-sm">
          <Calculator className="h-12 w-12 text-muted-foreground/30 mx-auto" />
          <h2 className="text-lg font-bold text-slate-700 uppercase tracking-wider">Caixa Fechado</h2>
          <div className="bg-slate-50 border rounded-xl p-3 text-xs text-muted-foreground space-y-0.5">
            <p>A operação de caixa de um pedido é lançada apenas quando ele é finalizado.</p>
            <p>O caixa precisa estar aberto para registrar vendas no balcão.</p>
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
    <div className="flex flex-col md:flex-row gap-4 h-[calc(100vh-140px)] overflow-hidden">
      {/* Coluna Esquerda: Produtos e Filtros */}
      <div className="w-full md:w-2/3 flex flex-col h-full overflow-hidden bg-white rounded-xl shadow-sm border p-4">
        
        <div className="flex items-center gap-2 mb-4 overflow-x-auto custom-scrollbar pb-2">
          <div className="relative min-w-[200px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Buscar" 
              className="pl-9 h-10 bg-slate-50"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <Badge 
            variant={activeCategory === 'all' ? 'default' : 'outline'}
            className="cursor-pointer h-8 px-4 flex-shrink-0"
            onClick={() => setActiveCategory('all')}
          >
            Todos
          </Badge>
          {categories?.map(cat => (
            <Badge 
              key={cat.id}
              variant={activeCategory === cat.id ? 'default' : 'outline'}
              className="cursor-pointer h-8 px-4 flex-shrink-0"
              onClick={() => setActiveCategory(cat.id)}
            >
              {cat.name}
            </Badge>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pr-2 pb-4">
            {filteredItems?.map(item => {
              const inCart = cart.find(i => i.id === item.id);
              return (
                <Card key={item.id} className="overflow-hidden hover:shadow-md transition-all cursor-pointer flex flex-col group border-slate-200">
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
                  
                  {inCart ? (
                    <div className="border-t bg-slate-50 p-2 flex justify-between items-center px-4">
                       <Button variant="outline" size="icon" className="h-6 w-6 rounded-full" onClick={(e) => { e.stopPropagation(); updateQuantity(item.id, -1); }}>
                         <Minus className="h-3 w-3" />
                       </Button>
                       <span className="font-bold text-sm">{inCart.quantity}</span>
                       <Button variant="default" size="icon" className="h-6 w-6 rounded-full" onClick={(e) => { e.stopPropagation(); updateQuantity(item.id, 1); }}>
                         <Plus className="h-3 w-3" />
                       </Button>
                    </div>
                  ) : (
                    <div className="border-t p-2">
                      <Button variant="ghost" size="sm" className="w-full h-8 text-xs font-bold text-slate-500 group-hover:bg-primary group-hover:text-white transition-colors" onClick={() => addToCart(item)}>
                         <ShoppingCart className="h-3 w-3 mr-2" /> Adicionar
                      </Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
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
          <div className="space-y-2 bg-white p-2 rounded border border-slate-100 shadow-sm">
            <div className="flex bg-slate-100 p-0.5 rounded">
              <button 
                onClick={() => {
                  setOrderType('pickup');
                  setDeliveryFeeInput('');
                  setDynamicFee(null);
                  setDistanceInfo(null);
                }}
                className={`flex-1 text-[10px] font-bold py-1 rounded transition-colors ${orderType === 'pickup' ? 'bg-white shadow-sm text-primary' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Balcão / Retirada
              </button>
              <button 
                onClick={() => {
                  setOrderType('delivery');
                  if (addressObj.street) {
                    const addr = addressObj.number ? `${addressObj.street}, ${addressObj.number}` : addressObj.street;
                    calculateDeliveryFee(addr);
                  }
                }}
                className={`flex-1 text-[10px] font-bold py-1 rounded transition-colors ${orderType === 'delivery' ? 'bg-white shadow-sm text-primary' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Delivery
              </button>
            </div>
            
            <div className="space-y-1.5">
              <Input placeholder="Nome do Cliente" value={customerName} onChange={e => setCustomerName(e.target.value)} className="h-7 text-xs" />
              <Input placeholder="Telefone / WhatsApp" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} className="h-7 text-xs" />
              
              {orderType === 'delivery' && (
                <div className="pt-1.5 border-t space-y-1.5 mt-1.5">
                  <AddressAutocomplete
                    value={addressObj.street}
                    onChange={(val) => setAddressObj(prev => ({...prev, street: val}))}
                    onSelect={handleAddressSelected}
                    placeholder="Buscar endereço no Maps..."
                  />
                  <div className="flex gap-1.5">
                    <Input placeholder="Número" value={addressObj.number} onChange={e => {
                      setAddressObj(prev => ({...prev, number: e.target.value}));
                    }} onBlur={() => {
                      if (addressObj.street) calculateDeliveryFee(`${addressObj.street}, ${addressObj.number}`);
                    }} className="h-7 text-xs w-1/3" />
                    <Input placeholder="Bairro" value={addressObj.neighborhood} onChange={e => setAddressObj(prev => ({...prev, neighborhood: e.target.value}))} className="h-7 text-xs flex-1" />
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
                <div key={item.id} className="flex justify-between items-start border-b pb-2">
                  <div className="flex-1">
                    <h4 className="font-semibold text-xs text-slate-800">{item.name}</h4>
                    <p className="text-[10px] text-muted-foreground">R$ {item.price.toFixed(2)}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <Button variant="outline" size="icon" className="h-4 w-4 rounded-full" onClick={() => updateQuantity(item.id, -1)}>
                        <Minus className="h-2 w-2" />
                      </Button>
                      <span className="text-[10px] font-bold w-3 text-center">{item.quantity}</span>
                      <Button variant="outline" size="icon" className="h-4 w-4 rounded-full" onClick={() => updateQuantity(item.id, 1)}>
                        <Plus className="h-2 w-2" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                     <span className="font-semibold text-xs">R$ {(item.price * item.quantity).toFixed(2)}</span>
                     <Button variant="ghost" size="icon" className="h-5 w-5 text-red-400 hover:text-red-500" onClick={() => removeFromCart(item.id)}>
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
          <DialogHeader className="pb-1">
            <DialogTitle className="text-sm flex items-center justify-between">
              <span>💰 Pagamento Balcão</span>
              <span className="text-lg font-black text-primary">R$ {finalTotal.toFixed(2)}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">Selecione como o cliente vai pagar.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-4 gap-2 py-2">
            {FORMAS_PAGAMENTO.map((fp: any) => (
              <button
                key={fp.id}
                type="button"
                onClick={() => setSelectedPayment(fp.id)}
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

          <DialogFooter className="pt-1 gap-2">
            <Button variant="outline" size="sm" onClick={() => setPaymentModalOpen(false)}>Cancelar</Button>
            <Button 
              size="sm"
              disabled={!selectedPayment || isSubmitting} 
              onClick={handleConfirmCheckout}
              className="bg-green-600 hover:bg-green-700"
            >
              {isSubmitting ? '...' : '✅ Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {orderToPrint && (
        <PrintReceipt order={orderToPrint} storeInfo={storeProfile} />
      )}
    </div>
  );
}
