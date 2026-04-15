
"use client"

import React, { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useCart } from '@/components/providers/CartProvider';
import { ShoppingCart, Trash2, Minus, Plus, Loader2 } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useFirestore, useUser, useAuth } from '@/firebase';
import { collection, doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CartDrawerProps {
  storeOwnerId?: string | null;
}

type Step = 'cart' | 'auth' | 'info';

export function CartDrawer({ storeOwnerId }: CartDrawerProps) {
  const { cart, removeFromCart, updateQuantity, totalPrice, totalItems, clearCart } = useCart();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState<Step>('cart');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');

  const db = useFirestore();
  const auth = useAuth();
  const { user } = useUser();

  const isRealUser = !!(user && !user.isAnonymous && user.email);

  // Quando abre o drawer, se já estiver logado, carrega o perfil salvo
  useEffect(() => {
    if (!isOpen || !isRealUser || !db || !user) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'customers', user.uid));
        if (snap.exists()) {
          const d = snap.data();
          setCustomerName(d.name || '');
          setCustomerPhone(d.phone || '');
          setDeliveryAddress(d.address || '');
        }
        setEmail(user.email || '');
      } catch (e) {
        console.warn('load customer profile failed', e);
      }
    })();
  }, [isOpen, isRealUser, db, user]);

  const goToCheckout = () => {
    if (!storeOwnerId) {
      toast({ variant: "destructive", title: "Link da loja inválido", description: "Acesse pelo link de compartilhamento da loja." });
      return;
    }
    setStep(isRealUser ? 'info' : 'auth');
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) return;
    if (!email || !password || password.length < 6) {
      toast({ variant: "destructive", title: "Dados inválidos", description: "Email e senha (6+ caracteres)." });
      return;
    }
    setIsSubmitting(true);
    try {
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (err: any) {
        if (err?.code === 'auth/user-not-found' || err?.code === 'auth/invalid-credential') {
          await createUserWithEmailAndPassword(auth, email, password);
        } else {
          throw err;
        }
      }
      toast({ title: "Bem-vindo!", description: "Agora informe seus dados de entrega." });
      setStep('info');
    } catch (err: any) {
      console.error(err);
      toast({ variant: "destructive", title: "Erro no login", description: err?.message || "Falha na autenticação." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCheckout = async () => {
    if (!user || !db) {
      toast({ variant: "destructive", title: "Erro", description: "Usuário não autenticado." });
      return;
    }
    if (!customerName || !customerPhone || !deliveryAddress) {
      toast({ variant: "destructive", title: "Campos obrigatórios", description: "Preencha nome, telefone e endereço." });
      return;
    }
    if (!storeOwnerId) {
      toast({ variant: "destructive", title: "Link da loja inválido", description: "Acesse pelo link de compartilhamento da loja." });
      return;
    }

    setIsSubmitting(true);
    try {
      // Salva/atualiza perfil do cliente
      await setDoc(doc(db, 'customers', user.uid), {
        uid: user.uid,
        email: user.email || '',
        name: customerName,
        phone: customerPhone,
        address: deliveryAddress,
        updatedAt: new Date().toISOString(),
      }, { merge: true });

      const orderId = Math.random().toString(36).substring(2, 10).toUpperCase();
      const orderRef = doc(collection(db, 'orders'), orderId);

      const orderData = {
        id: orderId,
        customerIdentifier: user.uid,
        ownerId: storeOwnerId,
        customerName,
        customerPhone,
        customerEmail: user.email || '',
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

      toast({ title: "Pedido Enviado!", description: `Pedido #${orderId} foi recebido.` });

      clearCart();
      setIsOpen(false);
      setStep('cart');
      setPassword('');
    } catch (error: any) {
      console.error(error);
      toast({ variant: "destructive", title: "Erro ao enviar", description: error?.message || "Erro ao processar o pedido." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const headerTitle = step === 'cart' ? 'Meu Pedido' : step === 'auth' ? 'Identificação' : 'Dados de Entrega';

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
        ) : step === 'auth' ? (
          <ScrollArea className="flex-1 -mx-6 px-6 py-4">
            <form onSubmit={handleAuth} className="space-y-4" id="auth-form">
              <p className="text-sm text-muted-foreground">Entre com seu email e senha. Criamos sua conta automaticamente se ainda não tiver uma.</p>
              <div className="space-y-2">
                <Label htmlFor="cust_email">Email</Label>
                <Input id="cust_email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cust_pass">Senha (mínimo 6 caracteres)</Label>
                <Input id="cust_pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
              </div>
            </form>
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

            {step === 'cart' ? (
              <Button className="w-full h-14 bg-primary text-white font-bold" onClick={goToCheckout}>
                Continuar
              </Button>
            ) : step === 'auth' ? (
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-14" onClick={() => setStep('cart')}>Voltar</Button>
                <Button form="auth-form" type="submit" className="flex-[2] h-14 bg-primary text-white font-bold" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Entrar / Cadastrar'}
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-14" onClick={() => setStep(isRealUser ? 'cart' : 'auth')}>Voltar</Button>
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
