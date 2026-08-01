import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  customers: new Map<string, any>(),
  writes: [] as Array<{ id: string; data: any }>,
  commits: 0,
  preloadError: null as Error | null,
  transactionCreations: 0,
  occupyBeforeTransaction: null as { id: string; data: any } | null,
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: any, name: string) => ({ name }),
  where: (field: string, op: string, value: any) => ({ field, op, value }),
  query: (ref: any, ...constraints: any[]) => ({ ...ref, constraints }),
  doc: (_db: any, collectionName: string, id: string) => ({ collectionName, id }),
  getDocs: async () => {
    if (fake.preloadError) throw fake.preloadError;
    const docs = [...fake.customers.entries()].map(([id, data]) => ({
      id,
      data: () => ({ ...data }),
    }));
    return { docs, forEach: (callback: (item: any) => void) => docs.forEach(callback) };
  },
  runTransaction: async (_db: any, body: (transaction: any) => Promise<void>) => {
    fake.transactionCreations++;
    if (fake.occupyBeforeTransaction) {
      fake.customers.set(fake.occupyBeforeTransaction.id, { ...fake.occupyBeforeTransaction.data });
      fake.occupyBeforeTransaction = null;
    }
    const pending: Array<{ id: string; data: any }> = [];
    await body({
      get: async (ref: { id: string }) => ({
        id: ref.id,
        exists: () => fake.customers.has(ref.id),
        data: () => fake.customers.get(ref.id),
      }),
      set: (ref: { id: string }, data: any) => pending.push({ id: ref.id, data: { ...data } }),
    });
    pending.forEach(({ id, data }) => fake.customers.set(id, { ...data }));
    fake.writes.push(...pending);
    fake.commits++;
  },
}));

const { importContactsToClientes } = await import('./contacts-import');

const OWNER = 'loja-1';

beforeEach(() => {
  fake.customers.clear();
  fake.writes.length = 0;
  fake.commits = 0;
  fake.preloadError = null;
  fake.transactionCreations = 0;
  fake.occupyBeforeTransaction = null;
});

describe('importContactsToClientes', () => {
  it('aborta antes de criar transacao quando nao consegue conferir a base', async () => {
    fake.preloadError = new Error('permission-denied');

    await expect(importContactsToClientes({}, OWNER, [
      { nome: 'Nova', celular: '16999998888' },
    ])).rejects.toThrow('Nenhum contato foi importado');

    expect(fake.transactionCreations).toBe(0);
    expect(fake.writes).toEqual([]);
  });

  it('reconhece cliente legado pelo telefone e nao sobrescreve seus dados', async () => {
    fake.customers.set('id-legado', {
      ownerId: OWNER,
      celular: '+55 (16) 99999-8888',
      creditBalance: 91,
      totalPedidos: 12,
      archived: false,
    });

    const result = await importContactsToClientes({}, OWNER, [
      { nome: 'Nome do CSV', celular: '16999998888' },
    ]);

    expect(result).toMatchObject({ imported: 0, skipped: 1 });
    expect(result.skippedByReason.existing).toBe(1);
    expect(fake.transactionCreations).toBe(0);
    expect(fake.writes).toEqual([]);
  });

  it('relata duplicado, arquivado, colisao e repeticao no proprio CSV', async () => {
    fake.customers.set('duplicado-a', { ownerId: OWNER, celular: '16911112222' });
    fake.customers.set('duplicado-b', { ownerId: OWNER, celular: '(16) 91111-2222' });
    fake.customers.set('arquivado', { ownerId: OWNER, celular: '16922223333', archived: true });
    fake.customers.set(`${OWNER}_16933334444`, { ownerId: OWNER, celular: '16955556666' });

    const result = await importContactsToClientes({}, OWNER, [
      { nome: 'Duplicado', celular: '16911112222' },
      { nome: 'Arquivado', celular: '16922223333' },
      { nome: 'Colisao', celular: '16933334444' },
      { nome: 'Nova', celular: '16944445555' },
      { nome: 'Repetida no CSV', celular: '(16) 94444-5555' },
    ]);

    expect(result.skippedByReason).toMatchObject({
      duplicate: 1,
      archived: 1,
      collision: 1,
      duplicateCsv: 1,
    });
    expect(result).toMatchObject({ imported: 1, skipped: 4 });
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({
      id: `${OWNER}_16944445555`,
      data: { nome: 'Nova', celular: '16944445555', totalPedidos: 0 },
    });
  });

  it('nao sobrescreve id criado concorrentemente depois do preload', async () => {
    const id = `${OWNER}_16988887777`;
    fake.occupyBeforeTransaction = {
      id,
      data: { ownerId: OWNER, celular: '16911112222', creditBalance: 70 },
    };

    await expect(importContactsToClientes({}, OWNER, [
      { nome: 'Nova', celular: '16988887777' },
    ])).rejects.toThrow('foi ocupado durante a importacao');

    expect(fake.writes).toEqual([]);
    expect(fake.customers.get(id)).toMatchObject({ celular: '16911112222', creditBalance: 70 });
  });
});
