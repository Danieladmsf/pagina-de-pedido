
"use client"

import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MenuItem, Addon, SelectedAddon } from '@/lib/types';
import { useCart } from '@/components/providers/CartProvider';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import Image from 'next/image';
import { Minus, Plus } from 'lucide-react';

interface MenuItemDialogProps {
  item: MenuItem | null;
  isOpen: boolean;
  onClose: () => void;
  allAddons?: Addon[];
}

export function MenuItemDialog({ item, isOpen, onClose, allAddons = [] }: MenuItemDialogProps) {
  const { addToCart } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [selectedAddons, setSelectedAddons] = useState<SelectedAddon[]>([]);

  useEffect(() => {
    if (isOpen) {
      setQuantity(1);
      setNotes('');
      setSelectedAddons([]);
    }
  }, [isOpen, item?.id]);

  const productAddons = useMemo(() => {
    if (!item?.addonIds || item.addonIds.length === 0) return [];
    return allAddons.filter(a => item.addonIds!.includes(a.id));
  }, [item, allAddons]);

  if (!item) return null;

  const toggleAddon = (addon: Addon) => {
    setSelectedAddons(prev => {
      const exists = prev.find(a => a.id === addon.id);
      if (exists) return prev.filter(a => a.id !== addon.id);
      return [...prev, { id: addon.id, name: addon.name, price: addon.price }];
    });
  };

  const addonsTotal = selectedAddons.reduce((acc, a) => acc + a.price, 0);
  const unitPrice = item.price + addonsTotal;
  const total = unitPrice * quantity;

  const handleAdd = () => {
    addToCart(item, quantity, { addons: selectedAddons, notes });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="relative w-full h-48 mb-4 overflow-hidden rounded-lg">
            <Image
              src={item.imageUrl}
              alt={item.name}
              fill
              className="object-cover"
            />
          </div>
          <DialogTitle className="text-2xl font-bold">{item.name}</DialogTitle>
          <p className="text-muted-foreground">{item.description}</p>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {productAddons.length > 0 && (
            <div className="space-y-3">
              <Label className="text-base font-semibold">Adicionais</Label>
              <div className="space-y-2">
                {productAddons.map((addon) => {
                  const checked = !!selectedAddons.find(a => a.id === addon.id);
                  return (
                    <label
                      key={addon.id}
                      className="flex items-center justify-between gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleAddon(addon)}
                        />
                        <span className="text-sm font-medium">{addon.name}</span>
                      </div>
                      <span className="text-sm font-bold text-primary">
                        + R$ {addon.price.toFixed(2)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <Label className="text-base font-semibold">Observações</Label>
            <Textarea
              placeholder="Ex: sem gelo, bem gelado, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-4 items-center sm:justify-between border-t pt-4">
          <div className="flex items-center gap-4 bg-muted p-1 rounded-lg">
            <Button variant="ghost" size="icon" onClick={() => setQuantity(Math.max(1, quantity - 1))}>
              <Minus className="h-4 w-4" />
            </Button>
            <span className="font-bold min-w-[20px] text-center">{quantity}</span>
            <Button variant="ghost" size="icon" onClick={() => setQuantity(quantity + 1)}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <Button
            className="w-full sm:w-auto bg-accent hover:bg-accent/90 text-accent-foreground font-bold px-8"
            onClick={handleAdd}
          >
            Adicionar • R$ {total.toFixed(2)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
