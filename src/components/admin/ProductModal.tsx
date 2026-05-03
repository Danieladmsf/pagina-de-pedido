import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CurrencyInput } from '@/components/ui/currency-input';
import { doc, setDoc, updateDoc, collection } from 'firebase/firestore';
import { AddonGroup, Addon } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, GripVertical, Upload, Loader2 } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import Image from 'next/image';

interface ProductModalProps {
  db: any;
  user: any;
  addons: Addon[];
  editingProduct: any;
  setEditingProduct: (v: any) => void;
  categories: any[];
}

export function ProductModal({ db, user, addons, editingProduct, setEditingProduct, categories }: ProductModalProps) {
  const { toast } = useToast();
  const [categoryId, setCategoryId] = useState('');
  const [fixedItemsText, setFixedItemsText] = useState('');
  const [groups, setGroups] = useState<AddonGroup[]>([]);
  const [groupNameInput, setGroupNameInput] = useState('');
  const [groupSearchTerms, setGroupSearchTerms] = useState<Record<number, string>>({});
  
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [uploadingImage, setUploadingImage] = useState(false);

  const isMarmita = editingProduct?.isMarmita === true;

  // Initialize state when editingProduct changes
  useEffect(() => {
    if (editingProduct) {
      setCategoryId(editingProduct.categoryId || categories?.[0]?.id || '');
      setFixedItemsText((editingProduct.fixedItems || []).join(', '));
      setGroups(editingProduct.addonGroups || []);
      setGroupNameInput('');
      setGroupSearchTerms({});
      setImageFile(null);
      setImagePreview(editingProduct.imageUrl || '');
      setUploadingImage(false);
    }
  }, [editingProduct, categories]);

  const handleAddGroup = () => {
    const name = groupNameInput.trim() || 'Nova Etapa';
    setGroups([...groups, { name, addonIds: [], min: 1, max: 1 }]);
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

  const handleToggleFreeAddon = (groupIndex: number, addonId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const newGroups = [...groups];
    const group = newGroups[groupIndex];
    if (!group.freeAddonIds) group.freeAddonIds = [];
    
    if (group.freeAddonIds.includes(addonId)) {
      group.freeAddonIds = group.freeAddonIds.filter(id => id !== addonId);
    } else {
      group.freeAddonIds = [...group.freeAddonIds, addonId];
    }
    setGroups(newGroups);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const uploadImage = async (): Promise<string> => {
    if (!imageFile) return editingProduct?.imageUrl || '';
    setUploadingImage(true);
    try {
      const response = await fetch(`/api/upload?filename=${encodeURIComponent(imageFile.name)}`, {
        method: 'POST',
        body: imageFile,
      });
      if (!response.ok) {
        const text = await response.text();
        let errorMsg = 'Falha no upload da imagem';
        try { errorMsg = JSON.parse(text).error || errorMsg; } catch {}
        throw new Error(errorMsg);
      }
      const blob = await response.json();
      if (!blob.url) throw new Error('Upload não retornou URL válida');
      return blob.url;
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSaveProduct = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!db || !user) return;
    
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const priceStr = formData.get('price') as string;
    const price = parseFloat(priceStr.replace(/\./g, '').replace(',', '.')) || 0;

    let imageUrl = editingProduct?.imageUrl || '';
    
    try {
      if (!isMarmita && imageFile) {
        imageUrl = await uploadImage();
      }

      const fixedItems = fixedItemsText.split(',').map((s: string) => s.trim()).filter((s: string) => s);
      const description = isMarmita 
        ? (fixedItems.length > 0 ? `Itens fixos: ${fixedItems.join(', ')}` : '')
        : (formData.get('description') as string || '');

      const data = {
        name,
        price,
        categoryId,
        description,
        ownerId: user.uid,
        isAvailable: editingProduct?.id ? editingProduct.isAvailable : true,
        isMarmita,
        fixedItems: isMarmita ? fixedItems : [],
        addonGroups: groups,
        addonIds: [],
        imageUrl
      };

      if (editingProduct?.id) {
        await updateDoc(doc(db, 'menuItems', editingProduct.id), data);
        toast({ title: 'Produto atualizado com sucesso!' });
      } else {
        const ref = doc(collection(db, 'menuItems'));
        await setDoc(ref, { id: ref.id, ...data });
        toast({ title: 'Produto criado com sucesso!' });
      }
      setEditingProduct(null);
    } catch (err: any) {
      toast({ title: 'Erro ao salvar produto', description: err.message, variant: 'destructive' });
      setUploadingImage(false);
    }
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const newGroups = Array.from(groups);
    const [reordered] = newGroups.splice(result.source.index, 1);
    newGroups.splice(result.destination.index, 0, reordered);
    setGroups(newGroups);
  };

  if (editingProduct === null) return null;

  // Agrupar adicionais disponíveis para facilitar a seleção
  const addonsByGroup = addons?.reduce((acc: any, addon) => {
    const g = addon.group || 'Sem Grupo';
    if (!acc[g]) acc[g] = [];
    acc[g].push(addon);
    return acc;
  }, {});

  return (
    <Dialog open={editingProduct !== null} onOpenChange={(open) => { if (!open) setEditingProduct(null); }}>
      <DialogContent className="sm:max-w-[850px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {editingProduct.id 
              ? (isMarmita ? 'Editar Marmita/Prato Montável' : 'Editar Produto') 
              : (isMarmita ? 'Nova Marmita/Prato Montável' : 'Novo Produto')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSaveProduct} className="space-y-4 pt-4 flex-1 overflow-y-auto pr-2">
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome do {isMarmita ? 'Prato/Marmita' : 'Produto'}</Label>
              <Input id="name" name="name" defaultValue={editingProduct?.name} placeholder={isMarmita ? "Ex: Marmitex M (2 Carnes)" : "Ex: X-Burguer"} required />
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
              <CurrencyInput id="price" name="price" defaultValue={editingProduct?.price} required placeholder="0,00" />
            </div>
            {isMarmita ? (
              <div className="space-y-2">
                <Label htmlFor="fixedItems">Itens Fixos (Separados por vírgula)</Label>
                <Input id="fixedItems" value={fixedItemsText} onChange={e => setFixedItemsText(e.target.value)} placeholder="Ex: Arroz, Feijão, Salada" />
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Foto do Produto</Label>
                <div className="flex items-center gap-2">
                  {imagePreview && (
                    <div className="relative h-10 w-10 rounded overflow-hidden border flex-shrink-0">
                      <Image src={imagePreview} alt="preview" fill className="object-cover" />
                    </div>
                  )}
                  <label className="flex-1 cursor-pointer">
                    <div className="flex items-center justify-center gap-2 border border-dashed border-muted-foreground/30 rounded p-1.5 hover:border-primary transition-colors bg-muted/20 h-10">
                      <Upload className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {imageFile ? imageFile.name : 'Clique para escolher uma foto'}
                      </span>
                    </div>
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                  </label>
                </div>
              </div>
            )}
          </div>

          {!isMarmita && (
            <div className="space-y-2">
              <Label htmlFor="description">Descrição</Label>
              <Textarea id="description" name="description" defaultValue={editingProduct?.description} className="min-h-[60px] text-sm resize-none" placeholder="Ingredientes e detalhes do produto..." />
            </div>
          )}

          <div className="border-t pt-4">
            <Label className="text-base font-bold text-slate-700">Etapas de Escolha (Grupos de Adicionais)</Label>
            <p className="text-xs text-muted-foreground mb-3">
              Crie os passos que o cliente deve seguir. Ex: "1. Escolha a Carne", "2. Escolha as Guarnições".
            </p>

            <div className="mb-4">
              <Button type="button" onClick={handleAddGroup} variant="secondary" className="w-full sm:w-auto"><Plus className="h-4 w-4 mr-1"/> Adicionar Etapa</Button>
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
                                  className="h-8 font-semibold flex-1"
                                />
                                <div className="flex items-center gap-1 bg-emerald-50 border border-emerald-200 rounded px-2 whitespace-nowrap">
                                  <Label className="text-[10px] text-emerald-700 font-bold">Qtd Inclusa (Grátis)</Label>
                                  <Input type="number" min="0" value={group.freeLimit || 0} onChange={e => handleUpdateGroup(index, 'freeLimit', parseInt(e.target.value)||0)} className="w-10 h-7 px-1 text-center border-0 bg-transparent text-emerald-700 font-bold text-[11px]" />
                                </div>
                                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 ml-auto" onClick={() => handleRemoveGroup(index)}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                              
                              <div className="bg-white border rounded-md p-2 max-h-[150px] overflow-y-auto">
                                <div className="flex justify-between items-center mb-1">
                                  <Label className="text-xs text-muted-foreground">Selecione as opções disponíveis para este grupo:</Label>
                                  <Input 
                                    placeholder="Buscar..." 
                                    className="h-6 text-[10px] w-32"
                                    value={groupSearchTerms[index] || ''}
                                    onChange={(e) => setGroupSearchTerms({...groupSearchTerms, [index]: e.target.value})}
                                  />
                                </div>
                                {Object.keys(addonsByGroup || {}).map(g => {
                                  const searchTerm = (groupSearchTerms[index] || '').toLowerCase();
                                  const filtered = addonsByGroup[g].filter((addon: any) => addon.name.toLowerCase().includes(searchTerm));
                                  if (filtered.length === 0) return null;
                                  
                                  return (
                                    <div key={g} className="mb-2">
                                      <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">{g}</div>
                                      <div className="grid grid-cols-2 gap-1">
                                        {filtered.map((addon: any) => {
                                          const isChecked = group.addonIds.includes(addon.id);
                                          const isFree = group.freeAddonIds?.includes(addon.id);
                                          return (
                                            <label key={addon.id} className="flex items-center gap-2 text-xs p-1 hover:bg-slate-50 rounded cursor-pointer group/item">
                                              <input 
                                                type="checkbox" 
                                                checked={isChecked}
                                                onChange={() => handleToggleAddonInGroup(index, addon.id)}
                                                className="rounded text-primary focus:ring-primary"
                                              />
                                              <span className="truncate flex-1">{addon.name}</span>
                                              {addon.price > 0 && (
                                                <div className="flex items-center gap-1">
                                                  {isFree ? (
                                                    <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1 rounded font-bold">Grátis</span>
                                                  ) : (
                                                    <span className="text-emerald-600">+R$ {addon.price.toFixed(2)}</span>
                                                  )}
                                                  {isChecked && (
                                                    <button type="button" onClick={(e) => handleToggleFreeAddon(index, addon.id, e)} className="opacity-0 group-hover/item:opacity-100 text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 px-1 rounded transition-opacity">
                                                      {isFree ? 'Cobrar' : 'Isentar'}
                                                    </button>
                                                  )}
                                                </div>
                                              )}
                                            </label>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )
                                })}
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
            <Button type="submit" className="w-full font-bold" disabled={uploadingImage}>
              {uploadingImage ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Enviando foto...</> : (isMarmita ? 'Salvar Marmita' : 'Salvar Produto')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
