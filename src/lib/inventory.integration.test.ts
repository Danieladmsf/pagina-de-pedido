import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', async () => {
  const { firestoreMock } = await import('./__fixtures__/fake-firestore');
  return firestoreMock();
});

import { InsufficientStockError, reconcileOrderStock, releaseOrderStock } from './inventory';
import { applyStockChange } from './stock-movements';
import { fakeDb, read, readAll, resetDb, seed, setCommitHook } from './__fixtures__/fake-firestore';

/**
 * Testes de INTEGRAÇÃO do estoque: rodam o código que realmente move a
 * contagem, dentro de transações, contra um Firestore em memória.
 *
 * Por que existem: os testes puros provam o cálculo, mas o estoque só está
 * certo se a transação inteira estiver certa — abater e gravar o pedido juntos,
 * não gravar nada quando falta estoque, e refazer a conta quando outra venda
 * chega no meio. Nada disso era coberto.
 *
 * Cada helper abaixo chama `reconcileOrderStock` do MESMO jeito que o canal de
 * verdade chama, então o teste vale como simulação dos canais.
 */

const ITEMS = 'menuItems';
const ORDERS = 'orders';
const MOVES = 'stock_movements';
const OWNER = 'owner-1';

const ref = (collection: string, id: string) => ({ __col: collection, __id: id }) as any;

// ─────────────────────────── os canais ───────────────────────────

/** Cardápio online — CartDrawer: cria o pedido e abate na mesma transação. */
const vendaPeloCardapio = (orderId: string, items: any[]) =>
  reconcileOrderStock(fakeDb, {
    enableInventory: true,
    targetItems: items,
    order: { ref: ref(ORDERS, orderId), mode: 'set', data: { id: orderId, source: 'cardapio', status: 'pending', items } },
  });

/** PDV Balcão — NovoPedidoTab. */
const vendaNoBalcao = (orderId: string, items: any[]) =>
  reconcileOrderStock(fakeDb, {
    enableInventory: true,
    targetItems: items,
    order: { ref: ref(ORDERS, orderId), mode: 'set', data: { id: orderId, source: 'pdv', status: 'delivered', items } },
  });

/** Mesa — MesasTab: abrir comanda. */
const abrirComanda = (orderId: string, items: any[]) =>
  reconcileOrderStock(fakeDb, {
    enableInventory: true,
    targetItems: items,
    order: { ref: ref(ORDERS, orderId), mode: 'set', data: { id: orderId, orderType: 'dine_in', status: 'pending', items } },
  });

/** Mesa/Delivery — lançar ou editar itens de um pedido que já existe. */
const editarItens = (orderId: string, items: any[], alreadyDeducted: Record<string, number>) =>
  reconcileOrderStock(fakeDb, {
    enableInventory: true,
    targetItems: items,
    alreadyDeducted,
    order: { ref: ref(ORDERS, orderId), mode: 'update', data: { items } },
  });

/** Cancelamento — updateOrderStatus no PDV. */
const cancelarPedido = (orderId: string, alreadyDeducted: Record<string, number>) =>
  releaseOrderStock(fakeDb, {
    enableInventory: true,
    alreadyDeducted,
    order: { ref: ref(ORDERS, orderId), mode: 'update', data: { status: 'canceled' } },
  });

/** Rede de segurança do PDV: reabate um pedido que chegou sem baixa. */
const redeDeSeguranca = (orderId: string, items: any[], alreadyDeducted: Record<string, number>) =>
  reconcileOrderStock(fakeDb, {
    enableInventory: true,
    targetItems: items,
    alreadyDeducted,
    order: { ref: ref(ORDERS, orderId), mode: 'update', data: {} },
  });

const estoque = (id: string) => read(ITEMS, id)?.stockQuantity;

beforeEach(() => {
  resetDb();
  seed(ITEMS, 'brigadeiro', { name: 'Brigadeiro', stockQuantity: 10 });
  seed(ITEMS, 'coxinha', { name: 'Coxinha', stockQuantity: 3 });
  seed(ITEMS, 'cafe', { name: 'Café', stockQuantity: null }); // sem controle
});

