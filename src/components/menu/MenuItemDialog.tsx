"use client"

import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MenuItem, Addon, SelectedAddon, AddonGroup } from '@/lib/types';
import { useCart } from '@/components/providers/CartProvider';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import Image from 'next/image';
import { Minus, Plus, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface MenuItemDialogProps {
  item: MenuItem | null;
  isOpen: boolean;
  onClose: () => void;
  allAddons?: Addon[];
  isStoreOpen?: boolean;
}

export function MenuItemDialog({ item, isOpen, onClose, allAddons = [], isStoreOpen = true }: MenuItemDialogProps) {
  const { addToCart } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  
  // Para produtos normais
  const [selectedAddons, setSelectedAddons] = useState<SelectedAddon[]>([]);
  
  // Para marmitas (grupos de adicionais)
  const [marmitaSelections, setMarmitaSelections] = useState<Record<number, SelectedAddon[]>>({});

  useEffect(() => {
    if (isOpen) {
      setQuantity(1);
      setNotes('');
      setSelectedAddons([]);
      setMarmitaSelections({});
    }
  }, [isOpen, item?.id]);

  const productAddons = useMemo(() => {
    if (item?.isMarmita || item?.isCombo) return [];
    if (!item?.addonIds || item.addonIds.length === 0) return [];
    return allAddons.filter(a => item.addonIds!.includes(a.id));
  }, [item, allAddons]);

  if (!item) return null;

  const toggleNormalAddon = (addon: Addon) => {
    setSelectedAddons(prev => {
      const exists = prev.find(a => a.id === addon.id);
      if (exists) return prev.filter(a => a.id !== addon.id);
      return [...prev, { id: addon.id, name: addon.name, price: addon.price }];
    });
  };

  const toggleMarmitaAddon = (groupIndex: number, addon: Addon, group: AddonGroup) => {
    setMarmitaSelections(prev => {
      const current = prev[groupIndex] || [];
      const exists = current.find(a => a.id === addon.id);
      
      let next = [...current];
      if (exists) {
        next = next.filter(a => a.id !== addon.id);
      } else {
        if (next.length >= group.max) {
          if (group.max === 1) {
            next = [{ id: addon.id, name: addon.name, price: addon.price }];
          } else {
            return prev; // não permite selecionar mais
          }
        } else {
          next.push({ id: addon.id, name: addon.name, price: addon.price });
        }
      }
      return { ...prev, [groupIndex]: next };
    });
  };

  // Calcula total
  let addonsTotal = 0;
  let finalAddonsList: SelectedAddon[] = [];

  if (item.isMarmita) {
    Object.values(marmitaSelections).forEach(arr => {
      arr.forEach(a => {
        addonsTotal += a.price;
        finalAddonsList.push(a);
      });
    });
  } else {
    addonsTotal = selectedAddons.reduce((acc, a) => acc + a.price, 0);
    finalAddonsList = [...selectedAddons];
  }

  const unitPrice = item.price + addonsTotal;
  const total = unitPrice * quantity;

  // Validação
  let canAddToCart = true;
  let validationMessage = '';

  if (item.isMarmita && item.addonGroups) {
    for (let i = 0; i < item.addonGroups.length; i++) {
      const g = item.addonGroups[i];
      const selectedCount = (marmitaSelections[i] || []).length;
      if (selectedCount < g.min) {
        canAddToCart = false;
        validationMessage = `Falta selecionar itens na etapa: ${g.name} (mínimo ${g.min})`;
        break;
      }
    }
  }

  const handleAdd = () => {
    if (!canAddToCart) return;
    addToCart(item, quantity, { addons: finalAddonsList, notes });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto flex flex-col">
        <DialogHeader>
          <div className="relative w-full h-48 mb-4 overflow-hidden rounded-lg bg-muted/30 flex items-center justify-center">
            {item.imageUrl ? (
              <Image
                src={item.imageUrl}
                alt={item.name}
                fill
                className="object-cover"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-muted-foreground/40">
                <span className="text-4xl">🍽️</span>
                <span className="text-sm mt-2 font-medium">Sem imagem</span>
              </div>
            )}
          </div>
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            {item.name}
            {item.isCombo && <span className="bg-purple-100 text-purple-700 text-xs px-2 py-1 rounded uppercase tracking-wider font-bold">Combo</span>}
            {item.isMarmita && <span className="bg-orange-100 text-orange-700 text-xs px-2 py-1 rounded uppercase tracking-wider font-bold">Montável</span>}
          </DialogTitle>
          <p className="text-muted-foreground">{item.description}</p>
        </DialogHeader>

        <div className="space-y-6 py-4 flex-1 overflow-y-auto pr-2">
          
          {/* Combo Items */}
          {item.isCombo && item.comboItems && item.comboItems.length > 0 && (
            <div className="bg-purple-50 p-4 rounded-lg border border-purple-100">
              <Label className="text-purple-800 font-bold mb-2 block">Itens Inclusos no Combo:</Label>
              <ul className="list-disc pl-5 space-y-1">
                {item.comboItems.map((ci, idx) => (
                  <li key={idx} className="text-sm text-purple-700">{ci.name}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Normal Addons */}
          {!item.isMarmita && !item.isCombo && productAddons.length > 0 && (
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
                          onCheckedChange={() => toggleNormalAddon(addon)}
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

          {/* Marmita Addon Groups */}
          {item.isMarmita && item.addonGroups && item.addonGroups.map((group, groupIndex) => {
            const availableAddons = allAddons.filter(a => group.addonIds.includes(a.id));
            const currentSelected = marmitaSelections[groupIndex] || [];
            
            if (availableAddons.length === 0) return null;

            return (
              <div key={groupIndex} className="space-y-3 p-4 border rounded-lg bg-slate-50/50">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <Label className="text-base font-bold text-slate-800">{group.name}</Label>
                    <span className="text-xs bg-slate-200 px-2 py-0.5 rounded text-slate-600 font-medium">
                      Escolha de {group.min} a {group.max}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground font-medium">
                    {currentSelected.length} de {group.max} selecionados
                  </span>
                </div>
                
                <div className="grid gap-2">
                  {availableAddons.map((addon) => {
                    const checked = !!currentSelected.find(a => a.id === addon.id);
                    const disabled = !checked && currentSelected.length >= group.max && group.max > 1;

                    return (
                      <label
                        key={addon.id}
                        className={`flex items-center justify-between gap-3 p-2.5 border rounded-md cursor-pointer transition-colors bg-white ${checked ? 'border-primary/50 bg-primary/5' : 'hover:bg-slate-100'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <div className="flex items-center gap-3">
                          <input 
                            type={group.max === 1 ? 'radio' : 'checkbox'} 
                            name={`group-${groupIndex}`}
                            checked={checked}
                            onChange={() => !disabled && toggleMarmitaAddon(groupIndex, addon, group)}
                            disabled={disabled}
                            className="rounded-sm text-primary focus:ring-primary"
                          />
                          <span className={`text-sm ${checked ? 'font-medium text-primary' : 'text-slate-700'}`}>{addon.name}</span>
                        </div>
                        {addon.price > 0 && (
                          <span className="text-xs font-bold text-emerald-600">
                            + R$ {addon.price.toFixed(2)}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="space-y-3">
            <Label className="text-base font-semibold">Observações</Label>
            <Textarea
              placeholder="Ex: sem cebola, ponto da carne, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="flex-col gap-4 border-t pt-4">
          {!canAddToCart && (
            <Alert variant="destructive" className="py-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs font-semibold">{validationMessage}</AlertDescription>
            </Alert>
          )}
          
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:justify-between">
            <div className="flex items-center gap-4 bg-muted p-1 rounded-lg w-full sm:w-auto justify-center">
              <Button variant="ghost" size="icon" onClick={() => setQuantity(Math.max(1, quantity - 1))}>
                <Minus className="h-4 w-4" />
              </Button>
              <span className="font-bold min-w-[20px] text-center">{quantity}</span>
              <Button variant="ghost" size="icon" onClick={() => setQuantity(quantity + 1)}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <Button
              className={`w-full sm:w-auto font-bold px-8 ${canAddToCart && isStoreOpen ? 'bg-accent hover:bg-accent/90 text-accent-foreground' : 'bg-slate-300 text-slate-500 cursor-not-allowed'}`}
              onClick={handleAdd}
              disabled={!isStoreOpen || !canAddToCart}
            >
              {isStoreOpen ? `Adicionar • R$ ${total.toFixed(2)}` : 'Loja Fechada'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
