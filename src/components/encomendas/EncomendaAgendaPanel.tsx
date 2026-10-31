'use client';

import React, { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { CalendarDays, Clock, Copy as CopyIcon, Plus, Trash2 } from 'lucide-react';
import { type DayHours, DAY_ORDER, DAY_SHORT, fromStoreWorkingHours } from '@/lib/encomendas/schedule';
import type { RascunhoEncomendas } from '@/lib/encomendas/rascunho';
import type { EncomendaConfig } from '@/lib/encomendas/config';
import { EncomendaDiasFechados } from '@/components/encomendas/EncomendaDiasFechados';

type Modo = 'week' | 'store' | 'text';

// Aba Agenda: como a dona conta os dias/horários e o prazo do pedido. Controlada:
// o estado mora no rascunho da EncomendasAdminTab.
export function EncomendaAgendaPanel({ r, onChange, storeProfile, liveConfig }: {
  r: RascunhoEncomendas;
  onChange: (patch: Partial<RascunhoEncomendas>) => void;
  storeProfile: any;
  liveConfig: EncomendaConfig;
}) {
  // Horário fixo da semana do perfil da loja, se já estiver preenchido lá.
  const storeWeek = useMemo(() => fromStoreWorkingHours(storeProfile?.workingHours), [storeProfile?.workingHours]);
  // Seguindo a loja, os dias mostram o horário do Perfil e não se editam aqui.
  const following = r.scheduleMode === 'store' && !!storeWeek;
  const shownWeek = following && storeWeek ? storeWeek : r.weekHours;
  const modo: Modo = r.scheduleMode === 'text' ? 'text' : following ? 'store' : 'week';

  const opcoes: { id: Modo; label: string }[] = [
    { id: 'week', label: 'Por dia da semana' },
    ...(storeWeek ? [{ id: 'store' as Modo, label: 'Igual ao da loja' }] : []),
    { id: 'text', label: 'Texto livre' },
  ];

  const escolher = (m: Modo) => {
    if (m === modo) return;
    // Saindo do "igual ao da loja", a lista começa do horário da loja: o que o
    // cliente via continua igual até alguém mudar um dia.
    if (m === 'week' && modo === 'store' && storeWeek) onChange({ scheduleMode: 'week', weekHours: storeWeek });
    else onChange({ scheduleMode: m });
  };

  const setDay = (index: number, patch: Partial<DayHours>) =>
    onChange({ weekHours: r.weekHours.map((d, i) => (i === index ? { ...d, ...patch } : d)) });

  const times = r.catalog.deliveryTimes;
  const setTimes = (next: string[]) => onChange({ catalog: { ...r.catalog, deliveryTimes: next } });

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="space-y-5">
      <Card className="border shadow-sm rounded-2xl">
        <CardContent className="space-y-3 p-4">
          <div>
            <p className="flex items-center gap-2 font-bold text-slate-800"><CalendarDays className="h-4 w-4 text-emerald-600" /> Dias e horários</p>
            <p className="text-xs text-muted-foreground">O que o cliente vê na página e os dias que ele pode escolher.</p>
          </div>

          <div className="flex h-9 rounded-md bg-slate-100 p-0.5">
            {opcoes.map((o) => (
              <button key={o.id} type="button" onClick={() => escolher(o.id)}
                className={`flex-1 rounded px-2 text-xs font-semibold transition-colors ${modo === o.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {o.label}
              </button>
            ))}
          </div>

          {modo !== 'text' ? (
            <div className="space-y-2">
              <div className="divide-y rounded-lg border">
                {DAY_ORDER.map((d) => {
                  const day = shownWeek[d];
                  return (
                    <div key={d} className={`flex h-9 items-center gap-2 px-2.5 ${day.closed ? 'bg-slate-50' : ''}`}>
                      <span className="w-9 shrink-0 text-xs font-semibold text-slate-700">{DAY_SHORT[d]}</span>
                      <Switch checked={!day.closed} disabled={following} onCheckedChange={(on) => setDay(d, { closed: !on })} className="scale-75" />
                      {day.closed ? (
                        <span className="flex-1 text-right text-xs text-muted-foreground">Fechado</span>
                      ) : (
                        <div className="flex flex-1 items-center justify-end gap-1.5">
                          <Input type="time" value={day.open} disabled={following} onChange={(e) => setDay(d, { open: e.target.value })} className="h-7 w-[5.5rem] px-1.5 text-xs" />
                          <span className="text-xs text-muted-foreground">às</span>
                          <Input type="time" value={day.close} disabled={following} onChange={(e) => setDay(d, { close: e.target.value })} className="h-7 w-[5.5rem] px-1.5 text-xs" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="text-xs text-muted-foreground">
                  {following ? 'Para mudar, altere o horário de funcionamento em Perfil da Loja.' : 'A página recusa pedidos nos dias fechados.'}
                </p>
                {modo === 'week' && storeWeek && (
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-slate-600" onClick={() => onChange({ weekHours: storeWeek })}>
                    <CopyIcon className="mr-1.5 h-3.5 w-3.5" /> Copiar o horário da loja
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-slate-600">Dias de funcionamento</Label>
                  <Input className="h-9 text-sm" value={r.daysLabel} onChange={(e) => onChange({ daysLabel: e.target.value })} placeholder="Ex.: Terça a Sábado" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-slate-600">Horário de atendimento</Label>
                  <Input className="h-9 text-sm" value={r.hours} onChange={(e) => onChange({ hours: e.target.value })} placeholder="Ex.: 09h às 18h" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">São as duas linhas do bloco &quot;Horário&quot;, no rodapé da página. Os dias também aparecem na hora de escolher a data do pedido.</p>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Dias que aceitam retirada ou entrega</Label>
                <div className="flex flex-wrap gap-1.5">
                  {DAY_SHORT.map((d, i) => {
                    const on = r.weekDays.includes(i);
                    return (
                      <button key={d} type="button"
                        onClick={() => onChange({ weekDays: on ? r.weekDays.filter((x) => x !== i) : [...r.weekDays, i].sort() })}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${on ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                        {d}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">A página recusa datas fora desses dias. Nenhum marcado = todos os dias.</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border shadow-sm rounded-2xl">
        <CardContent className="space-y-4 p-4">
          <div>
            <p className="flex items-center gap-2 font-bold text-slate-800"><Clock className="h-4 w-4 text-emerald-600" /> Prazo e horários</p>
            <p className="text-xs text-muted-foreground">Com quanta antecedência o cliente precisa pedir e a que horas retira ou recebe.</p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-semibold text-slate-600">Antecedência mínima</Label>
            <div className="flex items-center gap-2">
              <Input type="number" min={0} className="h-9 w-24 text-sm" value={r.minDays} onChange={(e) => onChange({ minDays: Number(e.target.value) })} />
              <span className="text-sm text-slate-600">dias</span>
            </div>
            <p className="text-xs text-muted-foreground">O cliente só escolhe datas a partir desse prazo.</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-600">Horários de retirada e entrega</Label>
            <div className="flex flex-wrap gap-2">
              {times.map((t, i) => (
                <div key={i} className="flex items-center gap-0.5">
                  <Input className="h-9 w-24 text-sm" value={t} placeholder="Ex.: 14:00"
                    onChange={(e) => setTimes(times.map((x, j) => (j === i ? e.target.value : x)))} />
                  <button type="button" title="Remover horário" onClick={() => setTimes(times.filter((_, j) => j !== i))}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setTimes([...times, ''])}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar horário
            </Button>
          </div>
        </CardContent>
      </Card>
      </div>

      {/* Em tela estreita o calendário vem primeiro: é o que a dona mais usa. */}
      <div className="order-first lg:order-none">
        <EncomendaDiasFechados r={r} onChange={onChange} liveConfig={liveConfig} />
      </div>
    </div>
  );
}
