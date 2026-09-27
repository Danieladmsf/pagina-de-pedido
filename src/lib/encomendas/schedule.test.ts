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
