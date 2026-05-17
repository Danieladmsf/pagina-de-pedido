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
  onAddToCart?: (item: any, quantity: number, options: any) => void;
}

export function MenuItemDialog({ item, isOpen, onClose, allAddons = [], isStoreOpen = true, onAddToCart }: MenuItemDialogProps) {
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
    if (item?.isCombo) return [];
    if (!item?.addonIds || item.addonIds.length === 0) return [];
    return allAddons.filter(a => item.addonIds!.includes(a.id) && a.active !== false);
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
        const finalPrice = group.freeAddonIds?.includes(addon.id) ? 0 : addon.price;
        const limit = group.max || 0;
        
        if (limit > 0 && next.length >= limit) {
          if (limit === 1) {
            next = [{ id: addon.id, name: addon.name, price: finalPrice }];
          } else {
            return prev; // não permite selecionar mais
          }
        } else {
          next.push({ id: addon.id, name: addon.name, price: finalPrice });
        }
      }
      return { ...prev, [groupIndex]: next };
    });
  };

  // Calcula total
  let addonsTotal = 0;
  let finalAddonsList: SelectedAddon[] = [];

  if (item.addonGroups && item.addonGroups.length > 0) {
    item.addonGroups.forEach((group, index) => {
      const arr = marmitaSelections[index] || [];
      const freeLimit = group.freeLimit || 0;
      
      arr.forEach((a, i) => {
        let effectivePrice = 0;
        // Se o índice for maior ou igual ao limite gratuito, cobra o valor
        if (i >= freeLimit) {
          effectivePrice = Number(a.price) || 0;
          addonsTotal += effectivePrice;
        }
        // O item vai pro carrinho final com o preço efetivo (0 se for grátis)
        finalAddonsList.push({ ...a, price: effectivePrice });
      });
    });
  }
  
  if (selectedAddons.length > 0) {
    addonsTotal += selectedAddons.reduce((acc, a) => acc + (Number(a.price) || 0), 0);
    finalAddonsList = [...finalAddonsList, ...selectedAddons];
  }

  const unitPrice = (Number(item.price) || 0) + addonsTotal;
  const total = unitPrice * quantity;

  // Validação
  let canAddToCart = true;
  let validationMessage = '';

  if (item.addonGroups && item.addonGroups.length > 0) {
    for (let i = 0; i < item.addonGroups.length; i++) {
      const g = item.addonGroups[i];
      const selectedCount = (marmitaSelections[i] || []).length;
      if (selectedCount < g.min) {
        canAddToCart = false;
        validationMessage = `Selecione ao menos ${g.min} em: ${g.name}`;
        break;
      }
    }
  }

  const handleAdd = () => {
    if (!canAddToCart) return;
    if (onAddToCart) {
      onAddToCart(item, quantity, { addons: finalAddonsList, notes });
    } else {
      addToCart(item, quantity, { addons: finalAddonsList, notes });
    }
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[400px] max-h-[85vh] overflow-y-auto flex flex-col p-4">
        <DialogHeader className="pb-1 space-y-1">
          <DialogTitle className="text-lg font-bold flex items-center gap-2 leading-tight">
            {item.name}
            {item.isCombo && <span className="bg-purple-100 text-purple-700 text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-bold">Combo</span>}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{item.description}</p>
          {item.prazo && (
            <div className="mt-2 inline-block bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-[10px] font-bold w-fit">
              Prazo: {item.prazo}
            </div>
          )}
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



          {/* Addon Groups */}
          {item.addonGroups && item.addonGroups.map((group, groupIndex) => {
            const availableAddons = allAddons.filter(a => group.addonIds.includes(a.id) && a.active !== false);
            const currentSelected = marmitaSelections[groupIndex] || [];
            
            if (availableAddons.length === 0) return null;

            return (
              <div key={groupIndex} className="space-y-2 p-3 border rounded-md bg-slate-50/50">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <Label className="text-sm font-bold text-slate-800">{group.name}</Label>
                    <div className="flex gap-1">
                      {group.freeLimit ? (
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">
                          {group.freeLimit} {group.freeLimit === 1 ? 'grátis' : 'grátis'}
                        </span>
                      ) : null}
                      <span className="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-600 font-medium">
                        {group.max > 0 ? `Escolha de ${group.min || 0} a ${group.max}` : 'Sem limite'}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium">
                    {currentSelected.length} {group.max > 0 ? `de ${group.max}` : ''} selecionados
                  </span>
                </div>
                
                <div className="grid gap-1.5">
                  {availableAddons.map((addon) => {
                    const checked = !!currentSelected.find(a => a.id === addon.id);
                    const disabled = group.max > 0 && !checked && currentSelected.length >= group.max && group.max > 1;

                    return (
                      <label
                        key={addon.id}
                        className={`flex items-center justify-between gap-2 p-2 border rounded cursor-pointer transition-colors bg-white ${checked ? 'border-primary/50 bg-primary/5' : 'hover:bg-slate-100'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <div className="flex items-center gap-2">
                          <input 
                            type={group.max === 1 ? 'radio' : 'checkbox'} 
                            name={`group-${groupIndex}`}
                            checked={checked}
                            onChange={() => !disabled && toggleMarmitaAddon(groupIndex, addon, group)}
                            disabled={disabled}
                            className="h-3.5 w-3.5 rounded-sm text-primary focus:ring-primary"
                          />
                          <span className={`text-xs ${checked ? 'font-medium text-primary' : 'text-slate-700'}`}>{addon.name}</span>
                        </div>
                        {addon.price > 0 && (() => {
                          const freeLimit = group.freeLimit || 0;
                          const selectedIndex = currentSelected.findIndex(a => a.id === addon.id);
                          const isSelected = selectedIndex >= 0;
                          // It's free ONLY if it is currently selected AND within the free limit
                          const isCurrentlyFree = isSelected && selectedIndex < freeLimit;

                          // If the free limit hasn't been reached yet, this item WOULD be free if selected.
                          // But we want the user to know it has a cost if they exceed the limit.
                          // So we show the price, unless it is actively selected as a free item.
                          return (
                            <span className="text-[11px] font-bold flex items-center gap-1.5">
                              {isCurrentlyFree ? (
                                <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[10px]">Grátis</span>
                              ) : (
                                <span className="text-emerald-600">+ R$ {addon.price.toFixed(2)}</span>
                              )}
                            </span>
                          );
                        })()}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="space-y-2">
            <Label className="text-sm font-semibold">Observações</Label>
            <Textarea
              placeholder="Ex: algum detalhe ou preferência, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="resize-none min-h-[50px] text-xs"
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
