'use client';

import React, { useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  ClipboardList,
  Download,
  Loader2,
  PackageSearch,
  Search,
  SlidersHorizontal,
  TriangleAlert,
} from 'lucide-react';

import { useCollection, useMemoFirebase } from '@/firebase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { getManagedStock } from '@/lib/inventory';
import {
  HISTORY_LABELS,
  MOVEMENT_LABELS,
  StockMovementError,
  applyStockChange,
  buildMovementsCsv,
  computeMovement,
  downloadCsv,
  parseQuantity,
  type HistoryRow,
  type StockMovementType,
} from '@/lib/stock-movements';
import { removeAccents } from '@/lib/utils';

interface EstoqueTabProps {
  db: any;
  ownerId: string;
  items: any[] | null;
  orders: any[] | null;
  userName?: string;
  storeName?: string;
  enableInventory?: boolean;
  canEdit?: boolean;
}

const PERIODS = [
  { id: '7', label: 'Últimos 7 dias' },
  { id: '30', label: 'Últimos 30 dias' },
  { id: '90', label: 'Últimos 90 dias' },
  { id: 'all', label: 'Tudo' },
];

/** Data de um pedido, tolerando o histórico antigo do PDV (que não tem createdAt). */
function orderDate(order: any): Date | null {
  const raw = order?.createdAt?.toDate?.() ?? (order?.orderDateTime ? new Date(order.orderDateTime) : null);
  return raw && !Number.isNaN(raw.getTime()) ? raw : null;
}

