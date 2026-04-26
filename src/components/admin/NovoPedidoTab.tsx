'use client';

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShoppingCart, Plus, Minus, Search, Tag, X, CreditCard, Banknote, QrCode, Wallet } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import { collection, doc, setDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { PrintReceipt } from './PrintReceipt';

interface NovoPedidoTabProps {
  categories: any[];
  items: any[];
  db: any;
  user: any;
  registrarLancamento?: (params: { tipo: 'venda'; titulo: string; valor: number; formaPagamento: string }) => Promise<void>;
  caixaAberto?: boolean;
  storeProfile?: any;
}

const FORMAS_PAGAMENTO = [
  { id: 'dinheiro', label: 'Dinheiro', icon: Banknote },
  { id: 'pix', label: 'Pix', icon: QrCode },
  { id: 'debito', label: 'Débito', icon: CreditCard },
  { id: 'credito', label: 'Crédito', icon: Wallet },
];

export function NovoPedidoTab({ categories, items, db, user, registrarLancamento, caixaAberto, storeProfile }: NovoPedidoTabProps) {
  const { toast } = useToast();
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Carrinho
  const [cart, setCart] = useState<any[]>([]);

  const filteredItems = items?.filter(item => {
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderToPrint, setOrderToPrint] = useState<any>(null);

  const handleCheckout = () => {
    if (cart.length === 0) return;
    setSelectedPayment('');
    setValorRecebido('');
    setPaymentModalOpen(true);
  };

  const handleConfirmCheckout = async () => {
    if (!db || !user || cart.length === 0 || !selectedPayment) return;
    setIsSubmitting(true);

    try {
      const newOrderRef = doc(collection(db, 'orders'));
      const orderData = {
        id: newOrderRef.id,
        ownerId: user.uid,
        customerName: 'Cliente Balcão',
        customerPhone: '',
        deliveryAddress: '',
        orderType: 'pickup',
        items: cart.map(i => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.price,
          addons: i.addons,
          notes: i.notes
        })),
        status: 'delivered',
        totalAmount: cartTotal,
        paymentMethod: selectedPayment === 'dinheiro' && valorRecebido ? `Dinheiro (Troco para R$ ${Number(valorRecebido).toFixed(2)})` : selectedPayment,
        orderDateTime: new Date().toISOString(),
      };

      await setDoc(newOrderRef, orderData);

      // Registrar venda no caixa
      if (registrarLancamento && caixaAberto) {
        await registrarLancamento({
          tipo: 'venda',
          titulo: `PDV #${newOrderRef.id.substring(0, 5)} - Balcão`,
          valor: cartTotal,
          formaPagamento: selectedPayment,
        });
      }

      toast({ title: '✅ Pedido finalizado!', description: `Venda R$ ${cartTotal.toFixed(2)} (${selectedPayment}) registrada.` });
      
      setOrderToPrint(orderData);
      setTimeout(() => {
        window.print();
        setCart([]);
        setPaymentModalOpen(false);
      }, 500);

    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erro', description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

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
        <div className="p-4 border-b text-center font-bold text-slate-800">
          Pedido / Mesa
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-300">
              <ShoppingCart className="h-16 w-16 mb-4" />
              <p className="text-sm font-medium">Adicione um produto para começar</p>
            </div>
          ) : (
            <div className="space-y-3">
              {cart.map((item) => (
                <div key={item.id} className="flex justify-between items-start border-b pb-3">
                  <div className="flex-1">
                    <h4 className="font-bold text-sm text-slate-800">{item.name}</h4>
                    <p className="text-xs text-muted-foreground">R$ {item.price.toFixed(2)}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <Button variant="outline" size="icon" className="h-5 w-5 rounded-full" onClick={() => updateQuantity(item.id, -1)}>
                        <Minus className="h-2 w-2" />
                      </Button>
                      <span className="text-xs font-bold w-4 text-center">{item.quantity}</span>
                      <Button variant="outline" size="icon" className="h-5 w-5 rounded-full" onClick={() => updateQuantity(item.id, 1)}>
                        <Plus className="h-2 w-2" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                     <span className="font-bold text-sm">R$ {(item.price * item.quantity).toFixed(2)}</span>
                     <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400 hover:text-red-500" onClick={() => removeFromCart(item.id)}>
                        <X className="h-4 w-4" />
                     </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {cart.length > 0 && (
          <div className="p-4 bg-slate-50 border-t">
            <div className="flex justify-between items-center mb-4 text-lg">
              <span className="font-bold text-slate-600">Total</span>
              <span className="font-black text-red-500">R$ {cartTotal.toFixed(2)}</span>
            </div>
            <Button className="w-full h-12 bg-green-500 hover:bg-green-600 text-lg font-bold" onClick={handleCheckout}>
              Finalizar Pedido
            </Button>
            {!caixaAberto && <p className="text-xs text-red-400 text-center mt-2">⚠️ Caixa fechado — abra o caixa para registrar vendas</p>}
          </div>
        )}
      </div>

      {/* Modal Forma de Pagamento */}
      <Dialog open={paymentModalOpen} onOpenChange={setPaymentModalOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-lg">💰 Forma de Pagamento</DialogTitle>
            <DialogDescription>Selecione como o cliente vai pagar.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 py-4">
            {FORMAS_PAGAMENTO.map(fp => {
              const Icon = fp.icon;
              return (
                <button
                  key={fp.id}
                  type="button"
                  onClick={() => setSelectedPayment(fp.id)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 font-bold text-sm transition-all ${
                    selectedPayment === fp.id 
                      ? 'border-primary bg-primary/10 text-primary ring-2 ring-primary/30 scale-105' 
                      : 'border-muted text-muted-foreground hover:border-slate-300'
                  }`}
                >
                  <Icon className="h-6 w-6" />
                  {fp.label}
                </button>
              );
            })}
          </div>

          <div className="space-y-3">
            <div className="bg-slate-50 p-3 rounded-lg border text-center">
              <p className="text-sm text-muted-foreground">Total do pedido</p>
              <p className="text-2xl font-black text-primary">R$ {cartTotal.toFixed(2)}</p>
            </div>

            {selectedPayment === 'dinheiro' && (
              <div className="bg-amber-50 p-3 rounded-lg border border-amber-200 space-y-2">
                <label className="text-sm font-medium text-amber-800">💵 Valor recebido em dinheiro (R$)</label>
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
                  className="text-lg font-bold text-center bg-white"
                  autoFocus
                />
                {Number(valorRecebido) > 0 && (
                  <div className={`text-center p-2 rounded-lg font-bold text-lg ${Number(valorRecebido) >= cartTotal ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                    {Number(valorRecebido) >= cartTotal 
                      ? `Troco: R$ ${(Number(valorRecebido) - cartTotal).toFixed(2)}`
                      : `Falta: R$ ${(cartTotal - Number(valorRecebido)).toFixed(2)}`
                    }
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setPaymentModalOpen(false)}>Cancelar</Button>
            <Button 
              disabled={!selectedPayment || isSubmitting} 
              onClick={handleConfirmCheckout}
              className="bg-green-600 hover:bg-green-700"
            >
              {isSubmitting ? 'Finalizando...' : '✅ Confirmar e Imprimir'}
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
