import { describe, expect, it } from 'vitest';

import {
  checkCartStock,
  computeStockDelta,
  getEffectiveStock,
  getManagedStock,
  getStockDemand,
  isOutOfStock,
  normalizeStockInput,
} from './inventory';

/**
 * O que estes testes protegem: a contabilidade do estoque.
 *
 * Caso real que originou isto (Gostinho de Céu, jul/2026): "Bolo Caseiro Ninho"
 * ficou com estoque -2 no banco. A regra antiga (`value >= 0 ? value : null`)
 * lia negativo como "ilimitado" — o produto voltou a vender para sempre, sem
 * nunca abater e sem nunca aparecer como esgotado. A dona reclamou que "a venda
 * não baixa do estoque" e estava certa, só que para aquele item específico.
 *
 * A regra agora é uma só, e vale em todas as telas: **só é ilimitado quem não
 * tem estoque definido. Número é sempre controlado, e zerou, zerou.**
 */

describe('getManagedStock', () => {
  it('trata negativo como ZERO, nunca como ilimitado', () => {
    expect(getManagedStock(-2)).toBe(0);
    expect(getManagedStock(-0.5)).toBe(0);
  });

  it('só é ilimitado quem não tem estoque definido', () => {
    expect(getManagedStock(null)).toBeNull();
    expect(getManagedStock(undefined)).toBeNull();
    expect(getManagedStock('5')).toBeNull(); // string não é estoque controlado
    expect(getManagedStock(NaN)).toBeNull();
    expect(getManagedStock(Infinity)).toBeNull();
  });

  it('preserva o número quando há controle', () => {
    expect(getManagedStock(0)).toBe(0);
    expect(getManagedStock(7)).toBe(7);
  });
});

describe('normalizeStockInput', () => {
  it('nunca deixa gravar negativo', () => {
    expect(normalizeStockInput('-3')).toBe(0);
    expect(normalizeStockInput(-3)).toBe(0);
  });

  it('campo vazio significa ilimitado', () => {
    expect(normalizeStockInput('')).toBeNull();
    expect(normalizeStockInput('   ')).toBeNull();
    expect(normalizeStockInput(null)).toBeNull();
    expect(normalizeStockInput(undefined)).toBeNull();
  });

  it('trunca para inteiro', () => {
    expect(normalizeStockInput('4.9')).toBe(4);
    expect(normalizeStockInput('10')).toBe(10);
  });

  it('texto inválido não vira 0 silenciosamente: fica ilimitado', () => {
    expect(normalizeStockInput('abc')).toBeNull();
  });
});

describe('getEffectiveStock (combo)', () => {
  const items = [
    { id: 'refri', name: 'Refri', stockQuantity: 5 },
    { id: 'lanche', name: 'Lanche', stockQuantity: 2 },
    { id: 'brinde', name: 'Brinde', stockQuantity: null },
    { id: 'furado', name: 'Furado', stockQuantity: -4 },
  ];

  it('combo vale o menor estoque entre os componentes', () => {
    const combo = { id: 'c1', isCombo: true, comboItems: [{ itemId: 'refri' }, { itemId: 'lanche' }] };
    expect(getEffectiveStock(combo, items)).toBe(2);
  });

  it('componente ilimitado não limita o combo', () => {
    const combo = { id: 'c2', isCombo: true, comboItems: [{ itemId: 'brinde' }, { itemId: 'refri' }] };
    expect(getEffectiveStock(combo, items)).toBe(5);
  });

  it('componente que não existe mais zera o combo', () => {
    const combo = { id: 'c3', isCombo: true, comboItems: [{ itemId: 'refri' }, { itemId: 'sumiu' }] };
    expect(getEffectiveStock(combo, items)).toBe(0);
  });

  it('componente com estoque negativo zera o combo', () => {
    const combo = { id: 'c4', isCombo: true, comboItems: [{ itemId: 'refri' }, { itemId: 'furado' }] };
    expect(getEffectiveStock(combo, items)).toBe(0);
  });
});

