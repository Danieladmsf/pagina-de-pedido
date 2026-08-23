import { describe, expect, it } from 'vitest';

import {
  buscasSemResultado,
  faixasDeCarrinhoParado,
  nomeDoDia,
  visitasNaPortaFechada,
} from './decisoes-do-cardapio';
import type { Visitante } from './visitantes';

/**
 * O que estes testes protegem: três decisões que a loja toma com estes números
 * — o que cadastrar no cardápio, que horas abrir e para quem ligar primeiro.
 */

const visitante = (parcial: Partial<Visitante> & { id: string }): Visitante => ({
  storeId: 'loja',
  visitorId: parcial.id,
  ...parcial,
});

describe('buscasSemResultado', () => {
  it('conta gente, não digitação', () => {
    // A mesma pessoa insistindo três vezes é uma pessoa querendo brigadeiro.
    const lista = [
      visitante({
        id: 'a',
        linhaDoTempo: [
          { tipo: 'busca', at: 1, termo: 'brigadeiro' },
          { tipo: 'busca', at: 2, termo: 'brigadeiro' },
          { tipo: 'busca', at: 3, termo: 'brigadeiro' },
        ],
      }),
      visitante({ id: 'b', linhaDoTempo: [{ tipo: 'busca', at: 1, termo: 'Brigadeiro' }] }),
      visitante({ id: 'c', linhaDoTempo: [{ tipo: 'busca', at: 1, termo: 'coxinha' }] }),
    ];
    const buscas = buscasSemResultado(lista);
    expect(buscas[0]).toEqual({ termo: 'brigadeiro', pessoas: 2, vezes: 4 });
    expect(buscas[1]).toEqual({ termo: 'coxinha', pessoas: 1, vezes: 1 });
  });

  it('ignora o que não é busca e termo vazio', () => {
    const lista = [
      visitante({
        id: 'a',
        linhaDoTempo: [
          { tipo: 'viu', at: 1, produtoId: 'p1' },
          { tipo: 'busca', at: 2, termo: '   ' },
        ],
      }),
    ];
    expect(buscasSemResultado(lista)).toEqual([]);
  });
});

describe('visitasNaPortaFechada', () => {
  // Confeitaria de verdade: fecha domingo e segunda, abre 10h às 18h.
  const loja = {
    workingHours: [
      { day: 'domingo', isClosed: true },
      { day: 'segunda', isClosed: true },
      { day: 'terca', isClosed: false, open: '10:00', close: '18:00' },
      { day: 'quarta', isClosed: false, open: '10:00', close: '18:00' },
      { day: 'quinta', isClosed: false, open: '10:00', close: '18:00' },
      { day: 'sexta', isClosed: false, open: '10:00', close: '18:00' },
      { day: 'sabado', isClosed: false, open: '10:00', close: '18:00' },
    ],
    general: { timezone: 'America/Sao_Paulo' },
  };

  // Datas em horário de Brasília (UTC-3).
  const em = (iso: string) => ({ at: Date.parse(iso) });

  it('separa quem bateu na porta fechada de quem veio no expediente', () => {
    const visitas = [
      em('2026-08-19T15:00:00-03:00'), // quarta, 15h: aberta
      em('2026-08-19T22:30:00-03:00'), // quarta, 22h30: fechada
      em('2026-08-17T14:00:00-03:00'), // segunda: fechada o dia todo
      em('2026-08-16T11:00:00-03:00'), // domingo: fechada
    ];
    const r = visitasNaPortaFechada(visitas, loja);
    expect(r.visitas).toBe(3);
    expect(r.fatia).toBe(75);
    expect(r.horas[0].visitas).toBe(1);
    expect(r.dias.map((d) => d.dia)).toContain(1); // segunda
  });

  it('o caixa fechado não carimba o período inteiro como porta fechada', () => {
    // A dona abre a tela às 20h com o caixa fechado; isso não pode transformar
    // a visita das 15h de quarta em "porta fechada".
    const r = visitasNaPortaFechada([em('2026-08-19T15:00:00-03:00')], {
      ...loja,
      isCaixaAberto: false,
    });
    expect(r.visitas).toBe(0);
  });

  it('visita sem data não entra na conta', () => {
    const r = visitasNaPortaFechada([{ at: null }, { at: undefined }], loja);
    expect(r.visitas).toBe(0);
    expect(r.fatia).toBe(0);
  });

  it('dá nome ao dia para a tela não falar em número', () => {
    expect(nomeDoDia(0)).toBe('domingo');
    expect(nomeDoDia(1)).toBe('segunda');
  });
});

describe('faixasDeCarrinhoParado', () => {
  const comCarrinho = (id: string, valor: number) =>
    visitante({ id, carrinho: { itens: [{ id: 'p1', nome: 'Bolo', qtd: 1, valor }], valor } });

  it('mostra a faixa mais alta primeiro — a ordem de ligar', () => {
    const faixas = faixasDeCarrinhoParado([
      comCarrinho('a', 12),
      comCarrinho('b', 45),
      comCarrinho('c', 150),
      comCarrinho('d', 200),
    ]);
    expect(faixas.map((f) => f.rotulo)).toEqual([
      'acima de R$ 120',
      'R$ 30 a R$ 60',
      'até R$ 30',
    ]);
    expect(faixas[0]).toMatchObject({ pessoas: 2, valor: 350 });
  });

  it('sacola vazia ou sem valor não é oportunidade', () => {
    const lista = [
      visitante({ id: 'a', carrinho: { itens: [], valor: 0 } }),
      visitante({ id: 'b', carrinho: { itens: [{ id: 'p', nome: 'x', qtd: 1, valor: 0 }], valor: 0 } }),
      visitante({ id: 'c' }),
    ];
    expect(faixasDeCarrinhoParado(lista)).toEqual([]);
  });

  it('o limite da faixa não conta duas vezes', () => {
    const faixas = faixasDeCarrinhoParado([comCarrinho('a', 30), comCarrinho('b', 60)]);
    expect(faixas.find((f) => f.rotulo === 'R$ 30 a R$ 60')?.pessoas).toBe(1);
    expect(faixas.find((f) => f.rotulo === 'R$ 60 a R$ 120')?.pessoas).toBe(1);
  });
});
