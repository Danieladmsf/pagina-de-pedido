import { describe, expect, it } from 'vitest';
import { formatTodayClosingTime, renderWhatsAppTemplate } from './whatsapp-messages';

// Horário da Gostinho de Céu em 26/09/2026: terça a sexta até 18:00, sábado até
// 16:00, domingo e segunda fechada. A mensagem de retirada dizia "até as 18:00"
// escrito à mão e saiu assim num sábado.
const horarios = [
  { day: 'Segunda', open: '09:00', close: '23:59', isClosed: true },
  { day: 'Terça', open: '10:00', close: '18:00', isClosed: false },
  { day: 'Quarta', open: '10:00', close: '18:00', isClosed: false },
  { day: 'Quinta', open: '10:00', close: '18:00', isClosed: false },
  { day: 'Sexta', open: '10:00', close: '18:00', isClosed: false },
  { day: 'Sábado', open: '10:00', close: '16:00', isClosed: false },
  { day: 'Domingo', open: '09:00', close: '23:59', isClosed: true },
];

// 14:11 em São Paulo (UTC-3).
const sabado = new Date('2026-09-26T17:11:00Z');
const sexta = new Date('2026-09-25T17:11:00Z');
const domingo = new Date('2026-09-27T17:11:00Z');

describe('{fechamento_hoje}', () => {
  it('no sábado é a hora do sábado, não a da semana', () => {
    expect(formatTodayClosingTime(horarios, [], undefined, sabado)).toBe('16:00');
    expect(formatTodayClosingTime(horarios, [], undefined, sexta)).toBe('18:00');
  });

  it('usa o dia do fuso da loja, não o do servidor', () => {
    // 01:30 UTC de sábado ainda é sexta-feira em São Paulo.
    expect(formatTodayClosingTime(horarios, [], undefined, new Date('2026-09-26T01:30:00Z'))).toBe('18:00');
  });

  it('dia fechado, fechamento programado ou sem cadastro não inventam hora', () => {
    expect(formatTodayClosingTime(horarios, [], undefined, domingo)).toBe('');
    expect(formatTodayClosingTime(horarios, [{ date: '2026-09-26', reason: 'Feriado' }], undefined, sabado)).toBe('');
    expect(formatTodayClosingTime([], [], undefined, sabado)).toBe('');
    expect(formatTodayClosingTime(undefined, [], undefined, sabado)).toBe('');
  });

  it('entra no texto salvo pela dona', () => {
    const texto = '🕐 A retirada pode ser feita até as {fechamento_hoje} de hoje.';
    expect(renderWhatsAppTemplate(texto, { fechamento_hoje: formatTodayClosingTime(horarios, [], undefined, sabado) }))
      .toBe('🕐 A retirada pode ser feita até as 16:00 de hoje.');
  });
});
