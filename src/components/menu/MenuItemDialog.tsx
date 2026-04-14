
"use client"

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MenuItem } from '@/lib/types';
import { useCart } from '@/components/providers/CartProvider';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import Image from 'next/image';
import { Minus, Plus, ShoppingCart } from 'lucide-react';

interface MenuItemDialogProps {
  item: MenuItem | null;
  isOpen: boolean;
  onClose: () => void;
}

export function MenuItemDialog({ item, isOpen, onClose }: MenuItemDialogProps) {
  const { addToCart } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [size, setSize] = useState('Padrão');
  const [extras, setExtras] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  if (!item) return null;

  const handleAdd = () => {
    addToCart(item, quantity, { size, extras, notes });
    onClose();
    setQuantity(1);
    setSize('Padrão');
    setExtras([]);
    setNotes('');
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
              data-ai-hint={item.imageHint}
            />
          </div>
          <DialogTitle className="text-2xl font-bold">{item.name}</DialogTitle>
          <p className="text-muted-foreground">{item.description}</p>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-3">
            <Label className="text-base font-semibold">Tamanho</Label>
            <RadioGroup value={size} onValueChange={setSize} className="flex gap-4">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Pequeno" id="s" />
                <Label htmlFor="s">Pequeno</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Padrão" id="m" />
                <Label htmlFor="m">Padrão</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Grande" id="l" />
                <Label htmlFor="l">Grande</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-3">
            <Label className="text-base font-semibold">Adicionais</Label>
            <div className="grid grid-cols-2 gap-2">
              {['Bacon', 'Queijo Extra', 'Cebola Caramelizada', 'Molho Picante'].map((extra) => (
                <div key={extra} className="flex items-center space-x-2">
                  <Checkbox 
                    id={extra} 
                    checked={extras.includes(extra)}
                    onCheckedChange={(checked) => {
                      if (checked) setExtras([...extras, extra]);
                      else setExtras(extras.filter(e => e !== extra));
                    }}
                  />
                  <Label htmlFor={extra} className="text-sm cursor-pointer">{extra}</Label>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-base font-semibold">Observações Especiais</Label>
            <Textarea 
              placeholder="Ex: Sem cebola, ponto da carne, etc." 
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
            Adicionar • R$ {(item.price * quantity).toFixed(2)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
