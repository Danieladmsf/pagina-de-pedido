
"use client"

import React, { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useCart } from '@/components/providers/CartProvider';
import { ShoppingCart, Trash2, Minus, Plus, Send, Loader2 } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useFirestore, useUser } from '@/firebase';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';

export function CartDrawer() {
  const { cart, removeFromCart, updateQuantity, totalPrice, totalItems, clearCart } = useCart();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const db = useFirestore();
  const { user } = useUser();

  const handleCheckout = async () => {
    if (!user) {
      toast({ variant: "destructive", title: "Erro", description: "Usuário não identificado." });
      return;
    }

    setIsSubmitting(true);
    try {
      const orderId = Math.random().toString(36).substring(2, 10).toUpperCase();
      const orderRef = doc(collection(db, 'orders'), orderId);

      const orderData = {
        id: orderId,
        customerIdentifier: user.uid,
        customerName: user.isAnonymous ? "Cliente Anônimo" : (user.displayName || "Cliente"),
        orderDateTime: new Date().toISOString(),
        createdAt: serverTimestamp(),
        status: 'pending',
        totalAmount: totalPrice,
        paymentStatus: 'pending',
        orderType: 'delivery',
        items: cart.map(item => ({
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.price,
          customization: item.customization || {}
        }))
      };

      await setDoc(orderRef, orderData);

      toast({
        title: "Pedido Enviado!",
        description: `Seu pedido #${orderId} foi recebido e já está sendo preparado.`
      });
      clearCart();
      setIsOpen(false);
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Erro ao enviar", description: "Não foi possível processar seu pedido agora." });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
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
            Meu Pedido <span className="text-muted-foreground font-normal">({totalItems} {totalItems === 1 ? 'item' : 'itens'})</span>
          </SheetTitle>
        </SheetHeader>

        <Separator />

        {cart.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-4">
            <div className="bg-muted p-6 rounded-full">
              <ShoppingCart className="h-12 w-12 text-muted-foreground opacity-50" />
            </div>
            <h3 className="text-lg font-semibold">Seu carrinho está vazio</h3>
            <p className="text-muted-foreground">Que tal adicionar alguns itens deliciosos?</p>
          </div>
        ) : (
          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="py-4 space-y-6">
              {cart.map((item) => (
                <div key={item.cartId} className="flex flex-col gap-2">
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <h4 className="font-bold">{item.name}</h4>
                      {item.customization?.size && (
                        <p className="text-xs text-muted-foreground">Tamanho: {item.customization.size}</p>
                      )}
                      {item.customization?.extras && item.customization.extras.length > 0 && (
                        <p className="text-xs text-muted-foreground">Extras: {item.customization.extras.join(', ')}</p>
                      )}
                    </div>
                    <span className="font-semibold text-primary">R$ {(item.price * item.quantity).toFixed(2)}</span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 bg-white border rounded-md px-2 py-1 shadow-sm">
                      <button onClick={() => updateQuantity(item.cartId, item.quantity - 1)} className="text-primary hover:text-accent p-1">
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="text-sm font-bold min-w-[15px] text-center">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.cartId, item.quantity + 1)} className="text-primary hover:text-accent p-1">
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <Button variant="ghost" size="sm" className="text-destructive h-8 px-2 hover:bg-destructive/5" onClick={() => removeFromCart(item.cartId)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {cart.length > 0 && (
          <div className="pt-6 border-t space-y-4">
            <div className="flex justify-between items-center text-lg">
              <span className="font-medium">Total</span>
              <span className="font-bold text-2xl text-primary">R$ {totalPrice.toFixed(2)}</span>
            </div>
            <Button 
              className="w-full h-14 bg-accent hover:bg-accent/90 text-accent-foreground font-bold text-lg rounded-xl flex gap-2 items-center"
              onClick={handleCheckout}
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              {isSubmitting ? 'Enviando...' : 'Finalizar e Enviar Pedido'}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
