"use client"

import React, { useMemo, useState, useEffect } from 'react';
import { useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShoppingBag } from 'lucide-react';
import { useCustomerFirebase } from '@/firebase/customer-client';
import { ensureAuthenticated } from '@/firebase/non-blocking-login';

export function CustomerAccountButton({ storeId, storeSlug }: { storeId?: string | null; storeSlug?: string | null }) {
  const { firestore: db, auth, user, isUserLoading } = useCustomerFirebase();
  const [customerPhone, setCustomerPhone] = useState<string | null>(null);

  useEffect(() => {
    const readPhone = () => {
      try {
        const phone = localStorage.getItem('customer_phone');
        setCustomerPhone(phone);
      } catch {}
    };

    readPhone();

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setCustomerPhone(detail);
    };
    window.addEventListener('customer_phone_updated', handler);
    return () => window.removeEventListener('customer_phone_updated', handler);
  }, []);

  useEffect(() => {
    if (!auth || isUserLoading || user || !customerPhone) return;
    void ensureAuthenticated(auth);
  }, [auth, isUserLoading, user, customerPhone]);

  // Buscar os próprios pedidos pelo uid anônimo (customerUid) — as regras
  // só liberam a listagem dos pedidos do próprio usuário.
  const myOrdersQuery = useMemoFirebase(() => {
    if (!db || !user || !customerPhone || !storeId) return null;
    return query(collection(db, 'orders'), where('customerUid', '==', user.uid));
  }, [db, user, customerPhone, storeId]);
  const { data: myOrdersRaw } = useCollection(myOrdersQuery);

  // Badge de pedidos em andamento
  const activeCount = useMemo(() => {
    if (!myOrdersRaw) return 0;
    return (myOrdersRaw as any[])
      .filter(o => o.ownerId === storeId)
      .filter(o => ['pending', 'received', 'ready', 'out_for_delivery'].includes(o.status)).length;
  }, [myOrdersRaw, storeId]);

  // O botão sempre aparece para que o cliente possa fazer login ou ver o histórico.
  // if (!customerPhone || (!myOrders || myOrders.length === 0)) return null;

  const params = new URLSearchParams();
  if (storeId) params.set('storeId', storeId);
  if (storeSlug) params.set('returnTo', `/${storeSlug}`);
  const href = params.size > 0 ? `/my-orders?${params.toString()}` : '/my-orders';

  return (
    <Link href={href}>
      <Button
        variant="secondary"
        size="sm"
        className="bg-white/90 backdrop-blur text-primary font-bold shadow-md relative"
      >
        <ShoppingBag className="h-4 w-4 mr-2" /> Meus Pedidos
        {activeCount > 0 && (
          <Badge className="absolute -top-2 -right-2 bg-accent text-white h-5 min-w-[20px] px-1 flex items-center justify-center text-[10px] font-bold border-2 border-white">
            {activeCount}
          </Badge>
        )}
      </Button>
    </Link>
  );
}
