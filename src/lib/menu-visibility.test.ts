import { describe, expect, it } from 'vitest';

import { buildAdminMenuGroups } from './menu-groups';
import {
  getMotivosOcultoNoCardapio,
  getVisibleCategories,
  isCategoryOn,
  isCategoryVisibleNow,
  isItemInVisibleCategory,
  pareceLigadoMasNaoAparece,
} from './menu-visibility';

/**
 * O que estes testes protegem: o botão Ligada/Desligada da aba Categorias.
 *
 * Caso real (Gostinho de Céu, 11/08/2026): a dona desligava a categoria e ela
 * continuava aparecendo, porque o desligamento só era respeitado nas seções do
 * cardápio público. A Vitrine do topo, as páginas de oferta e o PDV montavam a
 * lista por conta própria e ignoravam o botão — "FESTIVAL DE FATIAS" estava
 * desligada com 6 dos 10 produtos ainda ligados.
 *
 * Invariante central: categoria desligada leva os produtos dela junto, em toda
 * tela. As duas exceções são deliberadas — combo tem seção própria e produto
 * sem categoria não tem a quem obedecer.
 */

const promoVazia = { promoItemsMap: {}, promoOnlyIds: new Set<string>(), hasActivePromos: false };

describe('isCategoryOn', () => {
  it('trata categoria antiga sem o campo como ligada', () => {
    expect(isCategoryOn({ name: 'Bolos' })).toBe(true);
    expect(isCategoryOn({ isAvailable: true })).toBe(true);
    expect(isCategoryOn({ isAvailable: false })).toBe(false);
  });
});

describe('isCategoryVisibleNow', () => {
  const terca10h = new Date('2026-08-11T13:00:00Z'); // 10h em São Paulo

  it('desligada some mesmo dentro da janela de horário', () => {
    const cat = {
      isAvailable: false,
      availability: { enabled: true, days: ['terca'], startTime: '08:00', endTime: '18:00' },
    };
    expect(isCategoryVisibleNow(cat, terca10h)).toBe(false);
  });

  it('ligada sem agenda aparece sempre', () => {
    expect(isCategoryVisibleNow({ name: 'Bolos' }, terca10h)).toBe(true);
  });

  it('respeita dia da semana com acento e maiúscula', () => {
    const cat = { availability: { enabled: true, days: ['Terça'], startTime: '08:00', endTime: '18:00' } };
    expect(isCategoryVisibleNow(cat, terca10h)).toBe(true);

    const soDomingo = { availability: { enabled: true, days: ['Domingo'], startTime: '08:00', endTime: '18:00' } };
    expect(isCategoryVisibleNow(soDomingo, terca10h)).toBe(false);
  });

  it('fecha fora da janela e atravessa a meia-noite', () => {
    const almoco = { availability: { enabled: true, days: ['terca'], startTime: '11:00', endTime: '14:00' } };
    expect(isCategoryVisibleNow(almoco, terca10h)).toBe(false);

    const madrugada = { availability: { enabled: true, days: ['terca'], startTime: '22:00', endTime: '04:00' } };
    const terca23h = new Date('2026-08-12T02:00:00Z'); // 23h em São Paulo, ainda terça
    expect(isCategoryVisibleNow(madrugada, terca23h)).toBe(true);
  });
});

describe('getVisibleCategories', () => {
  it('tira as desligadas e devolve na ordem de exibição', () => {
    const cats = [
      { id: 'c', name: 'Trufas', displayOrder: 2 },
      { id: 'a', name: 'Bolos', displayOrder: 1 },
      { id: 'x', name: 'FESTIVAL DE FATIAS', displayOrder: 0, isAvailable: false },
    ];
    expect(getVisibleCategories(cats, new Date()).map((c: any) => c.id)).toEqual(['a', 'c']);
  });
});

describe('isItemInVisibleCategory', () => {
  const visiveis = new Set(['bolos']);

  it('esconde produto de categoria desligada', () => {
    expect(isItemInVisibleCategory({ categoryId: 'fatias' }, visiveis)).toBe(false);
  });

  it('mantém combo e produto sem categoria', () => {
    expect(isItemInVisibleCategory({ categoryId: 'fatias', isCombo: true }, visiveis)).toBe(true);
    expect(isItemInVisibleCategory({ name: 'avulso' }, visiveis)).toBe(true);
  });
});

