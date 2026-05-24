"use client"

import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MenuItem, Addon, SelectedAddon, AddonGroup, AddonCategory } from '@/lib/types';
import { useCart } from '@/components/providers/CartProvider';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import Image from 'next/image';
import { Minus, Plus, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';

const checkCartStock = (
  projectedCart: any[],
  menuItemsList: MenuItem[],
  enableInventory: boolean
): { allowed: boolean; message?: string } => {
  if (!enableInventory || !menuItemsList || menuItemsList.length === 0) return { allowed: true };

  const demand: Record<string, number> = {};

  projectedCart.forEach(item => {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) return;

    if (item.isCombo && item.comboItems) {
      item.comboItems.forEach((ci: any) => {
        demand[ci.itemId] = (demand[ci.itemId] || 0) + qty;
      });
    } else {
      demand[item.id] = (demand[item.id] || 0) + qty;
    }
  });

  for (const [productId, reqQty] of Object.entries(demand)) {
    const matchedProduct = menuItemsList.find(m => m.id === productId);
    if (!matchedProduct) continue;

    const rawStock = (matchedProduct as any).stockQuantity;
    const availableStock = typeof rawStock === 'number' && Number.isFinite(rawStock) && rawStock >= 0 ? rawStock : null;

    if (availableStock !== null && reqQty > availableStock) {
      return {
        allowed: false,
        message: `"${matchedProduct.name}" tem apenas ${availableStock} unidade(s) disponível(is).`
      };
    }
  }

  return { allowed: true };
};

interface MenuItemDialogProps {
  item: MenuItem | null;
  isOpen: boolean;
  onClose: () => void;
  allAddons?: Addon[];
  addonCategories?: AddonCategory[];
  isStoreOpen?: boolean;
  onAddToCart?: (item: any, quantity: number, options: any) => void;
  menuItems?: MenuItem[];
  enableInventory?: boolean;
}

