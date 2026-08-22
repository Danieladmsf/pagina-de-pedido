import { describe, expect, it } from 'vitest';
import { janelaDaAudiencia, movimentoPorDia } from './audiencia-periodo';

// 22/08/2026, um sábado, 14:30.
const AGORA = new Date(2026, 7, 22, 14, 30);
const CAIXA = new Date(2026, 7, 22, 8, 15);

const visita = (mes: number, dia: number, hora = 12, visitorId?: string) => ({
  at: new Date(2026, mes, dia, hora, 0),
  ...(visitorId ? { visitorId } : {}),
});

describe('janelaDaAudiencia', () => {
  it('a sessão de caixa começa na abertura e não tem fim', () => {
    const j = janelaDaAudiencia({ preset: 'sessao' }, { caixaAbertoEm: CAIXA, agora: AGORA });
    expect(j.inicio).toEqual(CAIXA);
    expect(j.fim).toBeNull();
    expect(j.descricao).toBe('desde hoje às 08:15');
  });

  it('caixa aberto ontem à noite diz a data, para não virar "movimento de hoje"', () => {
    const ontemANoite = new Date(2026, 7, 21, 22, 40);
    const j = janelaDaAudiencia({ preset: 'sessao' }, { caixaAbertoEm: ontemANoite, agora: AGORA });
    expect(j.descricao).toBe('desde 21/08/2026 às 22:40');
  });

  it('pedir a sessão com o caixa fechado cai em Hoje, e não em tela vazia', () => {
    const j = janelaDaAudiencia({ preset: 'sessao' }, { caixaAbertoEm: null, agora: AGORA });
    expect(j.rotulo).toBe('Hoje');
    expect(j.inicio).toEqual(new Date(2026, 7, 22));
    expect(j.fim).toEqual(new Date(2026, 7, 23));
  });

  it('hoje e ontem são dias de calendário fechados', () => {
    const hoje = janelaDaAudiencia({ preset: 'hoje' }, { agora: AGORA });
    expect([hoje.inicio, hoje.fim]).toEqual([new Date(2026, 7, 22), new Date(2026, 7, 23)]);

    const ontem = janelaDaAudiencia({ preset: 'ontem' }, { agora: AGORA });
    expect([ontem.inicio, ontem.fim]).toEqual([new Date(2026, 7, 21), new Date(2026, 7, 22)]);
    expect(ontem.descricao).toBe('21/08/2026');
  });

  it('7 e 30 dias incluem hoje inteiro', () => {
    const sete = janelaDaAudiencia({ preset: '7d' }, { agora: AGORA });
    expect(sete.inicio).toEqual(new Date(2026, 7, 16));
    expect(sete.fim).toEqual(new Date(2026, 7, 23));
  });

  it('escolher um dia só devolve aquele dia', () => {
    const j = janelaDaAudiencia({ preset: 'custom', de: '2026-08-18', ate: '2026-08-18' }, { agora: AGORA });
    expect(j.inicio).toEqual(new Date(2026, 7, 18));
    expect(j.fim).toEqual(new Date(2026, 7, 19));
  });
});

