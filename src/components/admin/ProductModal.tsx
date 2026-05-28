import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { doc, setDoc, updateDoc, collection, writeBatch, getDoc } from 'firebase/firestore';
import { AddonGroup, Addon, AddonCategory } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, GripVertical, Upload, Loader2, ArrowLeft, X, Check, Power, PowerOff } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import Image from 'next/image';
import { uploadImage } from '@/lib/upload';

interface ProductModalProps {
  db: any;
  user: any;
  addons: Addon[];
  addonCategories?: AddonCategory[];
  editingProduct: any;
  setEditingProduct: (v: any) => void;
  categories: any[];
  items?: any[];
}

export function ProductModal({ db, user, addons, addonCategories = [], editingProduct, setEditingProduct, categories, items = [] }: ProductModalProps) {
  const { toast } = useToast();
  const [categoryId, setCategoryId] = useState('');
  const [fixedItemsText, setFixedItemsText] = useState('');
  const [groups, setGroups] = useState<AddonGroup[]>([]);
  
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [isReplicateModalOpen, setIsReplicateModalOpen] = useState(false);
  const [replicateTargetIds, setReplicateTargetIds] = useState<string[]>([]);
  const [replicateCategoryId, setReplicateCategoryId] = useState('all');
  const [isReplicating, setIsReplicating] = useState(false);

  const isMarmita = editingProduct?.isMarmita === true;



  useEffect(() => {
    if (editingProduct) {
      setCategoryId(editingProduct.categoryId || categories?.[0]?.id || '');
      setFixedItemsText((editingProduct.fixedItems || []).join(', '));
      setGroups(editingProduct.addonGroups || []);
      setImageFile(null);
      setImagePreview(editingProduct.imageUrl || '');
      setUploadingImage(false);
      setIsReplicateModalOpen(false);
      setReplicateTargetIds([]);
      setReplicateCategoryId('all');
    }
  }, [editingProduct, categories]);

  const handleAddGroup = () => {
    setGroups([...groups, { name: `Etapa ${groups.length + 1}`, addonIds: [], min: 0, max: 0 }]);
  };

  const handleRemoveGroup = (index: number) => {
    setGroups(groups.filter((_, i) => i !== index));
  };

  const handleUpdateGroup = (index: number, field: keyof AddonGroup, value: any) => {
    const newGroups = [...groups];
    newGroups[index] = { ...newGroups[index], [field]: value };
    setGroups(newGroups);
  };

  const handleRemoveAddonFromGroup = (groupIndex: number, addonId: string) => {
    const newGroups = [...groups];
    newGroups[groupIndex].addonIds = newGroups[groupIndex].addonIds.filter(id => id !== addonId);
    setGroups(newGroups);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleUploadImage = async (): Promise<string> => {
    if (!imageFile) return editingProduct?.imageUrl || '';
    setUploadingImage(true);
    try {
      return await uploadImage(imageFile);
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
    const price = parseFloat(priceStr) || 0;
    
    const stockQuantityStr = formData.get('stockQuantity') as string;
    const stockQuantity = stockQuantityStr ? parseInt(stockQuantityStr, 10) : null;

    let imageUrl = editingProduct?.imageUrl || '';
    
    try {
      if (imageFile) {
        imageUrl = await handleUploadImage();
      }

      const fixedItems = fixedItemsText.split(',').map((s: string) => s.trim()).filter((s: string) => s);
      const description = isMarmita 
        ? (fixedItems.length > 0 ? `Itens fixos: ${fixedItems.join(', ')}` : '')
        : (formData.get('description') as string || '');
      const addonGroups = buildCleanAddonGroups();

      const data = {
        name,
        price,
        stockQuantity,
        categoryId,
        description,
        ownerId: user.uid,
        isAvailable: editingProduct?.id ? editingProduct.isAvailable : true,
        isMarmita,
        fixedItems: isMarmita ? fixedItems : [],
        addonGroups,
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
  const addonContainers = (() => {
    const byName = new Map<string, { id: string; name: string; addonIds: string[]; removedAddonIds: string[]; usePrice: boolean; max: number }>();

    for (const category of addonCategories || []) {
      const ids = Array.isArray(category.addonIds) ? category.addonIds : [];
      const removedAddonIds = Array.isArray(category.removedAddonIds) ? category.removedAddonIds : [];
      byName.set(category.name, {
        id: category.id,
        name: category.name,
        addonIds: ids.filter(id => !removedAddonIds.includes(id)),
        removedAddonIds,
        usePrice: category.usePrice !== false,
        max: category.max || 0,
      });
    }

    for (const addon of addons || []) {
      const name = addon.group || 'Geral';
      const existing = byName.get(name);
      if (existing) {
        if (!existing.removedAddonIds.includes(addon.id) && !existing.addonIds.includes(addon.id)) existing.addonIds.push(addon.id);
      } else {
        byName.set(name, {
          id: `legacy:${name}`,
          name,
          addonIds: [addon.id],
          removedAddonIds: [],
          usePrice: true,
          max: 0,
        });
      }
    }

    return Array.from(byName.values())
      .map(container => ({
        ...container,
        addonIds: Array.from(new Set(container.addonIds)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  })();

  const getContainerForGroup = (group: AddonGroup) => {
    if (group.addonCategoryId) {
      const containerById = addonContainers.find(container => container.id === group.addonCategoryId);
      if (containerById) return containerById;
    }
    if (group.addonCategoryName) {
      return addonContainers.find(container => container.name === group.addonCategoryName);
    }
    return undefined;
  };

  const getGroupAddonIds = (group: AddonGroup) => getContainerForGroup(group)?.addonIds || group.addonIds || [];

  const buildCleanAddonGroups = () => groups.map((group) => {
    const cleanGroup = { ...group, addonIds: getGroupAddonIds(group) } as Record<string, unknown>;
    delete cleanGroup.freeLimit;
    delete cleanGroup.freeAddonIds;
    return cleanGroup;
  });

  const replicateTargets = (items || [])
    .filter((item: any) => item.id && item.id !== editingProduct?.id && !item.isCombo)
    .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));

  const productHasAddonGroups = (item: any) => Array.isArray(item?.addonGroups) && item.addonGroups.length > 0;
  const selectedReplicateCategory = categories?.find((cat: any) => cat.id === replicateCategoryId);
  const getCategoryNameForItem = (item: any) => categories?.find((cat: any) => cat.id === item.categoryId)?.name || item.category || 'Sem categoria';

  const filteredReplicateTargets = replicateCategoryId === 'all'
    ? replicateTargets
    : replicateTargets.filter((item: any) => item.categoryId === replicateCategoryId || item.category === selectedReplicateCategory?.name);

  const eligibleReplicateTargets = filteredReplicateTargets.filter((item: any) => !productHasAddonGroups(item));

  const toggleReplicateTarget = (item: any) => {
    if (productHasAddonGroups(item)) return;
    const itemId = item.id;
    setReplicateTargetIds(prev =>
      prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId]
    );
  };

  const allReplicateTargetsSelected = eligibleReplicateTargets.length > 0
    && eligibleReplicateTargets.every((item: any) => replicateTargetIds.includes(item.id));

  const toggleAllReplicateTargets = () => {
    setReplicateTargetIds(allReplicateTargetsSelected ? [] : eligibleReplicateTargets.map((item: any) => item.id));
  };

  const handleReplicateAddonGroups = async () => {
    if (!db || replicateTargetIds.length === 0) return;
    setIsReplicating(true);
    try {
      const batch = writeBatch(db);
      const addonGroups = buildCleanAddonGroups();
      const targetDocs = await Promise.all(Array.from(new Set(replicateTargetIds)).map(async (itemId) => {
        const ref = doc(db, 'menuItems', itemId);
        const snapshot = await getDoc(ref);
        return { ref, snapshot };
      }));
      const targetsWithoutGroups = targetDocs.filter(({ snapshot }) => {
        if (!snapshot.exists()) return false;
        return !productHasAddonGroups(snapshot.data());
      });

      if (targetsWithoutGroups.length === 0) {
        toast({
          title: 'Nenhum produto atualizado',
          description: 'Os produtos selecionados ja possuem etapas.',
        });
        return;
      }

      targetsWithoutGroups.forEach(({ ref }) => batch.update(ref, { addonGroups }));
      await batch.commit();
      const skippedCount = replicateTargetIds.length - targetsWithoutGroups.length;
      toast({
        title: `Etapas replicadas em ${targetsWithoutGroups.length} produto(s).`,
        description: skippedCount > 0 ? `${skippedCount} produto(s) com etapas existentes foram ignorados.` : undefined,
      });
      setIsReplicateModalOpen(false);
      setReplicateTargetIds([]);
      setReplicateCategoryId('all');
    } catch (err: any) {
      toast({ title: 'Erro ao replicar etapas', description: err.message, variant: 'destructive' });
    } finally {
      setIsReplicating(false);
    }
  };

  const handleSelectAddonContainer = (groupIndex: number, containerId: string) => {
    const container = addonContainers.find(item => item.id === containerId);
    if (!container) return;

    const newGroups = [...groups];
    const current = newGroups[groupIndex];
    const shouldUseContainerName = !current.name.trim() || /^Etapa \d+$/i.test(current.name.trim());

    newGroups[groupIndex] = {
      ...current,
      name: shouldUseContainerName ? container.name : current.name,
      addonCategoryId: container.id.startsWith('legacy:') ? undefined : container.id,
      addonCategoryName: container.name,
      usePrice: container.usePrice,
      addonIds: container.addonIds,
    };
    setGroups(newGroups);
  };

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
              <div className="col-span-4 md:col-span-2 space-y-1.5">
                <Label htmlFor="price" className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Preço (R$)</Label>
                <CurrencyInput id="price" name="price" defaultValue={editingProduct?.price} required placeholder="0,00" />
              </div>
              <div className="col-span-4 md:col-span-2 space-y-1.5">
                <Label htmlFor="stockQuantity" className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Estoque</Label>
                <Input id="stockQuantity" name="stockQuantity" type="number" defaultValue={editingProduct?.stockQuantity ?? ''} placeholder="∞" />
              </div>
              <div className="col-span-4 md:col-span-2 space-y-1.5">
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
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                onClick={() => setIsReplicateModalOpen(true)}
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={groups.length === 0 || eligibleReplicateTargets.length === 0}
              >
                <Check className="h-4 w-4"/> Replicar
              </Button>
              <Button type="button" onClick={handleAddGroup} variant="outline" size="sm" className="gap-1.5">
                <Plus className="h-4 w-4"/> Etapa
              </Button>
            </div>
          </div>

          {groups.length > 0 ? (
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="groups">
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-4">
                    {groups.map((group, index) => {
                      const selectedAddons = allAddons.filter(a => getGroupAddonIds(group).includes(a.id));
                      const currentContainerId = group.addonCategoryId || (group.addonCategoryName
                        ? addonContainers.find(container => container.name === group.addonCategoryName)?.id || ''
                        : '');

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
                                    <Input type="number" min="0" value={group.max || getContainerForGroup(group)?.max || 0} onChange={e => handleUpdateGroup(index, 'max', parseInt(e.target.value)||0)} className="w-8 h-6 px-0 text-center border-0 bg-transparent text-amber-700 font-bold text-xs shadow-none focus-visible:ring-0" title="Limite máximo de escolhas (0 = Ilimitado)" />
                                  </div>
                                </div>
                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-destructive" onClick={() => handleRemoveGroup(index)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>

                              {/* Corpo da etapa */}
                              <div className="p-3">
                                <div className="mb-3 max-w-sm space-y-1">
                                    <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Container de adicionais</Label>
                                    <select
                                      value={currentContainerId}
                                      onChange={(e) => handleSelectAddonContainer(index, e.target.value)}
                                      className="h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
                                    >
                                      <option value="">Selecione um container...</option>
                                      {addonContainers.map(container => (
                                        <option key={container.id} value={container.id}>
                                          {container.name} ({container.addonIds.length})
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                <div className="grid grid-cols-1 gap-3">
                                  <div className="border rounded-lg overflow-hidden border-emerald-200 flex flex-col">
                                    <div className="bg-emerald-50 px-3 py-1.5 border-b border-emerald-200 flex justify-between items-center">
                                      <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">Itens da etapa</span>
                                      <span className="text-[10px] bg-emerald-100 text-emerald-600 rounded-full px-1.5 font-bold">{selectedAddons.length}</span>
                                    </div>
                                    <div className="h-[180px] overflow-y-auto p-1.5 space-y-0.5 bg-white">
                                      {selectedAddons.length > 0 ? selectedAddons.map((addon: any) => {
                                        return (
                                          <div key={addon.id} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-emerald-50/50 group/sel">
                                            <Check className="h-3 w-3 text-emerald-500 flex-shrink-0" />
                                            <span 
                                              className={`truncate flex-1 transition-colors ${addon.active === false ? 'text-red-500 line-through' : 'text-slate-700'}`} 
                                              title={addon.name}
                                            >
                                              {addon.name}
                                            </span>
                                            {group.usePrice !== false && addon.price > 0 && (
                                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-semibold flex-shrink-0">
                                                +R$ {addon.price.toFixed(2)}
                                              </span>
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
                                          Selecione um container para listar os itens desta etapa.
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

      <Dialog open={isReplicateModalOpen} onOpenChange={(open) => {
        setIsReplicateModalOpen(open);
        if (!open) {
          setReplicateTargetIds([]);
          setReplicateCategoryId('all');
        }
      }}>
        <DialogContent className="sm:max-w-[860px]">
          <DialogHeader>
            <DialogTitle>Replicar etapas para produtos</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-lg border bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <span className="font-bold">{groups.length}</span> etapa(s) de <span className="font-bold">{editingProduct?.name}</span>.
              Produtos que ja possuem etapas ficam bloqueados.
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_auto] md:items-end">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Categoria</Label>
                <select
                  value={replicateCategoryId}
                  onChange={(e) => {
                    setReplicateCategoryId(e.target.value);
                    setReplicateTargetIds([]);
                  }}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="all">Todas as categorias</option>
                  {categories?.map((cat: any) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between gap-3 md:justify-end">
                <span className="text-xs font-semibold text-slate-500">
                  {replicateTargetIds.length} selecionado(s) de {eligibleReplicateTargets.length} disponiveis
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={toggleAllReplicateTargets}
                  disabled={eligibleReplicateTargets.length === 0}
                  className="h-10 px-4 text-xs font-bold"
                >
                  {allReplicateTargetsSelected ? 'Limpar selecao' : 'Selecionar tudo'}
                </Button>
              </div>
            </div>

            <div className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${eligibleReplicateTargets.length === 0 ? 'bg-slate-50 text-slate-400' : 'bg-emerald-50 text-emerald-800'}`}>
              <Checkbox
                id="replicate-select-all"
                checked={allReplicateTargetsSelected}
                onCheckedChange={toggleAllReplicateTargets}
                disabled={eligibleReplicateTargets.length === 0}
                className="h-4 w-4"
              />
              <Label
                htmlFor="replicate-select-all"
                className={`flex-1 text-sm font-bold ${eligibleReplicateTargets.length === 0 ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                Selecionar tudo disponivel nesta categoria
              </Label>
              <span className="text-xs font-semibold">
                {eligibleReplicateTargets.length} produto(s)
              </span>
            </div>

            <div className="max-h-[320px] overflow-y-auto rounded-lg border bg-white">
              {filteredReplicateTargets.length > 0 ? (
                filteredReplicateTargets.map((item: any) => {
                  const checkboxId = `replicate-product-${item.id}`;
                  const isChecked = replicateTargetIds.includes(item.id);
                  const hasGroups = productHasAddonGroups(item);

                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 border-b px-3 py-2.5 text-sm last:border-b-0 ${hasGroups ? 'bg-slate-50 text-slate-400' : 'cursor-pointer hover:bg-slate-50'}`}
                    >
                      <Checkbox
                        id={checkboxId}
                        checked={isChecked}
                        onCheckedChange={() => toggleReplicateTarget(item)}
                        disabled={hasGroups}
                        className="h-4 w-4"
                      />
                      <Label htmlFor={checkboxId} className={`flex min-w-0 flex-1 items-center gap-3 font-normal ${hasGroups ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                        <span className={`min-w-0 flex-1 truncate font-medium ${hasGroups ? 'text-slate-400' : 'text-slate-700'}`} title={item.name}>
                          {item.name}
                        </span>
                        <span className="hidden w-44 truncate text-xs text-slate-500 md:block" title={getCategoryNameForItem(item)}>
                          {getCategoryNameForItem(item)}
                        </span>
                        {hasGroups && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                            Ja possui etapas
                          </span>
                        )}
                      </Label>
                    </div>
                  );
                })
              ) : (
                <div className="px-3 py-8 text-center text-sm text-slate-400">
                  Nenhum produto nesta categoria.
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsReplicateModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleReplicateAddonGroups}
              disabled={replicateTargetIds.length === 0 || isReplicating}
              className="bg-primary text-white"
            >
              {isReplicating ? 'Replicando...' : `Replicar (${replicateTargetIds.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