describe('todos os canais abatem igual', () => {
  it('cardápio online', async () => {
    await vendaPeloCardapio('o1', [{ id: 'brigadeiro', quantity: 4 }]);
    expect(estoque('brigadeiro')).toBe(6);
    expect(read(ORDERS, 'o1')).toMatchObject({ stockDeducted: true, stockDeductedItems: { brigadeiro: 4 } });
  });

  it('PDV balcão', async () => {
    await vendaNoBalcao('o2', [{ id: 'coxinha', quantity: 2 }]);
    expect(estoque('coxinha')).toBe(1);
    expect(read(ORDERS, 'o2')!.stockDeductedItems).toEqual({ coxinha: 2 });
  });

  it('mesa: abre a comanda e depois lança mais, aplicando só a diferença', async () => {
    const abriu = await abrirComanda('mesa1', [{ id: 'brigadeiro', quantity: 2 }]);
    expect(estoque('brigadeiro')).toBe(8);

    await editarItens('mesa1', [{ id: 'brigadeiro', quantity: 5 }], abriu.stockDeductedItems);
    expect(estoque('brigadeiro')).toBe(5); // tirou 3 a mais, não 5
  });

  it('delivery: reduzir item devolve a diferença ao estoque', async () => {
    const venda = await vendaPeloCardapio('o3', [{ id: 'brigadeiro', quantity: 6 }]);
    expect(estoque('brigadeiro')).toBe(4);

    await editarItens('o3', [{ id: 'brigadeiro', quantity: 2 }], venda.stockDeductedItems);
    expect(estoque('brigadeiro')).toBe(8);
    expect(read(ORDERS, 'o3')!.stockDeductedItems).toEqual({ brigadeiro: 2 });
  });

  it('cancelamento devolve exatamente o que foi reservado', async () => {
    const venda = await vendaNoBalcao('o4', [{ id: 'coxinha', quantity: 3 }]);
    expect(estoque('coxinha')).toBe(0);

    await cancelarPedido('o4', venda.stockDeductedItems);
    expect(estoque('coxinha')).toBe(3);
    expect(read(ORDERS, 'o4')).toMatchObject({ status: 'canceled', stockDeducted: false, stockDeductedItems: {} });
  });
});

describe('nada de baixa dobrada', () => {
  it('reabater o mesmo pedido não tira nada a mais (idempotente)', async () => {
    const venda = await vendaPeloCardapio('o5', [{ id: 'brigadeiro', quantity: 3 }]);
    expect(estoque('brigadeiro')).toBe(7);

    const denovo = await redeDeSeguranca('o5', [{ id: 'brigadeiro', quantity: 3 }], venda.stockDeductedItems);
    expect(estoque('brigadeiro')).toBe(7);
    expect(denovo.changed).toBe(false);
  });

  it('cancelar duas vezes não devolve em dobro', async () => {
    const venda = await vendaNoBalcao('o6', [{ id: 'brigadeiro', quantity: 2 }]);
    const cancelou = await cancelarPedido('o6', venda.stockDeductedItems);
    await cancelarPedido('o6', cancelou.stockDeductedItems);
    expect(estoque('brigadeiro')).toBe(10);
  });
});

describe('quando falta estoque, nada acontece pela metade', () => {
  it('barra a venda e NÃO cria o pedido nem mexe no estoque', async () => {
    await expect(vendaPeloCardapio('o7', [{ id: 'coxinha', quantity: 4 }])).rejects.toThrow(InsufficientStockError);
    expect(estoque('coxinha')).toBe(3);
    expect(read(ORDERS, 'o7')).toBeUndefined();
  });

  it('um item sem estoque derruba o pedido inteiro (não grava o outro item)', async () => {
    await expect(
      vendaNoBalcao('o8', [{ id: 'brigadeiro', quantity: 1 }, { id: 'coxinha', quantity: 99 }]),
    ).rejects.toThrow(InsufficientStockError);
    expect(estoque('brigadeiro')).toBe(10);
    expect(estoque('coxinha')).toBe(3);
    expect(read(ORDERS, 'o8')).toBeUndefined();
  });

  it('produto zerado não vende — zerou, zerou', async () => {
    seed(ITEMS, 'zerado', { name: 'Bolo', stockQuantity: 0 });
    await expect(vendaPeloCardapio('o9', [{ id: 'zerado', quantity: 1 }])).rejects.toThrow(/esgotado|apenas 0|0 unidade/i);
  });

  it('REGRESSÃO: estoque negativo legado vale 0 e barra a venda', async () => {
    seed(ITEMS, 'furado', { name: 'Bolo Caseiro Ninho', stockQuantity: -2 });
    await expect(vendaPeloCardapio('o10', [{ id: 'furado', quantity: 1 }])).rejects.toThrow(InsufficientStockError);
    expect(read(ORDERS, 'o10')).toBeUndefined();
  });
});

