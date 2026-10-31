import { describe, expect, it } from 'vitest';
import { buildEncomendaConfig } from './config';
import { formatWeekSchedule, fromStoreWorkingHours } from './schedule';

// Gostinho de Céu em 26/09/2026: a página de encomendas tinha uma cópia própria
// (abre 09h) enquanto o funcionamento da loja dizia 10h.
const workingHours = [
  { day: 'Segunda', open: '09:00', close: '23:59', isClosed: true },
  { day: 'Terça', open: '10:00', close: '18:00', isClosed: false },
  { day: 'Quarta', open: '10:00', close: '18:00', isClosed: false },
  { day: 'Quinta', open: '10:00', close: '18:00', isClosed: false },
  { day: 'Sexta', open: '10:00', close: '18:00', isClosed: false },
  { day: 'Sábado', open: '10:00', close: '16:00', isClosed: false },
  { day: 'Domingo', open: '09:00', close: '23:59', isClosed: true },
];
const copiaAntiga = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ closed: d < 2, open: '09:00', close: d === 6 ? '16:00' : '18:00' }));

describe('horário das encomendas seguindo o funcionamento da loja', () => {
  it("no modo 'store' o rodapé mostra o horário da loja, não a cópia salva", () => {
    const c = buildEncomendaConfig({ workingHours, encomendas: { scheduleMode: 'store', weekHours: copiaAntiga } });
    expect(formatWeekSchedule(c.weekHours)).toEqual([
      { days: 'Ter a Sex', hours: '10h às 18h' },
      { days: 'Sáb', hours: '10h às 16h' },
    ]);
    expect(c.daysLabel).toBe('Terça a Sábado');
  });

  it("no modo 'week' continua valendo o que foi digitado nas encomendas", () => {
    const c = buildEncomendaConfig({ workingHours, encomendas: { scheduleMode: 'week', weekHours: copiaAntiga } });
    expect(formatWeekSchedule(c.weekHours)[0]).toEqual({ days: 'Ter a Sex', hours: '09h às 18h' });
  });

  it('loja sem horário cadastrado cai na cópia salva', () => {
    const c = buildEncomendaConfig({ encomendas: { scheduleMode: 'store', weekHours: copiaAntiga } });
    expect(formatWeekSchedule(c.weekHours)[0]).toEqual({ days: 'Ter a Sex', hours: '09h às 18h' });
  });

  it('nome do dia sem acento ou em maiúscula é o mesmo dia', () => {
    const w = fromStoreWorkingHours([{ day: 'SABADO', open: '10:00', close: '16:00', isClosed: false }]);
    expect(w?.[6]).toEqual({ closed: false, open: '10:00', close: '16:00' });
  });
});

describe('dias em que a encomenda pode ser marcada', () => {
  it('com horário por dia, são os dias abertos do horário da página de encomendas', () => {
    // Encomenda com horário próprio: fecha quarta, mesmo com a loja abrindo.
    const semQuarta = copiaAntiga.map((d, i) => (i === 3 ? { ...d, closed: true } : d));
    const c = buildEncomendaConfig({ workingHours, encomendas: { scheduleMode: 'week', weekHours: semQuarta, weekDays: [2, 3, 4, 5, 6] } });
    expect(c.weekDays).toEqual([2, 4, 5, 6]);
  });

  it("no modo 'store' são os dias em que a loja abre", () => {
    const c = buildEncomendaConfig({ workingHours, encomendas: { scheduleMode: 'store', weekDays: [0, 1] } });
    expect(c.weekDays).toEqual([2, 3, 4, 5, 6]);
  });

  it('com horário em texto livre, valem os dias marcados na configuração', () => {
    const c = buildEncomendaConfig({ workingHours, encomendas: { scheduleMode: 'text', weekDays: [5, 6] } });
    expect(c.weekDays).toEqual([5, 6]);
  });

  it('horário com todos os dias fechados não libera a semana inteira', () => {
    const tudoFechado = copiaAntiga.map((d) => ({ ...d, closed: true }));
    const c = buildEncomendaConfig({ encomendas: { scheduleMode: 'week', weekHours: tudoFechado, weekDays: [6] } });
    expect(c.weekDays).toEqual([6]);
  });
});

// ---- Datas fechadas ----
import {
  agruparDatas, listaCurtaDeDatas, localIsoPlusDays, mergeBlockedDates, primeiraDataLivre,
  rotuloDeFaixa, situacaoDaData, weekdayOfIso,
} from './schedule';

describe('mergeBlockedDates', () => {
  it('só datas reais, sem repetir, em ordem', () => {
    expect(mergeBlockedDates(['2026-12-25', '2026-02-30', 'lixo', '2026-12-24', '2026-12-25', 5, null, '2026-1-5']))
      .toEqual(['2026-12-24', '2026-12-25']);
    expect(mergeBlockedDates(undefined)).toEqual([]);
    expect(mergeBlockedDates('2026-12-25')).toEqual([]);
  });
});