describe('isOutOfStock', () => {
  it('com o controle desligado nada fica esgotado', () => {
    expect(isOutOfStock({ id: 'x', stockQuantity: 0 }, { enableInventory: false })).toBe(false);
  });

  it('zero e negativo estão esgotados', () => {
    expect(isOutOfStock({ id: 'x', stockQuantity: 0 }, { enableInventory: true })).toBe(true);
    expect(isOutOfStock({ id: 'x', stockQuantity: -2 }, { enableInventory: true })).toBe(true);
  });

  it('sem estoque definido nunca esgota', () => {
    expect(isOutOfStock({ id: 'x', stockQuantity: null }, { enableInventory: true })).toBe(false);
  });
});

describe('getStockDemand', () => {
  it('expande combo nos componentes', () => {
    const demand = getStockDemand([
      { id: 'c1', quantity: 2, isCombo: true, comboItems: [{ itemId: 'refri' }, { itemId: 'lanche' }] },
    ]);
    expect(demand).toEqual({ refri: 2, lanche: 2 });
  });

  it('soma o mesmo produto vindo em linhas separadas', () => {
    const demand = getStockDemand([
      { id: 'p1', quantity: 1 },
      { id: 'p1', quantity: 3 },
    ]);
    expect(demand).toEqual({ p1: 4 });
  });

  it('ignora quantidade zero ou inválida', () => {
    expect(getStockDemand([{ id: 'p1', quantity: 0 }, { id: 'p2', quantity: 'x' as any }])).toEqual({});
  });
});

describe('computeStockDelta', () => {
  it('aplica só a diferença do que já estava reservado (idempotência)', () => {
    expect(computeStockDelta({ p1: 2 }, { p1: 2 })).toEqual({});
    expect(computeStockDelta({ p1: 2 }, { p1: 5 })).toEqual({ p1: 3 });
    expect(computeStockDelta({ p1: 5 }, { p1: 2 })).toEqual({ p1: -3 });
  });

  it('cancelamento devolve tudo que estava reservado', () => {
    expect(computeStockDelta({ p1: 4, p2: 1 }, {})).toEqual({ p1: -4, p2: -1 });
  });
});

describe('checkCartStock', () => {
  const items = [
    { id: 'p1', name: 'Brigadeiro', stockQuantity: 3 },
    { id: 'zerado', name: 'Coxinha', stockQuantity: 0 },
    { id: 'furado', name: 'Bolo Caseiro Ninho', stockQuantity: -2 },
    { id: 'livre', name: 'Café', stockQuantity: null },
  ];

  it('deixa passar o que cabe no estoque', () => {
    expect(checkCartStock([{ id: 'p1', quantity: 3 }], items, true).allowed).toBe(true);
  });

  it('barra o que passa do estoque', () => {
    const r = checkCartStock([{ id: 'p1', quantity: 4 }], items, true);
    expect(r.allowed).toBe(false);
    expect(r.message).toContain('apenas 3');
  });

  it('produto zerado diz "esgotado", não "apenas 0 unidades"', () => {
    const r = checkCartStock([{ id: 'zerado', quantity: 1 }], items, true);
    expect(r.allowed).toBe(false);
    expect(r.message).toContain('esgotado');
  });

  it('REGRESSÃO: estoque negativo barra a venda em vez de virar ilimitado', () => {
    expect(checkCartStock([{ id: 'furado', quantity: 1 }], items, true).allowed).toBe(false);
  });

  it('item sem controle de estoque nunca barra', () => {
    expect(checkCartStock([{ id: 'livre', quantity: 999 }], items, true).allowed).toBe(true);
  });

  it('com o controle desligado nada barra', () => {
    expect(checkCartStock([{ id: 'zerado', quantity: 10 }], items, false).allowed).toBe(true);
  });

  it('soma as linhas do mesmo produto antes de comparar', () => {
    const r = checkCartStock([{ id: 'p1', quantity: 2 }, { id: 'p1', quantity: 2 }], items, true);
    expect(r.allowed).toBe(false);
  });

  it('combo consome o estoque dos componentes', () => {
    const r = checkCartStock(
      [{ id: 'c1', quantity: 2, isCombo: true, comboItems: [{ itemId: 'p1' }, { itemId: 'zerado' }] }],
      items,
      true,
    );
    expect(r.allowed).toBe(false);
  });
});
