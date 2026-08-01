import { describe, expect, it } from 'vitest';
import { dentroDaJanela, janelaDoPeriodo } from './periodo';

const AGORA = Date.parse('2026-08-01T15:00:00.000Z');
const DIA = 24 * 60 * 60 * 1000;

describe('janelaDoPeriodo — atalhos', () => {
  it('"tudo" não limita nada', () => {
    const j = janelaDoPeriodo({ preset: 'tudo' }, AGORA);
    expect(j).toEqual({ inicio: null, fim: null, rotulo: 'Tudo' });
  });

  it('30 dias é janela corrida para trás', () => {
    const j = janelaDoPeriodo({ preset: '30' }, AGORA);
    expect(j.inicio).toBe(AGORA - 30 * DIA);
    expect(j.fim).toBeNull();
    expect(j.rotulo).toBe('30 dias');
  });
});

describe('janelaDoPeriodo — personalizado', () => {
  it('inclui o dia final inteiro (o erro clássico de fim exclusivo)', () => {
    const j = janelaDoPeriodo({ preset: 'custom', de: '2026-07-01', ate: '2026-07-31' }, AGORA);
    // Uma compra às 22h do dia 31 TEM que entrar.
    expect(dentroDaJanela('2026-07-31T22:30:00.000', j)).toBe(true);
    // E o dia 1º de agosto não.
    expect(dentroDaJanela('2026-08-01T00:10:00.000', j)).toBe(false);
    expect(j.rotulo).toBe('01/07/2026 a 31/07/2026');
  });

  it('um dia só: início e fim iguais viram o dia inteiro', () => {
    const j = janelaDoPeriodo({ preset: 'custom', de: '2026-07-10', ate: '2026-07-10' }, AGORA);
    expect(dentroDaJanela('2026-07-10T00:00:00.000', j)).toBe(true);
    expect(dentroDaJanela('2026-07-10T23:59:00.000', j)).toBe(true);
    expect(dentroDaJanela('2026-07-11T00:01:00.000', j)).toBe(false);
    expect(j.rotulo).toBe('10/07/2026');
  });

  it('só "de": tudo de lá para cá', () => {
    const j = janelaDoPeriodo({ preset: 'custom', de: '2026-07-01' }, AGORA);
    expect(j.fim).toBeNull();
    expect(j.rotulo).toBe('desde 01/07/2026');
    expect(dentroDaJanela('2026-12-01T10:00:00.000', j)).toBe(true);
  });

  it('só "até": tudo até aquele dia, inclusive', () => {
    const j = janelaDoPeriodo({ preset: 'custom', ate: '2026-07-31' }, AGORA);
    expect(j.inicio).toBeNull();
    expect(j.rotulo).toBe('até 31/07/2026');
    expect(dentroDaJanela('2026-07-31T20:00:00.000', j)).toBe(true);
    expect(dentroDaJanela('2026-08-02T20:00:00.000', j)).toBe(false);
  });

  it('personalizado sem datas não some com tudo', () => {
    // O operador clica em "Personalizado" antes de escolher: a lista não pode
    // ficar vazia por causa disso.
    const j = janelaDoPeriodo({ preset: 'custom' }, AGORA);
    expect(j.rotulo).toBe('Tudo');
    expect(dentroDaJanela('2020-01-01T00:00:00.000', j)).toBe(true);
  });

  it('datas invertidas não devolvem lista vazia em silêncio', () => {
    const j = janelaDoPeriodo({ preset: 'custom', de: '2026-07-31', ate: '2026-07-01' }, AGORA);
    expect(j.rotulo).toBe('31/07/2026');
    expect(dentroDaJanela('2026-07-31T12:00:00.000', j)).toBe(true);
  });
});

describe('dentroDaJanela', () => {
  it('registro sem data fica de fora quando há filtro', () => {
    const j = janelaDoPeriodo({ preset: '30' }, AGORA);
    expect(dentroDaJanela(undefined, j)).toBe(false);
    expect(dentroDaJanela('data-quebrada', j)).toBe(false);
  });

  it('sem filtro, até registro sem data entra', () => {
    const j = janelaDoPeriodo({ preset: 'tudo' }, AGORA);
    expect(dentroDaJanela(undefined, j)).toBe(true);
  });
});