export function MenuItemDialog({ item, isOpen, onClose, allAddons = [], addonCategories = [], isStoreOpen = true, onAddToCart, menuItems = [], enableInventory = false }: MenuItemDialogProps) {
  const { addToCart, cart } = useCart();
  const { toast } = useToast();
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const addButtonRef = React.useRef<HTMLButtonElement>(null);
  const quantityPlusButtonRef = React.useRef<HTMLButtonElement>(null);
  
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

  const getCategoryForGroup = (group: AddonGroup) => {
    if (group.addonCategoryId) {
      const categoryById = addonCategories.find(item => item.id === group.addonCategoryId);
      if (categoryById) return categoryById;
    }
    if (group.addonCategoryName) {
      return addonCategories.find(item => item.name === group.addonCategoryName);
    }
    return undefined;
  };

  const getCategoryAddonIds = (category: AddonCategory) => {
    const removedIds = new Set(category.removedAddonIds || []);
    const legacyIds = allAddons
      .filter(addon => (addon.group || '').trim() === category.name)
      .map(addon => addon.id);
    return Array.from(new Set([...(category.addonIds || []), ...legacyIds]))
      .filter(id => !removedIds.has(id));
  };

  const getGroupAddonIds = (group: AddonGroup) => {
    const category = getCategoryForGroup(group);
    if (category) return getCategoryAddonIds(category);
    if (group.addonCategoryName) {
      const legacyIds = allAddons
        .filter(addon => (addon.group || '').trim() === group.addonCategoryName)
        .map(addon => addon.id);
      if (legacyIds.length > 0) return legacyIds;
    }
    return group.addonIds || [];
  };

  const groupUsesPrice = (group: AddonGroup) => {
    const category = getCategoryForGroup(group);
    if (category) return category.usePrice !== false;
    if (typeof group.usePrice === 'boolean') return group.usePrice;
    return group.usePrice !== false;
  };

  const getNumericGroupValue = (value: unknown) => {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
  };

  const toggleNormalAddon = (addon: Addon) => {
    setSelectedAddons(prev => {
      const exists = prev.find(a => a.id === addon.id);
      if (exists) return prev.filter(a => a.id !== addon.id);
      return [...prev, { id: addon.id, name: addon.name, description: addon.description, price: addon.price }];
    });
  };

  const updateMarmitaAddonQuantity = (groupIndex: number, addon: Addon, group: AddonGroup, delta: 1 | -1) => {
    setMarmitaSelections(prev => {
      const current = prev[groupIndex] || [];
      let next = [...current];
      if (delta > 0) {
        const limit = getNumericGroupValue(group.max);
        
        if (limit === 1) {
          next = [{ id: addon.id, name: addon.name, description: addon.description, price: addon.price }];
        } else if (limit > 0 && next.length >= limit) {
          return prev;
        } else {
          next.push({ id: addon.id, name: addon.name, description: addon.description, price: addon.price });
        }
      } else {
        let removeIndex = -1;
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].id === addon.id) {
            removeIndex = i;
            break;
          }
        }
        if (removeIndex === -1) return prev;
        next.splice(removeIndex, 1);
      }
      return { ...prev, [groupIndex]: next };
    });
  };

  const getAddonQuantity = (selection: SelectedAddon[], addonId: string) =>
    selection.filter(a => a.id === addonId).length;

  // Calcula total
  let addonsTotal = 0;
  let finalAddonsList: SelectedAddon[] = [];

  if (item.addonGroups && item.addonGroups.length > 0) {
    item.addonGroups.forEach((group, index) => {
      const arr = marmitaSelections[index] || [];
      
      arr.forEach((a) => {
        const effectivePrice = groupUsesPrice(group) ? Number(a.price) || 0 : 0;
        addonsTotal += effectivePrice;
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
      const minRequired = getNumericGroupValue(g.min);
      if (selectedCount < minRequired) {
        canAddToCart = false;
        validationMessage = `Selecione ao menos ${minRequired} em: ${g.name}`;
        break;
      }
    }
  }

  const handleAdd = () => {
    if (!canAddToCart) return;

    if (enableInventory && menuItems && menuItems.length > 0) {
      const mockItem: any = { ...item, quantity, isCombo: item.isCombo, comboItems: item.comboItems };
      const projectedCart = [...cart, mockItem];
      const check = checkCartStock(projectedCart, menuItems, enableInventory);
      if (!check.allowed) {
        toast({
          title: "Estoque insuficiente",
          description: check.message,
          variant: "destructive"
        });
        return;
      }
    }

    if (onAddToCart) {
      onAddToCart(item, quantity, { addons: finalAddonsList, notes });
    } else {
      addToCart(item, quantity, { addons: finalAddonsList, notes });
    }
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    onClose();
    window.setTimeout(() => {
      const checkoutButton = document.querySelector('[data-floating-checkout]') as HTMLButtonElement | null;
      checkoutButton?.focus({ preventScroll: true });
    }, 120);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="sm:max-w-[400px] max-h-[85dvh] overflow-hidden flex flex-col p-4"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          window.requestAnimationFrame(() => {
            const target = addButtonRef.current && !addButtonRef.current.disabled
              ? addButtonRef.current
              : quantityPlusButtonRef.current;
            target?.focus({ preventScroll: true });
          });
        }}
      >
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

        <div className="space-y-6 py-4 flex-1 min-h-0 overflow-y-auto pr-2">
          
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
          {productAddons.length > 0 && (
            <div className="space-y-2 p-3 border rounded-md bg-slate-50/50">
              <Label className="text-sm font-bold text-slate-800">Adicionais</Label>
              <div className="grid gap-1.5">
                {productAddons.map((addon) => {
                  const checked = !!selectedAddons.find(a => a.id === addon.id);

                  return (
                    <label
                      key={addon.id}
                      className={`flex items-start justify-between gap-2 p-2 border rounded cursor-pointer transition-colors bg-white ${checked ? 'border-primary/50 bg-primary/5' : 'hover:bg-slate-100'}`}
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleNormalAddon(addon)}
                          className="mt-0.5 h-3.5 w-3.5 rounded-sm text-primary focus:ring-primary"
                        />
                        <div className="min-w-0">
                          <span className={`block text-xs font-semibold leading-tight ${checked ? 'text-primary' : 'text-slate-800'}`}>
                            {addon.name}
                          </span>
                          {addon.description && (
                            <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                              {addon.description}
                            </span>
                          )}
                        </div>
                      </div>
                      {addon.price > 0 && (
                        <span className="shrink-0 text-[11px] font-bold text-emerald-600">+ R$ {addon.price.toFixed(2)}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Addon Groups */}
          {item.addonGroups && item.addonGroups.map((group, groupIndex) => {
            const groupAddonIds = getGroupAddonIds(group);
            const availableAddons = allAddons.filter(a => groupAddonIds.includes(a.id) && a.active !== false);
            const currentSelected = marmitaSelections[groupIndex] || [];
            const usesPrice = groupUsesPrice(group);
            const maxChoices = getNumericGroupValue(group.max);
            const minChoices = getNumericGroupValue(group.min);
            
            if (availableAddons.length === 0) return null;

            return (
              <div key={groupIndex} className="space-y-2 p-3 border rounded-md bg-slate-50/50">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <Label className="text-sm font-bold text-slate-800">{group.name}</Label>
                    <div className="flex gap-1">
                      <span className="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-600 font-medium">
                        {maxChoices > 0 ? `Escolha de ${minChoices} a ${maxChoices}` : 'Sem limite'}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium">
                    {currentSelected.length} {maxChoices > 0 ? `de ${maxChoices}` : ''} selecionados
                  </span>
                </div>
                
                <div className="grid gap-1.5">
                  {availableAddons.map((addon) => {
                    const selectedQuantity = getAddonQuantity(currentSelected, addon.id);
                    const limit = maxChoices;
                    const canIncrease = limit === 0 || currentSelected.length < limit;
                    const isSelected = selectedQuantity > 0;
                    const isLockedByLimit = limit > 0 && currentSelected.length >= limit && !isSelected;

                    return (
                      <div
                        key={addon.id}
                        className={`flex items-center justify-between gap-3 border-b border-slate-100 px-1 py-2 transition-opacity last:border-b-0 ${isSelected ? 'bg-primary/5' : 'bg-white'} ${isLockedByLimit ? 'opacity-40' : ''}`}
                      >
                        <div className="min-w-0">
                          <span className={`block text-xs font-semibold leading-tight ${isSelected ? 'text-primary' : 'text-slate-800'}`}>
                            {addon.name}
                          </span>
                          {addon.description && (
                            <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                              {addon.description}
                            </span>
                          )}
                          {usesPrice && addon.price > 0 && (
                            <span className="mt-0.5 block text-[11px] font-bold text-emerald-600">+ R$ {addon.price.toFixed(2)}</span>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <button
                            type="button"
                            onClick={() => updateMarmitaAddonQuantity(groupIndex, addon, group, -1)}
                            disabled={selectedQuantity === 0}
                            aria-label={`Diminuir ${addon.name}`}
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-black text-white transition-opacity disabled:opacity-25"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="w-4 text-center text-xs font-bold text-slate-600">{selectedQuantity}</span>
                          <button
                            type="button"
                            onClick={() => updateMarmitaAddonQuantity(groupIndex, addon, group, 1)}
                            disabled={!canIncrease}
                            aria-label={`Adicionar ${addon.name}`}
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-black text-white transition-opacity disabled:opacity-25"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
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

        <DialogFooter className="flex-col gap-4 border-t bg-background pt-4 shrink-0">
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
              <Button ref={quantityPlusButtonRef} variant="ghost" size="icon" onClick={() => setQuantity(quantity + 1)}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <Button
              ref={addButtonRef}
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
