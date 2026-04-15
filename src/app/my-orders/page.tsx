
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFirestore, useCollection, useMemoFirebase, useUser, useAuth, useDoc } from '@/firebase';
import { collection, query, where, doc, setDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronLeft, ShoppingBag, Clock, Loader2, LogOut, User as UserIcon, Phone, MapPin, Pencil, Save, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Toaster } from '@/components/ui/toaster';
import { useCart } from '@/components/providers/CartProvider';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Aguardando Confirmação',
  received: 'Pedido Recebido',
  ready: 'Pedido Pronto',
  out_for_delivery: 'Saiu para Entrega',
  delivered: 'Concluído',
};

const DELIVERY_STEPS = [
  { key: 'pending', label: 'Enviado' },
  { key: 'received', label: 'Recebido' },
  { key: 'ready', label: 'Preparado' },
  { key: 'out_for_delivery', label: 'Em Entrega' },
  { key: 'delivered', label: 'Entregue' },
];
const PICKUP_STEPS = [
  { key: 'pending', label: 'Enviado' },
  { key: 'received', label: 'Recebido' },
  { key: 'ready', label: 'Pronto p/ Retirar' },
  { key: 'delivered', label: 'Retirado' },
];

const statusMessage = (status: string, orderType: string) => {
  if (status === 'received') return { title: 'Pedido Recebido!', description: 'A loja confirmou o recebimento do seu pedido.' };
  if (status === 'ready') return orderType === 'pickup'
    ? { title: 'Pedido Pronto para Retirar!', description: 'Você já pode buscar seu pedido na loja.' }
    : { title: 'Pedido Pronto!', description: 'Seu pedido está sendo preparado para sair.' };
  if (status === 'out_for_delivery') return { title: 'Saiu para Entrega!', description: 'Seu pedido está a caminho.' };
  if (status === 'delivered') return orderType === 'pickup'
    ? { title: 'Pedido Retirado', description: 'Obrigado pela preferência!' }
    : { title: 'Pedido Entregue', description: 'Aproveite!' };
  return null;
};