describe('concorrência: a última unidade', () => {
  it('não vende duas vezes — a transação refaz a conta e barra a segunda', async () => {
    seed(ITEMS, 'ultimo', { name: 'Último doce', stockQuantity: 1 });

    // Entre a leitura e o commit do pedido A, o pedido B fecha e leva a unidade.
    setCommitHook(async () => {
      await vendaNoBalcao('B', [{ id: 'ultimo', quantity: 1 }]);
    });

    await expect(vendaPeloCardapio('A', [{ id: 'ultimo', quantity: 1 }])).rejects.toThrow(InsufficientStockError);

    expect(estoque('ultimo')).toBe(0);
    expect(read(ORDERS, 'B')!.stockDeductedItems).toEqual({ ultimo: 1 });
    expect(read(ORDERS, 'A')).toBeUndefined();
  });

  it('duas vendas que cabem no estoque passam as duas', async () => {
    setCommitHook(async () => {
      await vendaNoBalcao('B', [{ id: 'brigadeiro', quantity: 3 }]);
    });
    await vendaPeloCardapio('A', [{ id: 'brigadeiro', quantity: 2 }]);
    expect(estoque('brigadeiro')).toBe(5); // 10 - 3 - 2
  });
});

describe('casos que não devem contar', () => {
  it('produto sem controle não é abatido nem rastreado', async () => {
    const venda = await vendaPeloCardapio('o11', [{ id: 'cafe', quantity: 50 }]);
    expect(estoque('cafe')).toBeNull();
    expect(venda.stockDeductedItems).toEqual({});
    expect(read(ORDERS, 'o11')!.stockDeducted).toBe(false);
  });

  it('combo abate os componentes, não o combo', async () => {
    const combo = [{ id: 'combo1', quantity: 2, isCombo: true, comboItems: [{ itemId: 'brigadeiro' }, { itemId: 'coxinha' }] }];
    await vendaNoBalcao('o12', combo);
    expect(estoque('brigadeiro')).toBe(8);
    expect(estoque('coxinha')).toBe(1);
    expect(read(ORDERS, 'o12')!.stockDeductedItems).toEqual({ brigadeiro: 2, coxinha: 2 });
  });

  it('com o controle desligado o pedido é gravado sem tocar no estoque', async () => {
    await reconcileOrderStock(fakeDb, {
      enableInventory: false,
      targetItems: [{ id: 'brigadeiro', quantity: 5 }],
      order: { ref: ref(ORDERS, 'o13'), mode: 'set', data: { id: 'o13' } },
    });
    expect(estoque('brigadeiro')).toBe(10);
    expect(read(ORDERS, 'o13')).toBeDefined();
  });

  it('produto apagado no meio do caminho não quebra a venda', async () => {
    await vendaPeloCardapio('o14', [{ id: 'sumiu', quantity: 1 }, { id: 'brigadeiro', quantity: 1 }]);
    expect(estoque('brigadeiro')).toBe(9);
  });
});

