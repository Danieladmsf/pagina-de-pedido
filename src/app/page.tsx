
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
import { Plus, Search, Loader2, ShoppingBag } from 'lucide-react';
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
          <p className="text-muted-foreground font-medium">Carregando cardápio delicioso...</p>
        </div>
      </div>
    );
  }

  return (
    <CartProvider>
      <div className="min-h-screen pb-24 max-w-7xl mx-auto px-4 md:px-8">
        <header className="py-8 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-4xl font-extrabold tracking-tight text-primary">Pronto Pedido</h1>
              <p className="text-muted-foreground text-lg">Seu cardápio digital rápido e saboroso.</p>
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
              placeholder="O que vamos comer?" 
              className="pl-10 h-12 bg-white border-primary/10 rounded-xl shadow-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </header>

        <div className="flex gap-2 overflow-x-auto pb-6 hide-scrollbar">
          <Button
            variant={activeCategoryId === 'all' ? 'default' : 'outline'}
            className={`rounded-full px-6 whitespace-nowrap h-11 text-sm font-semibold transition-all shadow-sm ${
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
              className={`rounded-full px-6 whitespace-nowrap h-11 text-sm font-semibold transition-all shadow-sm ${
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
              className="group overflow-hidden border-none shadow-md hover:shadow-xl transition-all cursor-pointer rounded-2xl bg-white flex flex-col"
              onClick={() => setSelectedItem(item)}
            >
              <div className="relative h-48 w-full">
                <Image 
                  src={item.imageUrl || 'https://picsum.photos/seed/placeholder/600/400'} 
                  alt={item.name} 
                  fill 
                  className="object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <Badge className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm text-primary font-bold border-none shadow-sm">
                  R$ {item.price.toFixed(2)}
                </Badge>
              </div>
              <CardContent className="p-5 flex flex-col flex-1">
                <div className="flex-1 space-y-2 mb-4">
                  <h3 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors">{item.name}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                    {item.description}
                  </p>
                </div>
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs font-medium text-primary/60 uppercase tracking-wider">
                    {categories?.find(c => c.id === item.categoryId)?.name}
                  </span>
                  <Button size="sm" className="bg-accent hover:bg-accent/90 text-accent-foreground h-9 w-9 p-0 rounded-lg shadow-sm">
                    <Plus className="h-5 w-5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredItems.length === 0 && (
          <div className="py-20 text-center space-y-4">
            <p className="text-xl text-muted-foreground">Nenhum prato encontrado.</p>
          </div>
        )}

        <footer className="mt-20 pt-10 border-t border-primary/10 text-center text-muted-foreground text-sm">
          <p>&copy; 2024 Pronto Pedido • Sabores que chegam até você</p>
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