describe('buildAdminMenuGroups: categoria desligada no PDV e nas Mesas', () => {
  const categories = [
    { id: 'bolos', name: 'Bolos Caseiros' },
    { id: 'fatias', name: 'FESTIVAL DE FATIAS', isAvailable: false },
  ];
  const items = [
    { id: '1', name: 'Bolo de Cenoura', categoryId: 'bolos' },
    { id: '2', name: 'Fatia Matilda', categoryId: 'fatias' },
  ];

  it('não cria a seção da categoria desligada', () => {
    const grupos = buildAdminMenuGroups(items, categories, 'pickup', '', promoVazia);
    expect(grupos.map((g) => g.name)).toEqual(['Bolos Caseiros']);
  });

  it('não deixa o produto vazar para "Outros"', () => {
    const grupos = buildAdminMenuGroups(items, categories, 'dine_in', '', promoVazia);
    const todosOsItens = grupos.flatMap((g) => g.items.map((i: any) => i.id));
    expect(todosOsItens).toEqual(['1']);
  });

  it('não deixa o produto voltar pela seção de Promoções', () => {
    const grupos = buildAdminMenuGroups(items, categories, 'pickup', '', {
      promoItemsMap: { '2': { promoPrice: 20, originalPrice: 25 } } as any,
      promoOnlyIds: new Set<string>(),
      hasActivePromos: true,
    });
    expect(grupos.find((g) => g.id === '__promo__')).toBeUndefined();
  });

  it('mantém o combo de categoria desligada na seção de Combos', () => {
    const comCombo = [...items, { id: '3', name: 'Combo Festa', categoryId: 'fatias', isCombo: true }];
    const grupos = buildAdminMenuGroups(comCombo, categories, 'pickup', '', promoVazia);
    expect(grupos.find((g) => g.id === '__combos__')?.items.map((i: any) => i.id)).toEqual(['3']);
  });

  it('produto sem categoria continua em "Outros"', () => {
    const comAvulso = [...items, { id: '4', name: 'Taxa', categoryId: 'sumiu' }];
    const grupos = buildAdminMenuGroups(comAvulso, categories, 'pickup', '', promoVazia);
    expect(grupos.find((g) => g.id === '__none__')?.items.map((i: any) => i.id)).toEqual(['4']);
  });
});

/**
 * O relato das lojas era "categorias e produtos ligam e desligam sozinhos, e no
 * dia seguinte só alguns itens". Auditando a produção, nada no app escreve
 * esses campos fora do botão da aba Produtos: o que muda sozinho é o ESTOQUE
 * (zerou ao vender o último, voltou quando um pedido foi cancelado) e a
 * categoria desligada, que leva os produtos junto. A aba Produtos não mostrava
 * nem um nem outro — os dois botões continuavam verdes. Estes testes travam o
 * diagnóstico que passou a aparecer na linha do produto.
 */
describe('getMotivosOcultoNoCardapio', () => {
  const ligada = { id: 'bolos', name: 'Bolos', isAvailable: true };
  const desligada = { id: 'bolos', name: 'Bolos', isAvailable: false };
  const produto = { id: '1', name: 'Bolo de Pote', categoryId: 'bolos' };

  it('não acusa nada quando o produto está mesmo no ar', () => {
    expect(getMotivosOcultoNoCardapio(produto, { category: ligada })).toEqual([]);
  });

  it('acusa estoque zerado mesmo com os dois botões verdes', () => {
    const motivos = getMotivosOcultoNoCardapio(produto, { category: ligada, esgotado: true });
    expect(motivos).toEqual(['esgotado']);
    expect(pareceLigadoMasNaoAparece(motivos)).toBe(true);
  });

  it('acusa categoria desligada mesmo com os dois botões verdes', () => {
    const motivos = getMotivosOcultoNoCardapio(produto, { category: desligada });
    expect(motivos).toEqual(['categoria_desligada']);
    expect(pareceLigadoMasNaoAparece(motivos)).toBe(true);
  });

  it('acusa "só no PDV" quando Local está ligado e Delivery não', () => {
    const soLocal = { ...produto, showDelivery: false, showPickup: true, showDineIn: true };
    expect(getMotivosOcultoNoCardapio(soLocal, { category: ligada })).toEqual(['sem_delivery']);
  });

  it('produto com os dois botões cinza se explica sozinho — não vira aviso', () => {
    const off = { ...produto, showDelivery: false, showPickup: false, showDineIn: false, isAvailable: false };
    const motivos = getMotivosOcultoNoCardapio(off, { category: ligada });
    expect(motivos).toEqual(['desligado']);
    expect(pareceLigadoMasNaoAparece(motivos)).toBe(false);
  });

  it('pega o legado com isAvailable dessincronizado dos canais', () => {
    const legado = { ...produto, isAvailable: false, showDelivery: true, showPickup: true };
    expect(getMotivosOcultoNoCardapio(legado, { category: ligada })).toContain('desligado');
  });

  it('soma os motivos: esgotado dentro de categoria desligada', () => {
    const motivos = getMotivosOcultoNoCardapio(produto, { category: desligada, esgotado: true });
    expect(motivos).toEqual(['categoria_desligada', 'esgotado']);
  });

  it('combo não obedece categoria (tem seção própria)', () => {
    const combo = { id: '9', name: 'Combo Festa', categoryId: 'bolos', isCombo: true };
    expect(getMotivosOcultoNoCardapio(combo, { category: desligada })).toEqual([]);
  });

  it('produto sem categoria não tem a quem obedecer', () => {
    const avulso = { id: '5', name: 'Taxa de Entrega' };
    expect(getMotivosOcultoNoCardapio(avulso, { category: desligada })).toEqual([]);
  });
});
