
"use client"

import React, { useState, useMemo } from 'react';
import { CATEGORIES, MENU_ITEMS } from '@/lib/data';
import { Category, MenuItem } from '@/lib/types';
import { CartProvider } from '@/components/providers/CartProvider';
import { CartDrawer } from '@/components/cart/CartDrawer';
import { AIAssistant } from '@/components/ai/AIAssistant';
import { MenuItemDialog } from '@/components/menu/MenuItemDialog';
import { Toaster } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import { Plus, Search, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';

export default function Home() {
  const [activeCategory, setActiveCategory] = useState<Category>('Todos');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);

  const filteredItems = useMemo(() => {
    return MENU_ITEMS.filter(item => {
      const matchesCategory = activeCategory === 'Todos' || item.category === activeCategory;
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           item.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, searchQuery]);

  return (
    <CartProvider>
      <div className="min-h-screen pb-24 max-w-7xl mx-auto px-4 md:px-8">
        {/* Header Section */}
        <header className="py-8 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-4xl font-extrabold tracking-tight text-primary">Pronto Pedido</h1>
              <p className="text-muted-foreground text-lg">Seu cardápio digital rápido e saboroso.</p>
            </div>
            <div className="flex items-center gap-3">
              <AIAssistant />
              <CartDrawer />
            </div>
          </div>

          {/* Search Bar */}
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

        {/* Categories Horizontal Scroll */}
        <div className="flex gap-2 overflow-x-auto pb-6 hide-scrollbar">
          {CATEGORIES.map((cat) => (
            <Button
              key={cat}
              variant={activeCategory === cat ? 'default' : 'outline'}
              className={`rounded-full px-6 whitespace-nowrap h-11 text-sm font-semibold transition-all shadow-sm ${
                activeCategory === cat 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-white border-primary/20 text-primary hover:bg-primary/5'
              }`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </Button>
          ))}
        </div>

        {/* Menu Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredItems.map((item) => (
            <Card 
              key={item.id} 
              className="group overflow-hidden border-none shadow-md hover:shadow-xl transition-all cursor-pointer rounded-2xl bg-white flex flex-col"
              onClick={() => setSelectedItem(item)}
            >
              <div className="relative h-48 w-full">
                <Image 
                  src={item.imageUrl} 
                  alt={item.name} 
                  fill 
                  className="object-cover group-hover:scale-105 transition-transform duration-500"
                  data-ai-hint={item.imageHint}
                />
                <Badge className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm text-primary font-bold border-none shadow-sm">
                  R$ {item.price.toFixed(2)}
                </Badge>
              </div>
              <CardContent className="p-5 flex flex-col flex-1">
                <div className="flex-1 space-y-2 mb-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors">{item.name}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                    {item.description}
                  </p>
                </div>
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs font-medium text-primary/60 uppercase tracking-wider">{item.category}</span>
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
            <p className="text-xl text-muted-foreground">Nenhum prato encontrado com esses critérios.</p>
            <Button variant="link" onClick={() => {setSearchQuery(''); setActiveCategory('Todos')}} className="text-primary font-bold">
              Limpar filtros
            </Button>
          </div>
        )}

        {/* Footer/Mobile Nav Placeholder (Experience only) */}
        <footer className="mt-20 pt-10 border-t border-primary/10 text-center text-muted-foreground text-sm">
          <p>&copy; 2024 Pronto Pedido • Sabores que chegam até você</p>
        </footer>

        {/* Item Selection Dialog */}
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
