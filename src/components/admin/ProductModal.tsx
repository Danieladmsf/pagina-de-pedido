import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Card, CardContent } from '@/components/ui/card';
import { doc, setDoc, updateDoc, collection } from 'firebase/firestore';
import { AddonGroup, Addon } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, GripVertical, Upload, Loader2, ArrowLeft, X, Check } from 'lucide-react';
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
  const [groupSearchTerms, setGroupSearchTerms] = useState<Record<number, string>>({});
  
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [uploadingImage, setUploadingImage] = useState(false);

  const isMarmita = editingProduct?.isMarmita === true;

  useEffect(() => {
    if (editingProduct) {
      setCategoryId(editingProduct.categoryId || categories?.[0]?.id || '');
      setFixedItemsText((editingProduct.fixedItems || []).join(', '));
      setGroups(editingProduct.addonGroups || []);
      setGroupSearchTerms({});
      setImageFile(null);
      setImagePreview(editingProduct.imageUrl || '');
      setUploadingImage(false);
    }
  }, [editingProduct, categories]);

  const handleAddGroup = () => {
    setGroups([...groups, { name: `Etapa ${groups.length + 1}`, addonIds: [], freeLimit: 1, max: 0 }]);
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

  const handleRemoveAddonFromGroup = (groupIndex: number, addonId: string) => {
    const newGroups = [...groups];
    newGroups[groupIndex].addonIds = newGroups[groupIndex].addonIds.filter(id => id !== addonId);
    if (newGroups[groupIndex].freeAddonIds) {
      newGroups[groupIndex].freeAddonIds = newGroups[groupIndex].freeAddonIds!.filter(id => id !== addonId);
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

  const allAddons = [...(addons || [])].sort((a, b) => a.name.localeCompare(b.name));

  const pageTitle = editingProduct.id 
    ? (isMarmita ? 'Editar Marmita/Prato Montável' : 'Editar Produto') 
    : (isMarmita ? 'Nova Marmita/Prato Montável' : 'Novo Produto');

  return (
    <div className="space-y-4">
      {/* Header com seta e título */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setEditingProduct(null)} className="h-9 w-9 rounded-full hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-xl font-bold text-slate-800">{pageTitle}</h2>
      </div>

      {/* Card de Dados Básicos */}
      <Card className="border shadow-md rounded-2xl overflow-hidden">
        <CardContent className="p-6">
          <form onSubmit={handleSaveProduct} id="product-form" className="space-y-5">
            
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 md:col-span-4 space-y-1.5">
                <Label htmlFor="name" className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Nome</Label>
                <Input id="name" name="name" defaultValue={editingProduct?.name} placeholder={isMarmita ? "Ex: Marmitex M" : "Ex: X-Burguer"} required />
              </div>
              <div className="col-span-12 md:col-span-4 space-y-1.5">
                <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Categoria</Label>
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm" required>
                  {categories?.map((cat: any) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-6 md:col-span-2 space-y-1.5">
                <Label htmlFor="price" className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Preço (R$)</Label>
                <CurrencyInput id="price" name="price" defaultValue={editingProduct?.price} required placeholder="0,00" />
              </div>
              {!isMarmita && (
                <div className="col-span-6 md:col-span-2 space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Foto</Label>
                  <div className="flex items-center gap-2">
                    {imagePreview && (
                      <div className="relative h-10 w-10 rounded-lg overflow-hidden border flex-shrink-0">
                        <Image src={imagePreview} alt="preview" fill className="object-cover" />
                      </div>
                    )}
                    <label className="flex-1 cursor-pointer">
                      <div className="flex items-center justify-center gap-1.5 border border-dashed border-muted-foreground/30 rounded-lg hover:border-primary transition-colors bg-muted/10 h-10 px-2">
                        <Upload className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="text-[11px] text-muted-foreground truncate">
                          {imageFile ? imageFile.name : 'Foto'}
                        </span>
                      </div>
                      <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                    </label>
                  </div>
                </div>
              )}
            </div>

            {isMarmita ? (
              <div className="space-y-1.5">
                <Label htmlFor="fixedItems" className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Itens Fixos (separados por vírgula)</Label>
                <Input id="fixedItems" value={fixedItemsText} onChange={e => setFixedItemsText(e.target.value)} placeholder="Ex: Arroz, Feijão, Salada" />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="description" className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Descrição</Label>
                <Input id="description" name="description" defaultValue={editingProduct?.description} placeholder="Ingredientes e detalhes do produto..." />
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Card de Etapas */}
      <Card className="border shadow-md rounded-2xl overflow-hidden">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-700">Etapas de Escolha</h3>
              <p className="text-xs text-muted-foreground">
                Ex: &quot;Escolha a Carne&quot;, &quot;Escolha as Guarnições&quot;
              </p>
            </div>
            <Button type="button" onClick={handleAddGroup} variant="outline" size="sm" className="gap-1.5">
              <Plus className="h-4 w-4"/> Etapa
            </Button>
          </div>

          {groups.length > 0 ? (
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="groups">
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-4">
                    {groups.map((group, index) => {
                      const searchTerm = (groupSearchTerms[index] || '').toLowerCase();
                      const filteredAddons = allAddons.filter(a => a.name.toLowerCase().includes(searchTerm));
                      const selectedAddons = allAddons.filter(a => group.addonIds.includes(a.id));
                      const availableAddons = filteredAddons.filter(a => !group.addonIds.includes(a.id));

                      // Agrupar por grupo
                      const availableByGroup: Record<string, Addon[]> = {};
                      availableAddons.forEach(a => {
                        const g = a.group || 'Sem Grupo';
                        if (!availableByGroup[g]) availableByGroup[g] = [];
                        availableByGroup[g].push(a);
                      });

                      return (
                        <Draggable key={`group-${index}`} draggableId={`group-${index}`} index={index}>
                          {(provided) => (
                            <div ref={provided.innerRef} {...provided.draggableProps} className="border rounded-xl bg-white shadow-sm">
                              {/* Header da Etapa */}
                              <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 rounded-t-xl border-b">
                                <div {...provided.dragHandleProps} className="cursor-grab text-slate-300 hover:text-slate-500 transition-colors">
                                  <GripVertical className="h-4 w-4" />
                                </div>
                                <span className="text-xs font-bold text-slate-400 bg-slate-200 rounded-full h-6 w-6 flex items-center justify-center">{index + 1}</span>
                                <Input 
                                  value={group.name} 
                                  onChange={e => handleUpdateGroup(index, 'name', e.target.value)} 
                                  className="h-8 font-semibold flex-1 border-0 bg-transparent shadow-none focus-visible:ring-1 px-2"
                                  placeholder="Nome da etapa..."
                                />
                                <div className="flex items-center gap-1.5">
                                  <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-lg px-2 py-0.5 whitespace-nowrap">
                                    <span className="text-[10px] text-amber-700 font-semibold" title="0 = Sem Limite">Máximo:</span>
                                    <Input type="number" min="0" value={group.max || 0} onChange={e => handleUpdateGroup(index, 'max', parseInt(e.target.value)||0)} className="w-8 h-6 px-0 text-center border-0 bg-transparent text-amber-700 font-bold text-xs shadow-none focus-visible:ring-0" title="Limite máximo de escolhas (0 = Ilimitado)" />
                                  </div>
                                  <div className="flex items-center gap-1 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-0.5 whitespace-nowrap">
                                    <span className="text-[10px] text-emerald-700 font-semibold">Grátis:</span>
                                    <Input type="number" min="0" value={group.freeLimit || 0} onChange={e => handleUpdateGroup(index, 'freeLimit', parseInt(e.target.value)||0)} className="w-8 h-6 px-0 text-center border-0 bg-transparent text-emerald-700 font-bold text-xs shadow-none focus-visible:ring-0" title="Quantidade de itens que saem de graça" />
                                  </div>
                                </div>
                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-destructive" onClick={() => handleRemoveGroup(index)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>

                              {/* Corpo: Dois painéis lado a lado */}
                              <div className="p-3">
                                {/* Barra de pesquisa fora dos cards */}
                                <div className="mb-3">
                                  <Input 
                                    placeholder="🔍 Buscar adicionais..." 
                                    className="h-8 text-xs"
                                    value={groupSearchTerms[index] || ''}
                                    onChange={(e) => setGroupSearchTerms({...groupSearchTerms, [index]: e.target.value})}
                                  />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                  {/* Painel Esquerdo: Disponíveis */}
                                  <div className="border rounded-lg overflow-hidden">
                                    <div className="bg-slate-50 px-3 py-1.5 border-b">
                                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Disponíveis</span>
                                    </div>
                                    <div className="max-h-[180px] overflow-y-auto p-1.5 space-y-0.5">
                                      {Object.keys(availableByGroup).length > 0 ? Object.entries(availableByGroup).map(([gName, gAddons]) => (
                                        <div key={gName}>
                                          <div className="text-[9px] font-bold uppercase text-slate-300 px-1 pt-1">{gName}</div>
                                          {gAddons.map((addon: any) => (
                                            <button
                                              key={addon.id}
                                              type="button"
                                              onClick={() => handleToggleAddonInGroup(index, addon.id)}
                                              className="w-full flex items-center gap-1.5 text-xs px-2 py-1 rounded hover:bg-emerald-50 hover:text-emerald-700 transition-colors text-left group/avail"
                                            >
                                              <Plus className="h-3 w-3 text-slate-300 group-hover/avail:text-emerald-500 flex-shrink-0" />
                                              <span className="truncate flex-1">{addon.name}</span>
                                              {addon.price > 0 && (
                                                <span className="text-[10px] text-slate-400 flex-shrink-0">R$ {addon.price.toFixed(2)}</span>
                                              )}
                                            </button>
                                          ))}
                                        </div>
                                      )) : (
                                        <div className="text-center text-[11px] text-slate-300 py-4">
                                          {searchTerm ? 'Nenhum resultado' : 'Todos adicionados'}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Painel Direito: Selecionados */}
                                  <div className="border rounded-lg overflow-hidden border-emerald-200">
                                    <div className="bg-emerald-50 px-3 py-1.5 border-b border-emerald-200 flex justify-between items-center">
                                      <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">Selecionados</span>
                                      <span className="text-[10px] bg-emerald-100 text-emerald-600 rounded-full px-1.5 font-bold">{selectedAddons.length}</span>
                                    </div>
                                    <div className="max-h-[180px] overflow-y-auto p-1.5 space-y-0.5">
                                      {selectedAddons.length > 0 ? selectedAddons.map((addon: any) => {
                                        const isFree = group.freeAddonIds?.includes(addon.id);
                                        return (
                                          <div key={addon.id} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-emerald-50/50 group/sel">
                                            <Check className="h-3 w-3 text-emerald-500 flex-shrink-0" />
                                            <span className="truncate flex-1 text-slate-700">{addon.name}</span>
                                            {addon.price > 0 && (
                                              <button
                                                type="button"
                                                onClick={(e) => handleToggleFreeAddon(index, addon.id, e)}
                                                className={`text-[10px] px-1.5 py-0.5 rounded font-semibold transition-colors flex-shrink-0 ${
                                                  isFree 
                                                    ? 'bg-emerald-100 text-emerald-700 hover:bg-amber-100 hover:text-amber-700' 
                                                    : 'bg-amber-50 text-amber-600 hover:bg-emerald-100 hover:text-emerald-700'
                                                }`}
                                              >
                                                {isFree ? 'Grátis' : `+R$ ${addon.price.toFixed(2)}`}
                                              </button>
                                            )}
                                            <button
                                              type="button"
                                              onClick={() => handleRemoveAddonFromGroup(index, addon.id)}
                                              className="opacity-0 group-hover/sel:opacity-100 transition-opacity flex-shrink-0"
                                            >
                                              <X className="h-3 w-3 text-slate-400 hover:text-red-500" />
                                            </button>
                                          </div>
                                        );
                                      }) : (
                                        <div className="text-center text-[11px] text-slate-300 py-4">
                                          Clique em &quot;+&quot; para adicionar
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          ) : (
            <div className="text-center py-8 border border-dashed rounded-xl text-slate-400 text-sm bg-slate-50/50">
              Nenhuma etapa configurada. <br/> Clique em &quot;+ Etapa&quot; para criar.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Botões de ação */}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" className="h-10 px-6" onClick={() => setEditingProduct(null)}>
          Cancelar
        </Button>
        <Button type="submit" form="product-form" className="h-10 px-10 font-bold" disabled={uploadingImage}>
          {uploadingImage ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Enviando foto...</> : (isMarmita ? 'Salvar Marmita' : 'Salvar Produto')}
        </Button>
      </div>
    </div>
  );
}
