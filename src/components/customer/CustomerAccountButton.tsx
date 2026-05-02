"use client"

import React, { useMemo, useState, useEffect } from 'react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShoppingBag } from 'lucide-react';

export function CustomerAccountButton() {
  const db = useFirestore();
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

  // Buscar pedidos pelo telefone
  const myOrdersQuery = useMemoFirebase(() => {
    if (!db || !customerPhone) return null;
    return query(collection(db, 'orders'), where('customerIdentifier', '==', customerPhone));
  }, [db, customerPhone]);
  const { data: myOrders } = useCollection(myOrdersQuery);

  // Badge de pedidos em andamento
  const activeCount = useMemo(() => {
    if (!myOrders) return 0;
    return (myOrders as any[]).filter(o => ['pending', 'received', 'ready', 'out_for_delivery'].includes(o.status)).length;
  }, [myOrders]);

  // Só mostra o botão se o cliente já fez algum pedido
  if (!customerPhone || (!myOrders || myOrders.length === 0)) return null;

  return (
    <Link href="/my-orders">
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
