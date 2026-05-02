import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { AddonGroup, Addon } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';

interface MarmitaModalProps {
  db: any;
  user: any;
  addons: Addon[];
  editingMarmita: any;
  setEditingMarmita: (v: any) => void;
  categories: any[];
}

export function MarmitaModal({ db, user, addons, editingMarmita, setEditingMarmita, categories }: MarmitaModalProps) {
  const { toast } = useToast();
  const [categoryId, setCategoryId] = useState(editingMarmita?.categoryId || categories?.[0]?.id || '');
  const [fixedItemsText, setFixedItemsText] = useState((editingMarmita?.fixedItems || []).join(', '));
  const [groups, setGroups] = useState<AddonGroup[]>(editingMarmita?.addonGroups || []);
  const [groupNameInput, setGroupNameInput] = useState('');
  
  const handleAddGroup = () => {
    if (!groupNameInput.trim()) return;
    setGroups([...groups, { name: groupNameInput.trim(), addonIds: [], min: 1, max: 1 }]);
    setGroupNameInput('');
  };

  const handleRemoveGroup = (index: number) => {
    setGroups(groups.filter((_, i) => i !== index));
  };

  const handleUpdateGroup = (index: number, field: keyof AddonGroup, value: any) => {
    const newGroups = [...groups];
    newGroups[index] = { ...newGroups[index], [field]: value };
    setGroups(newGroups);
  };

  const handleToggleAddonInGroup = (groupIndex: number, addonId: string) => {
    const newGroups = [...groups];
    const group = newGroups[groupIndex];
    if (group.addonIds.includes(addonId)) {
      group.addonIds = group.addonIds.filter(id => id !== addonId);
    } else {
      group.addonIds = [...group.addonIds, addonId];
    }
    setGroups(newGroups);
  };

  const handleSaveMarmita = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!db || !user) return;
    
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const priceStr = formData.get('price') as string;
    const price = parseFloat(priceStr.replace(/\./g, '').replace(',', '.')) || 0;

    const fixedItems = fixedItemsText.split(',').map((s: string) => s.trim()).filter((s: string) => s);

    const data = {
      name,
      price,
      categoryId,
      description: fixedItems.length > 0 ? `Itens fixos: ${fixedItems.join(', ')}` : '',
      ownerId: user.uid,
      isAvailable: true,
      isMarmita: true,
      fixedItems,
      addonGroups: groups,
      addonIds: [],
      imageUrl: ''
    };

    try {
      if (editingMarmita?.id) {
        await updateDoc(doc(db, 'menuItems', editingMarmita.id), data);
        toast({ title: 'Marmita atualizada com sucesso!' });
      } else {
        const ref = doc(db, 'menuItems');
        await setDoc(ref, { id: ref.id, ...data });
        toast({ title: 'Marmita criada com sucesso!' });
      }
      setEditingMarmita(null);
    } catch (err: any) {
      toast({ title: 'Erro ao salvar marmita', description: err.message, variant: 'destructive' });
    }
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const newGroups = Array.from(groups);
    const [reordered] = newGroups.splice(result.source.index, 1);
    newGroups.splice(result.destination.index, 0, reordered);
    setGroups(newGroups);
  };

  if (editingMarmita === null) return null;

  // Agrupar adicionais disponíveis para facilitar a seleção
  const addonsByGroup = addons?.reduce((acc: any, addon) => {
    const g = addon.group || 'Sem Grupo';
    if (!acc[g]) acc[g] = [];
    acc[g].push(addon);
    return acc;
  }, {});

  return (
    <Dialog open={editingMarmita !== null} onOpenChange={(open) => { if (!open) setEditingMarmita(null); }}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{editingMarmita.id ? 'Editar Marmita/Prato Montável' : 'Nova Marmita / Prato Montável'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSaveMarmita} className="space-y-4 pt-4 flex-1 overflow-y-auto pr-2">
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome do Prato/Marmita</Label>
              <Input id="name" name="name" defaultValue={editingMarmita?.name} placeholder="Ex: Marmitex M (2 Carnes)" required />
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="price">Preço Base (R$)</Label>
              <CurrencyInput id="price" name="price" defaultValue={editingMarmita?.price} required placeholder="0,00" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fixedItems">Itens Fixos (Separados por vírgula)</Label>
              <Input id="fixedItems" value={fixedItemsText} onChange={e => setFixedItemsText(e.target.value)} placeholder="Ex: Arroz, Feijão, Salada" />
            </div>
          </div>

          <div className="border-t pt-4">
            <Label className="text-base font-bold text-slate-700">Etapas de Escolha (Grupos de Adicionais)</Label>
            <p className="text-xs text-muted-foreground mb-3">
              Crie os passos que o cliente deve seguir. Ex: "1. Escolha a Carne", "2. Escolha as Guarnições".
            </p>

            <div className="flex gap-2 mb-4">
              <Input placeholder="Nome do novo grupo (Ex: Escolha a Carne)" value={groupNameInput} onChange={e => setGroupNameInput(e.target.value)} onKeyDown={e => { if(e.key === 'Enter'){ e.preventDefault(); handleAddGroup(); }}} />
              <Button type="button" onClick={handleAddGroup} variant="secondary"><Plus className="h-4 w-4 mr-1"/> Adicionar Etapa</Button>
            </div>

            {groups.length > 0 ? (
              <DragDropContext onDragEnd={onDragEnd}>
                <Droppable droppableId="groups">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-3">
                      {groups.map((group, index) => (
                        <Draggable key={`group-${index}`} draggableId={`group-${index}`} index={index}>
                          {(provided) => (
                            <div ref={provided.innerRef} {...provided.draggableProps} className="border rounded-lg bg-slate-50 p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <div {...provided.dragHandleProps} className="cursor-grab text-slate-400">
                                  <GripVertical className="h-4 w-4" />
                                </div>
                                <Input 
                                  value={group.name} 
                                  onChange={e => handleUpdateGroup(index, 'name', e.target.value)} 
                                  className="h-8 font-semibold"
                                />
                                <div className="flex items-center gap-1 bg-white border rounded px-2">
                                  <Label className="text-xs">Min</Label>
                                  <Input type="number" min="0" value={group.min} onChange={e => handleUpdateGroup(index, 'min', parseInt(e.target.value)||0)} className="w-12 h-7 px-1 text-center border-0" />
                                  <Label className="text-xs ml-1">Max</Label>
                                  <Input type="number" min="1" value={group.max} onChange={e => handleUpdateGroup(index, 'max', parseInt(e.target.value)||1)} className="w-12 h-7 px-1 text-center border-0" />
                                </div>
                                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 ml-auto" onClick={() => handleRemoveGroup(index)}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                              
                              <div className="bg-white border rounded-md p-2 max-h-[150px] overflow-y-auto">
                                <Label className="text-xs text-muted-foreground mb-1 block">Selecione as opções disponíveis para este grupo:</Label>
                                {Object.keys(addonsByGroup || {}).map(g => (
                                  <div key={g} className="mb-2">
                                    <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">{g}</div>
                                    <div className="grid grid-cols-2 gap-1">
                                      {addonsByGroup[g].map((addon: any) => (
                                        <label key={addon.id} className="flex items-center gap-2 text-xs p-1 hover:bg-slate-50 rounded cursor-pointer">
                                          <input 
                                            type="checkbox" 
                                            checked={group.addonIds.includes(addon.id)}
                                            onChange={() => handleToggleAddonInGroup(index, addon.id)}
                                            className="rounded text-primary focus:ring-primary"
                                          />
                                          <span className="truncate flex-1">{addon.name}</span>
                                          {addon.price > 0 && <span className="text-emerald-600">+R$ {addon.price.toFixed(2)}</span>}
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            ) : (
              <div className="text-center py-6 border border-dashed rounded-lg text-slate-400 text-sm">
                Nenhuma etapa configurada. <br/> Adicione etapas como "Escolha as Carnes" ou "Guarnições".
              </div>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button type="submit" className="w-full font-bold">Salvar Marmita</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
