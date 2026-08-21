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
  PowerOff,
  Search,
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
import { getEffectiveStock, getManagedStock } from '@/lib/inventory';
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
import { hasAnyVisibleToggle } from '@/lib/menu-visibility';
import { removeAccents } from '@/lib/utils';
import { getOrderCodePrefix } from '@/lib/order-code';

interface EstoqueTabProps {
  db: any;
  ownerId: string;
  items: any[] | null;
  orders: any[] | null;
  userName?: string;
  storeName?: string;
  enableInventory?: boolean;
  /**
   * Religar o produto no cardápio. Quem grava é a aba Produtos (dona do
   * liga/desliga); aqui só perguntamos, e só se ela passar o callback — sem
   * ele o convite nem aparece, que é como o operador sem permissão fica de fora.
   */
  onReligarProduto?: (item: any) => Promise<void>;
  canEdit?: boolean;
}

const PERIODS = [
  { id: '7', label: 'Últimos 7 dias' },
  { id: '30', label: 'Últimos 30 dias' },
  { id: '90', label: 'Últimos 90 dias' },
  { id: 'custom', label: 'Período personalizado' },
  { id: 'all', label: 'Tudo' },
];

/** Data no formato do <input type="date"> usando o fuso LOCAL (toISOString joga pra UTC e vira o dia). */
function toInputDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

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
  onReligarProduto,
}: EstoqueTabProps) {
  const { toast } = useToast();
  const [view, setView] = useState<'produtos' | 'historico'>('produtos');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'esgotados' | 'sem_controle'>('todos');
  const [period, setPeriod] = useState('30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [historySearch, setHistorySearch] = useState('');

  // Movimentação em edição (null = modal fechado)
  const [pending, setPending] = useState<{ item: any; type: StockMovementType } | null>(null);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  /**
   * Produto que acabou de receber entrada e continua desligado no cardápio.
   * É o momento exato de perguntar: repor o estoque não mexe no botão, e era
   * aí que a mercadoria ficava presa — a dona repunha, achava que voltou, e o
   * produto seguia invisível por semanas.
   */
  const [convidarReligar, setConvidarReligar] = useState<{ item: any; estoque: number } | null>(null);
  const [religando, setReligando] = useState(false);

  const movementsQuery = useMemoFirebase(
    () => (db && ownerId ? query(collection(db, 'stock_movements'), where('ownerId', '==', ownerId)) : null),
    [db, ownerId],
  );
  const { data: movements, isLoading: loadingMovements } = useCollection(movementsQuery);

  /**
   * Combo não tem estoque próprio: o dele é o menor dos componentes, e a venda
   * abate os componentes. Movimentar um combo gravaria um número que o sistema
   * ignora — por isso ele aparece só para consulta.
   */
  const isDerived = (item: any) => !!item?.isCombo || item?.saleUnit === 'kg';

  /** Este produto está tendo o estoque contado? */
  const controlado = (item: any) => getManagedStock(item?.stockQuantity) !== null;

  const movableItems = useMemo(() => (items || []).filter((i) => !isDerived(i)), [items]);

  const controlled = useMemo(
    () => movableItems.filter((i) => getManagedStock(i.stockQuantity) !== null),
    [movableItems],
  );

  const resumo = useMemo(() => {
    const zerados = controlled.filter((i) => getManagedStock(i.stockQuantity) === 0);
    const unidades = controlled.reduce((s, i) => s + (getManagedStock(i.stockQuantity) || 0), 0);
    return {
      controlados: controlled.length,
      semControle: movableItems.length - controlled.length,
      zerados: zerados.length,
      zeradosAtivos: zerados.filter((i) => i.isAvailable !== false).length,
      unidades,
    };
  }, [controlled, movableItems]);

  const filteredItems = useMemo(() => {
    const term = removeAccents(search.trim().toLowerCase());
    const list = (items || []).filter((i) => {
      if (term && !removeAccents((i.name || '').toLowerCase()).includes(term)) return false;
      if (statusFilter === 'esgotados') return !isDerived(i) && getManagedStock(i.stockQuantity) === 0;
      if (statusFilter === 'sem_controle') return !isDerived(i) && getManagedStock(i.stockQuantity) === null;
      return true;
    });
    // Esgotado primeiro: é o que precisa de ação. Derivado (combo/kg) por último.
    return list.sort((a, b) => {
      const rank = (i: any) => {
        if (isDerived(i)) return 3;
        const s = getManagedStock(i.stockQuantity);
        return s === null ? 2 : s === 0 ? 0 : 1;
      };
      const ra = rank(a);
      const rb = rank(b);
      return ra !== rb ? ra - rb : (a.name || '').localeCompare(b.name || '');
    });
  }, [items, search, statusFilter]);

  /** Intervalo escolhido. `to` inclui o dia inteiro (até 23:59:59). */
  const range = useMemo(() => {
    if (period === 'all') return { from: null as Date | null, to: null as Date | null };
    if (period === 'custom') {
      return {
        from: customFrom ? new Date(`${customFrom}T00:00:00`) : null,
        to: customTo ? new Date(`${customTo}T23:59:59.999`) : null,
      };
    }
    return { from: new Date(Date.now() - Number(period) * 86400000), to: null as Date | null };
  }, [period, customFrom, customTo]);

  // Os campos de data ficam SEMPRE na tela: num preset eles mostram o intervalo
  // equivalente (para ela enxergar o que está filtrando), e mexer em qualquer um
  // deles passa para personalizado.
  const shownFrom = period === 'custom'
    ? customFrom
    : period === 'all' ? '' : toInputDate(new Date(Date.now() - Number(period) * 86400000));
  const shownTo = period === 'custom' ? customTo : period === 'all' ? '' : toInputDate(new Date());

  const inRange = React.useCallback(
    (date: Date | null) => {
      if (!date) return true; // sem data conhecida: não esconde o lançamento
      if (range.from && date < range.from) return false;
      if (range.to && date > range.to) return false;
      return true;
    },
    [range],
  );

  const periodLabel = useMemo(() => {
    if (period !== 'custom') return PERIODS.find((p) => p.id === period)?.label || '';
    const de = customFrom ? new Date(`${customFrom}T00:00:00`).toLocaleDateString('pt-BR') : 'início';
    const ate = customTo ? new Date(`${customTo}T00:00:00`).toLocaleDateString('pt-BR') : 'hoje';
    return `${de} a ${ate}`;
  }, [period, customFrom, customTo]);

  /** Histórico = ajustes manuais + vendas derivadas dos pedidos. */
  const history = useMemo<HistoryRow[]>(() => {
    const rows: HistoryRow[] = [];

    for (const m of movements || []) {
      const date = (m as any).createdAt?.toDate?.() ?? null;
      if (!inRange(date)) continue;
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
      if (!inRange(date)) continue;
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
          note: `Pedido #${getOrderCodePrefix(order).toUpperCase()}`,
          userName: order.source === 'pdv' ? 'PDV' : 'Cardápio',
        });
      }
    }

    const termo = removeAccents(historySearch.trim().toLowerCase());
    const filtered = termo
      ? rows.filter((r) => removeAccents((r.itemName || '').toLowerCase()).includes(termo))
      : rows;
    return filtered.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
  }, [movements, orders, items, inRange, historySearch]);

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

  /** Ao escolher personalizado, herda o intervalo que já estava sendo mostrado. */
  const handlePeriodChange = (value: string) => {
    if (value === 'custom') {
      setCustomFrom(shownFrom || toInputDate(new Date(Date.now() - 30 * 86400000)));
      setCustomTo(shownTo || toInputDate(new Date()));
    }
    setPeriod(value);
  };

  /** Mexer numa das datas vira personalizado, preservando a outra ponta. */
  const handleDateChange = (which: 'from' | 'to', value: string) => {
    if (period !== 'custom') {
      setCustomFrom(which === 'from' ? value : shownFrom);
      setCustomTo(which === 'to' ? value : shownTo);
      setPeriod('custom');
      return;
    }
    if (which === 'from') setCustomFrom(value);
    else setCustomTo(value);
  };

  const openMovement = (item: any, type: StockMovementType) => {
    setPending({ item, type });
    setQty('');
    setNote('');
  };

  const handleSave = async (override?: StockMovementType) => {
    if (!pending || !db) return;
    const type = override ?? pending.type;
    const n = type === 'sem_controle' ? 0 : parseQuantity(qty);
    if (n === null) {
      toast({ variant: 'destructive', title: 'Quantidade inválida', description: 'Digite um número inteiro, sem sinal de menos.' });
      return;
    }
    setSaving(true);
    try {
      const res = await applyStockChange(db, {
        ownerId,
        itemId: pending.item.id,
        type,
        quantity: n,
        note,
        userName,
      });
      toast({
        title: `${MOVEMENT_LABELS[type]} registrada`,
        description: res.stockAfter === null
          ? `${res.itemName} passa a vender sem limite.`
          : `${res.itemName}: ${res.stockBefore ?? 'sem controle'} → ${res.stockAfter} unidade(s).`,
      });
      const desligado = pending.item?.isAvailable === false || !hasAnyVisibleToggle(pending.item);
      const item = pending.item;
      setPending(null);
      if (onReligarProduto && type === 'entrada' && typeof res.stockAfter === 'number' && res.stockAfter > 0 && desligado) {
        setConvidarReligar({ item, estoque: res.stockAfter });
      }
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
    const sufixo = period === 'custom' && customFrom && customTo
      ? `${customFrom}_a_${customTo}`
      : toInputDate(new Date());
    downloadCsv(`estoque-${sufixo}.csv`, buildMovementsCsv(history, storeName, periodLabel));
  };

  const stockBadge = (item: any) => {
    // Combo mostra o estoque derivado dos componentes; os demais, o próprio.
    const stock = getEffectiveStock(item, items || []);
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

      {enableInventory && resumo.semControle > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          <div className="flex items-start gap-3">
            <PackageSearch className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <strong>
                {resumo.semControle === 1
                  ? '1 produto está sem controle de estoque.'
                  : `${resumo.semControle} produtos estão sem controle de estoque.`}
              </strong>{' '}
              Eles vendem sem limite e nunca aparecem como esgotados. Se for de propósito, tudo bem —
              se não, faça uma entrada para começar a contar.
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-sky-300 bg-white text-sky-800 hover:bg-sky-100"
            onClick={() => { setView('produtos'); setStatusFilter('sem_controle'); }}
          >
            Ver quais são
          </Button>
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
          <div className="flex flex-wrap items-center gap-2">
            {([
              { id: 'todos', label: 'Todos' },
              { id: 'esgotados', label: `Esgotados (${resumo.zerados})` },
              { id: 'sem_controle', label: `Sem controle (${resumo.semControle})` },
            ] as const).map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => setStatusFilter(chip.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  statusFilter === chip.id
                    ? 'border-primary bg-primary text-white'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {chip.label}
              </button>
            ))}
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sky-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar produto..."
                className="border-2 border-sky-400 pl-9 placeholder:text-sky-700/50 focus-visible:ring-sky-300"
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {/* Busca em vez de lista suspensa: com 78 produtos, achar um no
                dropdown é pior do que digitar duas letras. */}
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sky-500" />
              <Input
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Buscar produto..."
                className="h-10 border-2 border-sky-400 pl-9 placeholder:text-sky-700/50 focus-visible:ring-sky-300"
              />
            </div>
            <Select value={period} onValueChange={handlePeriodChange}>
              <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5">
              <Input
                type="date" value={shownFrom} max={shownTo || undefined}
                onChange={(e) => handleDateChange('from', e.target.value)}
                aria-label="Data inicial" className="h-10 w-[150px]"
              />
              <span className="text-xs text-muted-foreground">até</span>
              <Input
                type="date" value={shownTo} min={shownFrom || undefined}
                onChange={(e) => handleDateChange('to', e.target.value)}
                aria-label="Data final" className="h-10 w-[150px]"
              />
            </div>
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
                <TableHead className="w-[280px] pr-6 text-right">Movimentar</TableHead>
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
                    {item.isCombo && (
                      <span className="text-[11px] text-muted-foreground">combo · o estoque vem dos itens que o compõem</span>
                    )}
                    {item.saleUnit === 'kg' && (
                      <span className="text-[11px] text-muted-foreground">vendido por peso · não conta unidade</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">{stockBadge(item)}</TableCell>
                  <TableCell className="pr-6">
                    {isDerived(item) ? (
                      <div className="text-right text-xs text-muted-foreground">Só consulta</div>
                    ) : (
                      <div className="flex justify-end gap-1.5">
                        {/* Em produto sem contagem, a Entrada é justamente o que
                            liga o controle — então o botão diz isso, em vez de
                            existir um interruptor separado fazendo o mesmo. */}
                        <Button
                          size="sm" variant="outline" disabled={!canEdit}
                          onClick={() => openMovement(item, 'entrada')}
                          className="gap-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                        >
                          <ArrowUpCircle className="h-3.5 w-3.5" />
                          {controlado(item) ? 'Entrada' : 'Controlar'}
                        </Button>
                        <Button
                          size="sm" variant="outline"
                          disabled={!canEdit || !controlado(item)}
                          title={controlado(item) ? undefined : 'Sem controle: não há estoque de onde tirar'}
                          onClick={() => openMovement(item, 'saida')}
                          className="gap-1 border-red-200 text-red-700 hover:bg-red-50"
                        >
                          <ArrowDownCircle className="h-3.5 w-3.5" /> Saída
                        </Button>
                        {/* Único caminho para sair da contagem. Discreto: e uma
                            acao rara, mas sem ela o produto fica preso contado. */}
                        {controlado(item) && (
                          <Button
                            size="sm" variant="ghost" disabled={!canEdit}
                            onClick={() => openMovement(item, 'sem_controle')}
                            title="Parar de contar o estoque deste produto"
                            aria-label={`Parar de contar o estoque de ${item.name}`}
                            className="px-2 text-slate-400 hover:text-slate-700"
                          >
                            <PowerOff className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
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

      <Dialog open={!!convidarReligar} onOpenChange={(open) => { if (!open && !religando) setConvidarReligar(null); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Este produto está desligado no cardápio</DialogTitle>
          </DialogHeader>
          {convidarReligar && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                <strong className="text-slate-800">{convidarReligar.item.name}</strong> ficou com{' '}
                <strong className="text-slate-800">{convidarReligar.estoque} unidade(s)</strong>, mas continua
                desligado — do jeito que está, ninguém consegue comprar.
              </p>
              <p className="text-sm text-muted-foreground">Quer religar agora?</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={religando} onClick={() => setConvidarReligar(null)}>
              Deixar desligado
            </Button>
            <Button
              className="bg-primary text-white"
              disabled={religando}
              onClick={async () => {
                if (!convidarReligar || !onReligarProduto) return;
                setReligando(true);
                try {
                  await onReligarProduto(convidarReligar.item);
                  setConvidarReligar(null);
                } finally {
                  setReligando(false);
                }
              }}
            >
              {religando ? 'Religando…' : 'Religar no cardápio'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pending} onOpenChange={(open) => { if (!open && !saving) setPending(null); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {pending
                ? `${pending.type === 'entrada' && !controlado(pending.item) ? 'Começar a controlar' : MOVEMENT_LABELS[pending.type]} — ${pending.item.name}`
                : ''}
            </DialogTitle>
          </DialogHeader>

          {pending && (
            <div className="space-y-4">
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <span className="text-muted-foreground">Estoque agora: </span>
                <strong>{getManagedStock(pending.item.stockQuantity) ?? 'sem controle'}</strong>
              </div>

              {pending.type === 'sem_controle' ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  Este produto passa a <strong>vender sem limite</strong>: as vendas deixam de descontar e ele
                  nunca vai aparecer como esgotado. A contagem atual é descartada. Para voltar a controlar,
                  basta lançar uma entrada.
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="qtd">
                      {pending.type !== 'entrada'
                        ? 'Quantas unidades saíram?'
                        : controlado(pending.item)
                          ? 'Quantas unidades entraram?'
                          : 'Quantas unidades você tem agora?'}
                    </Label>
                    <Input
                      id="qtd" type="number" min="0" step="1" autoFocus
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      placeholder="quantidade"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {pending.type !== 'entrada'
                        ? 'Digite só quanto saiu. O sistema desconta do que já tem no estoque.'
                        : controlado(pending.item)
                          ? 'Digite só quanto entrou agora, não o total. O sistema soma ao que já tem no estoque.'
                          : 'A partir daqui este produto passa a ser contado, e as vendas vão descontar.'}
                    </p>
                  </div>

                  {preview && (
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                      Vai ficar com <strong>{preview.stockAfter} unidade(s)</strong>
                      <span className="text-muted-foreground">
                        {' '}({preview.before ?? 'sem controle'} {preview.delta >= 0 ? '+' : '−'} {Math.abs(preview.delta)})
                      </span>
                    </div>
                  )}
                </>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="obs">Observação (opcional)</Label>
                <Textarea
                  id="obs" rows={2} value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={pending.type === 'entrada' ? 'ex.: produção da tarde' : pending.type === 'saida' ? 'ex.: quebra, degustação' : 'ex.: não vou contar este item'}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)} disabled={saving}>Cancelar</Button>
            <Button
              onClick={() => handleSave()}
              disabled={saving || (pending?.type !== 'sem_controle' && parseQuantity(qty) === null)}
              variant={pending?.type === 'sem_controle' ? 'destructive' : 'default'}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {pending?.type === 'sem_controle' ? 'Deixar sem controle' : 'Registrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
