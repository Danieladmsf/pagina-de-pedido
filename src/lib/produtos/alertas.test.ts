import { describe, expect, it } from 'vitest';

import { alertasDoProduto, contarAlertas, temAlerta } from './alertas';

/**
 * Os números vieram da Gostinho de Céu em 22/08/2026: 88 produtos, 49
 * esgotados, 11 desligados com estoque (46 unidades, R$ 383,50 presos) e 12
 * que estavam ligados mas o cliente não via. Cada caso abaixo é um desses.
 */

// Campos reais do modelo: os canais são showDelivery/showPickup/showDineIn e
// a categoria liga por isAvailable (ver lib/menu-visibility).
const ligado = { isAvailable: true, showDelivery: true, showPickup: true, showDineIn: true, price: 17 };
const categoriaLigada = { id: 'c1', isAvailable: true };

describe('alertasDoProduto', () => {
  it('produto normal, com estoque e no ar: nenhum alerta', () => {
    const alertas = alertasDoProduto({
      item: { ...ligado, id: 'p1', categoryId: 'c1' },
      categoria: categoriaLigada,
      estoque: 7,
    });
    expect(alertas).toEqual([]);
  });

  it('estoque zerado vira Esgotado', () => {
    const alertas = alertasDoProduto({
      item: { ...ligado, id: 'p1', categoryId: 'c1' },
      categoria: categoriaLigada,
      estoque: 0,
    });
    expect(alertas.map((a) => a.tipo)).toContain('esgotado');
  });

  it('desligado com estoque vira Parado, com as unidades no detalhe', () => {
    const alertas = alertasDoProduto({
      item: { id: 'p1', categoryId: 'c1', isAvailable: false, price: 17 },
      categoria: categoriaLigada,
      estoque: 4,
    });
    const parado = alertas.find((a) => a.tipo === 'parado');
    expect(parado?.detalhe).toBe('4 un. sem poder vender');
  });

  it('desligado SEM estoque não é parado: não há mercadoria presa', () => {
    const alertas = alertasDoProduto({
      item: { id: 'p1', categoryId: 'c1', isAvailable: false, price: 17 },
      categoria: categoriaLigada,
      estoque: 0,
    });
    expect(alertas.some((a) => a.tipo === 'parado')).toBe(false);
  });

  it('ligado mas escondido pela categoria vira Não aparece, dizendo o motivo', () => {
    const alertas = alertasDoProduto({
      item: { ...ligado, id: 'p1', categoryId: 'c1' },
      categoria: { id: 'c1', isAvailable: false },
      estoque: 5,
    });
    const oculto = alertas.find((a) => a.tipo === 'nao_aparece');
    expect(oculto?.detalhe).toBe('a categoria está desligada');
  });

  it('esgotado que some do cardápio ganha as duas etiquetas', () => {
    // São duas ações diferentes: repor, e conferir se era para estar no ar.
    const alertas = alertasDoProduto({
      item: { ...ligado, id: 'p1', categoryId: 'c1' },
      categoria: categoriaLigada,
      estoque: 0,
    });
    expect(alertas.map((a) => a.tipo).sort()).toEqual(['esgotado', 'nao_aparece']);
    expect(alertas.find((a) => a.tipo === 'nao_aparece')?.detalhe).toBe('o estoque está zerado');
  });

  it('só no PDV (Delivery desligado) também é Não aparece', () => {
    const alertas = alertasDoProduto({
      item: { id: 'p1', categoryId: 'c1', isAvailable: true, showDelivery: false, showPickup: true, showDineIn: true, price: 10 },
      categoria: categoriaLigada,
      estoque: 3,
    });
    expect(alertas.find((a) => a.tipo === 'nao_aparece')?.detalhe).toContain('Delivery');
  });

  it('produto desligado de propósito não vira Não aparece', () => {
    // Os dois botões cinza já se explicam: o aviso ali seria ruído.
    const alertas = alertasDoProduto({
      item: { id: 'p1', categoryId: 'c1', isAvailable: false, price: 10 },
      categoria: categoriaLigada,
      estoque: null,
    });
    expect(alertas.some((a) => a.tipo === 'nao_aparece')).toBe(false);
  });

  it('preço zerado vira Sem preço; combo não entra', () => {
    expect(
      alertasDoProduto({ item: { ...ligado, id: 'p1', price: 0, categoryId: 'c1' }, categoria: categoriaLigada, estoque: 5 })
        .some((a) => a.tipo === 'sem_preco'),
    ).toBe(true);
    expect(
      alertasDoProduto({ item: { ...ligado, id: 'c', isCombo: true, price: 0 }, estoque: 5 })
        .some((a) => a.tipo === 'sem_preco'),
    ).toBe(false);
  });

  it('produto sem controle de estoque não é esgotado nem parado', () => {
    const alertas = alertasDoProduto({
      item: { ...ligado, id: 'p1', categoryId: 'c1' },
      categoria: categoriaLigada,
      estoque: null,
    });
    expect(alertas).toEqual([]);
  });
});

describe('contarAlertas', () => {
  const loja = [
    { item: { ...ligado, id: 'a', categoryId: 'c1' }, categoria: categoriaLigada, estoque: 7 },
    { item: { ...ligado, id: 'b', categoryId: 'c1' }, categoria: categoriaLigada, estoque: 0 },
    { item: { id: 'c', categoryId: 'c1', isAvailable: false, price: 17 }, categoria: categoriaLigada, estoque: 4 },
    { item: { id: 'd', categoryId: 'c1', isAvailable: false, price: 10 }, categoria: categoriaLigada, estoque: 2 },
  ];

  it('conta cada alerta e soma as unidades e o dinheiro parados', () => {
    const contagem = contarAlertas(loja);
    const parado = contagem.find((c) => c.tipo === 'parado');
    expect(parado).toEqual({ tipo: 'parado', quantidade: 2, unidades: 6, valor: 88 });
  });

  it('devolve na ordem da tela e sem etiqueta zerada', () => {
    expect(contarAlertas(loja).map((c) => c.tipo)).toEqual(['parado', 'nao_aparece', 'esgotado']);
  });

  it('loja sem problema nenhum não gera etiqueta', () => {
    expect(contarAlertas([loja[0]])).toEqual([]);
    expect(contarAlertas([])).toEqual([]);
  });
});

describe('temAlerta', () => {
  it('responde o filtro da barra', () => {
    const parado = { item: { id: 'c', categoryId: 'c1', isAvailable: false, price: 17 }, categoria: categoriaLigada, estoque: 4 };
    expect(temAlerta(parado, 'parado')).toBe(true);
    expect(temAlerta(parado, 'esgotado')).toBe(false);
  });
});
