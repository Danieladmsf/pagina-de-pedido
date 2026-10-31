// Horário da página de Encomendas. Três formas de contar a mesma coisa:
//   'text'  → duas linhas livres (daysLabel + hours); é o formato antigo e o padrão;
//   'week'  → horário por dia da semana, digitado na página de encomendas;
//   'store' → horário por dia da semana LIDO do horário de funcionamento da loja
//             (store_profiles.workingHours): mudou lá, muda aqui.
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

// Só é chamada entre dias abertos — dia fechado nem chega a virar linha.
function sameHours(a: DayHours, b: DayHours): boolean {
  return a.open === b.open && a.close === b.close;
}

function runLabel(days: number[], names: string[]): string {
  if (days.length === 1) return names[days[0]];
  if (days.length === 2) return `${names[days[0]]} e ${names[days[1]]}`;
  return `${names[days[0]]} a ${names[days[days.length - 1]]}`;
}

// Linhas do rodapé: SÓ os dias abertos (fechado não vira linha — é ruído), com
// dias seguidos de mesmo horário agrupados. Sem nenhum dia aberto devolve [], e
// quem exibe decide o texto de fallback.
export function formatWeekSchedule(week: any): { days: string; hours: string }[] {
  const w = mergeWeekHours(week);
  const runs: number[][] = [];
  DAY_ORDER.forEach((d, pos) => {
    if (w[d].closed) return;
    const last = runs[runs.length - 1];
    const prev = last ? last[last.length - 1] : -1;
    // Só emenda se for o dia IMEDIATAMENTE anterior na ordem de exibição: com
    // buracos no meio (Seg e Qui abertos) "Seg a Qui" seria mentira.
    if (last && DAY_ORDER.indexOf(prev) === pos - 1 && sameHours(w[prev], w[d])) last.push(d);
    else runs.push([d]);
  });
  return runs.map((days) => {
    const h = w[days[0]];
    return { days: runLabel(days, DAY_SHORT), hours: `${formatHour(h.open)} às ${formatHour(h.close)}` };
  });
}

// Dias abertos (0=Dom..6=Sáb), no formato do `weekDays` da config: com o horário
// por dia, a data do pedido só pode cair num dia em que a página diz que abre.
export function openWeekDays(week: any): number[] {
  const w = mergeWeekHours(week);
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => !w[d].closed);
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
  // Mesma comparação do getStoreOpenState: "Sábado", "sabado" e "SÁBADO" são o mesmo dia.
  const clean = (d: unknown) => String(d || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return DEFAULT_WEEK_HOURS.map((def, i) => {
    const wh = workingHours.find((w: any) => clean(w?.day) === clean(DAY_LONG[i]));
    if (!wh) return { ...def };
    return {
      closed: wh.isClosed === true,
      open: typeof wh.open === 'string' && wh.open ? wh.open : def.open,
      close: typeof wh.close === 'string' && wh.close ? wh.close : def.close,
    };
  });
}

// ---------------------------------------------------------------------------
// Datas fechadas e regras de data do pedido.
// Datas viajam como 'AAAA-MM-DD' (dia local). NUNCA usar toISOString(): converte
// para UTC e, à noite no Brasil, vira o dia seguinte.
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0');

export function isoDeData(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 'AAAA-MM-DD' → Date no dia LOCAL (new Date('AAAA-MM-DD') seria UTC e erraria o dia).
export function dataDeIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

// Data local em ISO somando `days` dias. `hoje` (ISO) existe para testar.
export function localIsoPlusDays(days: number, hoje?: string): string {
  const d = hoje ? dataDeIso(hoje) : new Date();
  d.setDate(d.getDate() + days);
  return isoDeData(d);
}

export function weekdayOfIso(iso: string): number {
  return dataDeIso(iso).getDay();
}

// Só strings AAAA-MM-DD que sejam datas reais (2026-02-30 cai fora), sem repetir, em ordem.
export function mergeBlockedDates(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ok = raw.filter((v): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && isoDeData(dataDeIso(v)) === v);
  return [...new Set(ok)].sort();
}

export interface RegrasDeData { minDays: number; weekDays: number[]; blockedDates: string[] }
export type SituacaoDaData = 'prazo' | 'fechado' | 'semana' | 'livre';

// Prioridade: prazo (cobre o passado) > fechado por data > fechado toda semana > livre.
export function situacaoDaData(iso: string, regras: RegrasDeData, hoje?: string): SituacaoDaData {
  if (iso < localIsoPlusDays(regras.minDays || 0, hoje)) return 'prazo';
  if (regras.blockedDates.includes(iso)) return 'fechado';
  if (regras.weekDays.length > 0 && !regras.weekDays.includes(weekdayOfIso(iso))) return 'semana';
  return 'livre';
}

// Primeira data livre em até 180 dias, ou null.
export function primeiraDataLivre(regras: RegrasDeData, hoje?: string): string | null {
  for (let i = 0; i <= 180; i++) {
    const iso = localIsoPlusDays(i, hoje);
    if (situacaoDaData(iso, regras, hoje) === 'livre') return iso;
  }
  return null;
}

// Dias seguidos viram uma faixa (inclusive virando o mês).
export function agruparDatas(datas: string[]): { inicio: string; fim: string }[] {
  const ordem = mergeBlockedDates(datas);
  const faixas: { inicio: string; fim: string }[] = [];
  for (const iso of ordem) {
    const ult = faixas[faixas.length - 1];
    if (ult && localIsoPlusDays(1, ult.fim) === iso) ult.fim = iso;
    else faixas.push({ inicio: iso, fim: iso });
  }
  return faixas;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function rotuloDeFaixa(f: { inicio: string; fim: string }): string {
  const a = dataDeIso(f.inicio);
  const b = dataDeIso(f.fim);
  const dia = (d: Date) => String(d.getDate());
  const mes = (d: Date) => MESES[d.getMonth()];
  if (f.inicio === f.fim) return `${dia(a)} de ${mes(a)}`;
  const mesmoMes = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  const doisDias = localIsoPlusDays(1, f.inicio) === f.fim;
  if (mesmoMes) return doisDias ? `${dia(a)} e ${dia(b)} de ${mes(a)}` : `${dia(a)} a ${dia(b)} de ${mes(a)}`;
  return `${dia(a)} de ${mes(a)}${doisDias ? ' e ' : ' a '}${dia(b)} de ${mes(b)}`;
}

// "24/12, 26/12 a 28/12 e 31/12"; passando de `limite` faixas, termina em " e outras datas".
export function listaCurtaDeDatas(datas: string[], limite = 3): string {
  const curta = (iso: string) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };
  const faixas = agruparDatas(datas);
  const textos = faixas.slice(0, limite).map((f) => (f.inicio === f.fim ? curta(f.inicio) : `${curta(f.inicio)} a ${curta(f.fim)}`));
  if (faixas.length > limite) return `${textos.join(', ')} e outras datas`;
  if (textos.length <= 1) return textos[0] || '';
  return `${textos.slice(0, -1).join(', ')} e ${textos[textos.length - 1]}`;
}