describe('movimentação manual grava produto e histórico juntos', () => {
  const mover = (itemId: string, type: any, quantity: number, note = '') =>
    applyStockChange(fakeDb, { ownerId: OWNER, itemId, type, quantity, note, userName: 'Camila' });

  it('entrada soma e registra', async () => {
    await mover('coxinha', 'entrada', 12, 'produção da tarde');
    expect(estoque('coxinha')).toBe(15);
    expect(readAll(MOVES)).toHaveLength(1);
    expect(readAll(MOVES)[0]).toMatchObject({
      ownerId: OWNER, itemId: 'coxinha', type: 'entrada', delta: 12, stockBefore: 3, stockAfter: 15, userName: 'Camila',
    });
  });

  it('saída subtrai e nunca deixa negativo', async () => {
    await mover('coxinha', 'saida', 3, 'quebra');
    expect(estoque('coxinha')).toBe(0);
    await expect(mover('coxinha', 'saida', 1)).rejects.toThrow(/esgotado|Só há 0|0 unidade/i);
    expect(estoque('coxinha')).toBe(0);
    expect(readAll(MOVES)).toHaveLength(1); // a saída barrada não virou histórico
  });

  it('corrigir contagem é lançar a DIFERENÇA, não o total', async () => {
    // Contou 4 na prateleira e o sistema diz 10: lança a saída de 6.
    await mover('brigadeiro', 'saida', 6, 'contagem do fim do dia');
    expect(estoque('brigadeiro')).toBe(4);
    expect(readAll(MOVES)[0]).toMatchObject({ type: 'saida', delta: -6, stockAfter: 4 });
  });

  it('o tipo "ajuste" foi aposentado e não grava nada', async () => {
    await expect(mover('brigadeiro', 'ajuste', 4)).rejects.toThrow(/inválido/i);
    expect(estoque('brigadeiro')).toBe(10);
    expect(readAll(MOVES)).toHaveLength(0);
  });

  it('entrada em produto sem controle inicia o controle', async () => {
    await mover('cafe', 'entrada', 8);
    expect(estoque('cafe')).toBe(8);
    expect(readAll(MOVES)[0]).toMatchObject({ stockBefore: null, stockAfter: 8, delta: 8 });
  });

  it('sem_controle desliga a contagem — a única saída desse estado', async () => {
    await mover('brigadeiro', 'sem_controle', 0);
    expect(estoque('brigadeiro')).toBeNull();
    expect(readAll(MOVES)[0]).toMatchObject({ type: 'sem_controle', stockBefore: 10, stockAfter: null, delta: -10 });

    // e depois volta a vender sem limite
    const venda = await vendaPeloCardapio('o15', [{ id: 'brigadeiro', quantity: 999 }]);
    expect(venda.stockDeductedItems).toEqual({});
  });

  it('produto inexistente não gera histórico', async () => {
    await expect(mover('nao-existe', 'entrada', 5)).rejects.toThrow(/não encontrado/i);
    expect(readAll(MOVES)).toHaveLength(0);
  });
});

describe('CENÁRIO REAL — Gostinho de Céu', () => {
  /**
   * Foi assim que nasceram as 3 unidades fantasma do ESPETÃO: ela lia o número
   * na tela, somava de cabeça e digitava o TOTAL. Se saísse venda no meio, a
   * conta subia errado. Com entrada, quem soma é o banco.
   */
  it('repor por ENTRADA não desfaz as vendas que entraram no meio', async () => {
    seed(ITEMS, 'brig', { name: 'Brigadeiro', stockQuantity: 15 });

    // Ela olha a tela e vê 15. Enquanto pega o tabuleiro, saem 2.
    await vendaPeloCardapio('v1', [{ id: 'brig', quantity: 2 }]);
    expect(estoque('brig')).toBe(13);

    // Produziu mais 15 e informa a ENTRADA (não o total "30").
    await applyStockChange(fakeDb, { ownerId: OWNER, itemId: 'brig', type: 'entrada', quantity: 15 });

    expect(estoque('brig')).toBe(28); // e não 30: as 2 vendidas continuam vendidas
  });

  it('o dia inteiro do ESPETÃO fecha no zero, sem sobra nem falta', async () => {
    seed(ITEMS, 'espetao', { name: 'ESPETÃO', stockQuantity: 8 });

    const vendas: Array<[string, number]> = [
      ['z4ydh', 1], ['ppyai', 1], ['2l8sr', 1], ['vzr0o', 1],
      ['ev0e1', 1], ['4uqtv', 2], ['4zjb6', 1],
    ];
    for (const [id, qtd] of vendas) {
      await vendaPeloCardapio(id, [{ id: 'espetao', quantity: qtd }]);
    }

    expect(estoque('espetao')).toBe(0);
    // a nona unidade não existe
    await expect(vendaPeloCardapio('extra', [{ id: 'espetao', quantity: 1 }])).rejects.toThrow(InsufficientStockError);
  });
});
