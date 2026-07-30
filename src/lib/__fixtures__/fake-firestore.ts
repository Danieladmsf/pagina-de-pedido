/**
 * Firestore de mentira, em memória — para testar o que MOVE estoque de verdade.
 *
 * Os testes puros cobrem as regras de cálculo, mas `reconcileOrderStock` e
 * `applyStockChange` só existem dentro de uma TRANSAÇÃO: ler, conferir, gravar
 * tudo junto ou nada. Era justamente essa parte que ficava sem prova.
 *
 * O que este fake reproduz do Firestore de verdade:
 *  - transação com escrita adiada: nada é aplicado até o commit;
 *  - controle otimista por versão: se alguém escreveu num documento que a
 *    transação leu, ela é REEXECUTADA do zero (é assim que o Firestore evita
 *    vender a última unidade duas vezes);
 *  - erro dentro da transação = nada gravado.
 *
 * O gancho `setCommitHook` permite intercalar uma segunda operação entre a
 * leitura e o commit da primeira, que é como se simula concorrência real num
 * ambiente de uma thread só.
 */

interface StoredDoc {
  data: Record<string, any>;
  version: number;
}

const store = new Map<string, Map<string, StoredDoc>>();
let autoId = 0;
let commitHook: (() => Promise<void>) | null = null;
/** Quantas vezes cada transação precisou ser reexecutada (prova do retry). */
export let transactionAttempts = 0;

function coll(name: string): Map<string, StoredDoc> {
  if (!store.has(name)) store.set(name, new Map());
  return store.get(name)!;
}

export function resetDb(): void {
  store.clear();
  autoId = 0;
  commitHook = null;
  transactionAttempts = 0;
}

/** Semeia um documento direto, sem passar pelas regras (é o "estado inicial"). */
export function seed(collection: string, id: string, data: Record<string, any>): void {
  coll(collection).set(id, { data: { ...data }, version: 1 });
}

export function read(collection: string, id: string): Record<string, any> | undefined {
  const found = coll(collection).get(id);
  return found ? { ...found.data } : undefined;
}

export function readAll(collection: string): Array<Record<string, any>> {
  return [...coll(collection).values()].map((d) => ({ ...d.data }));
}

/** Roda uma vez, entre a leitura e o commit da próxima transação. */
export function setCommitHook(fn: (() => Promise<void>) | null): void {
  commitHook = fn;
}

interface FakeRef {
  __col: string;
  __id: string;
}

function isRef(value: any): value is FakeRef {
  return !!value && typeof value.__col === 'string' && typeof value.__id === 'string';
}

/** O objeto que o teste passa como `db`. O fake ignora o conteúdo. */
export const fakeDb = { __fake: true } as any;

export function firestoreMock() {
  return {
    // Tipos usados só em posição de tipo, mas o bundler mantém o import.
    Firestore: class {},
    DocumentReference: class {},

    collection: (_db: any, name: string) => ({ __col: name, __id: '' }),

    doc: (parent: any, ...path: string[]) => {
      // doc(collectionRef) -> id automático
      if (path.length === 0 && parent?.__col) {
        return { __col: parent.__col, __id: `auto-${++autoId}` };
      }
      // doc(db, 'menuItems', 'abc')
      const [collectionName, id] = path;
      return { __col: collectionName, __id: id };
    },

    serverTimestamp: () => '__serverTimestamp__',

    setDoc: async (ref: FakeRef, data: Record<string, any>, opts?: { merge?: boolean }) => {
      const current = coll(ref.__col).get(ref.__id);
      const next = opts?.merge && current ? { ...current.data, ...data } : { ...data };
      coll(ref.__col).set(ref.__id, { data: next, version: (current?.version ?? 0) + 1 });
    },

    updateDoc: async (ref: FakeRef, data: Record<string, any>) => {
      const current = coll(ref.__col).get(ref.__id);
      if (!current) throw new Error(`updateDoc em documento inexistente: ${ref.__col}/${ref.__id}`);
      coll(ref.__col).set(ref.__id, { data: { ...current.data, ...data }, version: current.version + 1 });
    },

    runTransaction: async (_db: any, body: (tx: any) => Promise<any>) => {
      const MAX = 5;
      for (let attempt = 1; attempt <= MAX; attempt++) {
        transactionAttempts += 1;
        const reads: Array<{ col: string; id: string; version: number }> = [];
        const pending: Array<() => void> = [];

        const tx = {
          get: async (ref: FakeRef) => {
            if (!isRef(ref)) throw new Error('tx.get recebeu algo que não é referência');
            const found = coll(ref.__col).get(ref.__id);
            reads.push({ col: ref.__col, id: ref.__id, version: found?.version ?? -1 });
            return {
              exists: () => !!found,
              data: () => (found ? { ...found.data } : undefined),
              id: ref.__id,
            };
          },
          set: (ref: FakeRef, data: Record<string, any>, opts?: { merge?: boolean }) => {
            pending.push(() => {
              const current = coll(ref.__col).get(ref.__id);
              const next = opts?.merge && current ? { ...current.data, ...data } : { ...data };
              coll(ref.__col).set(ref.__id, { data: next, version: (current?.version ?? 0) + 1 });
            });
          },
          update: (ref: FakeRef, data: Record<string, any>) => {
            pending.push(() => {
              const current = coll(ref.__col).get(ref.__id);
              if (!current) throw new Error(`update em documento inexistente: ${ref.__col}/${ref.__id}`);
              coll(ref.__col).set(ref.__id, { data: { ...current.data, ...data }, version: current.version + 1 });
            });
          },
        };

        // Erro dentro do corpo aborta a transação: nada de `pending` é aplicado.
        const result = await body(tx);

        if (commitHook) {
          const hook = commitHook;
          commitHook = null;
          await hook();
        }

        const conflict = reads.some((r) => (coll(r.col).get(r.id)?.version ?? -1) !== r.version);
        if (conflict) continue; // outra escrita chegou primeiro: refaz tudo

        pending.forEach((apply) => apply());
        return result;
      }
      throw new Error('transação abortada: conflito demais');
    },
  };
}