export function EstoqueTab({
  db,
  ownerId,
  items,
  orders,
  userName = '',
  storeName = '',
  enableInventory = false,
  canEdit = true,
}: EstoqueTabProps) {
  const { toast } = useToast();
  const [view, setView] = useState<'produtos' | 'historico'>('produtos');
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState('30');
  const [historyItemId, setHistoryItemId] = useState('all');

  // Movimentação em edição (null = modal fechado)
  const [pending, setPending] = useState<{ item: any; type: StockMovementType } | null>(null);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const movementsQuery = useMemoFirebase(
    () => (db && ownerId ? query(collection(db, 'stock_movements'), where('ownerId', '==', ownerId)) : null),
    [db, ownerId],
  );
  const { data: movements, isLoading: loadingMovements } = useCollection(movementsQuery);

  const controlled = useMemo(
    () => (items || []).filter((i) => getManagedStock(i.stockQuantity) !== null),
    [items],
  );

  const resumo = useMemo(() => {
    const zerados = controlled.filter((i) => getManagedStock(i.stockQuantity) === 0);
    const unidades = controlled.reduce((s, i) => s + (getManagedStock(i.stockQuantity) || 0), 0);
    return {
      controlados: controlled.length,
      semControle: (items || []).length - controlled.length,
      zerados: zerados.length,
      zeradosAtivos: zerados.filter((i) => i.isAvailable !== false).length,
      unidades,
    };
  }, [controlled, items]);

  const filteredItems = useMemo(() => {
    const term = removeAccents(search.trim().toLowerCase());
    const list = (items || []).filter((i) => !term || removeAccents((i.name || '').toLowerCase()).includes(term));
    // Esgotado primeiro: é o que precisa de ação.
    return list.sort((a, b) => {
      const sa = getManagedStock(a.stockQuantity);
      const sb = getManagedStock(b.stockQuantity);
      const ra = sa === null ? 2 : sa === 0 ? 0 : 1;
      const rb = sb === null ? 2 : sb === 0 ? 0 : 1;
      return ra !== rb ? ra - rb : (a.name || '').localeCompare(b.name || '');
    });
  }, [items, search]);

  /** Histórico = ajustes manuais + vendas derivadas dos pedidos. */
  const history = useMemo<HistoryRow[]>(() => {
    const cutoff = period === 'all' ? null : new Date(Date.now() - Number(period) * 86400000);
    const rows: HistoryRow[] = [];

    for (const m of movements || []) {
      const date = (m as any).createdAt?.toDate?.() ?? null;
      if (cutoff && date && date < cutoff) continue;
      rows.push({
        id: m.id,
        date,
        itemId: (m as any).itemId,
        itemName: (m as any).itemName || '',
        kind: (m as any).type,
        delta: Number((m as any).delta) || 0,
        stockBefore: (m as any).stockBefore ?? null,
        stockAfter: (m as any).stockAfter ?? null,
        note: (m as any).note || '',
        userName: (m as any).userName || '',
      });
    }

    const nameById = new Map((items || []).map((i) => [i.id, i.name]));
    for (const order of orders || []) {
      if (order?.status === 'canceled') continue;
      const reserved = order?.stockDeductedItems || {};
      const date = orderDate(order);
      if (cutoff && date && date < cutoff) continue;
      for (const [itemId, qtd] of Object.entries(reserved)) {
        const n = Number(qtd) || 0;
        if (n <= 0) continue;
        rows.push({
          id: `${order.id}:${itemId}`,
          date,
          itemId,
          itemName: nameById.get(itemId) || itemId,
          kind: 'venda',
          delta: -n,
          stockBefore: null,
          stockAfter: null,
          note: `Pedido #${String(order.id).slice(0, 5).toUpperCase()}`,
          userName: order.source === 'pdv' ? 'PDV' : 'Cardápio',
        });
      }
    }

    const filtered = historyItemId === 'all' ? rows : rows.filter((r) => r.itemId === historyItemId);
    return filtered.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
  }, [movements, orders, items, period, historyItemId]);

  const preview = useMemo(() => {
    if (!pending) return null;
    const n = parseQuantity(qty);
    if (n === null) return null;
    try {
      const before = getManagedStock(pending.item.stockQuantity);
      return { before, ...computeMovement(pending.type, before, n) };
    } catch {
      return null;
    }
  }, [pending, qty]);

  const openMovement = (item: any, type: StockMovementType) => {
    setPending({ item, type });
    setQty(type === 'ajuste' ? String(getManagedStock(item.stockQuantity) ?? '') : '');
    setNote('');
  };

  const handleSave = async () => {
    if (!pending || !db) return;
    const n = parseQuantity(qty);
    if (n === null) {
      toast({ variant: 'destructive', title: 'Quantidade inválida', description: 'Digite um número inteiro, sem sinal de menos.' });
      return;
    }
    setSaving(true);
    try {
      const res = await applyStockChange(db, {
        ownerId,
        itemId: pending.item.id,
        type: pending.type,
        quantity: n,
        note,
        userName,
      });
      toast({
        title: `${MOVEMENT_LABELS[pending.type]} registrada`,
        description: `${res.itemName}: ${res.stockBefore ?? 'sem controle'} → ${res.stockAfter} unidade(s).`,
      });
      setPending(null);
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: err instanceof StockMovementError ? 'Não deu para registrar' : 'Erro',
        description: err?.message || 'Tente de novo.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    if (history.length === 0) {
      toast({ title: 'Nada para exportar', description: 'Não há movimentação no período escolhido.' });
      return;
    }
    const hoje = new Date().toISOString().slice(0, 10);
    downloadCsv(`estoque-${hoje}.csv`, buildMovementsCsv(history, storeName));
  };

  const stockBadge = (item: any) => {
    const stock = getManagedStock(item.stockQuantity);
    if (stock === null) return <Badge variant="outline" className="text-slate-500">Sem controle</Badge>;
    if (stock === 0) return <Badge className="bg-red-500 hover:bg-red-600">Esgotado</Badge>;
    if (stock <= 3) return <Badge className="bg-amber-500 hover:bg-amber-600">{stock} un.</Badge>;
    return <Badge className="bg-emerald-600 hover:bg-emerald-700">{stock} un.</Badge>;
  };

  return (
    <div className="space-y-5">
      {!enableInventory && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <strong>O controle de estoque está desligado.</strong> Você pode registrar as movimentações aqui, mas as
            vendas não vão descontar nada e nenhum produto vai aparecer como esgotado no cardápio. Para ligar, vá em
            Dados e Contato.
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Produtos controlados</p>
            <p className="mt-1 text-2xl font-black text-slate-800">{resumo.controlados}</p>
            <p className="text-[11px] text-muted-foreground">{resumo.semControle} sem controle</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Esgotados</p>
            <p className="mt-1 text-2xl font-black text-red-600">{resumo.zerados}</p>
            <p className="text-[11px] text-muted-foreground">{resumo.zeradosAtivos} ainda ligados no cardápio</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Unidades em estoque</p>
            <p className="mt-1 text-2xl font-black text-slate-800">{resumo.unidades}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Lançamentos no período</p>
            <p className="mt-1 text-2xl font-black text-slate-800">{history.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={view} onValueChange={(v) => setView(v as any)}>
          <TabsList>
            <TabsTrigger value="produtos" className="gap-1.5">
              <PackageSearch className="h-3.5 w-3.5" /> Produtos
            </TabsTrigger>
            <TabsTrigger value="historico" className="gap-1.5">
              <ClipboardList className="h-3.5 w-3.5" /> Histórico
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {view === 'produtos' ? (
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar produto..."
              className="pl-9"
            />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={historyItemId} onValueChange={setHistoryItemId}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os produtos</SelectItem>
                {controlled.map((i) => (
                  <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={handleExport} className="gap-1.5">
              <Download className="h-4 w-4" /> Exportar
            </Button>
          </div>
        )}
      </div>

      {view === 'produtos' ? (
        <div className="rounded-xl border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Produto</TableHead>
                <TableHead className="w-[140px] text-center">Estoque</TableHead>
                <TableHead className="w-[320px] pr-6 text-right">Movimentar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-32 text-center text-sm text-muted-foreground">
                    Nenhum produto encontrado.
                  </TableCell>
                </TableRow>
              ) : filteredItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="pl-6">
                    <div className="font-medium text-slate-800">{item.name}</div>
                    {item.saleUnit === 'kg' && (
                      <span className="text-[11px] text-muted-foreground">vendido por peso</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">{stockBadge(item)}</TableCell>
                  <TableCell className="pr-6">
                    <div className="flex justify-end gap-1.5">
                      <Button
                        size="sm" variant="outline" disabled={!canEdit || item.saleUnit === 'kg'}
                        onClick={() => openMovement(item, 'entrada')}
                        className="gap-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      >
                        <ArrowUpCircle className="h-3.5 w-3.5" /> Entrada
                      </Button>
                      <Button
                        size="sm" variant="outline" disabled={!canEdit || item.saleUnit === 'kg'}
                        onClick={() => openMovement(item, 'saida')}
                        className="gap-1 border-red-200 text-red-700 hover:bg-red-50"
                      >
                        <ArrowDownCircle className="h-3.5 w-3.5" /> Saída
                      </Button>
                      <Button
                        size="sm" variant="ghost" disabled={!canEdit || item.saleUnit === 'kg'}
                        onClick={() => openMovement(item, 'ajuste')}
                        className="gap-1 text-slate-600"
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" /> Ajustar
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="rounded-xl border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[150px] pl-6">Quando</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="w-[110px]">Tipo</TableHead>
                <TableHead className="w-[100px] text-center">Qtd</TableHead>
                <TableHead className="w-[130px] text-center">Ficou com</TableHead>
                <TableHead className="pr-6">Observação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingMovements ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-sm text-muted-foreground">
                    Nenhuma movimentação no período.
                  </TableCell>
                </TableRow>
              ) : history.slice(0, 400).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="pl-6 text-xs text-muted-foreground">
                    {row.date ? row.date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </TableCell>
                  <TableCell className="font-medium text-slate-800">{row.itemName}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        row.kind === 'venda' ? 'border-slate-200 text-slate-600'
                          : row.kind === 'entrada' ? 'border-emerald-200 text-emerald-700'
                          : row.kind === 'saida' ? 'border-red-200 text-red-700'
                          : 'border-blue-200 text-blue-700'
                      }
                    >
                      {HISTORY_LABELS[row.kind]}
                    </Badge>
                  </TableCell>
                  <TableCell className={`text-center font-bold ${row.delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {row.delta > 0 ? `+${row.delta}` : row.delta}
                  </TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">
                    {row.stockAfter === null ? '—' : `${row.stockAfter} un.`}
                  </TableCell>
                  <TableCell className="pr-6 text-xs text-muted-foreground">
                    {row.note}
                    {row.userName && <span className="ml-1 opacity-70">· {row.userName}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {history.length > 400 && (
            <p className="border-t p-3 text-center text-xs text-muted-foreground">
              Mostrando os 400 lançamentos mais recentes. Use Exportar para ver todos.
            </p>
          )}
        </div>
      )}

      <Dialog open={!!pending} onOpenChange={(open) => { if (!open && !saving) setPending(null); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {pending ? `${MOVEMENT_LABELS[pending.type]} — ${pending.item.name}` : ''}
            </DialogTitle>
          </DialogHeader>

          {pending && (
            <div className="space-y-4">
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <span className="text-muted-foreground">Estoque agora: </span>
                <strong>{getManagedStock(pending.item.stockQuantity) ?? 'sem controle'}</strong>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="qtd">
                  {pending.type === 'entrada' ? 'Quantas unidades entraram?'
                    : pending.type === 'saida' ? 'Quantas unidades saíram?'
                    : 'Qual o total contado?'}
                </Label>
                <Input
                  id="qtd" type="number" min="0" step="1" autoFocus
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder={pending.type === 'ajuste' ? 'total' : 'quantidade'}
                />
                {pending.type !== 'ajuste' && (
                  <p className="text-[11px] text-muted-foreground">
                    Digite só o que entrou ou saiu — a conta com as vendas o sistema faz sozinho.
                  </p>
                )}
              </div>

              {preview && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                  Vai ficar com <strong>{preview.stockAfter} unidade(s)</strong>
                  <span className="text-muted-foreground">
                    {' '}({preview.before ?? 'sem controle'} {preview.delta >= 0 ? '+' : '−'} {Math.abs(preview.delta)})
                  </span>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="obs">Observação (opcional)</Label>
                <Textarea
                  id="obs" rows={2} value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={pending.type === 'entrada' ? 'ex.: produção da tarde' : pending.type === 'saida' ? 'ex.: quebra, degustação' : 'ex.: contagem do fim do dia'}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || parseQuantity(qty) === null}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
