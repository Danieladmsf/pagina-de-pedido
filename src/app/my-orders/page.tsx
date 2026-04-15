
'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronLeft, ShoppingBag, Clock, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { Toaster } from '@/components/ui/toaster';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  received: 'Pedido Recebido',
  ready: 'Pedido Pronto',
  out_for_delivery: 'Saiu para Entrega',
};

const STATUS_MESSAGES: Record<string, { title: string; description: string }> = {
  received: { title: 'Pedido Recebido!', description: 'A loja confirmou o recebimento do seu pedido.' },
  ready: { title: 'Pedido Pronto!', description: 'Seu pedido está pronto.' },
  out_for_delivery: { title: 'Saiu para Entrega!', description: 'Seu pedido está a caminho.' },
};

export default function MyOrdersPage() {
  const { user, isUserLoading } = useUser();
  const db = useFirestore();
  const { toast } = useToast();

  const ordersQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collection(db, 'orders'), where('customerIdentifier', '==', user.uid));
  }, [db, user]);

  const { data: ordersRaw, isLoading: loadingOrders } = useCollection(ordersQuery);

  const orders = useMemo(() => {
    if (!ordersRaw) return ordersRaw;
    return [...ordersRaw].sort((a: any, b: any) => (b.orderDateTime || '').localeCompare(a.orderDateTime || ''));
  }, [ordersRaw]);

  // Detecta mudança de status para notificar
  const lastStatusRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!orders) return;
    orders.forEach((order: any) => {
      const prev = lastStatusRef.current[order.id];
      if (prev && prev !== order.status && STATUS_MESSAGES[order.status]) {
        const msg = STATUS_MESSAGES[order.status];
        toast({ title: `${msg.title} #${order.id}`, description: msg.description });
        try {
          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification(msg.title, { body: `Pedido #${order.id} — ${msg.description}` });
          }
        } catch {}
      }
      lastStatusRef.current[order.id] = order.status;
    });
  }, [orders, toast]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  if (isUserLoading || loadingOrders || !db) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF7]">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
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
        <header className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ChevronLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Meus Pedidos</h1>
        </header>

        {!user ? (
          <div className="text-center py-20">
            <p className="text-muted-foreground">Você precisa estar logado para ver seus pedidos.</p>
          </div>
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
                  <div className="space-y-2">
                    {order.items?.map((it: any, i: number) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span>{it.quantity}x {it.name}</span>
                        <span className="text-muted-foreground">R$ {(it.unitPrice * it.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <Separator />
                  <div className="flex justify-between items-center font-bold">
                    <span>Total</span>
                    <span className="text-primary">R$ {order.totalAmount.toFixed(2)}</span>
                  </div>
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
