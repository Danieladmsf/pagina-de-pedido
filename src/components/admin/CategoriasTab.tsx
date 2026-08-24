'use client';

import React, { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd';
import { Clock, GripVertical, Loader2, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { comboReferenceWarning, promotionUpdatesForRemovedItems } from '@/lib/menu-item-delete';
import { isItemVisibleInChannel } from '@/lib/menu-visibility';

interface CategoriasTabProps {
  db: Firestore;
  ownerId: string;
  categories: any[];
  items: any[];
  promotions: any[];
  /** O atalho "Ver produtos" da linha da categoria leva para a aba Produtos já filtrada. */
  onVerProdutosDaCategoria: (categoryId: string) => void;
}

/**
 * Aba Categorias da Retaguarda.
 *
 * Morava dentro de `(sistema)/gestao/page.tsx` — 449 linhas de tela mais uns
 * 180 de estado, handlers e efeitos espalhados pela metade de cima do arquivo.
 * Saiu inteira para cá, sem mudança de comportamento: mesmas regras de
 * exclusão (mover ou apagar junto, nunca deixar produto solto), mesma ordem
 * por arrastar e mesmo diagnóstico de categoria ligada com produto invisível.
 */
export function CategoriasTab({
  db,
  ownerId,
  categories,
  items,
  promotions,
  onVerProdutosDaCategoria,
}: CategoriasTabProps) {
  const { toast } = useToast();

  // Estados para modal de Categoria
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  
  // Estados para edição da categoria (nome + disponibilidade)
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [isCategoryConfigModalOpen, setIsCategoryConfigModalOpen] = useState(false);
  // Nome de origem da categoria aberta: o título do modal mostra ele para não
  // ficar mudando letra a letra enquanto o dono digita o nome novo.
  const [categoryOriginalName, setCategoryOriginalName] = useState('');
  // Exclusão de categoria: antes apagava só a categoria e os produtos ficavam
  // soltos (sumiam do cardápio e continuavam à venda no PDV, em "Outros").
  const [deletingCategory, setDeletingCategory] = useState<any>(null);
  const [deleteCategoryAction, setDeleteCategoryAction] = useState<'move' | 'wipe'>('move');
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<string>('');
  const [isDeletingCategory, setIsDeletingCategory] = useState(false);

  /**
   * Diagnóstico de cada categoria para a lista da aba Categorias: ligar a
   * categoria não liga os produtos dentro dela, então dava pra deixar tudo
   * "Ligada" em verde e mesmo assim não aparecer nada no cardápio. Aqui contamos
   * quantos produtos dela o cliente enxerga de fato, e marcamos nome repetido
   * (desligar uma "Tortas" deixava a outra "Tortas" no ar).
   */
  const diagnosticoCategorias = React.useMemo(() => {
    const contagemPorNome = new Map<string, number>();
    for (const cat of categories || []) {
      const chave = (cat.name || '').trim().toLowerCase();
      contagemPorNome.set(chave, (contagemPorNome.get(chave) || 0) + 1);
    }
    const mapa: Record<string, { total: number; visiveis: number; nomeRepetido: boolean }> = {};
    for (const cat of categories || []) {
      const doCat = (items || []).filter((it: any) => !it.isCombo && it.categoryId === cat.id);
      mapa[cat.id] = {
        total: doCat.length,
        visiveis: doCat.filter((it: any) => it.isAvailable !== false && isItemVisibleInChannel(it, 'delivery')).length,
        nomeRepetido: (contagemPorNome.get((cat.name || '').trim().toLowerCase()) || 0) > 1,
      };
    }
    return mapa;
  }, [categories, items]);

  /**
   * Renomear no modal não pode criar uma segunda "Tortas" sem o dono perceber.
   * Não trava o salvar (às vezes é de propósito), só avisa enquanto ele digita.
   */
  const nomeDeCategoriaRepetido = React.useMemo(() => {
    const alvo = (editingCategory?.name || '').trim().toLowerCase();
    if (!alvo) return false;
    return (categories || []).some(
      (c: any) => c.id !== editingCategory?.id && (c.name || '').trim().toLowerCase() === alvo
    );
  }, [categories, editingCategory]);

  /** Produtos que hoje estão numa categoria (combos também carregam categoryId). */
  const itemsOfCategory = (categoryId?: string) =>
    !categoryId ? [] : (items || []).filter((it: any) => it.categoryId === categoryId);

  /**
   * Abre o modal da categoria (nome + disponibilidade). Trabalha numa cópia
   * para o que o dono digita só valer depois do Salvar.
   */
  const openCategoryConfig = (cat: any) => {
    setEditingCategory({ ...cat });
    setCategoryOriginalName(cat?.name || '');
    setIsCategoryConfigModalOpen(true);
  };

  /**
   * Exclui a categoria SEM deixar produto solto: ou move os produtos pra outra
   * categoria, ou apaga tudo junto. O caminho antigo apagava só a categoria e o
   * produto virava fantasma — sumia do cardápio e continuava vendável no PDV.
   */
  const confirmDeleteCategory = async () => {
    if (!db || !deletingCategory) return;
    const alvos = itemsOfCategory(deletingCategory.id);
    // Sem outra categoria não existe "mover" — a tela já mostra só a opção de
    // apagar junto, e aqui a regra tem que ser a mesma pra não travar.
    const outras = (categories || []).filter((c: any) => c.id !== deletingCategory.id);
    const movendo = alvos.length > 0 && deleteCategoryAction === 'move' && outras.length > 0;

    if (movendo && !outras.some((c: any) => c.id === deleteCategoryTarget)) {
      toast({ variant: 'destructive', title: 'Escolha para onde vão os produtos' });
      return;
    }

    if (!movendo && alvos.length > 0) {
      const comboWarning = comboReferenceWarning(
        items || [],
        new Set(alvos.map((item: any) => item.id)),
      );
      if (comboWarning) {
        toast({
          variant: 'destructive',
          title: 'Há combos usando produtos desta categoria',
          description: comboWarning,
        });
        return;
      }
    }

    setIsDeletingCategory(true);
    try {
      // Firestore aceita no máximo 500 operações por lote.
      const LOTE = 450;

      // Apagando os produtos junto, eles também precisam sair das promoções —
      // senão a exclusão em massa recria as referências mortas que a lixeira de
      // um produto só já evita. Promoções primeiro: nenhum estado intermediário
      // aponta pra produto inexistente.
      if (!movendo && alvos.length > 0) {
        const updates = promotionUpdatesForRemovedItems(
          promotions || [], new Set(alvos.map((it: any) => it.id))
        );
        for (let i = 0; i < updates.length; i += LOTE) {
          const batch = writeBatch(db);
          updates.slice(i, i + LOTE).forEach((u) => batch.update(doc(db, 'promotions', u.id), { items: u.items }));
          await batch.commit();
        }
      }

      for (let i = 0; i < alvos.length; i += LOTE) {
        const batch = writeBatch(db);
        alvos.slice(i, i + LOTE).forEach((it: any) => {
          const ref = doc(db, 'menuItems', it.id);
          if (movendo) batch.update(ref, { categoryId: deleteCategoryTarget });
          else batch.delete(ref);
        });
        await batch.commit();
      }
      // A categoria só sai depois que os produtos estão resolvidos: se algo
      // falhar no meio, ela continua lá e nada vira fantasma.
      await deleteDoc(doc(db, 'categories', deletingCategory.id));

      toast({
        title: 'Categoria excluída',
        description: alvos.length === 0
          ? undefined
          : movendo
            ? `${alvos.length} ${alvos.length === 1 ? 'produto foi movido' : 'produtos foram movidos'} para ${categories?.find((c: any) => c.id === deleteCategoryTarget)?.name || 'a outra categoria'}.`
            : `${alvos.length} ${alvos.length === 1 ? 'produto foi excluído' : 'produtos foram excluídos'} junto.`,
      });
      setDeletingCategory(null);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Não deu para excluir', description: error.message });
    } finally {
      setIsDeletingCategory(false);
    }
  };

  const handleDragEndCategory = async (result: DropResult) => {
    if (!result.destination || !db || !categories) return;
    
    const sourceIndex = result.source.index;
    const destinationIndex = result.destination.index;
    
    if (sourceIndex === destinationIndex) return;

    // Get sorted array
    const sortedCategories = [...categories].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
    
    // Reorder
    const [moved] = sortedCategories.splice(sourceIndex, 1);
    sortedCategories.splice(destinationIndex, 0, moved);
    
    // Update all displayOrders
    const batch = writeBatch(db);
    sortedCategories.forEach((cat, index) => {
      const catRef = doc(db, 'categories', cat.id);
      batch.update(catRef, { displayOrder: index });
    });
    
    try {
      await batch.commit();
      toast({ title: "Ordem atualizada com sucesso!" });
    } catch (error: any) {
      toast({ variant: 'destructive', title: "Erro ao atualizar ordem", description: error.message });
    }
  };

  const [salvandoCategoria, setSalvandoCategoria] = useState<Set<string>>(new Set());

  // Manage category creation dialog
  useEffect(() => {
    if (isCategoryModalOpen) {
      window.history.pushState({ type: 'admin-category-modal' }, '');
      const handlePop = () => setIsCategoryModalOpen(false);
      window.addEventListener('popstate', handlePop);
      return () => {
        window.removeEventListener('popstate', handlePop);
        if (window.history.state?.type === 'admin-category-modal') window.history.back();
      };
    }
  }, [isCategoryModalOpen]);

  // Manage category config dialog
  useEffect(() => {
    if (isCategoryConfigModalOpen) {
      window.history.pushState({ type: 'admin-category-config' }, '');
      const handlePop = () => setIsCategoryConfigModalOpen(false);
      window.addEventListener('popstate', handlePop);
      return () => {
        window.removeEventListener('popstate', handlePop);
        if (window.history.state?.type === 'admin-category-config') window.history.back();
      };
    }
  }, [isCategoryConfigModalOpen]);

  return (
    <div className="mt-2 flex-1 min-h-0 flex flex-col">
      <div className="mb-3 px-2 shrink-0 flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-black tracking-tight text-slate-800">Categorias do Cardápio</h1>
        <p className="text-sm text-muted-foreground font-medium">Organize os seus produtos, defina a ordem de exibição e limite horários de disponibilidade.</p>
      </div>
      <Card className="border shadow-md rounded-2xl overflow-hidden flex-1 min-h-0 flex flex-col">
      <CardHeader className="flex flex-row items-center justify-end border-b bg-white p-3 shrink-0">
        <Dialog open={isCategoryModalOpen} onOpenChange={(open) => {
          setIsCategoryModalOpen(open);
          if (!open) setNewCategoryName('');
        }}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-white">
              <Plus className="mr-2 h-4 w-4" /> Nova Categoria
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova Categoria</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-2">
              <Label htmlFor="catName">Nome da Categoria</Label>
              <Input 
                id="catName" 
                value={newCategoryName} 
                onChange={(e) => setNewCategoryName(e.target.value)} 
                placeholder="Ex: Lanches, Bebidas..." 
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Dica: Crie várias de uma vez separando por vírgula (,) ou ponto-e-vírgula (;)
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCategoryModalOpen(false)}>Cancelar</Button>
              <Button onClick={async () => {
                if (!db || !ownerId || !newCategoryName.trim()) return;
                
                // Divide por vírgula ou ponto-e-vírgula e remove espaços vazios
                const nomes = newCategoryName.split(/[,;]/).map(n => n.trim()).filter(n => n.length > 0);
                
                if (nomes.length === 0) return;

                try {
                  // Cria todas as categorias em paralelo
                  await Promise.all(nomes.map(async (name) => {
                    const newDoc = doc(collection(db, 'categories'));
                    return setDoc(newDoc, { 
                      id: newDoc.id, 
                      name, 
                      ownerId,
                      displayOrder: 0, 
                      description: "",
                      isAvailable: true
                    });
                  }));

                  setIsCategoryModalOpen(false);
                  setNewCategoryName('');
                  
                  if (nomes.length > 1) {
                    toast({ title: `${nomes.length} categorias criadas com sucesso!` });
                  } else {
                    toast({ title: 'Categoria criada com sucesso!' });
                  }
                } catch (err: any) {
                  toast({ variant: 'destructive', title: 'Erro ao criar', description: err.message });
                }
              }} className="bg-primary text-white">
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal da Categoria: nome e disponibilidade no mesmo lugar.
            Antes só dava para mexer no horário, e arrumar um nome errado
            obrigava a excluir a categoria e criar tudo de novo. */}
        <Dialog open={isCategoryConfigModalOpen} onOpenChange={setIsCategoryConfigModalOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Configurar Categoria: {categoryOriginalName}</DialogTitle>
            </DialogHeader>
            {editingCategory && (
              <div className="py-4 space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="editCatName" className="font-bold flex items-center gap-2 text-base">
                    <Tag className="w-4 h-4 text-primary" />
                    Nome da Categoria
                  </Label>
                  <Input
                    id="editCatName"
                    value={editingCategory.name || ''}
                    onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                    placeholder="Ex: Lanches, Bebidas..."
                  />
                  <p className="text-xs text-muted-foreground">
                    O nome novo aparece no cardápio e no PDV assim que salvar. Os produtos continuam dentro dela.
                  </p>
                  {nomeDeCategoriaRepetido && (
                    <p className="text-xs font-medium text-amber-600">
                      Já existe outra categoria com esse nome — no cardápio as duas vão parecer a mesma.
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between border-t pt-5">
                  <Label className="font-bold flex items-center gap-2 text-base">
                    <Clock className="w-4 h-4 text-primary" /> 
                    Limitar Disponibilidade
                  </Label>
                  <Switch 
                    checked={editingCategory.availability?.enabled || false}
                    onCheckedChange={(checked) => setEditingCategory({
                      ...editingCategory,
                      availability: { ...editingCategory.availability, enabled: checked, days: editingCategory.availability?.days || ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'], startTime: editingCategory.availability?.startTime || '00:00', endTime: editingCategory.availability?.endTime || '23:59' }
                    })}
                  />
                </div>
                <p className="text-xs text-muted-foreground -mt-4">
                  Se ativado, esta categoria só aparecerá para o cliente nos dias e horários selecionados abaixo.
                </p>

                {editingCategory.availability?.enabled && (
                  <div className="space-y-4 pt-2 border-t">
                    <div className="space-y-2">
                      <Label className="text-sm">Dias da Semana</Label>
                      <div className="flex flex-wrap gap-2">
                        {['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].map(d => {
                          const isSelected = editingCategory.availability?.days?.includes(d);
                          return (
                            <Badge 
                              key={d} 
                              variant={isSelected ? 'default' : 'outline'}
                              className="cursor-pointer"
                              onClick={() => {
                                const currentDays = editingCategory.availability?.days || [];
                                const newDays = isSelected ? currentDays.filter((x: string) => x !== d) : [...currentDays, d];
                                setEditingCategory({
                                  ...editingCategory,
                                  availability: { ...editingCategory.availability, days: newDays }
                                });
                              }}
                            >
                              {d.substring(0, 3)}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs">Horário Inicial</Label>
                        <Input 
                          type="time" 
                          value={editingCategory.availability?.startTime || '00:00'}
                          onChange={(e) => setEditingCategory({
                            ...editingCategory,
                            availability: { ...editingCategory.availability, startTime: e.target.value }
                          })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Horário Final</Label>
                        <Input 
                          type="time" 
                          value={editingCategory.availability?.endTime || '23:59'}
                          onChange={(e) => setEditingCategory({
                            ...editingCategory,
                            availability: { ...editingCategory.availability, endTime: e.target.value }
                          })}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCategoryConfigModalOpen(false)}>Cancelar</Button>
              <Button onClick={async () => {
                if (!db || !editingCategory) return;
                const nome = (editingCategory.name || '').trim();
                if (!nome) {
                  toast({ variant: 'destructive', title: 'A categoria precisa de um nome' });
                  return;
                }
                try {
                  // Produto e combo apontam para o id da categoria, então
                  // renomear não mexe em nada do que está dentro dela.
                  await updateDoc(doc(db, 'categories', editingCategory.id), {
                    name: nome,
                    availability: editingCategory.availability || null
                  });
                  setIsCategoryConfigModalOpen(false);
                  toast({
                    title: nome !== categoryOriginalName
                      ? `Agora se chama "${nome}"`
                      : 'Configurações salvas!',
                  });
                } catch (err: any) {
                  toast({ variant: 'destructive', title: 'Erro ao salvar', description: err.message });
                }
              }} className="bg-primary text-white">
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <Table>
            <TableHeader className="bg-muted/30 sticky top-0 z-10 backdrop-blur-sm">
              <TableRow>
                <TableHead className="pl-6">Nome</TableHead>
                <TableHead className="text-right pr-6">Ações</TableHead>
              </TableRow>
            </TableHeader>
          <DragDropContext onDragEnd={handleDragEndCategory}>
            <Droppable droppableId="categories-list">
              {(provided) => (
                <TableBody {...provided.droppableProps} ref={provided.innerRef}>
                  {categories?.sort((a,b) => (a.displayOrder || 0) - (b.displayOrder || 0)).map((cat, index) => (
                    <Draggable key={cat.id} draggableId={cat.id} index={index}>
                      {(provided) => (
                        <TableRow 
                          ref={provided.innerRef} 
                          {...provided.draggableProps}
                          className="bg-white"
                        >
                          <TableCell className="font-bold pl-6">
                            <div className="flex items-center gap-3">
                              <div {...provided.dragHandleProps} className="cursor-grab hover:text-primary active:cursor-grabbing p-1">
                                <GripVertical className="h-5 w-5 text-muted-foreground" />
                              </div>
                              <div>
                                <span className="inline-flex items-center gap-1.5">
                                  {cat.name}
                                  {diagnosticoCategorias[cat.id]?.nomeRepetido && (
                                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">
                                      nome repetido
                                    </span>
                                  )}
                                </span>
                                {cat.availability?.enabled && (
                                  <p className="text-[10px] text-muted-foreground font-normal mt-0.5">
                                    {cat.availability.days?.map((d: string) => d.substring(0, 3)).join(', ')} ({cat.availability.startTime || '00:00'} às {cat.availability.endTime || '23:59'})
                                  </p>
                                )}
                                {/* Ligada, mas o cliente não vê nada: os produtos de dentro é que
                                    estão desligados. Sem esse aviso o botão verde parecia quebrado. */}
                                {cat.isAvailable !== false && diagnosticoCategorias[cat.id]?.total > 0 && diagnosticoCategorias[cat.id]?.visiveis === 0 && (
                                  <p className="mt-1 text-[11px] font-medium text-amber-600">
                                    Ligada, mas não aparece no cardápio: {diagnosticoCategorias[cat.id].total === 1 ? 'o único produto está desligado' : `os ${diagnosticoCategorias[cat.id].total} produtos estão desligados`}.{' '}
                                    <button
                                      type="button"
                                      className="underline underline-offset-2 hover:text-amber-700"
                                      onClick={() => onVerProdutosDaCategoria(cat.id)}
                                    >
                                      Ver produtos
                                    </button>
                                  </p>
                                )}
                                {cat.isAvailable !== false && diagnosticoCategorias[cat.id]?.total === 0 && (
                                  <p className="mt-1 text-[11px] font-medium text-slate-400">
                                    Ligada, mas ainda não tem produto dentro.
                                  </p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            <div className="flex items-center justify-end gap-1">
                              <div className="flex items-center gap-1.5 mr-4 border-r pr-4">
                                <Switch 
                                  checked={cat.isAvailable !== false} 
                                  disabled={salvandoCategoria.has(cat.id)}
                                  onCheckedChange={async (checked) => {
                                    if (!db) return;
                                    // Sem o try/catch a chave voltava sozinha quando a
                                    // gravação falhava: o Firestore mostra a mudança
                                    // local antes do servidor confirmar e desfaz na
                                    // recusa, sem nada na tela explicando.
                                    setSalvandoCategoria((atual) => new Set(atual).add(cat.id));
                                    try {
                                      await updateDoc(doc(db, 'categories', cat.id), { isAvailable: checked });
                                      toast({ title: checked ? 'Categoria ativada' : 'Categoria desativada' });
                                    } catch (err: any) {
                                      toast({
                                        variant: 'destructive',
                                        title: 'Não deu para salvar',
                                        description: `"${cat.name}" continua como estava. Confira a internet e tente de novo.`,
                                      });
                                    } finally {
                                      setSalvandoCategoria((atual) => {
                                        const proximo = new Set(atual);
                                        proximo.delete(cat.id);
                                        return proximo;
                                      });
                                    }
                                  }} 
                                  className="scale-75 data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-red-500 disabled:cursor-wait disabled:opacity-50"
                                />
                                <span className={`text-[10px] font-medium uppercase ${cat.isAvailable !== false ? 'text-green-600' : 'text-red-500'}`}>{cat.isAvailable !== false ? 'Ligada' : 'Desligada'}</span>
                              </div>
                              <Button variant="ghost" size="icon" onClick={() => openCategoryConfig(cat)} title="Editar nome">
                                <Pencil className="h-4 w-4 text-blue-500" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => openCategoryConfig(cat)} title="Dias e horários" className={cat.availability?.enabled ? 'text-primary' : 'text-muted-foreground'}>
                                <Clock className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => {
                                setDeletingCategory(cat);
                                setDeleteCategoryAction('move');
                                setDeleteCategoryTarget(
                                  (categories || []).find((c: any) => c.id !== cat.id)?.id || ''
                                );
                              }} title="Excluir">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </TableBody>
              )}
            </Droppable>
          </DragDropContext>
        </Table>
        </div>
      </CardContent>
    </Card>

    {/* Excluir categoria: avisa quando ainda tem produtos dentro e obriga
        a decidir o destino deles (mover ou apagar junto). */}
    <Dialog open={!!deletingCategory} onOpenChange={(open) => { if (!open && !isDeletingCategory) setDeletingCategory(null); }}>
      <DialogContent className="sm:max-w-md">
        {deletingCategory && (() => {
          const alvos = itemsOfCategory(deletingCategory.id);
          const combos = alvos.filter((it: any) => it.isCombo).length;
          const outras = (categories || []).filter((c: any) => c.id !== deletingCategory.id);
          const semDestino = outras.length === 0;
          const acao = semDestino ? 'wipe' : deleteCategoryAction;
          return (
            <>
              <DialogHeader>
                <DialogTitle>Excluir "{deletingCategory.name}"</DialogTitle>
              </DialogHeader>

              {alvos.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Essa categoria está vazia. Pode excluir sem problema.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm">
                    Essa categoria tem <strong>{alvos.length} {alvos.length === 1 ? 'produto' : 'produtos'}</strong>
                    {combos > 0 && <> (sendo {combos} {combos === 1 ? 'combo' : 'combos'})</>}. O que fazer com {alvos.length === 1 ? 'ele' : 'eles'}?
                  </p>

                  {!semDestino && (
                    <label className={`flex flex-col gap-2 rounded-lg border p-3 cursor-pointer transition ${acao === 'move' ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}>
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          checked={acao === 'move'}
                          onChange={() => setDeleteCategoryAction('move')}
                          className="accent-primary"
                        />
                        <span className="text-sm font-medium">Mover para outra categoria</span>
                      </div>
                      <p className="text-xs text-muted-foreground pl-6">
                        Os produtos continuam à venda, só mudam de lugar no cardápio.
                      </p>
                      <div className="pl-6">
                        <Select
                          value={deleteCategoryTarget}
                          onValueChange={(v) => { setDeleteCategoryAction('move'); setDeleteCategoryTarget(v); }}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Escolha a categoria" />
                          </SelectTrigger>
                          <SelectContent>
                            {outras.map((c: any) => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </label>
                  )}

                  <label className={`flex flex-col gap-2 rounded-lg border p-3 cursor-pointer transition ${acao === 'wipe' ? 'border-destructive bg-destructive/5' : 'hover:bg-muted/40'}`}>
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={acao === 'wipe'}
                        onChange={() => setDeleteCategoryAction('wipe')}
                        className="accent-destructive"
                      />
                      <span className="text-sm font-medium">Excluir os produtos junto</span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-6">
                      {alvos.length === 1 ? 'O produto some' : 'Os produtos somem'} do cardápio e do PDV. Não tem como desfazer.
                    </p>
                  </label>

                  {semDestino && (
                    <p className="text-xs text-muted-foreground">
                      Não há outra categoria para onde mover — crie uma antes se não quiser perder esses produtos.
                    </p>
                  )}
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setDeletingCategory(null)} disabled={isDeletingCategory}>
                  Cancelar
                </Button>
                <Button
                  onClick={confirmDeleteCategory}
                  disabled={isDeletingCategory}
                  className={acao === 'wipe' && alvos.length > 0 ? 'bg-destructive text-white hover:bg-destructive/90' : 'bg-primary text-white'}
                >
                  {isDeletingCategory && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {alvos.length === 0
                    ? 'Excluir categoria'
                    : acao === 'move'
                      ? 'Mover e excluir categoria'
                      : `Excluir categoria e ${alvos.length} ${alvos.length === 1 ? 'produto' : 'produtos'}`}
                </Button>
              </DialogFooter>
            </>
          );
        })()}
      </DialogContent>
    </Dialog>
    </div>
  );
}