describe('movimentoPorDia', () => {
  const janelaDe = (preset: any) => janelaDaAudiencia({ preset }, { agora: AGORA });

  it('conta as visitas de cada dia', () => {
    const m = movimentoPorDia(
      [visita(7, 20), visita(7, 20, 15), visita(7, 21), visita(7, 22)],
      janelaDe('7d'),
      AGORA,
    );
    expect(m.dias.map((d) => [d.chave, d.visitas])).toEqual([
      ['2026-08-20', 2],
      ['2026-08-21', 1],
      ['2026-08-22', 1],
    ]);
    expect(m.totalVisitas).toBe(4);
  });

  it('dia sem visita no meio aparece zerado', () => {
    const m = movimentoPorDia([visita(7, 20), visita(7, 22)], janelaDe('7d'), AGORA);
    expect(m.dias.map((d) => d.visitas)).toEqual([1, 0, 1]);
  });

  it('não começa antes do primeiro dia com visita', () => {
    // 30 dias pedidos, mas a loja só tem visita de anteontem para cá.
    const m = movimentoPorDia([visita(7, 20), visita(7, 21)], janelaDe('30d'), AGORA);
    expect(m.dias).toHaveLength(3);
    expect(m.dias[0].chave).toBe('2026-08-20');
  });

  it('a série alcança hoje mesmo sem visita hoje', () => {
    const m = movimentoPorDia([visita(7, 19)], janelaDe('7d'), AGORA);
    expect(m.dias.at(-1)).toMatchObject({ chave: '2026-08-22', visitas: 0, ehHoje: true });
    expect(m.dias.filter((d) => d.ehHoje)).toHaveLength(1);
  });

  it('respeita os dois limites da janela', () => {
    const ontem = janelaDe('ontem');
    const m = movimentoPorDia([visita(7, 20), visita(7, 21), visita(7, 22)], ontem, AGORA);
    expect(m.totalVisitas).toBe(1);
    expect(m.dias).toHaveLength(1);
    expect(m.dias[0].chave).toBe('2026-08-21');
  });

  it('conta pessoas distintas, não visitas, quando o aparelho é conhecido', () => {
    const m = movimentoPorDia(
      [visita(7, 21, 10, 'a'), visita(7, 21, 14, 'a'), visita(7, 21, 16, 'b'), visita(7, 22, 9, 'a')],
      janelaDe('7d'),
      AGORA,
    );
    expect(m.dias[0]).toMatchObject({ visitas: 3, pessoas: 2, sabePessoas: true });
    // A mesma pessoa nos dois dias conta uma vez no total do período.
    expect(m.totalPessoas).toBe(2);
    expect(m.totalVisitas).toBe(4);
  });

  it('visita antiga sem visitorId não vira "0 pessoas" — vira desconhecido', () => {
    const m = movimentoPorDia([visita(7, 18), visita(7, 18, 15)], janelaDe('7d'), AGORA);
    const dia = m.dias.find((d) => d.chave === '2026-08-18')!;
    expect(dia).toMatchObject({ visitas: 2, pessoas: 0, sabePessoas: false });
    expect(m.sabePessoas).toBe(false);
  });

  it('período misto sabe que sabe, mas marca os dias que não sabem', () => {
    const m = movimentoPorDia([visita(7, 18), visita(7, 21, 10, 'a')], janelaDe('7d'), AGORA);
    expect(m.sabePessoas).toBe(true);
    expect(m.dias.filter((d) => d.visitas > 0 && !d.sabePessoas)).toHaveLength(1);
  });

  it('aponta o melhor dia entre os que tiveram visita', () => {
    const m = movimentoPorDia(
      [visita(7, 18), visita(7, 19), visita(7, 19, 13), visita(7, 19, 15), visita(7, 20)],
      janelaDe('7d'),
      AGORA,
    );
    expect(m.melhorDia).toMatchObject({ chave: '2026-08-19', visitas: 3 });
  });

  it('a média divide pelos dias da série', () => {
    const m = movimentoPorDia([visita(7, 20), visita(7, 20), visita(7, 21), visita(7, 22)], janelaDe('7d'), AGORA);
    expect(m.dias).toHaveLength(3);
    expect(m.mediaPorDia).toBeCloseTo(1.3, 5);
  });

  it('aceita Timestamp do Firestore e ignora data ilegível', () => {
    const m = movimentoPorDia(
      [
        { at: { toDate: () => new Date(2026, 7, 21, 11, 0) } },
        { at: 'nao e data' },
        { at: null },
        {},
      ],
      janelaDe('7d'),
      AGORA,
    );
    expect(m.totalVisitas).toBe(1);
  });

  it('sem visita nenhuma devolve série vazia em vez de quebrar', () => {
    const m = movimentoPorDia([], janelaDe('30d'), AGORA);
    expect(m.dias).toEqual([]);
    expect(m.melhorDia).toBeNull();
    expect(m.mediaPorDia).toBe(0);
    expect(movimentoPorDia(null, janelaDe('30d'), AGORA).totalVisitas).toBe(0);
  });

  it('janela aberta (sessão de caixa) vai até hoje', () => {
    const j = janelaDaAudiencia({ preset: 'sessao' }, { caixaAbertoEm: new Date(2026, 7, 20, 8, 0), agora: AGORA });
    const m = movimentoPorDia([visita(7, 20, 9), visita(7, 22, 10)], j, AGORA);
    expect(m.dias.map((d) => d.chave)).toEqual(['2026-08-20', '2026-08-21', '2026-08-22']);
  });
});
