'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { ShoppingBag, ChevronRight } from 'lucide-react';

const ACTIVE_STATUSES = ['pending', 'received', 'ready', 'out_for_delivery'];
const STATUS_LABELS: Record<string, string> = {
  pending: 'Aguardando confirmação',
  received: 'Pedido recebido',
  ready: 'Pronto',
  out_for_delivery: 'Saiu para entrega',
};

export function ActiveOrdersBanner() {
  const db = useFirestore();
  const { user } = useUser();
  const isRealUser = !!(user && !user.isAnonymous && user.email);

  const ordersQuery = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return query(collection(db, 'orders'), where('customerIdentifier', '==', user!.uid));
  }, [db, isRealUser]);
  const { data: ordersRaw } = useCollection(ordersQuery);

  const activeOrders = useMemo(() => {
    if (!ordersRaw) return [];
    return (ordersRaw as any[])
      .filter(o => ACTIVE_STATUSES.includes(o.status))
      .sort((a, b) => (b.orderDateTime || '').localeCompare(a.orderDateTime || ''));
  }, [ordersRaw]);

  if (!isRealUser || activeOrders.length === 0) return null;

  const latest = activeOrders[0];
  const statusLabel = STATUS_LABELS[latest.status] || latest.status;

  return (
    <Link href="/my-orders" className="block">
      <div className="max-w-7xl mx-auto px-4 md:px-8 pt-4">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary to-primary/80 text-white shadow-lg hover:shadow-xl transition-all active:scale-[0.99]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.15),transparent_60%)] pointer-events-none" />
          <div className="relative flex items-center gap-3 p-4">
            <div className="bg-white/20 backdrop-blur p-3 rounded-xl flex-shrink-0">
              <ShoppingBag className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider font-bold bg-white/25 px-2 py-0.5 rounded-full">
                  {activeOrders.length} pedido{activeOrders.length > 1 ? 's' : ''} em andamento
                </span>
              </div>
              <p className="font-black text-base mt-1 truncate">Clique para acompanhar seu pedido</p>
              <p className="text-xs text-white/90 truncate">
                #{latest.id} · {statusLabel}
              </p>
            </div>
            <ChevronRight className="h-6 w-6 flex-shrink-0 text-white/90" />
          </div>
        </div>
      </div>
    </Link>
  );
}
