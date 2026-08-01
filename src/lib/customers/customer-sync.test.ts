import { beforeEach, describe, expect, it, vi } from 'vitest';

type Stored = Record<string, any>;
type Ref = { col: string; id: string };

const fake = vi.hoisted(() => ({
  collections: new Map<string, Map<string, Stored>>(),
  queriedFields: [] as string[],
}));

const bucket = (name: string) => {
  let current = fake.collections.get(name);
  if (!current) {
    current = new Map();
    fake.collections.set(name, current);
  }
  return current;
};

const snapshot = (ref: Ref) => {
  const value = bucket(ref.col).get(ref.id);
  return {
    id: ref.id,
    exists: () => value !== undefined,
    data: () => value === undefined ? undefined : { ...value },
  };
};

vi.mock('firebase/firestore', () => ({
  Firestore: class {},
  collection: (_db: any, name: string) => ({ col: name }),
  doc: (_db: any, col: string, id: string): Ref => ({ col, id }),
  where: (field: string, op: string, value: any) => {
    fake.queriedFields.push(field);
    return { field, op, value };
  },
  query: (collectionRef: { col: string }, ...constraints: any[]) => ({ col: collectionRef.col, constraints }),
  getDoc: async (ref: Ref) => snapshot(ref),
  getDocs: async (queryRef: { col: string; constraints: any[] }) => {
    const docs = [...bucket(queryRef.col).entries()]
      .filter(([, data]) => queryRef.constraints.every(({ field, op, value }) => {
        if (op === '==') return data[field] === value;
        if (op === 'in') return Array.isArray(value) && value.includes(data[field]);
        throw new Error(`operador não suportado no fake: ${op}`);
      }))
      .map(([id]) => snapshot({ col: queryRef.col, id }));
    return { docs, empty: docs.length === 0 };
  },
  setDoc: async (ref: Ref, data: Stored, options?: { merge?: boolean }) => {
    const old = bucket(ref.col).get(ref.id);
    bucket(ref.col).set(ref.id, options?.merge && old ? { ...old, ...data } : { ...data });
  },
  runTransaction: async (_db: any, body: (tx: any) => Promise<any>) => body({
    get: async (ref: Ref) => snapshot(ref),
    set: (ref: Ref, data: Stored, options?: { merge?: boolean }) => {
      const old = bucket(ref.col).get(ref.id);
      bucket(ref.col).set(ref.id, options?.merge && old ? { ...old, ...data } : { ...data });
    },
    update: (ref: Ref, data: Stored) => {
      const old = bucket(ref.col).get(ref.id);
      if (!old) throw new Error(`documento inexistente: ${ref.col}/${ref.id}`);
      bucket(ref.col).set(ref.id, { ...old, ...data });
    },
  }),
}));

const {
  proposedCustomerId,
  syncCustomerFromOrder,
  unidentifiedCustomerDocId,
} = await import('./customer-sync');

const db = {} as any;
const OWNER = 'loja-1';

const seed = (col: string, id: string, data: Stored) => bucket(col).set(id, { ...data });
const read = (col: string, id: string) => bucket(col).get(id);

beforeEach(() => {
  fake.collections.clear();
  fake.queriedFields.length = 0;
});

describe('clienteId explícito', () => {
  it('tem precedência sobre telefone e é gravado no pedido', async () => {
    seed('clientes', 'escolhido', { ownerId: OWNER, nome: 'Nome antigo', celular: '16911112222' });
    seed('clientes', 'pelo-telefone', { ownerId: OWNER, nome: 'Outra pessoa', celular: '16999998888' });
    seed('orders', 'o1', { ownerId: OWNER, totalAmount: 25 });

    const result = await syncCustomerFromOrder(db, {
      id: 'o1',
      clienteId: 'escolhido',
      customerName: 'Ana corrigida',
      customerPhone: '(16) 99999-8888',
    }, { ownerId: OWNER, countOrder: false });

    expect(result.customerId).toBe('escolhido');
    expect(read('orders', 'o1')?.clienteId).toBe('escolhido');
    // O pedido pode ser antigo: o id permanece, mas ele não restaura no
    // cadastro o telefone velho depois de uma troca de número.
    expect(read('clientes', 'escolhido')).toMatchObject({ nome: 'Ana corrigida', celular: '16911112222' });
    expect(read('clientes', 'pelo-telefone')?.nome).toBe('Outra pessoa');
  });
});

