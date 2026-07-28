import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * O que estes testes protegem: apagar produto sem deixar a promoção apontando
 * pro vazio. `promotions.items[].menuItemId` é a única referência cruzada a
 * `menuItems` no projeto, e ninguém a limpava — a Lima Limão acumulou 5
 * referências mortas antes de alguém perceber.
 *
 * O ponto crítico é a ATOMICIDADE: produto e promoções têm que sair no mesmo
 * batch. Se o produto saísse antes, uma falha no meio recriaria exatamente o
 * problema que o fix veio resolver.
 */

const batchMock = { delete: vi.fn(), update: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };

vi.mock('firebase/firestore', () => ({
  doc: (_db: any, col: string, id: string) => ({ path: `${col}/${id}` }),
  writeBatch: () => batchMock,
}));

const { promotionsUsingItem, deleteItemWarning, deleteMenuItemWithCleanup } = await import('./menu-item-delete');

const promocoes = [
  { id: 'promo1', name: 'Terça Maluca', items: [{ menuItemId: 'x' }, { menuItemId: 'y' }] },
  { id: 'promo2', name: 'Fim de Semana', items: [{ menuItemId: 'y' }] },
  { id: 'promo3', name: 'Sem itens' },
];

beforeEach(() => {
  batchMock.delete.mockClear();
  batchMock.update.mockClear();
  batchMock.commit.mockClear();
});

describe('promotionsUsingItem', () => {
  it('acha as promoções que citam o produto', () => {
    expect(promotionsUsingItem(promocoes, 'y').map(p => p.id)).toEqual(['promo1', 'promo2']);
  });

  it('não quebra com promoção sem items', () => {
    expect(promotionsUsingItem(promocoes, 'zzz')).toEqual([]);
  });
});

describe('deleteItemWarning', () => {
  it('fica vazio quando o produto não está em promoção', () => {
    expect(deleteItemWarning(promocoes, 'zzz')).toBe('');
  });

  it('lista as promoções afetadas pelo nome', () => {
    const aviso = deleteItemWarning(promocoes, 'y');
    expect(aviso).toContain('2 promoções');
    expect(aviso).toContain('Terça Maluca');
    expect(aviso).toContain('Fim de Semana');
  });

  it('usa singular com uma promoção só', () => {
    const aviso = deleteItemWarning(promocoes, 'x');
    expect(aviso).toContain('1 promoção');
    expect(aviso).not.toContain('promoções');
  });
});

describe('deleteMenuItemWithCleanup', () => {
  it('apaga o produto e tira ele das promoções no MESMO batch', async () => {
    await deleteMenuItemWithCleanup({}, 'y', promocoes);

    expect(batchMock.delete).toHaveBeenCalledTimes(1);
    expect(batchMock.delete).toHaveBeenCalledWith({ path: 'menuItems/y' });
    expect(batchMock.update).toHaveBeenCalledTimes(2);
    // 'y' sai, 'x' fica
    expect(batchMock.update).toHaveBeenCalledWith({ path: 'promotions/promo1' }, { items: [{ menuItemId: 'x' }] });
    expect(batchMock.update).toHaveBeenCalledWith({ path: 'promotions/promo2' }, { items: [] });
    expect(batchMock.commit).toHaveBeenCalledTimes(1);
  });

  it('sem promoção afetada, só apaga o produto', async () => {
    await deleteMenuItemWithCleanup({}, 'zzz', promocoes);
    expect(batchMock.delete).toHaveBeenCalledTimes(1);
    expect(batchMock.update).not.toHaveBeenCalled();
    expect(batchMock.commit).toHaveBeenCalledTimes(1);
  });
});
