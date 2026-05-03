import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Card, CardContent } from '@/components/ui/card';
import { doc, setDoc, updateDoc, collection } from 'firebase/firestore';
import { MenuItem, ComboItem } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft } from 'lucide-react';

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
    const price = parseFloat(priceStr) || 0;

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
        const ref = doc(collection(db, 'menuItems'));
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
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setEditingCombo(null)} className="h-9 w-9 rounded-full hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-xl font-bold text-slate-800">{editingCombo.id ? 'Editar Combo' : 'Novo Combo'}</h2>
      </div>

      <Card className="border shadow-md rounded-2xl overflow-hidden">
        <CardContent className="p-6">
          <form onSubmit={handleSaveCombo} id="combo-form" className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Selecione os Produtos do Combo</Label>
                <div className="border rounded-md p-2 h-[200px] overflow-y-auto space-y-1">
                  {items?.filter(i => !i.isCombo && !i.isMarmita).map((item) => (
                    <div key={item.id} className="flex items-center space-x-2 p-1.5 hover:bg-slate-50 rounded">
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

              <div className="space-y-2">
                <div className="flex justify-between items-center h-[20px] mt-1">
                  <Label>Itens Selecionados ({selectedItems.length})</Label>
                </div>
                <div className="border rounded-md p-2 h-[200px] overflow-y-auto space-y-1 bg-slate-50">
                  {selectedItems.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground italic text-center px-4">
                      Nenhum item selecionado.<br/>Marque os produtos ao lado.
                    </div>
                  ) : (
                    selectedItems.map((item) => (
                      <div key={item.itemId} className="flex items-center justify-between p-2 bg-white rounded border border-slate-100 shadow-sm">
                        <span className="text-sm font-medium text-slate-700 truncate pr-2" title={item.name}>{item.name}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground font-medium">R$ {item.price.toFixed(2)}</span>
                          <Button 
                            type="button" 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6 text-red-400 hover:text-red-600 hover:bg-red-50"
                            onClick={() => handleToggleItem({ id: item.itemId, name: item.name, price: item.price } as any)}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="bg-slate-50 p-4 rounded-lg flex justify-between items-center border">
              <div>
                <span className="text-xs text-muted-foreground">Valor sem desconto (soma)</span>
                <div className="font-semibold text-slate-400 line-through">R$ {originalPrice.toFixed(2)}</div>
              </div>
              <div className="space-y-1 w-[180px]">
                <Label htmlFor="price" className="text-emerald-700 font-bold">Preço do Combo (R$)</Label>
                <CurrencyInput id="price" name="price" defaultValue={editingCombo?.price} required placeholder="0,00" />
              </div>
            </div>

          </form>
        </CardContent>
      </Card>

      {/* Botões de ação */}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" className="h-10 px-6" onClick={() => setEditingCombo(null)}>
          Cancelar
        </Button>
        <Button type="submit" form="combo-form" className="h-10 px-10 font-bold">Salvar Combo</Button>
      </div>
    </div>
  );
}
