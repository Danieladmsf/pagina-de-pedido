import { describe, expect, it } from 'vitest';

import { findUnderSuppliedProducts, resolveGroup } from './addon-groups';

/**
 * O que estes testes protegem: o beco sem saída do cardápio. A etapa de
 * adicionais era resolvida em DOIS lugares (validação e renderização do
 * MenuItemDialog). Quando divergiram, a etapa sem adicional disponível sumia da
 * tela mas continuava sendo exigida — o botão "Adicionar" ficava morto pra
 * sempre e o produto não podia ser comprado por ninguém.
 *
 * Caso real que originou isto: "Marmitex G" pedia 3 carnes com 30 das 31 carnes
 * pausadas. Sobrava 1 opção para um mínimo de 3: impossível de comprar, sem
 * nenhuma mensagem na tela.
 *
 * Invariante central: o mínimo cobrado NUNCA pode passar do número de opções
 * disponíveis.
 */

const addons = [
  { id: 'a1', name: 'Frango', group: '', active: true },
  { id: 'a2', name: 'Carne', group: '', active: false },   // pausado
  { id: 'a3', name: 'Peixe', group: '', active: true },
];

describe('resolveGroup', () => {
  it('ignora adicional pausado ao contar as opções', () => {
    const r = resolveGroup({ name: 'Carnes', addonIds: ['a1', 'a2', 'a3'], min: 2 }, addons, []);
    expect(r.availableAddons.map(a => a.id)).toEqual(['a1', 'a3']);
  });

  it('nunca exige mais do que dá para escolher (o caso Marmitex G)', () => {
    const r = resolveGroup({ name: 'Carnes', addonIds: ['a1', 'a2'], min: 3 }, addons, []);
    expect(r.configuredMin).toBe(3);
    expect(r.availableAddons).toHaveLength(1);
    expect(r.min).toBe(1);            // <- sem isso o produto fica invendável
    expect(r.isUnderSupplied).toBe(true);
  });

  it('zera o mínimo quando não sobrou nenhuma opção, em vez de travar', () => {
    const r = resolveGroup({ name: 'Carnes', addonIds: ['a2'], min: 2 }, addons, []);
    expect(r.availableAddons).toHaveLength(0);
    expect(r.min).toBe(0);
  });

  it('mantém o mínimo quando há opções suficientes', () => {
    const r = resolveGroup({ name: 'Carnes', addonIds: ['a1', 'a3'], min: 2 }, addons, []);
    expect(r.min).toBe(2);
    expect(r.isUnderSupplied).toBe(false);
  });

  it('adicional excluído (id órfão) não conta como opção', () => {
    const r = resolveGroup({ name: 'Carnes', addonIds: ['a1', 'sumiu'], min: 2 }, addons, []);
    expect(r.availableAddons).toHaveLength(1);
    expect(r.min).toBe(1);
  });

  it('respeita min/max e a pausa local do container', () => {
    const categories = [
      { id: 'c1', name: 'Carnes', addonIds: ['a1', 'a3'], pausedAddonIds: ['a3'], min: 2, max: 4 },
    ];
    const r = resolveGroup({ name: 'Etapa', addonCategoryId: 'c1' }, addons, categories);
    expect(r.availableAddons.map(a => a.id)).toEqual(['a1']);
    expect(r.configuredMin).toBe(2);
    expect(r.min).toBe(1);
    expect(r.max).toBe(4);
  });

  it('etapa opcional (min 0) segue opcional', () => {
    const r = resolveGroup({ name: 'Extras', addonIds: ['a2'], min: 0 }, addons, []);
    expect(r.min).toBe(0);
    expect(r.isUnderSupplied).toBe(false);
  });
});

describe('findUnderSuppliedProducts', () => {
  const items = [
    { id: 'p1', name: 'Marmitex G', addonGroups: [{ name: 'Escolha sua Carne', addonIds: ['a1', 'a3'], min: 2 }] },
    { id: 'p2', name: 'Refrigerante', addonGroups: [] },
  ];

  it('não acusa nada quando as opções bastam', () => {
    expect(findUnderSuppliedProducts(items, addons, [])).toHaveLength(0);
  });

  it('simula a saída de um adicional e aponta o produto afetado', () => {
    const afetados = findUnderSuppliedProducts(items, addons, [], new Set(['a3']));
    expect(afetados).toHaveLength(1);
    expect(afetados[0].product.name).toBe('Marmitex G');
    expect(afetados[0].groupName).toBe('Escolha sua Carne');
    expect(afetados[0].configuredMin).toBe(2);
    expect(afetados[0].available).toBe(1);
  });

  it('ignora etapa opcional na simulação', () => {
    const opcionais = [{ id: 'p3', name: 'X', addonGroups: [{ name: 'Extras', addonIds: ['a1'], min: 0 }] }];
    expect(findUnderSuppliedProducts(opcionais, addons, [], new Set(['a1']))).toHaveLength(0);
  });
});
