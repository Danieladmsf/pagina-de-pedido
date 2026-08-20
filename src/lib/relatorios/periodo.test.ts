import { describe, expect, it } from 'vitest';
import { dentroDaJanela, janelaDoRelatorio } from './periodo';

// 20/08/2026, uma quinta-feira, com a loja já aberta.
const AGORA = new Date(2026, 7, 20, 14, 30);

describe('janelaDoRelatorio', () => {
  it('mês atual vai do dia 1 até o primeiro dia do mês seguinte', () => {
    const j = janelaDoRelatorio({ preset: 'mes_atual' }, AGORA);
    expect(j.inicio).toEqual(new Date(2026, 7, 1));
    expect(j.fim).toEqual(new Date(2026, 8, 1));
  });

  it('mês passado é o mês de calendário anterior inteiro', () => {
    const j = janelaDoRelatorio({ preset: 'mes_passado' }, AGORA);
    expect(j.inicio).toEqual(new Date(2026, 6, 1));
    expect(j.fim).toEqual(new Date(2026, 7, 1));
  });

  it('3 meses conta o mês atual e começa no dia 1 de dois meses atrás', () => {
    const j = janelaDoRelatorio({ preset: '3m' }, AGORA);
    expect(j.inicio).toEqual(new Date(2026, 5, 1));
    expect(j.fim).toEqual(new Date(2026, 8, 1));
  });

  it('12 meses atravessa a virada do ano', () => {
    const j = janelaDoRelatorio({ preset: '12m' }, AGORA);
    expect(j.inicio).toEqual(new Date(2025, 8, 1));
  });

  it('7 dias inclui hoje inteiro', () => {
    const j = janelaDoRelatorio({ preset: '7d' }, AGORA);
    expect(j.inicio).toEqual(new Date(2026, 7, 14));
    expect(j.fim).toEqual(new Date(2026, 7, 21));
  });

  it('tudo não tem limite dos dois lados', () => {
    const j = janelaDoRelatorio({ preset: 'tudo' }, AGORA);
    expect(j.inicio).toBeNull();
    expect(j.fim).toBeNull();
    expect(j.descricao).toBe('todo o histórico');
  });

  it('personalizado até o dia 31 inclui o que foi vendido no dia 31', () => {
    const j = janelaDoRelatorio({ preset: 'custom', de: '2026-07-01', ate: '2026-07-31' }, AGORA);
    const vendaNoDia31 = new Date(2026, 6, 31, 22, 0);
    expect(dentroDaJanela(vendaNoDia31, j)).toBe(true);
    expect(dentroDaJanela(new Date(2026, 7, 1, 0, 1), j)).toBe(false);
  });

  it('personalizado com datas invertidas vira o dia escolhido, não uma tela vazia', () => {
    const j = janelaDoRelatorio({ preset: 'custom', de: '2026-07-31', ate: '2026-07-01' }, AGORA);
    expect(j.inicio).toEqual(new Date(2026, 6, 31));
    expect(j.fim).toEqual(new Date(2026, 7, 1));
  });

  it('a descrição do mês atual para em hoje, não no fim do mês', () => {
    const j = janelaDoRelatorio({ preset: 'mes_atual' }, AGORA);
    expect(j.descricao).toBe('01/08/2026 a 20/08/2026');
  });
});

describe('dentroDaJanela', () => {
  it('venda sem data legível fica de fora', () => {
    const j = janelaDoRelatorio({ preset: 'mes_atual' }, AGORA);
    expect(dentroDaJanela(null, j)).toBe(false);
  });

  it('o fim é exclusivo e o início é inclusivo', () => {
    const j = janelaDoRelatorio({ preset: 'mes_atual' }, AGORA);
    expect(dentroDaJanela(new Date(2026, 7, 1, 0, 0, 0), j)).toBe(true);
    expect(dentroDaJanela(new Date(2026, 8, 1, 0, 0, 0), j)).toBe(false);
  });
});