function OrderTimeline({ status, orderType }: { status: string; orderType: string }) {
  const steps = orderType === 'pickup' ? PICKUP_STEPS : DELIVERY_STEPS;
  const currentIdx = steps.findIndex(s => s.key === status);
  return (
    <div className="bg-muted/30 rounded-xl p-3">
      <div className="flex items-center justify-between">
        {steps.map((step, i) => {
          const done = i <= currentIdx && currentIdx >= 0;
          const current = i === currentIdx;
          return (
            <React.Fragment key={step.key}>
              <div className="flex flex-col items-center flex-shrink-0 w-14">
                <div className={`h-7 w-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all ${
                  current ? 'bg-primary border-primary text-white animate-pulse scale-110' :
                  done ? 'bg-green-500 border-green-500 text-white' :
                  'bg-white border-muted text-muted-foreground'
                }`}>
                  {done && !current ? '✓' : i + 1}
                </div>
                <span className={`text-[9px] font-bold mt-1 text-center leading-tight ${current ? 'text-primary' : done ? 'text-green-700' : 'text-muted-foreground'}`}>
                  {step.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className={`flex-1 h-0.5 mb-4 ${i < currentIdx ? 'bg-green-500' : 'bg-muted'}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export default function MyOrdersPage() {
  const { user, isUserLoading } = useUser();
  const db = useFirestore();
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { addToCart } = useCart();
  const isRealUser = !!(user && !user.isAnonymous && user.email);

  const ordersQuery = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return query(collection(db, 'orders'), where('customerIdentifier', '==', user!.uid));
  }, [db, isRealUser]);

  const profileRef = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return doc(db, 'customers', user!.uid);
  }, [db, isRealUser]);

  const menuItemsQuery = useMemoFirebase(() => (db ? collection(db, 'menuItems') : null), [db]);

  const { data: ordersRaw, isLoading: loadingOrders } = useCollection(ordersQuery);
  const { data: profile } = useDoc(profileRef);
  const { data: menuItems } = useCollection(menuItemsQuery);

  const [editingProfile, setEditingProfile] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (profile) {
      setName((profile as any).name || '');
      setPhone((profile as any).phone || '');
      setAddress((profile as any).address || '');
    }
  }, [profile]);

  const orders = useMemo(() => {
    if (!ordersRaw) return ordersRaw;
    return [...ordersRaw].sort((a: any, b: any) => (b.orderDateTime || '').localeCompare(a.orderDateTime || ''));
  }, [ordersRaw]);

  const lastStatusRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!orders) return;
    orders.forEach((order: any) => {
      const prev = lastStatusRef.current[order.id];
      if (prev && prev !== order.status) {
        const msg = statusMessage(order.status, order.orderType || 'delivery');
        if (msg) {
          toast({ title: `${msg.title} #${order.id}`, description: msg.description });
          try {
            if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
              new Notification(msg.title, { body: `Pedido #${order.id} — ${msg.description}` });
            }
          } catch {}
        }
      }
      lastStatusRef.current[order.id] = order.status;
    });
  }, [orders, toast]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const handleSaveProfile = async () => {
    if (!db || !user) return;
    setSavingProfile(true);
    try {
      await setDoc(doc(db, 'customers', user.uid), {
        uid: user.uid,
        email: user.email || '',
        name, phone, address,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      toast({ title: 'Perfil atualizado' });
      setEditingProfile(false);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err?.message || 'Falha ao salvar.' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleLogout = async () => {
    if (!auth) return;
    await signOut(auth);
    router.push('/');
  };

  const handleRepeatOrder = (order: any) => {
    if (!menuItems || !Array.isArray(order.items)) return;
    let added = 0, missing = 0;
    order.items.forEach((it: any) => {
      const match = (menuItems as any[]).find(m => m.name === it.name);
      if (match) {
        addToCart(match, it.quantity || 1, {
          addons: (it.addons || []).map((a: any) => ({ id: a.name, name: a.name, price: a.price })),
          notes: it.notes || '',
        });
        added++;
      } else {
        missing++;
      }
    });
    if (added > 0) {
      toast({ title: 'Itens adicionados ao carrinho', description: `${added} item(ns) pronto(s) para refazer.${missing > 0 ? ` ${missing} não estão mais disponíveis.` : ''}` });
    } else {
      toast({ variant: 'destructive', title: 'Nada foi adicionado', description: 'Os itens desse pedido não estão mais disponíveis no cardápio.' });
    }
  };

  if (isUserLoading || !db) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF7]">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!isRealUser) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] p-4 flex items-center justify-center">
        <Card className="max-w-md w-full text-center p-8 space-y-4">
          <UserIcon className="h-16 w-16 text-muted-foreground/30 mx-auto" />
          <h1 className="text-2xl font-bold">Faça login para ver seus pedidos</h1>
          <p className="text-sm text-muted-foreground">Entre com sua conta no cardápio para acessar o histórico.</p>
          <Link href="/">
            <Button className="w-full">Ir para o Cardápio</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const statusClass = (s: string) =>
    s === 'pending' ? 'bg-yellow-500 text-white' :
    s === 'received' ? 'bg-blue-500 text-white' :
    s === 'ready' ? 'bg-green-500 text-white' :
    s === 'out_for_delivery' ? 'bg-purple-500 text-white' :
    'bg-gray-500 text-white';

  return (
    <div className="min-h-screen bg-[#FAFAF7] p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ChevronLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">Minha Conta</h1>
          </div>
          <Button variant="ghost" size="sm" className="text-destructive" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" /> Sair
          </Button>
        </header>

        <Card className="shadow-sm rounded-2xl overflow-hidden">
          <CardHeader className="bg-white border-b py-4 flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <UserIcon className="h-4 w-4" /> Meus Dados
            </CardTitle>
            {!editingProfile ? (
              <Button size="sm" variant="ghost" onClick={() => setEditingProfile(true)}>
                <Pencil className="h-4 w-4 mr-1" /> Editar
              </Button>
            ) : (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditingProfile(false)}>Cancelar</Button>
                <Button size="sm" onClick={handleSaveProfile} disabled={savingProfile}>
                  {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1" /> Salvar</>}
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="p-4 bg-white space-y-3">
            <div className="text-xs text-muted-foreground">{user!.email}</div>
            {editingProfile ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="p_name">Nome</Label>
                  <Input id="p_name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="p_phone">Telefone</Label>
                  <Input id="p_phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="p_addr">Endereço</Label>
                  <Input id="p_addr" value={address} onChange={(e) => setAddress(e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="space-y-1 text-sm">
                <div className="flex items-center gap-2"><UserIcon className="h-3 w-3 text-muted-foreground" /> {name || <span className="italic text-muted-foreground">Sem nome</span>}</div>
                <div className="flex items-center gap-2"><Phone className="h-3 w-3 text-muted-foreground" /> {phone || <span className="italic text-muted-foreground">Sem telefone</span>}</div>
                <div className="flex items-center gap-2"><MapPin className="h-3 w-3 text-muted-foreground" /> {address || <span className="italic text-muted-foreground">Sem endereço</span>}</div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center gap-2">
          <ShoppingBag className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold">Histórico de Pedidos</h2>
        </div>

        {loadingOrders ? (
          <div className="py-10 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></div>
        ) : !orders || orders.length === 0 ? (
          <div className="text-center py-20 space-y-4">
            <ShoppingBag className="h-16 w-16 text-muted-foreground mx-auto opacity-20" />
            <p className="text-muted-foreground">Você ainda não fez nenhum pedido.</p>
            <Link href="/">
              <Button>Ir para o Cardápio</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order: any) => (
              <Card key={order.id} className="border-none shadow-sm overflow-hidden">
                <CardHeader className="bg-white border-b py-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <CardTitle className="text-base">Pedido #{order.id}</CardTitle>
                      <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <Clock className="h-3 w-3" /> {new Date(order.orderDateTime).toLocaleString('pt-BR')}
                      </div>
                    </div>
                    <Badge className={statusClass(order.status)}>
                      {STATUS_LABELS[order.status] || order.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-4 bg-white space-y-4">
                  <OrderTimeline status={order.status} orderType={order.orderType || 'delivery'} />
                  <div className="space-y-2">
                    {order.items?.map((it: any, i: number) => (
                      <div key={i} className="text-sm">
                        <div className="flex justify-between">
                          <span><span className="font-bold">{it.quantity}x</span> {it.name}</span>
                          <span className="text-muted-foreground">R$ {(it.unitPrice * it.quantity).toFixed(2)}</span>
                        </div>
                        {it.addons?.length > 0 && (
                          <div className="text-xs text-muted-foreground pl-4">
                            {it.addons.map((a: any, j: number) => <div key={j}>+ {a.name}</div>)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <Separator />
                  <div className="flex justify-between items-center font-bold">
                    <span>Total</span>
                    <span className="text-primary">R$ {order.totalAmount.toFixed(2)}</span>
                  </div>
                  <Button variant="outline" className="w-full" onClick={() => handleRepeatOrder(order)}>
                    <RotateCcw className="h-4 w-4 mr-2" /> Repetir Pedido
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
      <Toaster />
    </div>
  );
}
