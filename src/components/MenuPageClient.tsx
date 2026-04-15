
"use client"

import React, { useState, useMemo } from 'react';
import { useFirestore, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { CartDrawer } from '@/components/cart/CartDrawer';
import { CustomerAccountButton } from '@/components/customer/CustomerAccountButton';
import { MenuItemDialog } from '@/components/menu/MenuItemDialog';
import { Toaster } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import { Plus, Search, Loader2, ShoppingBag, Leaf, Lock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

export function MenuPageClient() {
  const db = useFirestore();
  const searchParams = useSearchParams();
  const [activeCategoryId, setActiveCategoryId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  const storeId = searchParams.get('s');

  // Proteção: Só tenta criar a referência se o 'db' for válido
  const storeRef = useMemoFirebase(() => {
    if (!db || !storeId) return null;
    return doc(db, 'roles_admin', storeId);
  }, [db, storeId]);
  
  const { data: storeInfo } = useDoc(storeRef);

  const categoriesQuery = useMemoFirebase(() => {
    if (!db) return null;
    if (storeId) return query(collection(db, 'categories'), where('ownerId', '==', storeId));
    return collection(db, 'categories');
  }, [db, storeId]);

  const itemsQuery = useMemoFirebase(() => {
    if (!db) return null;
    if (storeId) return query(collection(db, 'menuItems'), where('ownerId', '==', storeId));
    return collection(db, 'menuItems');
  }, [db, storeId]);

  const addonsQuery = useMemoFirebase(() => {
    if (!db) return null;
    if (storeId) return query(collection(db, 'addons'), where('ownerId', '==', storeId));
    return collection(db, 'addons');
  }, [db, storeId]);

  const { data: categories, isLoading: loadingCats } = useCollection(categoriesQuery);
  const { data: items, isLoading: loadingItems } = useCollection(itemsQuery);
  const { data: addons } = useCollection(addonsQuery);

  const filteredItems = useMemo(() => {
    if (!items) return [];
    return items.filter(item => {
      const matchesCategory = activeCategoryId === 'all' || item.categoryId === activeCategoryId;
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           item.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [activeCategoryId, searchQuery, items]);

  if (!db || loadingCats || loadingItems) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF7]">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground font-medium">Buscando sabores...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24 relative">
      <section
        className="relative w-full bg-no-repeat bg-center bg-cover md:bg-[length:100%_100%] min-h-[380px] md:min-h-0 md:aspect-[1832/560]"
        style={{ backgroundImage: "url('/lima-limao-bg.png')" }}
      >
        <div className="absolute inset-0 bg-white/25" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-white pointer-events-none" />
        <div className="relative max-w-7xl mx-auto px-4 md:px-8 py-6 flex justify-end">
          <div className="flex items-center gap-2">
            <CustomerAccountButton />
            <CartDrawer storeOwnerId={storeId} />
          </div>
        </div>
        <div className="relative max-w-7xl mx-auto px-4 md:px-8 pt-24 pb-6 space-y-5">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="O que você quer saborear hoje?"
              className="pl-10 h-12 bg-white border-primary/10 rounded-2xl shadow-md focus:ring-accent"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex gap-2 overflow-x-auto hide-scrollbar">
            <Button
              variant={activeCategoryId === 'all' ? 'default' : 'outline'}
              className={`rounded-full px-6 whitespace-nowrap h-11 text-sm font-bold transition-all shadow-sm ${
                activeCategoryId === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-white border-primary/20 text-primary hover:bg-primary/5'
              }`}
              onClick={() => setActiveCategoryId('all')}
            >
              Todos
            </Button>
            {categories?.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)).map((cat) => (
              <Button
                key={cat.id}
                variant={activeCategoryId === cat.id ? 'default' : 'outline'}
                className={`rounded-full px-6 whitespace-nowrap h-11 text-sm font-bold transition-all shadow-sm ${
                  activeCategoryId === cat.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-white border-primary/20 text-primary hover:bg-primary/5'
                }`}
                onClick={() => setActiveCategoryId(cat.id)}
              >
                {cat.name}
              </Button>
            ))}
          </div>
        </div>
      </section>
      <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredItems.map((item) => (
          <Card 
            key={item.id} 
            className="group overflow-hidden border-none shadow-md hover:shadow-2xl transition-all cursor-pointer rounded-3xl bg-white flex flex-col"
            onClick={() => setSelectedItem(item)}
          >
            <div className="relative h-56 w-full">
              <Image 
                src={item.imageUrl || 'https://picsum.photos/seed/placeholder/600/400'} 
                alt={item.name} 
                fill 
                className="object-cover group-hover:scale-105 transition-transform duration-700"
              />
              <Badge className="absolute top-4 right-4 bg-accent text-white font-black border-none shadow-lg px-3 py-1 text-base">
                R$ {item.price.toFixed(2)}
              </Badge>
            </div>
            <CardContent className="p-6 flex flex-col flex-1">
              <div className="flex-1 space-y-2 mb-4">
                <h3 className="text-xl font-black text-primary group-hover:text-accent transition-colors">{item.name}</h3>
                <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
                  {item.description}
                </p>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-muted">
                <span className="text-xs font-black text-primary/40 uppercase tracking-widest">
                  {categories?.find(c => c.id === item.categoryId)?.name}
                </span>
                <Button size="sm" className="bg-primary hover:bg-accent text-white h-10 w-10 p-0 rounded-xl shadow-md transition-colors">
                  <Plus className="h-6 w-6" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredItems.length === 0 && (
        <div className="py-20 text-center space-y-4">
          <p className="text-xl text-muted-foreground font-medium">Ops! Esta loja ainda não tem itens no cardápio.</p>
        </div>
      )}

      <footer className="mt-20 pt-10 border-t border-primary/10 text-center text-muted-foreground text-sm space-y-4">
        <div>
          <p className="font-bold">© 2024 {storeInfo?.storeName || 'Lima Limão'}</p>
          <p>{storeId ? 'Cardápio Digital Profissional' : 'O verdadeiro sabor da fruta!'}</p>
        </div>
        <div className="pt-4 flex justify-center gap-4">
          <Link href="/admin" className="inline-flex items-center gap-1 text-[10px] opacity-30 hover:opacity-100">
            <Lock className="h-3 w-3" /> Área Restrita
          </Link>
          <Link href="/register" className="inline-flex items-center gap-1 text-[10px] opacity-30 hover:opacity-100">
            Crie seu Cardápio
          </Link>
        </div>
      </footer>

      <MenuItemDialog
        item={selectedItem}
        isOpen={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        allAddons={addons || []}
      />
      
      <Toaster />
      </div>
    </div>
  );
}
