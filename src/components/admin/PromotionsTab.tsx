'use client';

import React, { useState, useMemo } from 'react';
import { collection, doc, setDoc, deleteDoc, query, where, Timestamp } from 'firebase/firestore';
import { useCollection, useMemoFirebase } from '@/firebase';
import { normalizeSearch } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CurrencyInput } from '@/components/ui/currency-input';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import {
  Plus, Trash2, Pencil, Clock, Tag, Flame, Search,
  CalendarDays, Package, Percent, Eye, EyeOff, Play, Pause, Copy, Box
} from 'lucide-react';

interface PromotionsTabProps {
  db: any;
  user: any;
  items: any[];
  categories: any[];
  setEditingCombo: (c: any) => void;
}

interface PromoItem {
  menuItemId: string;
  originalPrice: number;
  promoPrice: number;
  discountType: 'fixed' | 'percentage';
  discountValue: number;
  hideAfterPromo: boolean;
  promoOnly: boolean;
}

interface Promotion {
  id?: string;
  ownerId: string;
  name: string;
  startDate: any;
  endDate?: any;
  noEndDate?: boolean;
  active: boolean;
  createdAt: any;
  items: PromoItem[];
}

function dateValueToMillis(value: any) {
  if (!value) return NaN;
  const date = value?.toDate?.() ? value.toDate() : new Date(value);
  return date.getTime();
}

function getPromoStartMillis(promo: any) {
  const time = dateValueToMillis(promo.startDate);
  return Number.isFinite(time) ? time : 0;
}