describe('localIsoPlusDays / weekdayOfIso', () => {
  it('soma dias no calendário local, virando mês e ano', () => {
    expect(localIsoPlusDays(0, '2026-11-01')).toBe('2026-11-01');
    expect(localIsoPlusDays(30, '2026-12-05')).toBe('2027-01-04');
    expect(localIsoPlusDays(1, '2026-02-28')).toBe('2026-03-01');
  });
  it('dia da semana no dia local (31/10/2026 é sábado)', () => {
    expect(weekdayOfIso('2026-10-31')).toBe(6);
    expect(weekdayOfIso('2026-11-01')).toBe(0);
  });
});

describe('situacaoDaData', () => {
  const hoje = '2026-11-02'; // segunda
  const r = { minDays: 2, weekDays: [2, 3, 4, 5, 6], blockedDates: ['2026-11-04', '2026-11-03'] };
  it('segue a prioridade prazo > fechado > semana > livre', () => {
    expect(situacaoDaData('2026-10-30', r, hoje)).toBe('prazo');   // passado
    expect(situacaoDaData('2026-11-03', r, hoje)).toBe('prazo');   // fechada, mas dentro do prazo
    expect(situacaoDaData('2026-11-04', r, hoje)).toBe('fechado'); // quarta, fechada por data
    expect(situacaoDaData('2026-11-08', r, hoje)).toBe('semana');  // domingo
    expect(situacaoDaData('2026-11-05', r, hoje)).toBe('livre');
  });
  it('weekDays vazio = todos os dias', () => {
    expect(situacaoDaData('2026-11-08', { ...r, weekDays: [] }, hoje)).toBe('livre');
  });
});

describe('primeiraDataLivre', () => {
  const hoje = '2026-11-02';
  it('pula dia da semana fechado e data fechada', () => {
    // prazo 2 → a partir de 04/11 (quarta); 04 fechada → 05
    expect(primeiraDataLivre({ minDays: 2, weekDays: [2, 3, 4, 5, 6], blockedDates: ['2026-11-04'] }, hoje)).toBe('2026-11-05');
    // sexta e sábado fechados na semana, quinta fechada por data → só volta na terça
    expect(primeiraDataLivre({ minDays: 3, weekDays: [2], blockedDates: [] }, hoje)).toBe('2026-11-10');
  });
  it('devolve null sem data em 180 dias', () => {
    expect(primeiraDataLivre({ minDays: 0, weekDays: [], blockedDates: Array.from({ length: 200 }, (_, i) => localIsoPlusDays(i, hoje)) }, hoje)).toBeNull();
  });
});

describe('agruparDatas e rótulos', () => {
  it('dias seguidos viram faixa, inclusive virando o mês', () => {
    expect(agruparDatas(['2026-12-31', '2026-12-24', '2027-01-01', '2026-12-26', '2026-12-25']))
      .toEqual([{ inicio: '2026-12-24', fim: '2026-12-26' }, { inicio: '2026-12-31', fim: '2027-01-01' }]);
  });
  it('rotuloDeFaixa', () => {
    expect(rotuloDeFaixa({ inicio: '2026-12-24', fim: '2026-12-24' })).toBe('24 de dezembro');
    expect(rotuloDeFaixa({ inicio: '2026-12-24', fim: '2026-12-25' })).toBe('24 e 25 de dezembro');
    expect(rotuloDeFaixa({ inicio: '2026-12-20', fim: '2026-12-23' })).toBe('20 a 23 de dezembro');
    expect(rotuloDeFaixa({ inicio: '2026-12-28', fim: '2027-01-03' })).toBe('28 de dezembro a 3 de janeiro');
    expect(rotuloDeFaixa({ inicio: '2026-12-31', fim: '2027-01-01' })).toBe('31 de dezembro e 1 de janeiro');
  });
  it('listaCurtaDeDatas respeita o limite', () => {
    expect(listaCurtaDeDatas(['2026-12-24', '2026-12-26', '2026-12-27', '2026-12-28', '2026-12-31'])).toBe('24/12, 26/12 a 28/12 e 31/12');
    expect(listaCurtaDeDatas(['2026-12-24'])).toBe('24/12');
    expect(listaCurtaDeDatas(['2026-12-24', '2026-12-26'])).toBe('24/12 e 26/12');
    expect(listaCurtaDeDatas(['2026-12-01', '2026-12-03', '2026-12-05', '2026-12-07'])).toBe('01/12, 03/12, 05/12 e outras datas');
  });
});

describe('config', () => {
  it('sem blockedDates salvo, a lista é vazia', () => {
    expect(buildEncomendaConfig({}).blockedDates).toEqual([]);
    expect(buildEncomendaConfig({ encomendas: { blockedDates: ['2026-12-24', 'x'] } }).blockedDates).toEqual(['2026-12-24']);
  });
});
