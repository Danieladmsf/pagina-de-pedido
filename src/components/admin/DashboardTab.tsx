'use client';

import React, { useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { useCollection, useMemoFirebase } from '@/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import {
  TrendingUp,
  ShoppingBag,
  Wallet,
  Users,
  Bike,
  Store,
  UtensilsCrossed,
  Package,
  Clock,
  CheckCircle2,
  XCircle,
  Flame,
  Trophy,
  CreditCard,
  CalendarDays,
} from 'lucide-react';

interface DashboardTabProps {
  db: any;
  user: any;
  orders: any[];
  items: any[];
  categories: any[];
  storeProfile: any;
}

type RangePreset = 'hoje' | '7d' | '30d' | 'mes' | 'custom';

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string; Icon: any }> = {
  received: { label: 'Recebido', color: 'text-amber-700', bg: 'bg-amber-100', Icon: Clock },
  preparing: { label: 'Preparando', color: 'text-orange-700', bg: 'bg-orange-100', Icon: Flame },
  out_for_delivery: { label: 'Em rota', color: 'text-blue-700', bg: 'bg-blue-100', Icon: Bike },
  delivered: { label: 'Entregue', color: 'text-emerald-700', bg: 'bg-emerald-100', Icon: CheckCircle2 },
  canceled: { label: 'Cancelado', color: 'text-rose-700', bg: 'bg-rose-100', Icon: XCircle },
};

const ORDER_TYPE_LABELS: Record<string, { label: string; Icon: any }> = {
  delivery: { label: 'Delivery', Icon: Bike },
  pickup: { label: 'Retirada', Icon: Store },
  dine_in: { label: 'Mesa', Icon: UtensilsCrossed },
};

const PIE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

