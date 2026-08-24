'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { collection, doc, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { ChevronDown, Copy, Loader2, Pencil, Plus, Trash2, Upload, Utensils } from 'lucide-react';
import { ComboModal } from '@/components/admin/ComboModal';
import { ProductModal } from '@/components/admin/ProductModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { getEffectiveStock, isOutOfStock } from '@/lib/inventory';
import { comboReferenceWarning, deleteItemWarning, deleteMenuItemWithCleanup } from '@/lib/menu-item-delete';
import {
  MENU_VISIBILITY_TOGGLES,
  getLigarTudoUpdate,
  getMotivosOcultoNoCardapio,
  getToggleUpdate,
  hasAnyVisibleToggle,
  isEstoqueParado,
  isToggleActive,
  pareceLigadoMasNaoAparece,
} from '@/lib/menu-visibility';
import {
  ALERTA_EXPLICACAO,
  ALERTA_LABEL,
  ALERTA_LABEL_PLURAL,
  alertasDoProduto,
  contarAlertas,
  temAlerta,
  type TipoDeAlerta,
} from '@/lib/produtos/alertas';
import { uploadImage } from '@/lib/upload';
import { brl, removeAccents } from '@/lib/utils';

/** Cor de cada etiqueta de alerta: a pílula do filtro e a marca na linha. */
const CORES_DO_ALERTA: Record<TipoDeAlerta, { normal: string; ativo: string; linha: string }> = {
  parado: {
    normal: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
    ativo: 'border-rose-600 bg-rose-600 text-white',
    linha: 'bg-rose-50 text-rose-700 border-rose-200',
  },
  nao_aparece: {
    normal: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
    ativo: 'border-amber-500 bg-amber-500 text-white',
    linha: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  esgotado: {
    normal: 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100',
    ativo: 'border-slate-700 bg-slate-700 text-white',
    linha: 'bg-slate-100 text-slate-600 border-slate-200',
  },
  sem_preco: {
    normal: 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100',
    ativo: 'border-violet-600 bg-violet-600 text-white',
    linha: 'bg-violet-50 text-violet-700 border-violet-200',
  },
};

interface ProdutosTabProps {
  db: Firestore;
  ownerId: string;
  storeUser: any;
  storeProfile: any;
  categories: any[];
  items: any[];
  addons: any[];
  addonCategories: any[];
  promotions: any[];
  /**
   * Busca, categoria, etiqueta de alerta e ordenação ficam na página de
   * propósito: hoje eles sobrevivem à ida e volta para outra aba, e o atalho
   * "Ver produtos" da aba Categorias precisa escrever no filtro de categoria.
   */
  productSearch: string;
  setProductSearch: (v: string) => void;
  productCategoryFilter: string;
  setProductCategoryFilter: (v: string) => void;
  filtroAlerta: TipoDeAlerta | null;
  setFiltroAlerta: (v: TipoDeAlerta | null) => void;
  sortConfig: { key: string; direction: 'asc' | 'desc' } | null;
  setSortConfig: (v: { key: string; direction: 'asc' | 'desc' } | null) => void;
  /**
   * Combo em edição: mora na página porque a aba Ofertas também abre um combo
   * daqui — clicar em editar lá troca para esta aba com o modal já aberto.
   */
  editingCombo: any;
  setEditingCombo: (v: any) => void;
  /**
   * Escrita de visibilidade em voo e o religar: a página divide os dois com o
   * catálogo somente-consulta, que oferece o mesmo botão a quem não edita.
   */
  salvandoVisibilidade: Set<string>;
  setSalvandoVisibilidade: React.Dispatch<React.SetStateAction<Set<string>>>;
  religarProduto: (item: any) => void;
  /** O modal de preço rápido é compartilhado com a aba Adicionais e mora na página. */
  onEditarPreco: (alvo: { id: string; name: string; price: number; collection?: 'menuItems' | 'addons' }) => void;
  onIrParaAba: (aba: string) => void;
}

/**
 * Aba Produtos da Retaguarda.
 *
 * Saiu de dentro de `(sistema)/gestao/page.tsx` inteira — tela, memos de
 * alerta, filtro e os dois efeitos que fazem o botão voltar fechar o modal de
 * produto e de combo. Sem mudança de comportamento.
 */
export function ProdutosTab({
  db,
  ownerId,
  storeUser,
  storeProfile,
  categories,
  items,
  addons,
  addonCategories,
  promotions,
  productSearch,
  setProductSearch,
  productCategoryFilter,
  setProductCategoryFilter,
  filtroAlerta,
  setFiltroAlerta,
  sortConfig,
  setSortConfig,
  editingCombo,
  setEditingCombo,
  salvandoVisibilidade,
  setSalvandoVisibilidade,
  religarProduto,
  onEditarPreco,
  onIrParaAba,
}: ProdutosTabProps) {
  const { toast } = useToast();

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedProductCategories = React.useMemo(() => {
    return [...(categories || [])].sort((a: any, b: any) => {
      const orderA = a.displayOrder ?? 0;
      const orderB = b.displayOrder ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return (a.name || '').localeCompare(b.name || '', 'pt-BR');
    });
  }, [categories]);

  /**
   * Cada produto com o que a regra de alerta precisa: a categoria dele e o
   * estoque efetivo. Fica em um lugar só para a barra de etiquetas, o filtro e
   * a linha da tabela contarem exatamente a mesma coisa.
   */
  const produtosComContexto = React.useMemo(() => {
    const porId = new Map((categories || []).map((c: any) => [c.id, c]));
    return (items || []).map((item: any) => ({
      item,
      categoria: porId.get(item.categoryId),
      estoque: getEffectiveStock(item, (items || []) as any[]),
    }));
  }, [items, categories]);

  const contagemDeAlertas = React.useMemo(
    () => (storeProfile?.general?.enableInventory === false
      // Sem controle de estoque, "esgotado" e "parado" não existem: sobra o que
      // é de cardápio, e a barra some quando não sobra nada.
      ? contarAlertas(produtosComContexto).filter((c) => c.tipo === 'nao_aparece' || c.tipo === 'sem_preco')
      : contarAlertas(produtosComContexto)),
    [produtosComContexto, storeProfile],
  );

  const idsDoFiltroDeAlerta = React.useMemo(() => {
    if (!filtroAlerta) return null;
    return new Set(
      produtosComContexto.filter((p) => temAlerta(p, filtroAlerta)).map((p) => p.item.id),
    );
  }, [produtosComContexto, filtroAlerta]);

  /** Os alertas de um produto, para a etiqueta na linha. */
  const alertasPorId = React.useMemo(() => {
    const mapa = new Map<string, ReturnType<typeof alertasDoProduto>>();
    for (const produto of produtosComContexto) mapa.set(produto.item.id, alertasDoProduto(produto));
    return mapa;
  }, [produtosComContexto]);


  const filteredItems = React.useMemo(() => {
    if (!items) return [];
    let result = items.filter(item => !item.isCombo);
    if (productCategoryFilter !== 'todas') {
      result = result.filter(item => item.categoryId === productCategoryFilter);
    }
    if (productSearch.trim()) {
      const s = removeAccents(productSearch.toLowerCase());
      result = result.filter(item => removeAccents(item.name.toLowerCase()).includes(s));
    }
    if (idsDoFiltroDeAlerta) {
      result = result.filter(item => idsDoFiltroDeAlerta.has(item.id));
    }
    
    if (sortConfig) {
      result.sort((a, b) => {
        let valA: any = a[sortConfig.key as keyof typeof a];
        let valB: any = b[sortConfig.key as keyof typeof b];
        
        if (sortConfig.key === 'categoryName') {
           valA = categories?.find(c => c.id === a.categoryId)?.name || '';
           valB = categories?.find(c => c.id === b.categoryId)?.name || '';
        }
        
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    
    return result;
  }, [items, productCategoryFilter, productSearch, sortConfig, categories, idsDoFiltroDeAlerta]);

  const [editingProduct, setEditingProduct] = useState<any>(null);

  const [uploadingImageProductId, setUploadingImageProductId] = useState<string | null>(null);

  // Manage history state for product edit screen
  useEffect(() => {
    const isOpen = editingProduct !== null;
    if (isOpen) {
      window.history.pushState({ type: 'admin-product' }, '');

      const handlePopState = (event: PopStateEvent) => {
        setEditingProduct(null);
      };

      window.addEventListener('popstate', handlePopState);
      return () => {
        window.removeEventListener('popstate', handlePopState);
        if (window.history.state?.type === 'admin-product') {
          window.history.back();
        }
      };
    }
  }, [editingProduct !== null]);

  // Manage history state for combo edit screen
  useEffect(() => {
    const isOpen = editingCombo !== null;
    if (isOpen) {
      window.history.pushState({ type: 'admin-combo' }, '');

      const handlePopState = (event: PopStateEvent) => {
        setEditingCombo(null);
      };

      window.addEventListener('popstate', handlePopState);
      return () => {
        window.removeEventListener('popstate', handlePopState);
        if (window.history.state?.type === 'admin-combo') {
          window.history.back();
        }
      };
    }
  }, [editingCombo !== null]);

  return (
    <div className={`mt-2 flex-1 min-h-0 flex flex-col ${(editingProduct !== null || editingCombo !== null) ? 'overflow-y-auto custom-scrollbar' : ''}`}>
      {editingCombo === null && (
        <div className="mb-3 px-2 shrink-0 flex items-baseline gap-3 flex-wrap">
          <h1 className="text-2xl font-black tracking-tight text-slate-800">
            {editingProduct !== null ? (editingProduct.isMarmita ? 'Editar Produto Montável' : 'Editar Produto') : 'Produtos'}
          </h1>
          <p className="text-sm text-muted-foreground font-medium">
            {editingProduct !== null ? 'Gerencie as configurações deste item.' : 'Gerencie seu cardápio e monte produtos personalizados.'}
          </p>
        </div>
      )}
    {editingProduct !== null ? (
      <div className="pb-4 pr-1">
        <ProductModal
          db={db} user={storeUser} addons={addons || []}
          addonCategories={addonCategories || []}
          editingProduct={editingProduct} setEditingProduct={setEditingProduct}
          categories={categories || []}
        />
      </div>
    ) : editingCombo !== null ? (
      <div className="pb-4 pr-1">
        <ComboModal
          db={db} user={storeUser} items={items || []}
          editingCombo={editingCombo} setEditingCombo={setEditingCombo}
          categories={categories || []}
        />
      </div>
    ) : (
    <Card className="border shadow-md rounded-2xl overflow-hidden flex-1 min-h-0 flex flex-col">
      <CardHeader className="flex flex-col gap-2 border-b bg-white p-3 shrink-0">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Procurar produto..."
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            className="flex-1"
          />
          <Button onClick={() => setEditingProduct({})} className="bg-primary text-white shrink-0">
            <Plus className="mr-2 h-4 w-4" /> Novo Produto
          </Button>
        </div>
        {contagemDeAlertas.length > 0 && (
          /* As etiquetas de alerta: contam e filtram no mesmo clique.
             Antes era uma tarja vermelha fixa no topo para um único
             problema (estoque parado), enquanto os outros só existiam
             soltos dentro da linha e não davam para filtrar. */
          <div className="flex flex-wrap items-center gap-2">
            {contagemDeAlertas.map((alerta) => {
              const ativo = filtroAlerta === alerta.tipo;
              const cor = CORES_DO_ALERTA[alerta.tipo];
              return (
                <button
                  key={alerta.tipo}
                  type="button"
                  title={ALERTA_EXPLICACAO[alerta.tipo]}
                  onClick={() => {
                    setFiltroAlerta(ativo ? null : alerta.tipo);
                    setProductCategoryFilter('todas');
                    setProductSearch('');
                  }}
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                    ativo ? cor.ativo : cor.normal
                  }`}
                >
                  {alerta.quantidade}{' '}
                  {alerta.quantidade === 1
                    ? ALERTA_LABEL[alerta.tipo].toLowerCase()
                    : ALERTA_LABEL_PLURAL[alerta.tipo]}
                  {alerta.tipo === 'parado' && alerta.valor > 0 && (
                    <span className={ativo ? 'opacity-90' : 'opacity-70'}> · {brl(alerta.valor)}</span>
                  )}
                </button>
              );
            })}
            {filtroAlerta && (
              <button
                type="button"
                onClick={() => setFiltroAlerta(null)}
                className="shrink-0 rounded-full px-2 py-1 text-xs font-bold text-slate-500 underline underline-offset-2 hover:text-slate-800"
              >
                Ver todos
              </button>
            )}
          </div>
        )}
        <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
          <button
            type="button"
            onClick={() => { setProductCategoryFilter('todas'); setProductSearch(''); setFiltroAlerta(null); }}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-bold transition-colors ${
              productCategoryFilter === 'todas'
                ? 'border-primary bg-primary text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:border-primary/50 hover:text-primary'
            }`}
          >
            Todos
          </button>
          {sortedProductCategories.map((cat: any) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => { setProductCategoryFilter(cat.id); setProductSearch(''); setFiltroAlerta(null); }}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-bold transition-colors ${
                productCategoryFilter === cat.id
                  ? 'border-primary bg-primary text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-primary/50 hover:text-primary'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead className="pl-6 w-[80px] cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSort('id')}>
                <div className="flex items-center">Id {sortConfig?.key === 'id' ? <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${sortConfig.direction === 'asc' ? 'rotate-180' : ''}`} /> : <ChevronDown className="ml-1 h-3 w-3 opacity-20" />}</div>
              </TableHead>
              <TableHead className="w-[80px]">Ref</TableHead>
              <TableHead className="cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSort('name')}>
                <div className="flex items-center">Título {sortConfig?.key === 'name' ? <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${sortConfig.direction === 'asc' ? 'rotate-180' : ''}`} /> : <ChevronDown className="ml-1 h-3 w-3 opacity-20" />}</div>
              </TableHead>
              <TableHead className="w-[120px] cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSort('price')}>
                <div className="flex items-center">Valor {sortConfig?.key === 'price' ? <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${sortConfig.direction === 'asc' ? 'rotate-180' : ''}`} /> : <ChevronDown className="ml-1 h-3 w-3 opacity-20" />}</div>
              </TableHead>
              <TableHead className="w-[200px] cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSort('categoryName')}>
                <div className="flex items-center">Categoria {sortConfig?.key === 'categoryName' ? <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${sortConfig.direction === 'asc' ? 'rotate-180' : ''}`} /> : <ChevronDown className="ml-1 h-3 w-3 opacity-20" />}</div>
              </TableHead>
              <TableHead className="w-[190px] text-center">
                <span className="whitespace-nowrap text-[11px]">Delivery / Local</span>
              </TableHead>
              <TableHead className="text-right pr-6 w-[150px]">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-sm text-muted-foreground">
                  Nenhum produto encontrado nesta categoria.
                </TableCell>
              </TableRow>
            ) : filteredItems.map((item) => {
              const itemCategory = categories?.find(c => c.id === item.categoryId);
              const catName = itemCategory?.name || 'Sem Categoria';
              const itemAddons = addons?.filter(a => item.addonIds?.includes(a.id)) || [];
              const allOff = !hasAnyVisibleToggle(item);
              // Estoque e categoria escondem o produto sem mexer em botão nenhum:
              // a linha ficava toda verde e o produto sumido do cardápio. É o que
              // as lojas relatavam como "desliga sozinho" (vendeu o último) e
              // "liga sozinho" (pedido cancelado devolveu o estoque).
              const esgotado = isOutOfStock(item, {
                enableInventory: !!storeProfile?.general?.enableInventory,
                allItems: items || [],
              });
              const motivosOculto = getMotivosOcultoNoCardapio(item, { category: itemCategory, esgotado });
              const avisarOculto = pareceLigadoMasNaoAparece(motivosOculto);
              // O outro lado: desligado COM estoque esperando. Aqui o dono
              // olha os dois botões cinza e conclui "está desligado mesmo",
              // sem saber que tem mercadoria presa atrás.
              const estoqueDoItem = storeProfile?.general?.enableInventory
                ? getEffectiveStock(item, items || [])
                : null;
              const presoNoEstoque = isEstoqueParado(item, { estoque: estoqueDoItem, category: itemCategory });
              // Trava a linha inteira, não só o botão clicado: Delivery e Local
              // acionados em sequência antes do re-render recalculavam isAvailable
              // a partir do item vencido.
              const salvandoLinha = MENU_VISIBILITY_TOGGLES.some((t) => salvandoVisibilidade.has(`${item.id}:${t.id}`));
              const visibilityChannels = MENU_VISIBILITY_TOGGLES.map((toggle) => ({
                label: toggle.label,
                trackClass: toggle.trackClass,
                active: isToggleActive(item, toggle),
                saving: salvandoLinha,
                onToggle: async () => {
                  if (!db) return;
                  const chave = `${item.id}:${toggle.id}`;
                  const newVal = !isToggleActive(item, toggle);
                  setSalvandoVisibilidade((atual) => new Set(atual).add(chave));
                  try {
                    await updateDoc(doc(db, 'menuItems', item.id), getToggleUpdate(item, toggle, newVal));
                  } catch (err: any) {
                    toast({
                      variant: 'destructive',
                      title: 'Não deu para salvar',
                      description: `"${item.name}" continua como estava. Confira a internet e tente de novo.`,
                    });
                  } finally {
                    setSalvandoVisibilidade((atual) => {
                      const proximo = new Set(atual);
                      proximo.delete(chave);
                      return proximo;
                    });
                  }
                },
              }));
               
              return (
                <TableRow key={item.id} className={allOff ? 'opacity-60 bg-slate-50/50' : ''}>
                  <TableCell className="pl-6 text-muted-foreground text-xs">{item.id.slice(-6).toUpperCase()}</TableCell>
                  <TableCell>
                    <div className="relative h-10 w-10 rounded overflow-hidden border bg-muted/30 flex items-center justify-center">
                      {item.imageUrl ? (
                        <Image src={item.imageUrl} alt={item.name} fill className="object-cover" />
                      ) : (
                        <Utensils className="h-4 w-4 text-muted-foreground/40" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{item.name}</span>
                    </div>
                    {/* Etiquetas em vez de parágrafos: o mesmo problema
                        que a barra do topo conta, na cor da barra do
                        topo. A ação continua ao lado da etiqueta que a
                        pede — quem vê "Parado" quer religar dali. */}
                    {(alertasPorId.get(item.id) || []).length > 0 && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {(alertasPorId.get(item.id) || []).map((alerta) => (
                          <span
                            key={alerta.tipo}
                            title={alerta.detalhe || ALERTA_EXPLICACAO[alerta.tipo]}
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${CORES_DO_ALERTA[alerta.tipo].linha}`}
                          >
                            {ALERTA_LABEL[alerta.tipo]}
                            {alerta.detalhe && (
                              <span className="font-medium opacity-80">· {alerta.detalhe}</span>
                            )}
                          </span>
                        ))}
                        {presoNoEstoque && (
                          <button
                            type="button"
                            disabled={salvandoVisibilidade.has(`${item.id}:religar`)}
                            className="text-[10px] font-bold text-rose-700 underline underline-offset-2 hover:text-rose-900 disabled:cursor-wait disabled:opacity-50"
                            onClick={() => religarProduto(item)}
                          >
                            Religar
                          </button>
                        )}
                        {avisarOculto && motivosOculto.includes('categoria_desligada') && (
                          <button
                            type="button"
                            className="text-[10px] font-bold text-amber-700 underline underline-offset-2 hover:text-amber-900"
                            onClick={() => onIrParaAba('categorias')}
                          >
                            Ver categoria
                          </button>
                        )}
                        {avisarOculto && !motivosOculto.includes('categoria_desligada') && motivosOculto.includes('esgotado') && (
                          <button
                            type="button"
                            className="text-[10px] font-bold text-amber-700 underline underline-offset-2 hover:text-amber-900"
                            onClick={() => onIrParaAba('estoque')}
                          >
                            Repor estoque
                          </button>
                        )}
                      </div>
                    )}
                    {itemAddons.length > 0 && (
                      <div className="mt-1">
                        <Badge className="text-[10px] bg-teal-500 hover:bg-teal-600 font-normal">
                          Opções: {itemAddons.map(a => a.name).join('; ')}
                        </Badge>
                      </div>
                    )}
                    {item.isCombo && item.comboItems?.length > 0 && (
                      <div className="mt-1">
                        <Badge className="text-[10px] bg-purple-600 hover:bg-purple-700 font-normal">
                          Combo: {item.comboItems.length} itens
                        </Badge>
                      </div>
                    )}
                    {item.addonGroups?.length > 0 && (
                      <div className="mt-1">
                        <Badge className="text-[10px] bg-orange-600 hover:bg-orange-700 font-normal">
                          Etapas: {item.addonGroups.length}
                        </Badge>
                      </div>
                    )}
                  </TableCell>
                  <TableCell
                    className="text-primary font-semibold cursor-pointer hover:bg-primary/5 hover:underline transition-colors rounded"
                    title="Clique para editar preço"
                    onClick={() => {
                      onEditarPreco({ id: item.id, name: item.name, price: item.price || 0 });
                    }}
                  >{brl((item.price || 0))}{item.saleUnit === 'kg' ? '/kg' : ''}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{catName}</TableCell>
                  <TableCell className="text-center">
                    <div className="mx-auto flex w-[160px] items-center justify-center gap-2">
                      {visibilityChannels.map((channel) => (
                        <button
                          key={channel.label}
                          type="button"
                          aria-pressed={channel.active}
                          aria-label={`${channel.active ? 'Desligar' : 'Ligar'} ${channel.label}`}
                          title={`${channel.active ? 'Desligar' : 'Ligar'} ${channel.label}`}
                          disabled={channel.saving}
                          className={`relative h-6 w-11 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                            channel.active ? `${channel.trackClass} border-transparent` : 'border-slate-300 bg-slate-200 hover:bg-slate-300'
                          } ${channel.saving ? 'cursor-wait opacity-50' : ''}`}
                          onClick={channel.onToggle}
                        >
                          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${channel.active ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right pr-6 whitespace-nowrap">
                    <div className="flex items-center justify-end gap-0.5">
                      {uploadingImageProductId === item.id ? (
                        <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
                          <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                        </Button>
                      ) : (
                        <label className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-8 w-8 cursor-pointer" title="Adicionar Imagem Rápido">
                          <Upload className="h-4 w-4 text-emerald-600" />
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file || !db) return;
                              setUploadingImageProductId(item.id);
                              try {
                                toast({ title: "Enviando imagem...", description: "Por favor, aguarde." });
                                const url = await uploadImage(file);
                                await updateDoc(doc(db, 'menuItems', item.id), { imageUrl: url });
                                toast({ title: "Sucesso!", description: "Imagem do produto atualizada." });
                              } catch (err: any) {
                                toast({ variant: "destructive", title: "Erro ao enviar", description: err?.message || "Ocorreu um erro." });
                              } finally {
                                setUploadingImageProductId(null);
                              }
                            }}
                          />
                        </label>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                        if (item.isCombo) {
                          setEditingCombo(item);
                        } else {
                          setEditingProduct(item);
                        }
                      }} title="Editar">
                        <Pencil className="h-4 w-4 text-blue-500" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={async () => {
                        const newName = prompt(`Nome da cópia de "${item.name}":`, `${item.name} (Cópia)`);
                        if (!newName || !db || !ownerId) return;
                        try {
                          const newDoc = doc(collection(db, 'menuItems'));
                          const { id, ...itemWithoutId } = item;
                          await setDoc(newDoc, {
                            ...itemWithoutId,
                            id: newDoc.id,
                            name: newName,
                            createdAt: Date.now()
                          });
                          toast({ title: "Produto duplicado com sucesso!" });
                        } catch(e: any) {
                          toast({ variant: 'destructive', title: "Erro ao duplicar", description: e.message });
                        }
                      }} title="Duplicar">
                        <Copy className="h-4 w-4 text-emerald-500" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={async () => {
                        if (!db) return;
                        const comboWarning = comboReferenceWarning(items || [], new Set([item.id]));
                        if (comboWarning) {
                          toast({ variant: 'destructive', title: 'Produto usado em combo', description: comboWarning });
                          return;
                        }
                        // Sai das promoções junto, senão a promoção fica
                        // apontando pra um produto que não existe mais.
                        if (confirm(`Excluir "${item.name}"?${deleteItemWarning(promotions || [], item.id)}`)) {
                          try {
                            await deleteMenuItemWithCleanup(db, item.id, promotions || [], items || []);
                            toast({ title: 'Produto excluído.' });
                          } catch (error: any) {
                            toast({ variant: 'destructive', title: 'Não foi possível excluir', description: error?.message });
                          }
                        }
                      }} title="Excluir">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </div>
      </CardContent>
    </Card>
    )}
    </div>
  );
}
