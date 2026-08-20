import { describe, expect, it } from 'vitest';
import { balanceteMensal } from './balancete';

const AGORA = new Date(2026, 7, 20, 14, 30);

const venda = (mes: number, dia: number, total: number, over: any = {}) => ({
  id: `${mes}-${dia}-${total}`,
  status: 'delivered',
  orderDateTime: new Date(2026, mes, dia, 12, 0).toISOString(),
  totalAmount: total,
  ...over,
});

describe('balanceteMensal', () => {
  it('soma o faturamento e as vendas de cada mês', () => {
    const b = balanceteMensal([venda(5, 10, 100), venda(5, 20, 50), venda(6, 3, 200)], {
      meses: 12,
      agora: AGORA,
    });

    expect(b.meses.map((m) => [m.chave, m.faturamento, m.vendas])).toEqual([
      ['2026-06', 150, 2],
      ['2026-07', 200, 1],
      ['2026-08', 0, 0],
    ]);
    expect(b.total).toBe(350);
    expect(b.totalVendas).toBe(3);
    expect(b.ticketMedio).toBeCloseTo(116.67, 2);
  });

  it('não inventa meses antes da primeira venda', () => {
    const b = balanceteMensal([venda(6, 3, 200)], { meses: 12, agora: AGORA });
    expect(b.meses.map((m) => m.chave)).toEqual(['2026-07', '2026-08']);
  });

  it('mês sem venda nenhuma no meio da série aparece zerado', () => {
    const b = balanceteMensal([venda(4, 3, 100), venda(6, 3, 100)], { meses: 12, agora: AGORA });
    expect(b.meses.map((m) => m.chave)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08']);
    expect(b.meses[1].faturamento).toBe(0);
  });

  it('respeita a quantidade de meses pedida', () => {
    const vendas = [venda(2, 1, 10), venda(3, 1, 10), venda(4, 1, 10), venda(5, 1, 10), venda(6, 1, 10), venda(7, 1, 10)];
    const b = balanceteMensal(vendas, { meses: 3, agora: AGORA });
    expect(b.meses.map((m) => m.chave)).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(b.total).toBe(30);
  });

  it('meses = null traz o histórico inteiro', () => {
    const b = balanceteMensal([venda(0, 5, 40), venda(7, 5, 60)], { meses: null, agora: AGORA });
    expect(b.meses).toHaveLength(8);
    expect(b.meses[0].chave).toBe('2026-01');
  });

  it('a variação compara com o mês anterior e é nula quando não há com o que comparar', () => {
    const b = balanceteMensal([venda(5, 1, 100), venda(6, 1, 150)], { meses: 12, agora: AGORA });
    expect(b.meses[0].variacao).toBeNull();
    expect(b.meses[1].variacao).toBeCloseTo(0.5, 10);
    // Agosto caiu para zero: -100%, e não divisão por zero.
    expect(b.meses[2].variacao).toBeCloseTo(-1, 10);
  });

  it('não divide por zero quando o mês anterior foi zerado', () => {
    const b = balanceteMensal([venda(5, 1, 100), venda(7, 1, 80)], { meses: 12, agora: AGORA });
    expect(b.meses[1].faturamento).toBe(0);
    expect(b.meses[2].variacao).toBeNull();
    expect(b.meses.every((m) => m.variacao === null || Number.isFinite(m.variacao))).toBe(true);
  });

  it('melhor e pior mês ignoram os meses sem venda', () => {
    const b = balanceteMensal([venda(5, 1, 100), venda(6, 1, 80), venda(7, 1, 90)], { meses: 12, agora: AGORA });
    expect(b.melhor?.chave).toBe('2026-06');
    expect(b.pior?.chave).toBe('2026-07');
  });

  it('marca o mês corrente como em andamento', () => {
    const b = balanceteMensal([venda(5, 1, 100), venda(7, 1, 90)], { meses: 12, agora: AGORA });
    expect(b.meses.map((m) => m.emAndamento)).toEqual([false, false, true]);
  });

  it('o mês em andamento nunca é eleito o pior — ele ainda não terminou', () => {
    // Agosto está no dia 20 com R$ 10: é o menor número da série, mas é parcial.
    const b = balanceteMensal([venda(5, 1, 100), venda(6, 1, 80), venda(7, 1, 10)], { meses: 12, agora: AGORA });
    expect(b.meses[2]).toMatchObject({ chave: '2026-08', faturamento: 10, emAndamento: true });
    expect(b.pior?.chave).toBe('2026-07');
  });

  it('mas o mês em andamento pode ser o melhor: se já passou todos, passou mesmo', () => {
    const b = balanceteMensal([venda(5, 1, 100), venda(7, 1, 900)], { meses: 12, agora: AGORA });
    expect(b.melhor?.chave).toBe('2026-08');
  });

  it('quando só existe o mês corrente não há pior mês para apontar', () => {
    const b = balanceteMensal([venda(7, 1, 50)], { meses: 12, agora: AGORA });
    expect(b.melhor?.chave).toBe('2026-08');
    expect(b.pior).toBeNull();
  });

  it('venda cancelada não soma', () => {
    const b = balanceteMensal([venda(7, 1, 100), venda(7, 2, 500, { status: 'canceled' })], {
      meses: 12,
      agora: AGORA,
    });
    expect(b.total).toBe(100);
    expect(b.totalVendas).toBe(1);
  });

  it('pedido antigo do PDV, só com createdAt, entra no mês certo', () => {
    const b = balanceteMensal(
      [{ id: 'x', status: 'delivered', totalAmount: 70, createdAt: { toDate: () => new Date(2026, 6, 9, 10, 0) } }],
      { meses: 12, agora: AGORA },
    );
    expect(b.meses[0]).toMatchObject({ chave: '2026-07', faturamento: 70 });
  });

  it('sem venda nenhuma devolve série vazia em vez de quebrar', () => {
    const b = balanceteMensal([], { meses: 6, agora: AGORA });
    expect(b.meses).toEqual([]);
    expect(b.melhor).toBeNull();
    expect(b.mediaMensal).toBe(0);
  });

  it('a média mensal divide pelos meses da série, não pelos meses com venda', () => {
    const b = balanceteMensal([venda(5, 1, 300)], { meses: 12, agora: AGORA });
    expect(b.meses).toHaveLength(3);
    expect(b.mediaMensal).toBe(100);
  });
});
