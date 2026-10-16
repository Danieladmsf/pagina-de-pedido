import { describe, expect, it } from 'vitest';
import { dentroDaJanela, janelaDeComparacao, janelaDoRelatorio, variacaoEntre } from './periodo';

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

describe('hoje e ontem', () => {
  it('hoje vai da meia-noite até amanhã; ontem é o dia anterior inteiro', () => {
    expect(janelaDoRelatorio({ preset: 'hoje' }, AGORA)).toMatchObject({
      inicio: new Date(2026, 7, 20), fim: new Date(2026, 7, 21), rotulo: 'Hoje', descricao: '20/08/2026',
    });
    expect(janelaDoRelatorio({ preset: 'ontem' }, AGORA)).toMatchObject({
      inicio: new Date(2026, 7, 19), fim: new Date(2026, 7, 20), descricao: '19/08/2026',
    });
  });
});

describe('janelaDeComparacao', () => {
  it('hoje compara com o mesmo dia da semana passada, até a mesma hora', () => {
    // 20/08 é quinta, 14:30: compara com a quinta 13/08 das 00:00 às 14:30.
    const c = janelaDeComparacao({ preset: 'hoje' }, AGORA)!;
    expect(c.inicio).toEqual(new Date(2026, 7, 13));
    expect(c.fim).toEqual(new Date(2026, 7, 13, 14, 30));
    expect(c.rotulo).toBe('quinta passada (13/08), até as 14:30');
    expect(c.parcial).toBe(true);
  });

  it('ontem compara com o mesmo dia da semana anterior, inteiro', () => {
    const c = janelaDeComparacao({ preset: 'ontem' }, AGORA)!;
    expect(c.inicio).toEqual(new Date(2026, 7, 12));
    expect(c.fim).toEqual(new Date(2026, 7, 13));
    expect(c.rotulo).toBe('quarta passada (12/08)');
    expect(c.parcial).toBe(false);
  });

  it('fim de semana fala no masculino', () => {
    const sabado = new Date(2026, 7, 22, 10, 0);
    expect(janelaDeComparacao({ preset: 'hoje' }, sabado)!.rotulo).toBe('sábado passado (15/08), até as 10:00');
  });

  it('7 dias compara com os 7 anteriores até a mesma hora', () => {
    const c = janelaDeComparacao({ preset: '7d' }, AGORA)!;
    expect(c.inicio).toEqual(new Date(2026, 7, 7));
    expect(c.fim).toEqual(new Date(2026, 7, 13, 14, 30));
  });

  it('mês atual compara com o mês passado até o mesmo dia e hora', () => {
    const c = janelaDeComparacao({ preset: 'mes_atual' }, AGORA)!;
    expect(c.inicio).toEqual(new Date(2026, 6, 1));
    expect(c.fim).toEqual(new Date(2026, 6, 20, 14, 30));
    expect(c.rotulo).toBe('julho de 2026 até o dia 20');
  });

  it('dia 31 compara com o último dia do mês curto', () => {
    const c = janelaDeComparacao({ preset: 'mes_atual' }, new Date(2026, 2, 31, 9, 0))!;
    expect(c.fim).toEqual(new Date(2026, 1, 28, 9, 0));
  });

  it('mês passado compara com o mês anterior a ele, inteiro', () => {
    const c = janelaDeComparacao({ preset: 'mes_passado' }, AGORA)!;
    expect(c.inicio).toEqual(new Date(2026, 5, 1));
    expect(c.fim).toEqual(new Date(2026, 6, 1));
    expect(c.parcial).toBe(false);
  });

  it('3 meses compara com os 3 anteriores até o mesmo dia', () => {
    const c = janelaDeComparacao({ preset: '3m' }, AGORA)!;
    expect(c.inicio).toEqual(new Date(2026, 2, 1));
    expect(c.fim).toEqual(new Date(2026, 4, 20, 14, 30));
  });

  it('personalizado fechado compara com o mesmo tamanho logo antes', () => {
    const c = janelaDeComparacao({ preset: 'custom', de: '2026-08-10', ate: '2026-08-12' }, AGORA)!;
    expect(c.inicio).toEqual(new Date(2026, 7, 7));
    expect(c.fim).toEqual(new Date(2026, 7, 10));
    expect(c.parcial).toBe(false);
  });

  it('todo o período não tem comparação', () => {
    expect(janelaDeComparacao({ preset: 'tudo' }, AGORA)).toBeNull();
  });
});

describe('variacaoEntre', () => {
  it('fração da mudança, e nada quando não havia base', () => {
    expect(variacaoEntre(150, 100)).toBe(0.5);
    expect(variacaoEntre(50, 100)).toBe(-0.5);
    expect(variacaoEntre(50, 0)).toBeNull();
  });
});
