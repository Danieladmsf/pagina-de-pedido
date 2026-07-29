// Horário da página de Encomendas. Duas formas de contar a mesma coisa:
//   'text' → duas linhas livres (daysLabel + hours); é o formato antigo e o padrão;
//   'week' → horário por dia da semana.
// weekHours é indexado por dia do JS (0=Dom..6=Sáb), igual ao `weekDays` que já
// existe na config. A ORDEM de exibição é Segunda→Domingo, e dias seguidos com o
// mesmo horário são agrupados ("Ter a Sáb · 09h às 18h") pra o rodapé não virar
// uma lista de sete linhas.

export interface DayHours {
  closed: boolean;
  open: string;   // 'HH:MM'
  close: string;  // 'HH:MM'
}

export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const DAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const DAY_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// Espelha os defaults do formato texto ("Terça a Sábado", "09h às 18h").
export const DEFAULT_WEEK_HOURS: DayHours[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
  closed: d === 0 || d === 1,
  open: '09:00',
  close: '18:00',
}));

export function mergeWeekHours(partial: any): DayHours[] {
  return DEFAULT_WEEK_HOURS.map((def, i) => {
    const d = Array.isArray(partial) ? partial[i] : null;
    if (!d || typeof d !== 'object') return { ...def };
    return {
      closed: d.closed === true,
      open: typeof d.open === 'string' && d.open ? d.open : def.open,
      close: typeof d.close === 'string' && d.close ? d.close : def.close,
    };
  });
}

// '09:00' → '09h' · '09:30' → '09h30'
export function formatHour(hhmm: string): string {
  const [h, m] = String(hhmm || '').split(':');
  if (!h) return '';
  return m && m !== '00' ? `${h}h${m}` : `${h}h`;
}

function sameHours(a: DayHours, b: DayHours): boolean {
  if (a.closed !== b.closed) return false;
  return a.closed || (a.open === b.open && a.close === b.close);
}

function runLabel(days: number[], names: string[]): string {
  if (days.length === 1) return names[days[0]];
  if (days.length === 2) return `${names[days[0]]} e ${names[days[1]]}`;
  return `${names[days[0]]} a ${names[days[days.length - 1]]}`;
}

// Linhas do rodapé: dias seguidos com o mesmo horário viram uma linha só.
export function formatWeekSchedule(week: any): { days: string; hours: string }[] {
  const w = mergeWeekHours(week);
  const runs: number[][] = [];
  for (const d of DAY_ORDER) {
    const last = runs[runs.length - 1];
    if (last && sameHours(w[last[last.length - 1]], w[d])) last.push(d);
    else runs.push([d]);
  }
  return runs.map((days) => {
    const h = w[days[0]];
    return {
      days: runLabel(days, DAY_SHORT),
      hours: h.closed ? 'Fechado' : `${formatHour(h.open)} às ${formatHour(h.close)}`,
    };
  });
}

// Rótulo curto só dos dias abertos ("Terça a Sábado"), para onde antes ia o
// daysLabel de texto livre — inclusive o passo da data no wizard.
export function openDaysLabel(week: any, long = false): string {
  const w = mergeWeekHours(week);
  const open = DAY_ORDER.filter((d) => !w[d].closed);
  if (!open.length) return 'Sob consulta';
  if (open.length === 7) return 'Todos os dias';
  const names = long ? DAY_LONG : DAY_SHORT;
  const runs: number[][] = [];
  open.forEach((d) => {
    const last = runs[runs.length - 1];
    const prev = last ? last[last.length - 1] : -1;
    if (last && DAY_ORDER.indexOf(d) === DAY_ORDER.indexOf(prev) + 1) last.push(d);
    else runs.push([d]);
  });
  return runs.map((r) => runLabel(r, names)).join(', ');
}

// Converte o "Horário fixo da semana" do perfil da loja (store_profiles.workingHours,
// que guarda o dia por NOME) para o formato indexado daqui.
export function fromStoreWorkingHours(workingHours: any): DayHours[] | null {
  if (!Array.isArray(workingHours) || !workingHours.length) return null;
  return DEFAULT_WEEK_HOURS.map((def, i) => {
    const wh = workingHours.find((w: any) => w?.day === DAY_LONG[i]);
    if (!wh) return { ...def };
    return {
      closed: wh.isClosed === true,
      open: typeof wh.open === 'string' && wh.open ? wh.open : def.open,
      close: typeof wh.close === 'string' && wh.close ? wh.close : def.close,
    };
  });
}
