import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { MenuItem, ComboItem } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Checkbox } from '@/components/ui/checkbox';

interface ComboModalProps {
  db: any;
  user: any;
  items: MenuItem[];
  editingCombo: any;
  setEditingCombo: (v: any) => void;
  categories: any[];
}

export function ComboModal({ db, user, items, editingCombo, setEditingCombo, categories }: ComboModalProps) {
  const { toast } = useToast();
  const [selectedItems, setSelectedItems] = useState<ComboItem[]>(editingCombo?.comboItems || []);
  const [categoryId, setCategoryId] = useState(editingCombo?.categoryId || categories?.[0]?.id || '');
  
  const handleToggleItem = (item: MenuItem) => {
    if (selectedItems.find(i => i.itemId === item.id)) {
      setSelectedItems(selectedItems.filter(i => i.itemId !== item.id));
    } else {
      setSelectedItems([...selectedItems, { itemId: item.id, name: item.name, price: item.price }]);
    }
  };

  const originalPrice = selectedItems.reduce((acc, curr) => acc + curr.price, 0);

  const handleSaveCombo = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!db || !user) return;
    
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const priceStr = formData.get('price') as string;
    const price = parseFloat(priceStr.replace(/\./g, '').replace(',', '.')) || 0;

    const data = {
      name,
      price,
      categoryId,
      description: `Itens do combo: ${selectedItems.map(i => i.name).join(', ')}`,
      ownerId: user.uid,
      isAvailable: true,
      isCombo: true,
      comboItems: selectedItems,
      originalPrice,
      addonIds: [],
      imageUrl: ''
    };

    try {
      if (editingCombo?.id) {
        await updateDoc(doc(db, 'menuItems', editingCombo.id), data);
        toast({ title: 'Combo atualizado com sucesso!' });
      } else {
        const ref = doc(db, 'menuItems');
        await setDoc(ref, { id: ref.id, ...data });
        toast({ title: 'Combo criado com sucesso!' });
      }
      setEditingCombo(null);
    } catch (err: any) {
      toast({ title: 'Erro ao salvar combo', description: err.message, variant: 'destructive' });
    }
  };

  if (editingCombo === null) return null;

  return (
    <Dialog open={editingCombo !== null} onOpenChange={(open) => { if (!open) setEditingCombo(null); }}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{editingCombo.id ? 'Editar Combo' : 'Novo Combo'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSaveCombo} className="space-y-4 pt-4 flex-1 overflow-y-auto pr-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome do Combo</Label>
              <Input id="name" name="name" defaultValue={editingCombo?.name} placeholder="Ex: Combo X-Tudo" required />
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm" required>
                {categories?.map((cat: any) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Selecione os Produtos do Combo</Label>
            <div className="border rounded-md p-2 h-[200px] overflow-y-auto space-y-1">
              {items?.filter(i => !i.isCombo && !i.isMarmita).map((item) => (
                <div key={item.id} className="flex items-center space-x-2 p-1 hover:bg-slate-50 rounded">
                  <Checkbox 
                    id={`combo-item-${item.id}`} 
                    checked={!!selectedItems.find(i => i.itemId === item.id)}
                    onCheckedChange={() => handleToggleItem(item)}
                  />
                  <Label htmlFor={`combo-item-${item.id}`} className="flex-1 cursor-pointer font-normal text-sm">
                    {item.name} <span className="text-muted-foreground ml-1">(R$ {item.price.toFixed(2)})</span>
                  </Label>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-lg flex justify-between items-center border">
            <div>
              <span className="text-xs text-muted-foreground">Valor sem desconto (soma)</span>
              <div className="font-semibold text-slate-400 line-through">R$ {originalPrice.toFixed(2)}</div>
            </div>
            <div className="space-y-1 w-[150px]">
              <Label htmlFor="price" className="text-emerald-700 font-bold">Preço do Combo (R$)</Label>
              <CurrencyInput id="price" name="price" defaultValue={editingCombo?.price} required placeholder="0,00" />
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button type="submit" className="w-full font-bold">Salvar Combo</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
