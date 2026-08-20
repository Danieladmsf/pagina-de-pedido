import { describe, expect, it } from 'vitest';
import { janelaDoRelatorio } from './periodo';
import { granularidadeSugerida, serieDoProduto } from './serie-produto';

// 20/08/2026 é uma QUINTA. A semana dela começa na segunda, 17/08.
const AGORA = new Date(2026, 7, 20, 14, 30);
const TUDO = janelaDoRelatorio({ preset: 'tudo' }, AGORA);

const venda = (mes: number, dia: number, qtd: number, over: any = {}) => ({
  id: `${mes}-${dia}-${qtd}`,
  status: 'delivered',
  orderDateTime: new Date(2026, mes, dia, 12, 0).toISOString(),
  totalAmount: qtd * 10,
  items: [{ id: 'p1', name: 'Coxinha', quantity: qtd, unitPrice: 10 }],
  ...over,
});

const serie = (vendas: any[], granularidade: any, janela = TUDO) =>
  serieDoProduto(vendas, { chave: 'p1', janela, granularidade, agora: AGORA });

describe('serieDoProduto', () => {
  it('agrupa por semana começando na segunda-feira', () => {
    // 12/08 é quarta (semana de 10/08) e 17/08 é segunda (semana de 17/08).
    const s = serie([venda(7, 12, 3), venda(7, 13, 2), venda(7, 17, 8)], 'semana');

    expect(s.pontos.map((p) => [p.chave, p.quantidade])).toEqual([
      ['2026-08-10', 5],
      ['2026-08-17', 8],
    ]);
    expect(s.pontos[0].rotuloLongo).toBe('semana de 10/08 a 16/08');
  });

  it('responde "a semana em que mais vendeu"', () => {
    const s = serie([venda(6, 6, 4), venda(7, 3, 11), venda(7, 12, 6)], 'semana');
    expect(s.melhor?.rotuloLongo).toBe('semana de 03/08 a 09/08');
    expect(s.melhor?.quantidade).toBe(11);
  });

  it('semana sem venda no meio aparece com zero', () => {
    const s = serie([venda(7, 3, 5), venda(7, 17, 5)], 'semana');
    expect(s.pontos.map((p) => p.chave)).toEqual(['2026-08-03', '2026-08-10', '2026-08-17']);
    expect(s.pontos[1].quantidade).toBe(0);
  });

  it('não começa antes da primeira venda do produto', () => {
    const s = serie([venda(7, 17, 5)], 'mes');
    expect(s.pontos).toHaveLength(1);
    expect(s.pontos[0].chave).toBe('2026-08');
  });

  it('marca o período corrente como em andamento', () => {
    const s = serie([venda(6, 10, 5), venda(7, 18, 5)], 'semana');
    expect(s.pontos.at(-1)).toMatchObject({ chave: '2026-08-17', emAndamento: true });
    expect(s.pontos.filter((p) => p.emAndamento)).toHaveLength(1);
  });

  it('por mês e por dia usam os mesmos números, só mudam os baldes', () => {
    const vendas = [venda(7, 3, 2), venda(7, 3, 1), venda(7, 12, 4)];
    const porDia = serie(vendas, 'dia');
    const porMes = serie(vendas, 'mes');

    expect(porDia.pontos.find((p) => p.chave === '2026-08-03')?.quantidade).toBe(3);
    expect(porMes.pontos).toHaveLength(1);
    expect(porMes.totalQuantidade).toBe(porDia.totalQuantidade);
    expect(porMes.totalQuantidade).toBe(7);
  });

  it('ignora outros produtos da mesma venda', () => {
    const s = serie(
      [
        venda(7, 12, 3, {
          items: [
            { id: 'p1', name: 'Coxinha', quantity: 3, unitPrice: 10 },
            { id: 'p2', name: 'Brigadeiro', quantity: 99, unitPrice: 4 },
          ],
        }),
      ],
      'semana',
    );
    expect(s.totalQuantidade).toBe(3);
    expect(s.totalValor).toBe(30);
  });

  it('o mesmo produto em duas linhas da venda soma a quantidade e conta uma venda', () => {
    const s = serie(
      [
        venda(7, 12, 0, {
          items: [
            { id: 'p1', name: 'Coxinha', quantity: 2, unitPrice: 10 },
            { id: 'p1', name: 'Coxinha', quantity: 3, unitPrice: 10 },
          ],
        }),
      ],
      'dia',
    );
    expect(s.pontos[0]).toMatchObject({ quantidade: 5, vendas: 1, valor: 50 });
  });

  it('venda cancelada e venda fora da janela não entram', () => {
    const janelaDoMes = janelaDoRelatorio({ preset: 'mes_atual' }, AGORA);
    const s = serie(
      [venda(7, 12, 5), venda(7, 13, 9, { status: 'canceled' }), venda(6, 10, 100)],
      'dia',
      janelaDoMes,
    );
    expect(s.totalQuantidade).toBe(5);
  });

  it('produto por peso usa os gramas para eleger o melhor período', () => {
    const porPeso = (dia: number, gramas: number) =>
      venda(7, dia, 1, {
        items: [{ id: 'p1', name: 'Bolo', quantity: 1, unitPrice: 50, saleUnit: 'kg', weightGrams: gramas }],
      });
    // Duas pesagens pequenas contra uma grande: quem manda é o peso.
    const s = serie([porPeso(3, 500), porPeso(4, 500), porPeso(12, 3000)], 'semana');

    expect(s.porPeso).toBe(true);
    expect(s.melhor?.chave).toBe('2026-08-10');
    expect(s.totalGramas).toBe(4000);
  });

  it('produto que nunca vendeu devolve série vazia em vez de quebrar', () => {
    const s = serieDoProduto([venda(7, 12, 3)], {
      chave: 'nao-existe',
      janela: TUDO,
      granularidade: 'semana',
      agora: AGORA,
    });
    expect(s.pontos).toEqual([]);
    expect(s.melhor).toBeNull();
    expect(s.totalValor).toBe(0);
  });

  it('a série alcança o período de hoje mesmo sem venda recente', () => {
    const s = serie([venda(5, 10, 4)], 'mes');
    expect(s.pontos.map((p) => p.chave)).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(s.pontos.at(-1)).toMatchObject({ quantidade: 0, emAndamento: true });
  });

  it('janela que termina no passado não estica a série até hoje', () => {
    const mesPassado = janelaDoRelatorio({ preset: 'mes_passado' }, AGORA);
    const s = serie([venda(6, 3, 4)], 'semana', mesPassado);
    expect(s.pontos.at(-1)!.inicio.getMonth()).toBe(6);
    expect(s.pontos.every((p) => !p.emAndamento)).toBe(true);
  });
});

describe('granularidadeSugerida', () => {
  it('período curto vira dia, médio vira semana, longo vira mês', () => {
    expect(granularidadeSugerida(janelaDoRelatorio({ preset: '7d' }, AGORA), AGORA)).toBe('dia');
    expect(granularidadeSugerida(janelaDoRelatorio({ preset: '30d' }, AGORA), AGORA)).toBe('semana');
    expect(granularidadeSugerida(janelaDoRelatorio({ preset: '3m' }, AGORA), AGORA)).toBe('semana');
    expect(granularidadeSugerida(janelaDoRelatorio({ preset: '12m' }, AGORA), AGORA)).toBe('mes');
    expect(granularidadeSugerida(janelaDoRelatorio({ preset: 'tudo' }, AGORA), AGORA)).toBe('mes');
  });
});