describe('fallback por telefone', () => {
  it('resolve formatos diferentes quando existe exatamente um cadastro ativo', async () => {
    seed('clientes', 'legacy', { ownerId: OWNER, celular: '+55 16 99999-8888' });
    const result = await syncCustomerFromOrder(db, {
      id: 'o2', customerName: 'Ana', customerPhone: '16999998888',
    }, { ownerId: OWNER, countOrder: false, linkCollection: null });
    expect(result.customerId).toBe('legacy');
  });

  it('não escolhe o primeiro quando há telefone duplicado', async () => {
    seed('clientes', 'c1', { ownerId: OWNER, celular: '16999998888' });
    seed('clientes', 'c2', { ownerId: OWNER, celular: '(16) 99999-8888' });
    seed('orders', 'o3', { ownerId: OWNER });

    const result = await syncCustomerFromOrder(db, {
      id: 'o3', customerName: 'Ana', customerPhone: '+55 16 99999-8888',
    }, { ownerId: OWNER, countOrder: false });

    expect(result).toMatchObject({ customerId: null, ambiguous: true });
    expect(read('orders', 'o3')?.clienteId).toBeUndefined();
  });

  it('modo sem escrita devolve o id proposto e não cria cadastro', async () => {
    const result = await syncCustomerFromOrder(db, {
      id: 'publico-1', customerName: 'Nova', customerPhone: '(16) 98888-7777',
    }, { ownerId: OWNER, countOrder: false, writeCustomer: false, linkCollection: null });

    expect(result).toMatchObject({ customerId: `${OWNER}_16988887777`, created: false });
    expect(read('clientes', `${OWNER}_16988887777`)).toBeUndefined();
  });

  it('cadastro arquivado no id determinístico vira conflito e não é reativado', async () => {
    const id = `${OWNER}_16988887777`;
    seed('clientes', id, { ownerId: OWNER, celular: '16988887777', archived: true, creditBalance: 42 });
    const result = await syncCustomerFromOrder(db, {
      id: 'o4', customerName: 'Arquivada', customerPhone: '16988887777',
    }, { ownerId: OWNER, countOrder: false, linkCollection: null });

    expect(result).toMatchObject({ customerId: null, ambiguous: true });
    expect(read('clientes', id)).toMatchObject({ archived: true, creditBalance: 42 });
  });

  it('cadastro arquivado com id legado também impede criar um duplicado ativo', async () => {
    seed('clientes', 'id-legado-aleatorio', {
      ownerId: OWNER,
      celular: '(16) 98888-7777',
      archived: true,
      creditBalance: 18,
    });
    const proposed = `${OWNER}_16988887777`;
    const result = await syncCustomerFromOrder(db, {
      id: 'o-legado', customerName: 'Arquivada', customerPhone: '16988887777',
    }, { ownerId: OWNER, countOrder: false, linkCollection: null });

    expect(result).toMatchObject({ customerId: null, ambiguous: true });
    expect(read('clientes', proposed)).toBeUndefined();
    expect(read('clientes', 'id-legado-aleatorio')?.archived).toBe(true);
  });

  it('não vincula nem atualiza cadastro travado por uma unificação', async () => {
    seed('clientes', 'em-unificacao', {
      ownerId: OWNER,
      celular: '16988887777',
      mergeInProgress: { targetCustomerId: 'destino' },
    });
    const result = await syncCustomerFromOrder(db, {
      id: 'durante-merge', customerName: 'Cliente', customerPhone: '16988887777',
    }, { ownerId: OWNER, countOrder: false, linkCollection: null });

    expect(result).toMatchObject({ customerId: null, ambiguous: true });
    expect(read('clientes', 'em-unificacao')?.nome).toBeUndefined();
  });
});

describe('cliente sem telefone', () => {
  it('nunca consulta por nome e marca a identidade como não identificada', async () => {
    seed('orders', 'sem-fone-1', { ownerId: OWNER });
    const result = await syncCustomerFromOrder(db, {
      id: 'sem-fone-1', customerName: 'Maria Silva', customerPhone: '',
    }, { ownerId: OWNER, countOrder: false });

    const expectedId = unidentifiedCustomerDocId(OWNER, 'Maria Silva', 'sem-fone-1');
    expect(result.customerId).toBe(expectedId);
    expect(read('clientes', expectedId)).toMatchObject({ nome: 'Maria Silva', naoIdentificado: true });
    expect(fake.queriedFields).not.toContain('nome');
  });

  it('separa homônimos por pedido e repete o mesmo id no retry', async () => {
    const a = proposedCustomerId(OWNER, { id: 'pedido-a', customerName: 'João', customerPhone: '' });
    const b = proposedCustomerId(OWNER, { id: 'pedido-b', customerName: 'João', customerPhone: '' });
    const retry = proposedCustomerId(OWNER, { id: 'pedido-a', customerName: 'João', customerPhone: '' });
    expect(a).not.toBe(b);
    expect(retry).toBe(a);
  });

  it('venda anônima não inventa cliente', async () => {
    const result = await syncCustomerFromOrder(db, {
      id: 'anon', customerName: 'Cliente Balcão', customerPhone: '',
    }, { ownerId: OWNER, countOrder: false });
    expect(result.customerId).toBeNull();
    expect(bucket('clientes').size).toBe(0);
  });
});

describe('vínculo e contagem', () => {
  it('liga e contabiliza o pedido uma única vez', async () => {
    seed('orders', 'venda-1', { ownerId: OWNER, totalAmount: 30 });
    const order = { id: 'venda-1', customerName: 'Bia', customerPhone: '16977776666', totalAmount: 30 };

    const first = await syncCustomerFromOrder(db, order, { ownerId: OWNER, countOrder: true });
    const second = await syncCustomerFromOrder(db, order, { ownerId: OWNER, countOrder: true });
    const id = `${OWNER}_16977776666`;

    expect(first.counted).toBe(true);
    expect(second.counted).toBe(false);
    expect(read('orders', 'venda-1')).toMatchObject({ clienteId: id, customerCounted: true });
    expect(read('clientes', id)).toMatchObject({ totalPedidos: 1, ticketMedio: 30 });
  });

  it('vincula encomenda sem aplicar a contagem de pedidos', async () => {
    seed('encomendas', 'e1', { ownerId: OWNER, total: 100 });
    const result = await syncCustomerFromOrder(db, {
      id: 'e1', customerName: 'Cris', customerPhone: '16966665555', totalAmount: 100,
    }, { ownerId: OWNER, countOrder: true, linkCollection: 'encomendas' });
    const id = `${OWNER}_16966665555`;
    expect(result.counted).toBe(false);
    expect(read('encomendas', 'e1')?.clienteId).toBe(id);
    // Ausência equivale a zero nas leituras. Não gravamos defaults financeiros
    // fora da transação para não zerar saldo/métricas numa criação concorrente.
    expect(read('clientes', id)?.totalPedidos).toBeUndefined();
  });
});
