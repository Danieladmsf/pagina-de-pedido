
"use client"

import React, { useState, useMemo } from 'react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection } from 'firebase/firestore';
import { CartProvider } from '@/components/providers/CartProvider';
import { CartDrawer } from '@/components/cart/CartDrawer';
import { AIAssistant } from '@/components/ai/AIAssistant';
import { MenuItemDialog } from '@/components/menu/MenuItemDialog';
import { Toaster } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import { Plus, Search, Loader2, ShoppingBag, Leaf } from 'lucide-react';
import { Input } from '@/components/ui/input';
import Link from 'next/link';

export default function Home() {
  const db = useFirestore();
  const [activeCategoryId, setActiveCategoryId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  const categoriesQuery = useMemoFirebase(() => collection(db, 'categories'), [db]);
  const itemsQuery = useMemoFirebase(() => collection(db, 'menuItems'), [db]);
  
  const { data: categories, isLoading: loadingCats } = useCollection(categoriesQuery);
  const { data: items, isLoading: loadingItems } = useCollection(itemsQuery);

  const filteredItems = useMemo(() => {
    if (!items) return [];
    return items.filter(item => {
      const matchesCategory = activeCategoryId === 'all' || item.categoryId === activeCategoryId;
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           item.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [activeCategoryId, searchQuery, items]);

  if (loadingCats || loadingItems) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF7]">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground font-medium">Preparando o melhor sabor...</p>
        </div>
      </div>
    );
  }

  return (
    <CartProvider>
      <div className="min-h-screen pb-24 max-w-7xl mx-auto px-4 md:px-8">
        <header className="py-8 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary p-3 rounded-2xl shadow-lg">
                <Leaf className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-4xl font-black tracking-tight text-primary uppercase">Lima Limão</h1>
                <p className="text-accent font-bold text-lg leading-none">O verdadeiro sabor da fruta!</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/my-orders">
                <Button variant="ghost" size="sm" className="text-primary font-bold">
                  <ShoppingBag className="h-4 w-4 mr-2" /> Meus Pedidos
                </Button>
              </Link>
              <AIAssistant />
              <CartDrawer />
            </div>
          </div>

          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input 
              placeholder="O que você quer saborear hoje?" 
              className="pl-10 h-12 bg-white border-primary/10 rounded-2xl shadow-sm focus:ring-accent"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </header>

        <div className="flex gap-2 overflow-x-auto pb-6 hide-scrollbar">
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
            <p className="text-xl text-muted-foreground font-medium">Ops! Não encontramos esse item no momento.</p>
          </div>
        )}

        <footer className="mt-20 pt-10 border-t border-primary/10 text-center text-muted-foreground text-sm">
          <p className="font-bold">© 2024 Lima Limão • Sucos & Vitaminas</p>
          <p>O verdadeiro sabor da fruta!</p>
        </footer>

        <MenuItemDialog 
          item={selectedItem} 
          isOpen={!!selectedItem} 
          onClose={() => setSelectedItem(null)} 
        />
        
        <Toaster />
      </div>
    </CartProvider>
  );
}