function brl(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function todayInputValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function DashboardTab({ db, user, orders, items, categories, storeProfile }: DashboardTabProps) {
  const clientesQuery = useMemoFirebase(
    () => (db && user ? query(collection(db, 'clientes'), where('ownerId', '==', user.uid)) : null),
    [db, user]
  );
  const { data: clientes } = useCollection(clientesQuery);

  const [rangePreset, setRangePreset] = useState<RangePreset>('hoje');
  const [customFrom, setCustomFrom] = useState<string>(todayInputValue());
  const [customTo, setCustomTo] = useState<string>(todayInputValue());

  const range = useMemo(() => {
    const now = new Date();
    const today = startOfDay(now);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    switch (rangePreset) {
      case 'hoje':
        return { from: today, to: tomorrow, label: 'Hoje', mode: 'hourly' as const };
      case '7d': {
        const f = new Date(today);
        f.setDate(today.getDate() - 6);
        return { from: f, to: tomorrow, label: 'Últimos 7 dias', mode: 'daily' as const };
      }
      case '30d': {
        const f = new Date(today);
        f.setDate(today.getDate() - 29);
        return { from: f, to: tomorrow, label: 'Últimos 30 dias', mode: 'daily' as const };
      }
      case 'mes': {
        const f = new Date(now.getFullYear(), now.getMonth(), 1);
        return {
          from: f,
          to: tomorrow,
          label: now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
          mode: 'daily' as const,
        };
      }
      case 'custom': {
        const f = customFrom ? new Date(`${customFrom}T00:00:00`) : today;
        const t = customTo ? new Date(`${customTo}T00:00:00`) : today;
        const tEnd = new Date(t);
        tEnd.setDate(tEnd.getDate() + 1);
        const sameDay = customFrom === customTo;
        return {
          from: f,
          to: tEnd,
          label: sameDay
            ? f.toLocaleDateString('pt-BR')
            : `${f.toLocaleDateString('pt-BR')} → ${t.toLocaleDateString('pt-BR')}`,
          mode: sameDay ? ('hourly' as const) : ('daily' as const),
        };
      }
    }
  }, [rangePreset, customFrom, customTo]);

  const stats = useMemo(() => {
    const safeOrders = Array.isArray(orders) ? orders : [];
    const { from, to, mode } = range;

    const inRange = safeOrders.filter(o => {
      const t = new Date(o.orderDateTime || o.createdAt || 0);
      return t >= from && t < to;
    });
    const valid = inRange.filter(o => o.status !== 'canceled');

    const periodRevenue = valid.reduce((s, o) => s + (o.totalAmount || 0), 0);
    const periodCount = valid.length;
    const avgTicket = periodCount > 0 ? periodRevenue / periodCount : 0;

    // Chart buckets
    let chartData: { label: string; vendas: number; pedidos: number }[] = [];
    if (mode === 'hourly') {
      const hours = Array.from({ length: 24 }, (_, h) => ({
        label: `${String(h).padStart(2, '0')}h`,
        vendas: 0,
        pedidos: 0,
      }));
      valid.forEach(o => {
        const t = new Date(o.orderDateTime || o.createdAt || 0);
        const h = t.getHours();
        if (hours[h]) {
          hours[h].vendas += o.totalAmount || 0;
          hours[h].pedidos += 1;
        }
      });
      chartData = hours;
    } else {
      const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000));
      const dayMap: Record<string, { label: string; vendas: number; pedidos: number; order: number }> = {};
      for (let i = 0; i < days; i++) {
        const d = new Date(from);
        d.setDate(from.getDate() + i);
        const k = dateKey(startOfDay(d));
        const showWeekday = days <= 14;
        const label = showWeekday
          ? d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' }).replace('.', '')
          : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        dayMap[k] = { label, vendas: 0, pedidos: 0, order: i };
      }
      valid.forEach(o => {
        const t = new Date(o.orderDateTime || o.createdAt || 0);
        const k = dateKey(startOfDay(t));
        if (dayMap[k]) {
          dayMap[k].vendas += o.totalAmount || 0;
          dayMap[k].pedidos += 1;
        }
      });
      chartData = Object.values(dayMap).sort((a, b) => a.order - b.order);
    }

    // Status breakdown (inclui cancelados)
    const statusCount: Record<string, number> = {};
    inRange.forEach(o => {
      const s = o.status || 'received';
      statusCount[s] = (statusCount[s] || 0) + 1;
    });

    // Tipo de pedido
    const typeCount: Record<string, number> = { delivery: 0, pickup: 0, dine_in: 0 };
    valid.forEach(o => {
      const t = o.orderType || (o.tableNumber ? 'dine_in' : 'pickup');
      typeCount[t] = (typeCount[t] || 0) + 1;
    });
    const typeData = Object.entries(typeCount)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: ORDER_TYPE_LABELS[k]?.label || k, value: v }));

    // Forma de pagamento
    const paymentCount: Record<string, number> = {};
    valid.forEach(o => {
      const raw = (o.paymentMethod || 'Não definido').toString();
      let primary = raw.split(/[+,;]/)[0].trim().split('(')[0].trim() || 'Não definido';
      if (primary === 'conta_casa') primary = 'Prazo';
      paymentCount[primary] = (paymentCount[primary] || 0) + (o.totalAmount || 0);
    });
    const paymentData = Object.entries(paymentCount)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    // Top produtos
    const productAgg: Record<string, { name: string; qty: number; revenue: number }> = {};
    valid.forEach(o => {
      (o.items || []).forEach((it: any) => {
        const key = it.id || it.name;
        if (!productAgg[key]) productAgg[key] = { name: it.name || 'Item', qty: 0, revenue: 0 };
        productAgg[key].qty += it.quantity || 1;
        productAgg[key].revenue += (it.unitPrice || 0) * (it.quantity || 1);
      });
    });
    const topProducts = Object.values(productAgg)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    // Pedidos recentes
    const recentOrders = [...inRange]
      .sort((a, b) => (b.orderDateTime || '').localeCompare(a.orderDateTime || ''))
      .slice(0, 6);

    return {
      periodRevenue,
      periodCount,
      avgTicket,
      chartData,
      statusCount,
      typeData,
      paymentData,
      topProducts,
      recentOrders,
    };
  }, [orders, range]);

  const totalProducts = items?.length || 0;
  const totalCategories = categories?.length || 0;
  const totalClientes = clientes?.length || 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      <div className="max-w-[1600px] w-full mx-auto px-4 pb-8 mt-4 space-y-6">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-800">Dashboard</h1>
            <p className="text-muted-foreground mt-1 font-medium">
              Visão geral do desempenho da {storeProfile?.storeName || 'loja'}.
            </p>
          </div>
          <Badge variant="outline" className="gap-2 px-3 py-1.5 text-xs font-semibold bg-white">
            <CalendarDays className="h-3.5 w-3.5 text-emerald-600" />
            {range.label}
          </Badge>
        </div>

        {/* Filtros de período */}
        <Card className="border shadow-sm rounded-2xl">
          <CardContent className="p-3 flex flex-wrap items-center gap-2">
            {([
              { key: 'hoje', label: 'Hoje' },
              { key: '7d', label: '7 dias' },
              { key: '30d', label: '30 dias' },
              { key: 'mes', label: 'Mês atual' },
              { key: 'custom', label: 'Personalizado' },
            ] as { key: RangePreset; label: string }[]).map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => setRangePreset(p.key)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
                  rangePreset === p.key
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
            {rangePreset === 'custom' && (
              <div className="flex items-center gap-2 ml-1">
                <input
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="h-8 px-2 text-xs rounded-md border border-input bg-background"
                />
                <span className="text-xs text-muted-foreground">até</span>
                <input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  max={todayInputValue()}
                  onChange={e => setCustomTo(e.target.value)}
                  className="h-8 px-2 text-xs rounded-md border border-input bg-background"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label="Vendas no Período"
            value={brl(stats.periodRevenue)}
            sub={`${stats.periodCount} pedido${stats.periodCount === 1 ? '' : 's'} válidos`}
            Icon={Wallet}
            color="emerald"
          />
          <KpiCard
            label="Ticket Médio"
            value={brl(stats.avgTicket)}
            sub={stats.periodCount > 0 ? 'por pedido' : 'sem pedidos no período'}
            Icon={TrendingUp}
            color="blue"
          />
          <KpiCard
            label="Pedidos no Período"
            value={stats.periodCount.toString()}
            sub={`${stats.statusCount.canceled || 0} cancelado${(stats.statusCount.canceled || 0) === 1 ? '' : 's'}`}
            Icon={ShoppingBag}
            color="violet"
          />
          <KpiCard
            label="Base de Clientes"
            value={totalClientes.toString()}
            sub={`${totalProducts} produtos · ${totalCategories} categorias`}
            Icon={Users}
            color="amber"
          />
        </div>

        {/* Gráfico do período + Status */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2 border shadow-sm rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
                {range.mode === 'hourly' ? 'Vendas por Hora' : 'Vendas no Período'}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.chartData} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                    <defs>
                      <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.55} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="label"
                      stroke="#64748b"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      interval={stats.chartData.length > 20 ? 'preserveStartEnd' : 0}
                    />
                    <YAxis
                      stroke="#64748b"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `R$${v >= 1000 ? `${Math.round(v / 100) / 10}k` : Math.round(v)}`}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                      formatter={(value: any, name: string) =>
                        name === 'vendas' ? [brl(value), 'Vendas'] : [value, 'Pedidos']
                      }
                      labelStyle={{ fontWeight: 700, color: '#0f172a' }}
                    />
                    <Bar dataKey="vendas" fill="url(#barFill)" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="border shadow-sm rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Package className="h-4 w-4 text-blue-600" />
                Status dos Pedidos
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2 space-y-2">
              {Object.keys(STATUS_LABELS).map((key) => {
                const count = stats.statusCount[key] || 0;
                const cfg = STATUS_LABELS[key];
                const Icon = cfg.Icon;
                const max = Math.max(1, ...Object.values(stats.statusCount));
                const pct = (count / max) * 100;
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className={`flex items-center gap-2 font-medium ${cfg.color}`}>
                        <Icon className="h-3.5 w-3.5" />
                        {cfg.label}
                      </span>
                      <span className="font-bold text-slate-800">{count}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${cfg.bg.replace('-100', '-400')} rounded-full transition-all`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {stats.periodCount === 0 && (stats.statusCount.canceled || 0) === 0 && (
                <p className="text-xs text-muted-foreground italic text-center pt-4">
                  Nenhum pedido no período.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Top produtos + Tipos + Pagamento */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="border shadow-sm rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" />
                Top Produtos
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2 space-y-2">
              {stats.topProducts.length === 0 ? (
                <p className="text-xs text-muted-foreground italic text-center py-6">
                  Sem vendas no período.
                </p>
              ) : (
                stats.topProducts.map((p, idx) => (
                  <div key={p.name} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50">
                    <div
                      className={`h-8 w-8 rounded-lg flex items-center justify-center font-black text-sm ${
                        idx === 0
                          ? 'bg-amber-100 text-amber-700'
                          : idx === 1
                          ? 'bg-slate-100 text-slate-600'
                          : idx === 2
                          ? 'bg-orange-100 text-orange-700'
                          : 'bg-slate-50 text-slate-500'
                      }`}
                    >
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{brl(p.revenue)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-emerald-600">{p.qty}</div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">vend.</div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border shadow-sm rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Bike className="h-4 w-4 text-teal-600" />
                Pedidos por Tipo
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              {stats.typeData.length === 0 ? (
                <p className="text-xs text-muted-foreground italic text-center py-6">
                  Sem dados no período.
                </p>
              ) : (
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={stats.typeData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={80}
                        paddingAngle={2}
                      >
                        {stats.typeData.map((_, idx) => (
                          <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                      />
                      <Legend
                        verticalAlign="bottom"
                        height={28}
                        wrapperStyle={{ fontSize: 11 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border shadow-sm rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-violet-600" />
                Faturamento por Pagamento
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2 space-y-2">
              {stats.paymentData.length === 0 ? (
                <p className="text-xs text-muted-foreground italic text-center py-6">
                  Sem pagamentos no período.
                </p>
              ) : (
                stats.paymentData.map((p, idx) => {
                  const total = stats.paymentData.reduce((s, x) => s + x.value, 0) || 1;
                  const pct = (p.value / total) * 100;
                  return (
                    <div key={p.name} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-700 truncate pr-2">{p.name}</span>
                        <span className="font-bold text-slate-800 shrink-0">{brl(p.value)}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: PIE_COLORS[idx % PIE_COLORS.length],
                          }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>

        {/* Pedidos recentes */}
        <Card className="border shadow-sm rounded-2xl">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
              <Clock className="h-4 w-4 text-slate-500" />
              Pedidos Recentes
            </CardTitle>
            <span className="text-xs text-muted-foreground">Últimos {stats.recentOrders.length} no período</span>
          </CardHeader>
          <CardContent className="pt-2">
            {stats.recentOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground italic text-center py-8">
                Nenhum pedido no período.
              </p>
            ) : (
              <div className="divide-y">
                {stats.recentOrders.map((o) => {
                  const status = STATUS_LABELS[o.status] || STATUS_LABELS.received;
                  const StatusIcon = status.Icon;
                  const type = ORDER_TYPE_LABELS[o.orderType || (o.tableNumber ? 'dine_in' : 'pickup')];
                  const TypeIcon = type?.Icon || ShoppingBag;
                  const dt = new Date(o.orderDateTime || o.createdAt || 0);
                  return (
                    <div key={o.id} className="flex items-center gap-3 py-3">
                      <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${status.bg}`}>
                        <StatusIcon className={`h-4 w-4 ${status.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-800 truncate">
                          {o.customerName || 'Cliente'}
                          {o.tableNumber ? ` · Mesa ${o.tableNumber}` : ''}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                          <span className="flex items-center gap-1">
                            <TypeIcon className="h-3 w-3" />
                            {type?.label || 'Pedido'}
                          </span>
                          <span>·</span>
                          <span>{dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                          <span>·</span>
                          <span className={status.color}>{status.label}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-black text-emerald-600">
                          {brl(o.totalAmount || 0)}
                        </div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          #{(o.id || '').slice(-5).toUpperCase()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  sub: string;
  Icon: any;
  color: 'emerald' | 'blue' | 'violet' | 'amber';
}

function KpiCard({ label, value, sub, Icon, color }: KpiCardProps) {
  const palette = {
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-100' },
    blue: { bg: 'bg-blue-50', text: 'text-blue-600', ring: 'ring-blue-100' },
    violet: { bg: 'bg-violet-50', text: 'text-violet-600', ring: 'ring-violet-100' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-600', ring: 'ring-amber-100' },
  }[color];

  return (
    <Card className="border shadow-sm rounded-2xl">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-2xl font-black text-slate-800 mt-1 truncate">{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
          </div>
          <div className={`shrink-0 h-10 w-10 rounded-xl flex items-center justify-center ring-4 ${palette.bg} ${palette.ring}`}>
            <Icon className={`h-5 w-5 ${palette.text}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
