'use client';

import React, { useMemo } from 'react';
import { DayPicker } from 'react-day-picker';
import { ptBR } from 'react-day-picker/locale';
import { Card, CardContent } from '@/components/ui/card';
import { CalendarOff, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  type RegrasDeData, DAY_LONG, DAY_SHORT, agruparDatas, dataDeIso, isoDeData, localIsoPlusDays,
  primeiraDataLivre, rotuloDeFaixa, situacaoDaData,
} from '@/lib/encomendas/schedule';
import type { RascunhoEncomendas } from '@/lib/encomendas/rascunho';
import type { EncomendaConfig } from '@/lib/encomendas/config';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// Marcas do react-day-picker v9 caem no <td> (não no botão): por isso os
// seletores `[&>button]`. Sem o CSS padrão da biblioteca: o layout é todo daqui.
const BTN = 'relative h-11 w-full rounded-lg text-sm font-semibold text-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 enabled:hover:bg-rose-50 enabled:hover:text-rose-700 disabled:cursor-default';
const HACHURA = '[&>button]:bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,rgb(226_232_240/0.8)_4px,rgb(226_232_240/0.8)_5px)] [&>button]:text-slate-300';
const FECHADO = "[&>button]:bg-rose-600 [&>button]:text-white [&>button:hover]:bg-rose-700 [&>button:hover]:text-white sm:[&>button]:after:absolute sm:[&>button]:after:inset-x-0 sm:[&>button]:after:bottom-0.5 sm:[&>button]:after:text-[9px] sm:[&>button]:after:font-medium sm:[&>button]:after:leading-none sm:[&>button]:after:content-['Fechado']";
const SETA = 'flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent';

// Calendário "Dias sem encomenda": clicar num dia fecha ou reabre. Não grava nada:
// só mexe no rascunho (a barra de salvar da tela cuida do resto).
export function EncomendaDiasFechados({ r, onChange, liveConfig }: {
  r: RascunhoEncomendas;
  onChange: (patch: Partial<RascunhoEncomendas>) => void;
  liveConfig: EncomendaConfig;
}) {
  const hoje = localIsoPlusDays(0);
  // As regras reagem na hora ao que está sendo mexido (dias da semana e prazo), antes de salvar.
  const regras: RegrasDeData = {
    minDays: Math.max(0, Math.floor(Number(r.minDays) || 0)),
    weekDays: liveConfig.weekDays,
    blockedDates: r.blockedDates,
  };
  const sit = (d: Date) => situacaoDaData(isoDeData(d), regras, hoje);

  const selecionadas = useMemo(() => r.blockedDates.map(dataDeIso), [r.blockedDates]);
  const mesAtual = useMemo(() => { const d = dataDeIso(hoje); return new Date(d.getFullYear(), d.getMonth(), 1); }, [hoje]);
  const fimDoCalendario = new Date(mesAtual.getFullYear(), mesAtual.getMonth() + 24, 0);

  const proxima = primeiraDataLivre(regras, hoje);
  // Abre no mês da primeira data que o cliente pode pedir: no fim do mês, o mês
  // atual inteiro está fora do prazo e pareceria um calendário sem nada para clicar.
  const mesInicial = useMemo(() => { const d = proxima ? dataDeIso(proxima) : mesAtual; return new Date(d.getFullYear(), d.getMonth(), 1); }, [proxima, mesAtual]);
  const faixas = agruparDatas(r.blockedDates.filter((d) => d >= hoje));
  const reabrir = (f: { inicio: string; fim: string }) => onChange({ blockedDates: r.blockedDates.filter((d) => d < f.inicio || d > f.fim) });

  return (
    <Card className="border shadow-sm rounded-2xl">
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="flex items-center gap-2 font-bold text-slate-800"><CalendarOff className="h-4 w-4 text-emerald-600" /> Dias sem encomenda</p>
          <p className="text-xs text-muted-foreground">Clique num dia para fechar ou reabrir. O cliente não consegue escolher um dia fechado.</p>
        </div>

        <DayPicker
          mode="multiple"
          locale={ptBR}
          selected={selecionadas}
          onSelect={(dias) => onChange({ blockedDates: (dias || []).map(isoDeData).sort() })}
          disabled={(d) => { const s = sit(d); return s === 'prazo' || s === 'semana'; }}
          modifiers={{
            semana: (d) => sit(d) === 'semana',
            prazoLiso: (d) => sit(d) === 'prazo' && !r.blockedDates.includes(isoDeData(d)),
          }}
          modifiersClassNames={{
            semana: HACHURA,
            prazoLiso: '[&>button]:text-slate-300',
          }}
          startMonth={mesAtual}
          endMonth={fimDoCalendario}
          defaultMonth={mesInicial}
          fixedWeeks
          showOutsideDays={false}
          formatters={{
            formatWeekdayName: (d) => DAY_SHORT[d.getDay()],
            formatCaption: (m) => `${MESES[m.getMonth()]} ${m.getFullYear()}`,
          }}
          components={{
            Chevron: ({ orientation }) => (orientation === 'left' ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />),
          }}
          classNames={{
            root: 'relative w-full',
            months: 'w-full',
            month: 'w-full',
            nav: 'absolute inset-x-0 top-0 z-10 flex items-center justify-between',
            button_previous: SETA,
            button_next: SETA,
            month_caption: 'flex h-8 items-center justify-center',
            caption_label: 'text-sm font-bold text-slate-800',
            month_grid: 'mt-2 w-full table-fixed border-collapse',
            weekday: 'h-8 text-center text-xs font-semibold text-slate-500',
            week: '',
            day: 'p-0.5 text-center',
            day_button: BTN,
            selected: FECHADO,
            today: '[&>button]:ring-1 [&>button]:ring-inset [&>button]:ring-emerald-600',
          }}
        />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-rose-600" /> Fechado por você</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border bg-[repeating-linear-gradient(135deg,transparent,transparent_2px,rgb(203_213_225)_2px,rgb(203_213_225)_3px)]" /> Fechado toda semana</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-slate-200" /> Fora do prazo</span>
        </div>

        {proxima ? (
          <p className="text-xs font-medium text-slate-600">
            Hoje o cliente já consegue pedir para {DAY_LONG[dataDeIso(proxima).getDay()].toLowerCase()}, {proxima.slice(8, 10)}/{proxima.slice(5, 7)}.
          </p>
        ) : (
          <p className="text-xs font-semibold text-amber-600">Nenhuma data disponível nos próximos 6 meses.</p>
        )}

        <div className="space-y-1.5 border-t pt-3">
          <p className="text-xs font-semibold text-slate-600">Dias fechados</p>
          {faixas.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum dia fechado.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {faixas.map((f) => (
                  <span key={f.inicio} className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
                    {rotuloDeFaixa(f)}
                    <button type="button" title="Reabrir" aria-label={`Reabrir ${rotuloDeFaixa(f)}`} onClick={() => reabrir(f)}
                      className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-rose-200">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Quem já tem pedido para um dia fechado continua com o pedido.</p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
