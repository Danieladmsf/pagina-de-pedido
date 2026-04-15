
"use client"

import React, { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useCart } from '@/components/providers/CartProvider';
import { ShoppingCart, Trash2, Minus, Plus, Send, Loader2, User, MapPin, Phone, Mail } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useFirestore, useUser } from '@/firebase';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CartDrawerProps {
  storeOwnerId?: string | null;
}

export function CartDrawer({ storeOwnerId }: CartDrawerProps) {
  const { cart, removeFromCart, updateQuantity, totalPrice, totalItems, clearCart } = useCart();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCheckoutForm, setShowCheckoutForm] = useState(false);
  
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');

  const db = useFirestore();
  const { user } = useUser();

  const handleCheckout = async () => {
    if (!user) {
      toast({ variant: "destructive", title: "Erro", description: "Iniciando sessão anônima..." });
      return;
    }

    if (!customerName || !customerPhone || !deliveryAddress) {
      toast({ variant: "destructive", title: "Campos obrigatórios", description: "Por favor, preencha nome, telefone e endereço." });
      return;
    }

    if (!storeOwnerId) {
      toast({ variant: "destructive", title: "Link da loja inválido", description: "Acesse pelo link de compartilhamento da loja para fazer pedidos." });
      return;
    }

    setIsSubmitting(true);
    try {
      const orderId = Math.random().toString(36).substring(2, 10).toUpperCase();
      const orderRef = doc(collection(db, 'orders'), orderId);

      const orderData = {
        id: orderId,
        customerIdentifier: user.uid,
        ownerId: storeOwnerId, // Vincula o pedido ao dono da loja
        customerName,
        customerPhone,
        customerEmail,
        deliveryAddress,
        orderDateTime: new Date().toISOString(),
        createdAt: serverTimestamp(),
        status: 'pending',
        totalAmount: totalPrice,
        paymentStatus: 'pending',
        orderType: 'delivery',
        items: cart.map(item => {
          const addons = item.customization?.addons || [];
          const addonsTotal = addons.reduce((a, b) => a + b.price, 0);
          return {
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.price + addonsTotal,
            addons: addons.map(a => ({ name: a.name, price: a.price })),
            notes: item.customization?.notes || '',
          };
        })
      };

      await setDoc(orderRef, orderData);

      toast({
        title: "Pedido Enviado!",
        description: `Seu pedido #${orderId} foi recebido.`
      });
      
      clearCart();
      setIsOpen(false);
      setShowCheckoutForm(false);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerEmail('');
      setDeliveryAddress('');
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Erro ao enviar", description: "Erro ao processar o pedido." });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => {
      setIsOpen(open);
      if (!open) setShowCheckoutForm(false);
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
            {showCheckoutForm ? 'Dados de Entrega' : 'Meu Pedido'} 
            {!showCheckoutForm && <span className="text-muted-foreground font-normal">({totalItems})</span>}
          </SheetTitle>
        </SheetHeader>

        <Separator />

        {cart.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-4">
            <ShoppingCart className="h-12 w-12 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-semibold">Seu carrinho está vazio</h3>
          </div>
        ) : !showCheckoutForm ? (
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
                <Label htmlFor="cust_name">Nome Completo</Label>
                <Input id="cust_name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cust_phone">Telefone / WhatsApp</Label>
                <Input id="cust_phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cust_addr">Endereço de Entrega</Label>
                <Input id="cust_addr" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} />
              </div>
            </div>
          </ScrollArea>
        )}

        {cart.length > 0 && (
          <div className="pt-6 border-t space-y-4">
            <div className="flex justify-between items-center text-lg">
              <span className="font-medium">Total</span>
              <span className="font-bold text-2xl text-primary">R$ {totalPrice.toFixed(2)}</span>
            </div>
            
            {!showCheckoutForm ? (
              <Button className="w-full h-14 bg-primary text-white font-bold" onClick={() => setShowCheckoutForm(true)}>
                Continuar para Entrega
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-14" onClick={() => setShowCheckoutForm(false)}>Voltar</Button>
                <Button className="flex-[2] h-14 bg-accent text-white font-bold" onClick={handleCheckout} disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Finalizar Pedido'}
                </Button>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
