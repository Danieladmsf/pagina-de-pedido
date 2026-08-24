'use client';

import React, { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { HelpCircle, Pencil, Plus, Search, Store, Tag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CurrencyInput } from '@/components/ui/currency-input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { findUnderSuppliedProducts } from '@/lib/addon-groups';
import { hasAnyVisibleToggle } from '@/lib/menu-visibility';
import { brl, removeAccents } from '@/lib/utils';

interface AdicionaisTabProps {
  db: Firestore;
  ownerId: string;
  categories: any[];
  items: any[];
  addons: any[];
  addonCategories: any[];
  /** O modal de preço rápido é o mesmo da aba Produtos e mora na página. */
  onEditarPreco: (alvo: { id: string; name: string; price: number; collection?: 'menuItems' | 'addons' }) => void;
}

/**
 * Aba Adicionais da Retaguarda — a maior das três que moravam dentro de
 * `(sistema)/gestao/page.tsx` (1.042 linhas de tela).
 *
 * Diferente das outras duas, esta é autocontida: nenhum estado dela era usado
 * por outra aba. Veio inteira, com os grupos, a edição em massa de categoria,
 * os containers por produto e os quatro efeitos que fazem o botão voltar
 * fechar cada modal.
 */
export function AdicionaisTab({
  db,
  ownerId,
  categories,
  items,
  addons,
  addonCategories,
  onEditarPreco,
}: AdicionaisTabProps) {
  const { toast } = useToast();

  const [addonSortConfig, setAddonSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

  const handleAddonSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (addonSortConfig && addonSortConfig.key === key && addonSortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setAddonSortConfig({ key, direction });
  };

  const [editingAddon, setEditingAddon] = useState<any>(null);

  const [editingAddonContainers, setEditingAddonContainers] = useState<Set<string>>(new Set());

  const [addonSearchTerm, setAddonSearchTerm] = useState('');
  const [addonCategoryFilter, setAddonCategoryFilter] = useState('all');
  const [containerProductSearch, setContainerProductSearch] = useState('');
  const [highlightedAddonId, setHighlightedAddonId] = useState<string | null>(null);
  const [selectedAddonIds, setSelectedAddonIds] = useState<Set<string>>(new Set());
  const [isBulkCategoryModalOpen, setIsBulkCategoryModalOpen] = useState(false);
  const [bulkCategoryNames, setBulkCategoryNames] = useState<Set<string>>(new Set());
  const [bulkCategoryInitial, setBulkCategoryInitial] = useState<Set<string>>(new Set());
  const [bulkCategorySearch, setBulkCategorySearch] = useState('');
  const [isAddonCategoryModalOpen, setIsAddonCategoryModalOpen] = useState(false);
  const [newAddonCategoryName, setNewAddonCategoryName] = useState('');
  const [isEditCategoryModalOpen, setIsEditCategoryModalOpen] = useState(false);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editCategoryNewName, setEditCategoryNewName] = useState('');

  // Manage history state for addon edit dialog
  useEffect(() => {
    const isOpen = editingAddon !== null;
    if (isOpen) {
      window.history.pushState({ type: 'admin-addon' }, '');

      const handlePopState = (event: PopStateEvent) => {
        setEditingAddon(null);
      };

      window.addEventListener('popstate', handlePopState);
      return () => {
        window.removeEventListener('popstate', handlePopState);
        if (window.history.state?.type === 'admin-addon') {
          window.history.back();
        }
      };
    }
  }, [editingAddon !== null]);

  // Manage addon category dialog
  useEffect(() => {
    if (isAddonCategoryModalOpen) {
      window.history.pushState({ type: 'admin-addon-category' }, '');
      const handlePop = () => setIsAddonCategoryModalOpen(false);
      window.addEventListener('popstate', handlePop);
      return () => {
        window.removeEventListener('popstate', handlePop);
        if (window.history.state?.type === 'admin-addon-category') window.history.back();
      };
    }
  }, [isAddonCategoryModalOpen]);

  // Manage edit category dialog
  useEffect(() => {
    if (isEditCategoryModalOpen) {
      window.history.pushState({ type: 'admin-edit-category' }, '');
      const handlePop = () => setIsEditCategoryModalOpen(false);
      window.addEventListener('popstate', handlePop);
      return () => {
        window.removeEventListener('popstate', handlePop);
        if (window.history.state?.type === 'admin-edit-category') window.history.back();
      };
    }
  }, [isEditCategoryModalOpen]);

  // Manage bulk category assignment dialog
  useEffect(() => {
    if (isBulkCategoryModalOpen) {
      window.history.pushState({ type: 'admin-bulk-category' }, '');
      const handlePop = () => setIsBulkCategoryModalOpen(false);
      window.addEventListener('popstate', handlePop);
      return () => {
        window.removeEventListener('popstate', handlePop);
        if (window.history.state?.type === 'admin-bulk-category') window.history.back();
      };
    }
  }, [isBulkCategoryModalOpen]);

  const getAddonLegacyGroup = (addon: any) => (addon.group || '').trim();
  const explicitGroups = (addonCategories || []).map((c: any) => c.name);
  const implicitGroups = (addons || []).map(getAddonLegacyGroup).filter(Boolean);
  // Ordem alfabética pt-BR (ignora acentos e maiúsculas/minúsculas)
  const allGroups = (Array.from(new Set([...explicitGroups, ...implicitGroups])) as string[])
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  const addonCategoryByName = new Map((addonCategories || []).map((c: any) => [c.name, c]));
  const getLegacyAddonIdsForGroup = (name: string) => (addons || [])
    .filter((addon: any) => getAddonLegacyGroup(addon) === name)
    .map((addon: any) => addon.id);
  const getContainerAddonIds = (name: string) => {
    const category = addonCategoryByName.get(name) as any;
    const removedIds = new Set(category?.removedAddonIds || []);
    return Array.from(new Set([...(category?.addonIds || []), ...getLegacyAddonIdsForGroup(name)]))
      .filter((id: string) => !removedIds.has(id));
  };
  const getAddonContainerNames = (addon: any) => {
    const names = allGroups.filter(name => getContainerAddonIds(name).includes(addon.id));
    return names.length > 0 ? names : [getAddonLegacyGroup(addon) || 'Sem container'];
  };
  const ensureAddonCategory = async (name: string, seedIds: string[] = []) => {
    const existing = addonCategoryByName.get(name) as any;
    if (existing) {
      return { ref: doc(db, 'addonCategories', existing.id), data: existing };
    }
    const newDoc = doc(collection(db, 'addonCategories'));
    const data = {
      id: newDoc.id,
      name,
      ownerId,
      addonIds: Array.from(new Set(seedIds)),
      usePrice: true,
      min: 0,
      max: 0,
    };
    await setDoc(newDoc, data);
    return { ref: newDoc, data };
  };
  const isContainerView = addonCategoryFilter !== 'all';
  const removeAddonFromContainer = async (addon: any) => {
    if (!db || !ownerId || !isContainerView) return;
    const containerName = addonCategoryFilter;
    const currentIds = getContainerAddonIds(containerName);
    const nextIds = currentIds.filter((id: string) => id !== addon.id);
    const existing = addonCategoryByName.get(containerName) as any;
    const removedAddonIds = Array.from(new Set([...(existing?.removedAddonIds || []), addon.id]));
    const { ref } = await ensureAddonCategory(containerName, currentIds);
    await updateDoc(ref, {
      addonIds: nextIds,
      removedAddonIds,
    });
    toast({ title: 'Item removido apenas deste container.' });
  };
  /**
   * Produtos que passariam a pedir MAIS do que conseguem oferecer se
   * este adicional saísse do ar. Só conta o que quebra AGORA (o que já
   * estava furado antes não vira aviso novo).
   */
  const impactoDeTirarAddon = (addonId: string) => {
    const antes = new Set(
      findUnderSuppliedProducts(items || [], addons || [], addonCategories || [])
        .map((p) => `${p.product.id}|${p.groupName}`)
    );
    return findUnderSuppliedProducts(
      items || [], addons || [], addonCategories || [], new Set([addonId])
    ).filter((p) => !antes.has(`${p.product.id}|${p.groupName}`));
  };
  /** Texto do aviso, ou '' quando nada é afetado. */
  const avisoImpacto = (addonId: string) => {
    const afetados = impactoDeTirarAddon(addonId);
    if (afetados.length === 0) return '';
    const linhas = afetados
      .slice(0, 8)
      .map((a) => `• ${a.product.name} — a etapa "${a.groupName}" pede ${a.configuredMin} e ficaria com ${a.available}`)
      .join('\n');
    const resto = afetados.length > 8 ? `\n... e mais ${afetados.length - 8}` : '';
    return `\n\nATENÇÃO: ${afetados.length} ${afetados.length === 1 ? 'produto vai ficar' : 'produtos vão ficar'} com menos opções do que a etapa obrigatória pede:\n${linhas}${resto}\n\nEles continuam à venda, mas com menos escolhas do que você configurou.`;
  };
  const setAddonGlobalActive = async (addon: any, active: boolean) => {
    if (!db) return;
    // Pausar some com o adicional para o cliente igual excluir, então
    // o aviso vale para os dois caminhos.
    if (!active) {
      const aviso = avisoImpacto(addon.id);
      if (aviso && !confirm(`Pausar "${addon.name}"?${aviso}`)) return;
    }
    await updateDoc(doc(db, 'addons', addon.id), { active });
    toast({ title: active ? 'Adicional ativado globalmente' : 'Adicional pausado globalmente' });
  };
  // Pausa LOCAL: vale só para o container aberto. Regra do interruptor:
  // Lista Matriz liga/desliga global; dentro do container, só ali.
  const pausedInCurrentContainer = new Set<string>(
    ((addonCategoryByName.get(addonCategoryFilter) as any)?.pausedAddonIds || []) as string[]
  );
  const setAddonPausedInContainer = async (addon: any, paused: boolean) => {
    if (!db || !ownerId || !isContainerView) return;
    const containerName = addonCategoryFilter;
    const { ref, data } = await ensureAddonCategory(containerName, getContainerAddonIds(containerName));
    const next = new Set<string>(((data as any)?.pausedAddonIds || []) as string[]);
    if (paused) next.add(addon.id); else next.delete(addon.id);
    await updateDoc(ref, { pausedAddonIds: Array.from(next) });
    toast({
      title: paused ? `Pausado só em "${containerName}"` : `Reativado em "${containerName}"`,
      description: paused ? 'Nos outros containers o item continua ativo. Para pausar em todos, use a Lista Matriz.' : undefined,
    });
  };

  // Vínculo produto <-> container: o produto "usa" o container quando tem
  // um addonGroup apontando para ele (por id ou nome).
  const productUsesContainer = (product: any, containerName: string, containerId?: string) =>
    (product.addonGroups || []).some((g: any) => (containerId && g.addonCategoryId === containerId) || g.addonCategoryName === containerName);
  const linkProductToContainer = async (product: any, containerName: string) => {
    if (!db) return;
    const currentIds = getContainerAddonIds(containerName);
    const { ref, data } = await ensureAddonCategory(containerName, currentIds);
    const containerId = (data as any)?.id || ref.id;
    const cat = addonCategoryByName.get(containerName) as any;
    const newGroup = {
      name: containerName,
      addonCategoryId: containerId,
      addonCategoryName: containerName,
      addonIds: currentIds,
      usePrice: cat?.usePrice !== false,
      min: 0,
      max: cat?.max || 0,
    };
    const groups = (product.addonGroups || []).filter((g: any) => !(g.addonCategoryId === containerId || g.addonCategoryName === containerName));
    await updateDoc(doc(db, 'menuItems', product.id), { addonGroups: [...groups, newGroup] });
  };
  const unlinkProductFromContainer = async (product: any, containerName: string, containerId?: string) => {
    if (!db) return;
    const groups = (product.addonGroups || []).filter((g: any) => !((containerId && g.addonCategoryId === containerId) || g.addonCategoryName === containerName));
    await updateDoc(doc(db, 'menuItems', product.id), { addonGroups: groups });
  };
  const toggleProductContainer = async (product: any, containerName: string) => {
    const cat = addonCategoryByName.get(containerName) as any;
    const containerId = cat?.id;
    try {
      if (productUsesContainer(product, containerName, containerId)) {
        await unlinkProductFromContainer(product, containerName, containerId);
        toast({ title: `"${product.name}" desvinculado de ${containerName}.` });
      } else {
        await linkProductToContainer(product, containerName);
        toast({ title: `"${product.name}" vinculado a ${containerName}.` });
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err?.message });
    }
  };
  const containerFilterId = (addonCategoryByName.get(addonCategoryFilter) as any)?.id;
  const containerProductList = (items || [])
    .filter((p: any) => {
      const q = removeAccents(containerProductSearch.toLowerCase()).trim();
      return !q || removeAccents(String(p.name || '').toLowerCase()).includes(q);
    })
    .sort((a: any, b: any) => {
      // Selecionados primeiro, depois o restante; cada grupo em ordem alfabetica.
      const aUses = productUsesContainer(a, addonCategoryFilter, containerFilterId);
      const bUses = productUsesContainer(b, addonCategoryFilter, containerFilterId);
      if (aUses !== bUses) return aUses ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' });
    });
  const getAddonContainerSet = (addonId: string) =>
    new Set(allGroups.filter(name => getContainerAddonIds(name).includes(addonId)));
  // Containers que usam o item destacado (clicado na Lista Matriz) -> pintados de laranja.
  const highlightedContainers = highlightedAddonId ? getAddonContainerSet(highlightedAddonId) : new Set<string>();
  // Com um adicional destacado, os containers laranja sobem para o topo
  // da lista (alfabéticos entre si); o restante segue alfabético abaixo.
  // allGroups já vem ordenado, então o particionamento preserva a ordem.
  const orderedGroups = highlightedContainers.size > 0
    ? [...allGroups.filter(g => highlightedContainers.has(g)), ...allGroups.filter(g => !highlightedContainers.has(g))]
    : allGroups;
  const syncAddonContainers = async (addonId: string, selected: Set<string>) => {
    if (!db || !ownerId) return;
    const current = getAddonContainerSet(addonId);
    // Vincular aos containers recém-marcados
    for (const name of selected) {
      if (current.has(name)) continue;
      const currentIds = getContainerAddonIds(name);
      const { ref } = await ensureAddonCategory(name, currentIds);
      const existing = addonCategoryByName.get(name) as any;
      const removedAddonIds = (existing?.removedAddonIds || []).filter((id: string) => id !== addonId);
      await updateDoc(ref, { addonIds: Array.from(new Set([...currentIds, addonId])), removedAddonIds });
    }
    // Remover dos containers desmarcados
    for (const name of current) {
      if (selected.has(name)) continue;
      const nextIds = getContainerAddonIds(name).filter((id: string) => id !== addonId);
      const { ref } = await ensureAddonCategory(name, getContainerAddonIds(name));
      const existing = addonCategoryByName.get(name) as any;
      const removedAddonIds = Array.from(new Set([...(existing?.removedAddonIds || []), addonId]));
      await updateDoc(ref, { addonIds: nextIds, removedAddonIds });
    }
  };
  const handleSaveAddonWithContainers = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ownerId || !db) return;
    const formData = new FormData(e.currentTarget);
    const rawName = (formData.get('addonName') as string) || '';
    const description = ((formData.get('addonDescription') as string) || '').trim();
    const price = parseFloat(formData.get('addonPrice') as string);
    const baseData = {
      description,
      price,
      group: editingAddon?.group || '',
      ownerId,
    };
    // Em modo de criacao, nomes separados por , ou ; criam varios adicionais de uma vez
    // (todos com o mesmo preco/descricao/containers). Na edicao, mantem nome unico.
    const names = editingAddon?.id
      ? [rawName.trim()].filter(Boolean)
      : Array.from(new Set(
          rawName.split(/[,;\n]/).map(n => n.trim()).filter(Boolean)
        ));
    if (names.length === 0) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Informe ao menos um nome.' });
      return;
    }
    try {
      if (editingAddon?.id) {
        await updateDoc(doc(db, 'addons', editingAddon.id), { ...baseData, name: names[0] });
        await syncAddonContainers(editingAddon.id, editingAddonContainers);
      } else {
        for (const name of names) {
          const newDoc = doc(collection(db, 'addons'));
          await setDoc(newDoc, { ...baseData, name, id: newDoc.id });
          await syncAddonContainers(newDoc.id, editingAddonContainers);
        }
      }
      setEditingAddon(null);
      toast({
        title: 'Sucesso',
        description: names.length > 1 ? `${names.length} adicionais criados.` : 'Adicional salvo.',
      });
    } catch (err: any) {
      console.error('Erro ao salvar adicional:', err);
      toast({ variant: 'destructive', title: 'Erro', description: err?.message || 'Falha ao salvar adicional.' });
    }
  };
  const normalizeAddonLookup = (value: string) =>
    removeAccents(value.toLowerCase()).replace(/\s+/g, ' ').trim();
  const normalizedAddonSearch = normalizeAddonLookup(addonSearchTerm);
  const isAddonListSearch = /[,;\n]/.test(addonSearchTerm);
  const addonSearchTerms = isAddonListSearch
    ? Array.from(new Set(addonSearchTerm
        .split(/[,;\n]/)
        .map(term => normalizeAddonLookup(term))
        .filter(Boolean)))
    : [];
  const addonSearchTermSet = new Set(addonSearchTerms);
  const filteredAddons = (addons || []).filter((addon: any) => {
    const addonName = normalizeAddonLookup(addon.name || '');
    if (isAddonListSearch) {
      if (addonSearchTerms.length > 0 && !addonSearchTermSet.has(addonName)) return false;
    } else if (normalizedAddonSearch && !addonName.includes(normalizedAddonSearch)) {
      return false;
    }
    const g = getAddonLegacyGroup(addon);
    if (addonCategoryFilter !== 'all' && !getContainerAddonIds(addonCategoryFilter).includes(addon.id) && g !== addonCategoryFilter) return false;
    return true;
  }).sort((a: any, b: any) => {
    if (isAddonListSearch) {
      return (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' });
    }
    if (!addonSortConfig) return (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' });
    let valA: any = a[addonSortConfig.key];
    let valB: any = b[addonSortConfig.key];
    
    if (addonSortConfig.key === 'group') {
      valA = getAddonContainerNames(a).join(', ');
      valB = getAddonContainerNames(b).join(', ');
    }
    
    if (typeof valA === 'string' && typeof valB === 'string') {
       if (valA.toLowerCase() < valB.toLowerCase()) return addonSortConfig.direction === 'asc' ? -1 : 1;
       if (valA.toLowerCase() > valB.toLowerCase()) return addonSortConfig.direction === 'asc' ? 1 : -1;
    } else {
       if (valA < valB) return addonSortConfig.direction === 'asc' ? -1 : 1;
       if (valA > valB) return addonSortConfig.direction === 'asc' ? 1 : -1;
    }
    return 0;
  });

  const addonUsageMap = new Map<string, Set<string>>();
  for (const item of (items || [])) {
    const typeLabel = item.isCombo ? ' (Combo)' : item.isMarmita ? ' (Montável)' : ' (Produto)';
    const statusLabel = item.isAvailable === false ? ' [Inativo]' : '';
    const displayName = `${item.name}${typeLabel}${statusLabel}`;
    
    for (const id of (item.addonIds || [])) {
      if (!addonUsageMap.has(id)) addonUsageMap.set(id, new Set());
      addonUsageMap.get(id)!.add(displayName);
    }
    for (const g of (item.addonGroups || [])) {
      for (const id of (g.addonIds || [])) {
        if (!addonUsageMap.has(id)) addonUsageMap.set(id, new Set());
        addonUsageMap.get(id)!.add(displayName);
      }
    }
  }

  const addonNameMap = new Map<string, string[]>();
  for (const addon of addons || []) {
    const nameKey = addon.name
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove acentos
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ') // Espaços múltiplos
      .replace(/s\b/g, '') // Plurais no final da palavra
      .replace(/[ao]\b/g, ''); // Masculino/Feminino no final da palavra
    if (!addonNameMap.has(nameKey)) addonNameMap.set(nameKey, []);
    addonNameMap.get(nameKey)!.push(addon.id);
  }

  const unusedDuplicateIds = new Set<string>();
  for (const [name, ids] of addonNameMap.entries()) {
    if (ids.length > 1) {
      for (const id of ids) {
        if (!addonUsageMap.has(id) || addonUsageMap.get(id)!.size === 0) {
          unusedDuplicateIds.add(id);
        }
      }
    }
  }

  return (
  <div className="mt-2 flex-1 min-h-0 flex flex-col">
    <div className="mb-3 px-2 shrink-0 flex items-center gap-3 flex-wrap">
      <h1 className="text-2xl font-black tracking-tight text-slate-800">Grupos de Adicionais</h1>
      <a
        href="/ajuda/adicionais"
        target="_blank"
        rel="noopener noreferrer"
        title="Como funcionam os adicionais? Abre o guia visual"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 transition-colors hover:bg-emerald-200"
      >
        <HelpCircle className="h-4 w-4" />
      </a>
      <p className="text-sm text-muted-foreground font-medium">Crie itens extras que podem ser vinculados aos seus produtos (ex: Bacon, Molho Extra, Borda Recheada).</p>
    </div>
    <Card className="border shadow-md rounded-2xl overflow-hidden flex-1 min-h-0 flex flex-col">
    <CardContent className="p-0 flex-1 min-h-0 flex flex-col lg:flex-row">
      {/* ── Coluna 1: containers (lista vertical) ── */}
      <div className="flex shrink-0 flex-col border-b bg-white lg:w-[270px] lg:border-b-0 lg:border-r min-h-0 max-h-44 lg:max-h-none">
        <div className="shrink-0 border-b px-3 py-2">
          <p className="text-xs font-bold text-slate-700">Containers</p>
          {/* O destaque sobrevive à troca de container: é assim que se
              navega entre os containers que usam o mesmo item. Mas ele
              precisa de saída visível — indo para um container onde o
              item não aparece, não haveria onde clicar de novo. */}
          {highlightedAddonId && (() => {
            const destacado = (addons || []).find((a: any) => a.id === highlightedAddonId);
            if (!destacado) return null;
            return (
              <div className="mt-1.5 flex items-center gap-1 rounded-md border border-orange-300 bg-orange-50 px-1.5 py-1">
                <span className="min-w-0 flex-1 truncate text-[10px] font-bold text-orange-800" title={`Containers que usam "${destacado.name}"`}>
                  usando: {destacado.name}
                </span>
                <button
                  type="button"
                  onClick={() => setHighlightedAddonId(null)}
                  className="shrink-0 text-[11px] font-bold text-orange-500 transition-colors hover:text-orange-800"
                  title="Tirar o destaque"
                >
                  ✕
                </button>
              </div>
            );
          })()}
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto custom-scrollbar p-2">
          {/* Lista Matriz com identidade âmbar (mesma cor do guia de ajuda),
              para não se confundir com os containers */}
          <Button
            variant="outline"
            onClick={() => { setAddonCategoryFilter('all'); setAddonSearchTerm(''); }}
            size="sm"
            className={`w-full justify-start gap-2 rounded-lg border-2 font-bold ${
              addonCategoryFilter === 'all'
                ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600 hover:text-white'
                : 'border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400 hover:bg-amber-100 hover:text-amber-900'
            }`}
          >
            <Store className="h-3.5 w-3.5" /> Lista Matriz
          </Button>
          {orderedGroups.map(g => (
            <Button
              key={g}
              variant={addonCategoryFilter === g ? 'default' : 'outline'}
              onClick={() => { setAddonCategoryFilter(g); setAddonSearchTerm(''); }}
              size="sm"
              className={`w-full h-auto min-h-9 py-1.5 justify-between gap-2 rounded-lg flex items-center group ${
                highlightedContainers.has(g) && addonCategoryFilter !== g
                  ? 'border-orange-400 bg-orange-100 text-orange-700 hover:bg-orange-200'
                  : ''
              }`}
            >
              <span className="text-left whitespace-normal break-words leading-tight">{g}</span>
              <span className="flex shrink-0 items-center gap-1">
                <span className="rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[10px]">
                  {getContainerAddonIds(g).length}
                </span>
                {addonCategoryFilter === g && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditCategoryName(g);
                      setEditCategoryNewName(g);
                      setIsEditCategoryModalOpen(true);
                    }}
                    className="bg-primary-foreground/20 hover:bg-primary-foreground/40 text-primary-foreground p-1 rounded-full transition-colors cursor-pointer"
                    title="Editar Container"
                  >
                    <Pencil className="h-3 w-3" />
                  </span>
                )}
              </span>
            </Button>
          ))}

          <Dialog open={isEditCategoryModalOpen} onOpenChange={(open) => {
            setIsEditCategoryModalOpen(open);
            if (!open) {
              setEditCategoryName('');
              setEditCategoryNewName('');
            }
          }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Editar Container: {editCategoryName}</DialogTitle>
              </DialogHeader>
              <div className="py-4 space-y-4">
                <div className="space-y-2">
                  <Label>Nome do Container</Label>
                  <Input 
                    autoFocus
                    value={editCategoryNewName} 
                    onChange={(e) => setEditCategoryNewName(e.target.value)} 
                    placeholder="Digite o novo nome..." 
                  />
                </div>
              </div>
              <DialogFooter className="flex flex-row items-center justify-between w-full sm:justify-between">
                <Button 
                  variant="destructive" 
                  className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200"
                  onClick={async () => {
                  if (!db || !ownerId || !editCategoryName) return;
                  if (!confirm(`Tem certeza que deseja EXCLUIR a categoria "${editCategoryName}"?\n\nOs adicionais continuam na lista matriz; apenas este container será removido.`)) return;
                  try {
                    const batch = writeBatch(db);
                    const oldName = editCategoryName.trim();
                    
                    // 1. Delete the category document if it exists explicitly
                    const catDocs = addonCategories?.filter((c: any) => c.name.trim() === oldName);
                    catDocs?.forEach((catDoc: any) => {
                      batch.delete(doc(db, 'addonCategories', catDoc.id));
                    });
                    (addons || [])
                      .filter((addon: any) => getAddonLegacyGroup(addon) === oldName)
                      .forEach((addon: any) => {
                        batch.update(doc(db, 'addons', addon.id), { group: '' });
                      });

                    // 2. Remove as etapas (addonGroups) que apontam para este container
                    //    em todos os produtos, senao o card "fantasma" continua aparecendo
                    //    no cardapio do cliente e no ProductModal do admin.
                    const deletedCatIds = new Set((catDocs || []).map((c: any) => c.id));
                    (items || []).forEach((product: any) => {
                      const productGroups = Array.isArray(product.addonGroups) ? product.addonGroups : [];
                      if (productGroups.length === 0) return;
                      const remaining = productGroups.filter((g: any) => {
                        const matchesName = (g.addonCategoryName || '').trim() === oldName;
                        const matchesId = g.addonCategoryId && deletedCatIds.has(g.addonCategoryId);
                        return !(matchesName || matchesId);
                      });
                      if (remaining.length !== productGroups.length) {
                        batch.update(doc(db, 'menuItems', product.id), { addonGroups: remaining });
                      }
                    });

                    await batch.commit();
                    toast({ title: 'Container excluído com sucesso!' });
                    setIsEditCategoryModalOpen(false);
                    if (addonCategoryFilter === oldName) {
                      setAddonCategoryFilter('all');
                    }
                  } catch (err: any) {
                    toast({ variant: 'destructive', title: 'Erro', description: err.message });
                  }
                }}>
                  <Trash2 className="w-4 h-4 mr-2" /> Excluir
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setIsEditCategoryModalOpen(false)}>Cancelar</Button>
                  <Button onClick={async () => {
                    if (!db || !ownerId || !editCategoryName || !editCategoryNewName.trim() || editCategoryName === editCategoryNewName.trim()) return;
                    try {
                      const batch = writeBatch(db);
                      const newName = editCategoryNewName.trim();
                      const oldName = editCategoryName.trim();
                      
                      // 1. Rename the category document if it exists explicitly
                      const catDoc = addonCategories?.find((c: any) => c.name.trim() === oldName);
                      if (catDoc) {
                        batch.update(doc(db, 'addonCategories', catDoc.id), { name: newName });
                      } else {
                        // It was an implicit category, let's create it explicitly with the new name
                        const newDoc = doc(collection(db, 'addonCategories'));
                        batch.set(newDoc, { id: newDoc.id, name: newName, ownerId, addonIds: getLegacyAddonIdsForGroup(oldName), usePrice: true, min: 0, max: 0 });
                      }
                      (addons || [])
                        .filter((addon: any) => getAddonLegacyGroup(addon) === oldName)
                        .forEach((addon: any) => {
                          batch.update(doc(db, 'addons', addon.id), { group: newName });
                        });

                      await batch.commit();
                      toast({ title: 'Container renomeado com sucesso!' });
                      setIsEditCategoryModalOpen(false);
                      if (addonCategoryFilter === oldName) {
                        setAddonCategoryFilter(newName);
                      }
                    } catch (err: any) {
                      toast({ variant: 'destructive', title: 'Erro', description: err.message });
                    }
                  }} className="bg-primary text-white">
                    Salvar
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
      </div>
      </div>

      {/* ── Coluna 2: adicionais do container / lista matriz ── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="shrink-0 flex flex-wrap items-center gap-2 border-b bg-white px-3 py-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar adicionais..." value={addonSearchTerm} onChange={(e) => { setAddonSearchTerm(e.target.value); setHighlightedAddonId(null); }} className="pl-9" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
        {/* Controles do container selecionado, na linha dos botões */}
        {addonCategoryFilter !== 'all' && (() => {
          const category = addonCategoryByName.get(addonCategoryFilter) as any;
          const usePrice = category?.usePrice !== false;
          return (
            <>
              <div className="flex items-center gap-1 bg-sky-50 border border-sky-200 rounded-lg px-2 py-1.5 whitespace-nowrap">
                <span className="text-[10px] text-sky-700 font-semibold" title="0 = opcional">Mínimo:</span>
                <Input
                  type="number"
                  min="0"
                  value={category?.min || 0}
                  onChange={async (e) => {
                    if (!db || !ownerId) return;
                    const val = parseInt(e.target.value) || 0;
                    try {
                      const currentIds = getContainerAddonIds(addonCategoryFilter);
                      const { ref } = await ensureAddonCategory(addonCategoryFilter, currentIds);
                      await updateDoc(ref, { min: val });
                    } catch (err: any) {
                      toast({ variant: 'destructive', title: 'Erro', description: err.message });
                    }
                  }}
                  className="w-10 h-6 px-0 text-center border-0 bg-transparent text-sky-700 font-bold text-xs shadow-none focus-visible:ring-0"
                  title="Quantidade mínima obrigatória para o cliente fechar o pedido (0 = opcional)"
                />
              </div>
              <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 whitespace-nowrap">
                <span className="text-[10px] text-amber-700 font-semibold" title="0 = Sem Limite">Máximo:</span>
                <Input
                  type="number"
                  min="0"
                  value={category?.max || 0}
                  onChange={async (e) => {
                    if (!db || !ownerId) return;
                    const val = parseInt(e.target.value) || 0;
                    try {
                      const currentIds = getContainerAddonIds(addonCategoryFilter);
                      const { ref } = await ensureAddonCategory(addonCategoryFilter, currentIds);
                      await updateDoc(ref, { max: val });
                    } catch (err: any) {
                      toast({ variant: 'destructive', title: 'Erro', description: err.message });
                    }
                  }}
                  className="w-10 h-6 px-0 text-center border-0 bg-transparent text-amber-700 font-bold text-xs shadow-none focus-visible:ring-0"
                  title="Limite máximo de escolhas (0 = Ilimitado)"
                />
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!db || !ownerId) return;
                  try {
                    const currentIds = getContainerAddonIds(addonCategoryFilter);
                    const { ref } = await ensureAddonCategory(addonCategoryFilter, currentIds);
                    await updateDoc(ref, { usePrice: !usePrice });
                    toast({ title: !usePrice ? 'Preços ativados' : 'Preços desativados' });
                  } catch (err: any) {
                    toast({ variant: 'destructive', title: 'Erro', description: err.message });
                  }
                }}
                className={`h-9 rounded-full px-3 text-xs font-bold transition-colors ${
                  usePrice
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                }`}
              >
                {usePrice ? 'Usa preço' : 'Sem preço'}
              </button>
            </>
          );
        })()}
        <Dialog open={isAddonCategoryModalOpen} onOpenChange={(open) => {
          setIsAddonCategoryModalOpen(open);
          if (!open) setNewAddonCategoryName('');
        }}>
          <DialogTrigger asChild>
            <Button variant="outline" className="whitespace-nowrap border-dashed text-primary border-primary/50 hover:bg-primary/10">
              <Plus className="mr-2 h-4 w-4" /> Novo Container
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo Container de Adicionais</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-2">
              <Label>Nome do Container</Label>
              <Input
                autoFocus
                value={newAddonCategoryName}
                onChange={(e) => setNewAddonCategoryName(e.target.value)}
                placeholder="Ex: Opções PF, Bebidas..."
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddonCategoryModalOpen(false)}>Cancelar</Button>
              <Button onClick={async () => {
                if (!db || !ownerId || !newAddonCategoryName.trim()) return;
                try {
                  const newDoc = doc(collection(db, 'addonCategories'));
                  await setDoc(newDoc, { id: newDoc.id, name: newAddonCategoryName.trim(), ownerId, addonIds: [], usePrice: true, min: 0, max: 0 });
                  toast({ title: 'Container criado com sucesso!' });
                  setIsAddonCategoryModalOpen(false);
                  setNewAddonCategoryName('');
                } catch (err: any) {
                  toast({ variant: 'destructive', title: 'Erro', description: err.message });
                }
              }} className="bg-primary text-white">
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {selectedAddonIds.size > 0 && (
          <Button
            onClick={() => {
              // Pre-marca os containers que ja contem TODOS os itens selecionados.
              const selectedIds = Array.from(selectedAddonIds);
              const already = new Set(
                allGroups.filter(name => {
                  const ids = getContainerAddonIds(name);
                  return selectedIds.every(id => ids.includes(id));
                })
              );
              setBulkCategoryInitial(already);
              setBulkCategoryNames(new Set(already));
              setBulkCategorySearch('');
              setIsBulkCategoryModalOpen(true);
            }}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Tag className="mr-2 h-4 w-4" />
            Adicionar ao Container ({selectedAddonIds.size})
          </Button>
        )}
        <Dialog open={editingAddon !== null} onOpenChange={(open) => { if (!open) setEditingAddon(null); }}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditingAddon({}); setEditingAddonContainers(new Set()); }} className="bg-primary text-white">
              <Plus className="mr-2 h-4 w-4" /> Novo Adicional
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[680px]">
            <DialogHeader>
              <DialogTitle>{editingAddon?.id ? 'Editar Adicional' : 'Novo Adicional'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSaveAddonWithContainers} className="space-y-4 pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="addonName">Nome</Label>
                <Input id="addonName" name="addonName" defaultValue={editingAddon?.name} placeholder="Ex: Bacon, Queijo Extra, Gelo..." required />
                {!editingAddon?.id && (
                  <p className="text-xs text-muted-foreground">
                    Dica: separe varios nomes com <span className="font-medium">,</span> ou <span className="font-medium">;</span> para criar em massa (mesmo preco e containers).
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="addonDescription">Texto de apresentacao</Label>
                <Textarea
                  id="addonDescription"
                  name="addonDescription"
                  defaultValue={editingAddon?.description || ''}
                  placeholder="Ex: fatias de abacaxi fresco, porcao extra, molho especial..."
                  className="min-h-[80px] resize-none text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="addonPrice">Preço (R$)</Label>
                <CurrencyInput id="addonPrice" name="addonPrice" defaultValue={editingAddon?.price} required placeholder="0,00" />
              </div>
              </div>
              <div className="space-y-2">
                <Label>Containers vinculados <span className="font-normal text-muted-foreground">(opcional)</span></Label>
                {allGroups.length > 0 ? (
                  <div className="max-h-[260px] overflow-y-auto rounded-md border border-input divide-y">
                    {allGroups.map(name => {
                      const checked = editingAddonContainers.has(name);
                      return (
                        <label key={name} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300"
                            checked={checked}
                            onChange={(ev) => {
                              setEditingAddonContainers(prev => {
                                const next = new Set(prev);
                                if (ev.target.checked) next.add(name);
                                else next.delete(name);
                                return next;
                              });
                            }}
                          />
                          <span className={checked ? 'font-medium text-emerald-700' : ''}>{name}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    Nenhum container criado ainda. Crie um em "Novo Container".
                  </p>
                )}
              </div>
              </div>
              <DialogFooter>
                <Button type="submit" className="w-full h-12 font-bold">Salvar</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog open={isBulkCategoryModalOpen} onOpenChange={(open) => {
          setIsBulkCategoryModalOpen(open);
          if (!open) { setBulkCategoryNames(new Set()); setBulkCategoryInitial(new Set()); setBulkCategorySearch(''); }
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Containers de {selectedAddonIds.size} {selectedAddonIds.size === 1 ? 'item' : 'itens'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <p className="text-xs text-muted-foreground">
                Os containers ja marcados contem os itens selecionados. Marque para adicionar, desmarque para remover.
              </p>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={bulkCategorySearch}
                  onChange={(e) => setBulkCategorySearch(e.target.value)}
                  placeholder="Buscar container..."
                  className="h-9 pl-8 text-sm"
                />
              </div>
              {allGroups.length > 0 ? (
                <div className="max-h-[300px] overflow-y-auto rounded-md border border-input divide-y custom-scrollbar">
                  {allGroups
                    .filter(name => {
                      const q = removeAccents(bulkCategorySearch.toLowerCase()).trim();
                      return !q || removeAccents(name.toLowerCase()).includes(q);
                    })
                    .map(name => {
                      const checked = bulkCategoryNames.has(name);
                      return (
                        <label key={name} className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition hover:bg-slate-50 ${checked ? 'bg-emerald-50' : ''}`}>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300"
                            checked={checked}
                            onChange={(ev) => {
                              setBulkCategoryNames(prev => {
                                const next = new Set(prev);
                                if (ev.target.checked) next.add(name); else next.delete(name);
                                return next;
                              });
                            }}
                          />
                          <span className={`flex-1 ${checked ? 'font-medium text-emerald-700' : 'text-slate-700'}`}>{name}</span>
                          <span className="text-[10px] text-slate-400">{getContainerAddonIds(name).length}</span>
                        </label>
                      );
                    })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic py-4 text-center">
                  Nenhum container criado ainda. Crie um em &quot;Novo Container&quot;.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsBulkCategoryModalOpen(false)}>Cancelar</Button>
              <Button onClick={async () => {
                if (!db || selectedAddonIds.size === 0) return;
                const toAdd = Array.from(bulkCategoryNames).filter(name => !bulkCategoryInitial.has(name));
                const toRemove = Array.from(bulkCategoryInitial).filter(name => !bulkCategoryNames.has(name));
                if (toAdd.length === 0 && toRemove.length === 0) {
                  setIsBulkCategoryModalOpen(false);
                  return;
                }
                try {
                  for (const name of toAdd) {
                    const currentIds = getContainerAddonIds(name);
                    const nextIds = Array.from(new Set([...currentIds, ...Array.from(selectedAddonIds)]));
                    const { ref } = await ensureAddonCategory(name, currentIds);
                    const existing = addonCategoryByName.get(name) as any;
                    const removedAddonIds = (existing?.removedAddonIds || []).filter((id: string) => !selectedAddonIds.has(id));
                    await updateDoc(ref, { addonIds: nextIds, removedAddonIds });
                  }
                  for (const name of toRemove) {
                    const currentIds = getContainerAddonIds(name);
                    const nextIds = currentIds.filter((id: string) => !selectedAddonIds.has(id));
                    const { ref } = await ensureAddonCategory(name, currentIds);
                    const existing = addonCategoryByName.get(name) as any;
                    const removedAddonIds = Array.from(new Set([...(existing?.removedAddonIds || []), ...Array.from(selectedAddonIds)]));
                    await updateDoc(ref, { addonIds: nextIds, removedAddonIds });
                  }
                  toast({ title: `Containers atualizados (${toAdd.length} adicionado(s), ${toRemove.length} removido(s)).` });
                  setIsBulkCategoryModalOpen(false);
                  setSelectedAddonIds(new Set());
                  setBulkCategoryNames(new Set());
                  setBulkCategoryInitial(new Set());
                  setBulkCategorySearch('');
                } catch (err: any) {
                  toast({ variant: 'destructive', title: 'Erro', description: err.message });
                }
              }} className="bg-emerald-600 text-white hover:bg-emerald-700">
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      </div>
      {!isContainerView && (
        <div className="shrink-0 border-b px-4 py-2 text-xs font-semibold bg-slate-50 text-slate-600">
          Lista Matriz: editar, pausar ou excluir aqui altera o adicional globalmente.
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
      <Table>
        <TableHeader className="bg-muted/30">
          <TableRow>
            <TableHead className="w-[50px] pl-6">
              <input 
                type="checkbox" 
                className="h-4 w-4 rounded border-gray-300"
                checked={filteredAddons.length > 0 && selectedAddonIds.size === filteredAddons.length}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedAddonIds(new Set(filteredAddons.map((a: any) => a.id)));
                  } else {
                    setSelectedAddonIds(new Set());
                  }
                }}
              />
            </TableHead>
            <TableHead className="cursor-pointer hover:bg-slate-100 transition-colors select-none" onClick={() => handleAddonSort('name')}>
              Nome {addonSortConfig?.key === 'name' && (addonSortConfig.direction === 'asc' ? '↑' : '↓')}
            </TableHead>
            <TableHead className="cursor-pointer hover:bg-slate-100 transition-colors select-none" onClick={() => handleAddonSort('price')}>
              Preço {addonSortConfig?.key === 'price' && (addonSortConfig.direction === 'asc' ? '↑' : '↓')}
            </TableHead>
            <TableHead className="text-right pr-6">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredAddons.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                {addons?.length === 0 ? 'Nenhum adicional cadastrado.' : 'Nenhum adicional encontrado na busca.'}
              </TableCell>
            </TableRow>
          ) : (
            filteredAddons.map((addon: any) => {
              let rowClass = selectedAddonIds.has(addon.id) ? 'bg-emerald-50/30' : '';
              if (highlightedAddonId === addon.id) {
                rowClass = 'bg-orange-50 ring-1 ring-inset ring-orange-300';
              }
              if (unusedDuplicateIds.has(addon.id)) {
                rowClass = 'bg-red-200 border-2 border-red-500';
              }
              return (
              <TableRow key={addon.id} className={rowClass}>
                <TableCell className="pl-6">
                  <input 
                    type="checkbox" 
                    className="h-4 w-4 rounded border-gray-300"
                    checked={selectedAddonIds.has(addon.id)}
                    onChange={(e) => {
                      const newSet = new Set(selectedAddonIds);
                      if (e.target.checked) newSet.add(addon.id);
                      else newSet.delete(addon.id);
                      setSelectedAddonIds(newSet);
                    }}
                  />
                </TableCell>
                <TableCell
                  className="font-bold cursor-pointer hover:bg-orange-50/50 transition-colors"
                  title="Clique para destacar os containers que usam este item"
                  onClick={() => setHighlightedAddonId(prev => prev === addon.id ? null : addon.id)}
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-slate-900 ${addon.active === false ? 'line-through decoration-red-500 decoration-2' : ''}`}>{addon.name}</span>
                      {addon.active === false && <span className="bg-red-100 text-red-700 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">Pausado</span>}
                      {unusedDuplicateIds.has(addon.id) && <span className="bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide ml-2">S/ USO (DUPLICADO)</span>}
                    </div>
                    {addon.description && (
                      <div className="text-[11px] text-slate-500 mt-0.5 font-normal max-w-[200px] sm:max-w-xs md:max-w-md line-clamp-2">
                        {addon.description}
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell
                  className="text-primary font-semibold cursor-pointer hover:bg-primary/5 hover:underline transition-colors rounded"
                  title="Clique para editar preço"
                  onClick={() => onEditarPreco({ id: addon.id, name: addon.name, price: addon.price || 0, collection: 'addons' })}
                >{brl((addon.price || 0))}</TableCell>
                <TableCell className="text-right pr-6">
                  {isContainerView ? (
                    <div className="flex items-center justify-end gap-2">
                      <div
                        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-1"
                        title={`Ativo/Pausado APENAS neste container (${addonCategoryFilter}). Para pausar em todos, use a Lista Matriz.`}
                      >
                        <Switch
                          checked={!pausedInCurrentContainer.has(addon.id)}
                          onCheckedChange={(checked) => setAddonPausedInContainer(addon, !checked)}
                          aria-label="Ativo/Pausado neste container"
                          className="scale-75 data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-red-500"
                        />
                        <span className={`text-[10px] font-medium uppercase ${!pausedInCurrentContainer.has(addon.id) ? 'text-green-600' : 'text-red-500'}`}>
                          {!pausedInCurrentContainer.has(addon.id) ? 'Ativo aqui' : 'Pausado aqui'}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Remover apenas deste container"
                        onClick={async () => {
                          if (confirm(`Remover "${addon.name}" apenas do container "${addonCategoryFilter}"?`)) {
                            await removeAddonFromContainer(addon);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end gap-1">
                      <div className="flex items-center gap-1.5 mr-4 border-r pr-4">
                        <Switch
                          checked={addon.active !== false}
                          onCheckedChange={(checked) => setAddonGlobalActive(addon, checked)}
                          className="scale-75 data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-red-500"
                        />
                        <span className={`text-[10px] font-medium uppercase ${addon.active !== false ? 'text-green-600' : 'text-red-500'}`}>{addon.active !== false ? 'Ativo' : 'Pausado'}</span>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => { setEditingAddon(addon); setEditingAddonContainers(getAddonContainerSet(addon.id)); }}>
                        <Pencil className="h-4 w-4 text-blue-500" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={async () => {
                        if (!db) return;
                        if (confirm(`Excluir adicional da lista matriz? Isso remove do banco de dados.${avisoImpacto(addon.id)}`)) await deleteDoc(doc(db, 'addons', addon.id));
                      }}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      </div>
      </div>

      {/* ── Coluna 3: produtos que usam o container ── */}
      {isContainerView && (
        <div className="flex shrink-0 flex-col border-t bg-slate-50/40 lg:w-[320px] lg:border-l lg:border-t-0 min-h-0 max-h-[55vh] lg:max-h-none">
          <div className="border-b bg-white px-3 py-2">
            <p className="text-xs font-bold text-slate-700">Produtos que usam &quot;{addonCategoryFilter}&quot;</p>
            <p className="text-[10px] text-slate-500">Marque para vincular este container ao produto; desmarque para remover.</p>
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={containerProductSearch} onChange={(e) => setContainerProductSearch(e.target.value)} placeholder="Buscar produto..." className="h-8 pl-8 text-xs" />
            </div>
          </div>
          <div className="flex-1 divide-y overflow-y-auto custom-scrollbar">
            {containerProductList.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">Nenhum produto encontrado.</p>
            ) : containerProductList.map((product: any) => {
              const checked = productUsesContainer(product, addonCategoryFilter, (addonCategoryByName.get(addonCategoryFilter) as any)?.id);
              return (
                <label key={product.id} className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-xs transition ${checked ? 'bg-emerald-50' : 'opacity-50 hover:opacity-100 hover:bg-white'}`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300"
                    checked={checked}
                    onChange={() => toggleProductContainer(product, addonCategoryFilter)}
                  />
                  <span className="flex-1 truncate">
                    <span className={`font-semibold ${!hasAnyVisibleToggle(product) ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{product.name}</span>
                    <span className="ml-1 text-[10px] text-slate-400">{categories?.find((c: any) => c.id === product.categoryId)?.name || ''}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </CardContent>
  </Card>
  </div>
  );
}