function getPromoEndMillis(promo: any) {
  if (promo.noEndDate || !promo.endDate) return Number.POSITIVE_INFINITY;
  const time = dateValueToMillis(promo.endDate);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function getPromoEndDate(promo: any) {
  if (promo.noEndDate || !promo.endDate) return null;
  const date = promo.endDate?.toDate?.() ? promo.endDate.toDate() : new Date(promo.endDate);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getPromoStatus(promo: Promotion): 'active' | 'scheduled' | 'expired' | 'paused' {
  if (!promo.active) return 'paused';
  const now = Date.now();
  const start = getPromoStartMillis(promo);
  const end = getPromoEndMillis(promo);
  if (now < start) return 'scheduled';
  if (now > end) return 'expired';
  return 'active';
}

const STATUS_CONFIG = {
  active: { label: 'Ativa', color: 'bg-emerald-500', textColor: 'text-emerald-700', bgLight: 'bg-emerald-50', icon: Play },
  scheduled: { label: 'Agendada', color: 'bg-amber-500', textColor: 'text-amber-700', bgLight: 'bg-amber-50', icon: Clock },
  expired: { label: 'Expirada', color: 'bg-slate-400', textColor: 'text-slate-600', bgLight: 'bg-slate-50', icon: Clock },
  paused: { label: 'Pausada', color: 'bg-orange-500', textColor: 'text-orange-700', bgLight: 'bg-orange-50', icon: Pause },
};

function formatDateLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}

export function PromotionsTab({ db, user, items, categories, setEditingCombo }: PromotionsTabProps) {
  const { toast } = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPromo, setEditingPromo] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Form state
  const [formName, setFormName] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formNoEndDate, setFormNoEndDate] = useState(false);
  const [formActive, setFormActive] = useState(true);
  const [formItems, setFormItems] = useState<PromoItem[]>([]);
  const [itemSearchQuery, setItemSearchQuery] = useState('');

  // Firebase query
  const promotionsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collection(db, 'promotions'), where('ownerId', '==', user.uid));
  }, [db, user]);

  const { data: promotionsRaw } = useCollection(promotionsQuery);
  const promotions = (promotionsRaw || []) as any[];

  const itemsMap = useMemo(() => {
    const map: Record<string, any> = {};
    (items || []).forEach((it: any) => { map[it.id] = it; });
    return map;
  }, [items]);

  const categoriesMap = useMemo(() => {
    const map: Record<string, string> = {};
    (categories || []).forEach((c: any) => { map[c.id] = c.name; });
    return map;
  }, [categories]);

  const resetForm = () => {
    setFormName('');
    const now = new Date();
    setFormStartDate(formatDateLocal(now));
    const end = new Date(now);
    end.setDate(end.getDate() + 7);
    setFormEndDate(formatDateLocal(end));
    setFormNoEndDate(false);
    setFormActive(true);
    setFormItems([]);
    setItemSearchQuery('');
    setEditingPromo(null);
  };

  const openNewPromo = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEditPromo = (promo: any) => {
    setEditingPromo(promo);
    setFormName(promo.name || '');
    const start = promo.startDate?.toDate?.() ? promo.startDate.toDate() : new Date(promo.startDate);
    const noEndDate = promo.noEndDate || !promo.endDate;
    const end = getPromoEndDate(promo);
    const fallbackEnd = new Date();
    fallbackEnd.setDate(fallbackEnd.getDate() + 7);
    setFormStartDate(formatDateLocal(start));
    setFormEndDate(formatDateLocal(end || fallbackEnd));
    setFormNoEndDate(noEndDate);
    setFormActive(promo.active ?? true);
    
    // Sincroniza os itens com os preços e descontos mais recentes do catálogo
    const syncedItems = (promo.items || []).map((fi: any) => {
      const currentItem = itemsMap[fi.menuItemId];
      if (currentItem) {
        const originalPrice = currentItem.price || 0;
        let promoPrice = fi.promoPrice;
        if (fi.discountType === 'percentage') {
          promoPrice = Math.round(originalPrice * (1 - fi.discountValue / 100) * 100) / 100;
        } else {
          promoPrice = Math.max(0, originalPrice - fi.discountValue);
        }
        return {
          ...fi,
          originalPrice,
          promoPrice
        };
      }
      return fi;
    });
    setFormItems(syncedItems);
    setItemSearchQuery('');
    setIsModalOpen(true);
  };

  const addItemToPromo = (menuItem: any) => {
    if (formItems.find(fi => fi.menuItemId === menuItem.id)) return;
    const price = menuItem.price || 0;
    const defaultDiscount = 10;
    const promoPrice = Math.round(price * (1 - defaultDiscount / 100) * 100) / 100;
    setFormItems(prev => [...prev, {
      menuItemId: menuItem.id,
      originalPrice: price,
      promoPrice,
      discountType: 'percentage' as const,
      discountValue: defaultDiscount,
      hideAfterPromo: false,
      promoOnly: false,
    }]);
  };

  const removeItemFromPromo = (menuItemId: string) => {
    setFormItems(prev => prev.filter(fi => fi.menuItemId !== menuItemId));
  };

  const updatePromoItem = (menuItemId: string, updates: Partial<PromoItem>) => {
    setFormItems(prev => prev.map(fi => {
      if (fi.menuItemId !== menuItemId) return fi;
      const updated = { ...fi, ...updates };
      // Recalculate promoPrice based on discount
      if (updates.discountType || updates.discountValue !== undefined) {
        if (updated.discountType === 'percentage') {
          updated.promoPrice = Math.round(updated.originalPrice * (1 - updated.discountValue / 100) * 100) / 100;
        } else {
          updated.promoPrice = Math.max(0, updated.originalPrice - updated.discountValue);
        }
      }
      if (updates.promoPrice !== undefined) {
        updated.discountValue = updated.originalPrice - updated.promoPrice;
        updated.discountType = 'fixed';
      }
      return updated;
    }));
  };

  const handleSave = async () => {
    if (!db || !user) return;
    if (!formName.trim()) { toast({ title: 'Erro', description: 'Dê um nome à promoção.' }); return; }
    if (formItems.length === 0) { toast({ title: 'Erro', description: 'Adicione pelo menos um produto.' }); return; }
    if (!formStartDate || (!formNoEndDate && !formEndDate)) { toast({ title: 'Erro', description: 'Defina as datas.' }); return; }

    // Check for duplicate products in other active/scheduled promotions
    const newStart = new Date(formStartDate).getTime();
    const newEnd = formNoEndDate ? Number.POSITIVE_INFINITY : new Date(formEndDate).getTime();
    const conflicts: string[] = [];
    for (const fi of formItems) {
      for (const other of promotions) {
        if (editingPromo && other.id === editingPromo.id) continue;
        if (!other.active) continue;
        const otherStart = getPromoStartMillis(other);
        const otherEnd = getPromoEndMillis(other);
        // Check if date ranges overlap
        if (newStart <= otherEnd && newEnd >= otherStart) {
          const otherItems = (other.items || []).map((i: any) => i.menuItemId);
          if (otherItems.includes(fi.menuItemId)) {
            const itemName = itemsMap[fi.menuItemId]?.name || fi.menuItemId;
            conflicts.push(`"${itemName}" já está na promoção "${other.name}"`);
          }
        }
      }
    }
    if (conflicts.length > 0) {
      toast({ title: '⚠️ Produto duplicado', description: conflicts.join('; ') });
      return;
    }

    const data: any = {
      ownerId: user.uid,
      name: formName.trim(),
      startDate: Timestamp.fromDate(new Date(formStartDate)),
      endDate: formNoEndDate ? null : Timestamp.fromDate(new Date(formEndDate)),
      noEndDate: formNoEndDate,
      active: formActive,
      items: formItems,
      updatedAt: Timestamp.now(),
    };

    try {
      if (editingPromo) {
        await setDoc(doc(db, 'promotions', editingPromo.id), data, { merge: true });
        toast({ title: '✅ Promoção atualizada!' });
      } else {
        data.createdAt = Timestamp.now();
        const ref = doc(collection(db, 'promotions'));
        data.id = ref.id;
        await setDoc(ref, data);
        toast({ title: '🔥 Promoção criada com sucesso!' });
      }
      setIsModalOpen(false);
      resetForm();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message });
    }
  };

  const handleDelete = async (promoId: string) => {
    if (!db || !confirm('Excluir esta promoção?')) return;
    await deleteDoc(doc(db, 'promotions', promoId));
    toast({ title: '🗑️ Promoção excluída.' });
  };

  const handleToggleActive = async (promo: any) => {
    if (!db) return;
    await setDoc(doc(db, 'promotions', promo.id), { active: !promo.active }, { merge: true });
    toast({ title: promo.active ? '⏸️ Promoção pausada.' : '▶️ Promoção ativada!' });
  };

  const handleDuplicate = (promo: any) => {
    resetForm();
    setFormName(`${promo.name} (Cópia)`);
    setFormItems(promo.items || []);
    setIsModalOpen(true);
  };

  // Map of itemIds already in other active/scheduled promos (for visual indicator)
  const itemsInOtherPromos = useMemo(() => {
    const map: Record<string, string> = {}; // menuItemId -> promoName
    const now = Date.now();
    promotions.forEach((p: any) => {
      if (editingPromo && p.id === editingPromo.id) return;
      if (!p.active) return;
      const end = getPromoEndMillis(p);
      if (now > end) return; // expired
      (p.items || []).forEach((pi: any) => {
        map[pi.menuItemId] = p.name;
      });
    });
    return map;
  }, [promotions, editingPromo]);

  // Filter items not yet in the promotion
  const availableItems = useMemo(() => {
    const addedIds = new Set(formItems.map(fi => fi.menuItemId));
    return (items || []).filter((it: any) => {
      if (addedIds.has(it.id)) return false;
      if (!itemSearchQuery) return true;
      return normalizeSearch(it.name).includes(normalizeSearch(itemSearchQuery));
    });
  }, [items, formItems, itemSearchQuery]);

  const filteredPromotions = useMemo(() => {
    if (!searchQuery) return promotions;
    return promotions.filter((p: any) => normalizeSearch(p.name).includes(normalizeSearch(searchQuery)));
  }, [promotions, searchQuery]);

  const combos = useMemo(() => {
    return (items || []).filter(i => i.isCombo);
  }, [items]);

  const filteredCombos = useMemo(() => {
    if (!searchQuery) return combos;
    return combos.filter(c => normalizeSearch(c.name).includes(normalizeSearch(searchQuery)));
  }, [combos, searchQuery]);

  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      <div className="max-w-[1200px] w-full mx-auto px-4 pb-8 mt-4 space-y-6">
        {/* Header */}
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-800 flex items-center gap-2">
              <Tag className="h-7 w-7 text-purple-600" />
              Ofertas e Combos
            </h1>
            <p className="text-muted-foreground mt-1 font-medium">
              Configure promoções temporárias com desconto ou agrupe produtos em combos.
            </p>
          </div>
        </div>

        <Tabs defaultValue="promocoes" className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="promocoes" className="gap-1.5"><Flame className="h-4 w-4" /> Promoções</TabsTrigger>
            <TabsTrigger value="combos" className="gap-1.5"><Box className="h-4 w-4" /> Combos</TabsTrigger>
          </TabsList>

          <TabsContent value="promocoes" className="space-y-6 mt-6">
            <div className="flex justify-between items-center gap-3">
              <div className="relative max-w-sm flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Buscar promoção..."
                  className="pl-10 rounded-xl"
                />
              </div>
              <Button onClick={openNewPromo} className="bg-orange-500 hover:bg-orange-600 text-white gap-2 rounded-xl shadow-md shrink-0">
                <Plus className="h-4 w-4" /> Nova Promoção
              </Button>
            </div>

        {/* Promotions Grid */}
        {filteredPromotions.length === 0 ? (
          <Card className="border-dashed border-2 rounded-2xl">
            <CardContent className="py-16 text-center">
              <Flame className="h-12 w-12 text-orange-300 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-slate-700">Nenhuma promoção ainda</h3>
              <p className="text-sm text-muted-foreground mt-1">Crie sua primeira campanha promocional!</p>
              <Button onClick={openNewPromo} className="mt-4 bg-orange-500 hover:bg-orange-600 text-white gap-2 rounded-xl">
                <Plus className="h-4 w-4" /> Criar Promoção
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPromotions.map((promo: any) => {
              const status = getPromoStatus(promo);
              const cfg = STATUS_CONFIG[status];
              const StatusIcon = cfg.icon;
              const start = promo.startDate?.toDate?.() ? promo.startDate.toDate() : new Date(promo.startDate);
              const end = getPromoEndDate(promo) || { toLocaleDateString: () => 'Sem prazo' };
              const promoItems = promo.items || [];

              return (
                <Card key={promo.id} className="border shadow-sm rounded-2xl hover:shadow-md transition-shadow overflow-hidden">
                  <div className={`h-1.5 ${cfg.color}`} />
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-bold text-slate-800 truncate">{promo.name}</h3>
                        <div className="flex items-center gap-1.5 mt-1">
                          <Badge className={`${cfg.bgLight} ${cfg.textColor} border-0 text-[10px] font-bold gap-1`}>
                            <StatusIcon className="h-3 w-3" /> {cfg.label}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {promoItems.length} {promoItems.length === 1 ? 'item' : 'itens'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground space-y-1">
                      <div className="flex items-center gap-1.5">
                        <CalendarDays className="h-3 w-3" />
                        {start.toLocaleDateString('pt-BR')} → {end.toLocaleDateString('pt-BR')}
                      </div>
                    </div>

                    {/* Mini preview of items */}
                    <div className="flex flex-wrap gap-1">
                      {promoItems.slice(0, 3).map((pi: any) => {
                        const item = itemsMap[pi.menuItemId];
                        return (
                          <Badge key={pi.menuItemId} variant="outline" className="text-[10px] py-0 gap-1">
                            <Tag className="h-2.5 w-2.5" />
                            {item?.name?.slice(0, 15) || 'Item'}{item?.name?.length > 15 ? '...' : ''}
                          </Badge>
                        );
                      })}
                      {promoItems.length > 3 && (
                        <Badge variant="outline" className="text-[10px] py-0">+{promoItems.length - 3}</Badge>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 pt-1 border-t">
                      <Button size="sm" variant="ghost" className="h-8 text-xs gap-1 flex-1" onClick={() => openEditPromo(promo)}>
                        <Pencil className="h-3 w-3" /> Editar
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={() => handleToggleActive(promo)}>
                        {promo.active ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={() => handleDuplicate(promo)}>
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 text-xs gap-1 text-red-500 hover:text-red-700" onClick={() => handleDelete(promo.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
          </TabsContent>

          {/* ─── Combos Tab ─── */}
          <TabsContent value="combos" className="space-y-6 mt-6">
            <div className="flex justify-between items-center gap-3">
              <div className="relative max-w-sm flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Buscar combo..."
                  className="pl-10 rounded-xl"
                />
              </div>
              <Button onClick={() => setEditingCombo({})} className="bg-purple-600 hover:bg-purple-700 text-white gap-2 rounded-xl shadow-md shrink-0">
                <Plus className="h-4 w-4" /> Novo Combo
              </Button>
            </div>

            {filteredCombos.length === 0 ? (
              <Card className="border-dashed border-2 rounded-2xl">
                <CardContent className="py-16 text-center">
                  <Box className="h-12 w-12 text-purple-300 mx-auto mb-4" />
                  <h3 className="text-lg font-bold text-slate-700">Nenhum combo ainda</h3>
                  <p className="text-sm text-muted-foreground mt-1">Agrupe produtos em um combo para facilitar as vendas!</p>
                  <Button onClick={() => setEditingCombo({})} className="mt-4 bg-purple-600 hover:bg-purple-700 text-white gap-2 rounded-xl">
                    <Plus className="h-4 w-4" /> Criar Combo
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredCombos.map((combo: any) => {
                  const comboItems = combo.comboItems || [];
                  const isAvailable = combo.isAvailable !== false;
                  return (
                    <Card key={combo.id} className="border shadow-sm rounded-2xl hover:shadow-md transition-shadow overflow-hidden">
                      <div className={`h-1.5 ${isAvailable ? 'bg-purple-500' : 'bg-slate-300'}`} />
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="font-bold text-slate-800 truncate">{combo.name}</h3>
                            <div className="flex items-center gap-1.5 mt-1">
                              <Badge className={`${isAvailable ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'} border-0 text-[10px] font-bold gap-1`}>
                                {isAvailable ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                                {isAvailable ? 'Ativo' : 'Inativo'}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground">
                                {comboItems.length} {comboItems.length === 1 ? 'item' : 'itens'}
                              </span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-lg font-black text-purple-700">R$ {(combo.comboPrice || combo.price || 0).toFixed(2)}</p>
                          </div>
                        </div>

                        {/* Mini preview */}
                        <div className="flex flex-wrap gap-1">
                          {comboItems.slice(0, 4).map((ci: any, idx: number) => (
                            <Badge key={idx} variant="outline" className="text-[10px] py-0 gap-1">
                              <Package className="h-2.5 w-2.5" />
                              {ci.name?.slice(0, 15) || 'Item'}{ci.name?.length > 15 ? '...' : ''}
                              {ci.quantity > 1 && <span className="font-bold">x{ci.quantity}</span>}
                            </Badge>
                          ))}
                          {comboItems.length > 4 && (
                            <Badge variant="outline" className="text-[10px] py-0">+{comboItems.length - 4}</Badge>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 pt-1 border-t">
                          <Button size="sm" variant="ghost" className="h-8 text-xs gap-1 flex-1" onClick={() => setEditingCombo(combo)}>
                            <Pencil className="h-3 w-3" /> Editar
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 text-xs gap-1 text-red-500 hover:text-red-700" onClick={async () => {
                            if (!db || !confirm('Excluir este combo?')) return;
                            await deleteDoc(doc(db, 'menuItems', combo.id));
                            toast({ title: '🗑️ Combo excluído.' });
                          }}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Modal Create/Edit Promoção */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Flame className="h-5 w-5 text-orange-500" />
              {editingPromo ? 'Editar Promoção' : 'Nova Promoção'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Basic info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Label className="text-xs font-bold uppercase tracking-wide text-slate-500">Nome da Campanha</Label>
                <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Ex: Promoção de Inverno" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs font-bold uppercase tracking-wide text-slate-500">Início</Label>
                <Input type="datetime-local" value={formStartDate} onChange={e => setFormStartDate(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs font-bold uppercase tracking-wide text-slate-500">Término</Label>
                <Input type="datetime-local" value={formEndDate} onChange={e => setFormEndDate(e.target.value)} disabled={formNoEndDate} className="mt-1" />
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-xl border bg-slate-50 px-3 py-2">
              <Switch checked={formNoEndDate} onCheckedChange={setFormNoEndDate} />
              <div>
                <Label className="text-sm font-semibold">Sem prazo</Label>
                <p className="text-xs text-muted-foreground">A promocao fica ativa ate voce pausar ou excluir.</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch checked={formActive} onCheckedChange={setFormActive} />
              <Label className="text-sm">Ativar imediatamente</Label>
            </div>

            {/* Product selector */}
            <div>
              <Label className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2 block">
                Adicionar Produtos ({formItems.length} selecionados)
              </Label>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={itemSearchQuery}
                  onChange={e => setItemSearchQuery(e.target.value)}
                  placeholder="Buscar produto para adicionar..."
                  className="pl-10 text-sm"
                />
              </div>
              {itemSearchQuery && (
                <div className="border rounded-lg max-h-40 overflow-y-auto bg-white shadow-sm">
                  {availableItems.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic p-3 text-center">Nenhum produto encontrado.</p>
                  ) : (
                    availableItems.slice(0, 10).map((item: any) => {
                      const alreadyInPromo = itemsInOtherPromos[item.id];
                      return (
                      <button
                        key={item.id}
                        onClick={() => { if (!alreadyInPromo) { addItemToPromo(item); setItemSearchQuery(''); } }}
                        className={`w-full text-left px-3 py-2 flex items-center gap-3 text-sm border-b last:border-0 ${alreadyInPromo ? 'opacity-50 cursor-not-allowed bg-red-50' : 'hover:bg-slate-50'}`}
                      >
                        {item.imageUrl ? (
                          <Image src={item.imageUrl} alt="" width={32} height={32} className="rounded-md object-cover w-8 h-8" />
                        ) : (
                          <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center">
                            <Package className="h-4 w-4 text-slate-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {categoriesMap[item.categoryId] || ''} · {brl(item.price || 0)} · Estoque: {typeof item.stockQuantity === 'number' ? `${item.stockQuantity} un.` : 'Ilimitado'}
                            {alreadyInPromo && <span className="text-red-500 font-bold ml-1">• Já em "{alreadyInPromo}"</span>}
                          </p>
                        </div>
                        {alreadyInPromo ? (
                          <EyeOff className="h-4 w-4 text-red-400 shrink-0" />
                        ) : (
                          <Plus className="h-4 w-4 text-emerald-500 shrink-0" />
                        )}
                      </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Selected items with discount config */}
            {formItems.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wide text-slate-500">Configuração de Desconto</Label>
                {formItems.map(fi => {
                  const item = itemsMap[fi.menuItemId];
                  if (!item) return null;
                  const discountPct = fi.originalPrice > 0 ? Math.round((1 - fi.promoPrice / fi.originalPrice) * 100) : 0;
                  return (
                    <div key={fi.menuItemId} className="border rounded-xl p-3 bg-slate-50 space-y-2">
                      <div className="flex items-center gap-3">
                        {item.imageUrl ? (
                          <Image src={item.imageUrl} alt="" width={40} height={40} className="rounded-lg object-cover w-10 h-10" />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center border">
                            <Package className="h-5 w-5 text-slate-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate">{item.name}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                            <span>Original: {brl(fi.originalPrice)}</span>
                            <span className="text-slate-300">•</span>
                            <span>Estoque: {typeof item.stockQuantity === 'number' ? `${item.stockQuantity} un.` : 'Ilimitado'}</span>
                            {discountPct > 0 && (
                              <>
                                <span className="text-slate-300">•</span>
                                <span className="text-orange-600 font-bold">-{discountPct}%</span>
                              </>
                            )}
                          </p>
                        </div>
                        <button onClick={() => removeItemFromPromo(fi.menuItemId)} className="text-red-400 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Tipo</label>
                          <select
                            value={fi.discountType}
                            onChange={e => updatePromoItem(fi.menuItemId, { discountType: e.target.value as 'fixed' | 'percentage' })}
                            className="w-full h-8 text-xs rounded-md border px-2 bg-white"
                          >
                            <option value="percentage">% Desconto</option>
                            <option value="fixed">R$ Desconto</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Valor</label>
                          <Input
                            type="number"
                            value={fi.discountValue}
                            onChange={e => updatePromoItem(fi.menuItemId, { discountValue: Number(e.target.value) })}
                            className="h-8 text-xs"
                            min={0}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Preço Final</label>
                          <div className="h-8 flex items-center text-sm font-bold text-emerald-600">
                            {brl(fi.promoPrice)}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="flex items-center gap-1.5 text-[10px] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={fi.hideAfterPromo}
                              onChange={e => updatePromoItem(fi.menuItemId, { hideAfterPromo: e.target.checked })}
                              className="rounded"
                            />
                            <EyeOff className="h-3 w-3" /> Ocultar após
                          </label>
                          <label className="flex items-center gap-1.5 text-[10px] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={fi.promoOnly}
                              onChange={e => updatePromoItem(fi.menuItemId, { promoOnly: e.target.checked })}
                              className="rounded"
                            />
                            <Tag className="h-3 w-3" /> Só na promo
                          </label>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter className="pt-4">
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} className="bg-orange-500 hover:bg-orange-600 text-white gap-2">
              <Flame className="h-4 w-4" />
              {editingPromo ? 'Salvar Alterações' : 'Criar Promoção'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
