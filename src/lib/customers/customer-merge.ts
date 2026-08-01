import {
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { creditBalanceFromTransactions } from '@/lib/customer-integrity';

const BATCH_LIMIT = 400;

export type CustomerMergeResult = {
  sources: number;
  transactionsCopied: number;
  referencesUpdated: number;
  finalBalance: number;
};

export const mergedTransactionId = (sourceCustomerId: string, transactionId: string) =>
  `merge_${sourceCustomerId}_${transactionId}`;

/** Todos os documentos novos que podem apontar diretamente para um cliente. */
export const referencesCustomer = (record: any, customerId: string) =>
  String(record?.clienteId || '') === customerId;

export function mergeCustomerMetrics(target: any, source: any) {
  const targetOrders = Math.max(0, Number(target?.totalPedidos) || 0);
  const sourceOrders = Math.max(0, Number(source?.totalPedidos) || 0);
  const totalPedidos = targetOrders + sourceOrders;
  const weightedTickets = targetOrders * (Number(target?.ticketMedio) || 0)
    + sourceOrders * (Number(source?.ticketMedio) || 0);
  return {
    totalPedidos,
    ticketMedio: totalPedidos > 0 ? weightedTickets / totalPedidos : 0,
    totalPontos: (Number(target?.totalPontos) || 0) + (Number(source?.totalPontos) || 0),
  };
}

export function mergedCashReferencePatch(
  sourceCustomerId: string,
  targetCustomerId: string,
  cashData: any,
  sourceTransactionIds: Set<string>,
): Record<string, string> | null {
  const oldCreditTxId = String(cashData?.creditTxId || '').trim();
  if (oldCreditTxId && !sourceTransactionIds.has(oldCreditTxId)) return null;
  return {
    clienteId: targetCustomerId,
    ...(oldCreditTxId ? {
      creditTxId: mergedTransactionId(sourceCustomerId, oldCreditTxId),
    } : {}),
  };
}

async function commitInChunks(
  values: any[],
  makeOperation: (batch: ReturnType<typeof writeBatch>, value: any) => void,
  db: any,
) {
  for (let index = 0; index < values.length; index += BATCH_LIMIT) {
    const batch = writeBatch(db);
    values.slice(index, index + BATCH_LIMIT).forEach((value) => makeOperation(batch, value));
    await batch.commit();
  }
}

/**
 * Unificação conservadora e idempotente.
 *
 * O cadastro de origem não é apagado: fica arquivado e aponta para o destino.
 * O extrato é copiado com ids determinísticos, então repetir uma operação
 * interrompida não duplica lançamentos. Pedidos novos que já guardam clienteId
 * são redirecionados; o texto histórico permanece intacto.
 */
export async function mergeCustomers(
  db: any,
  ownerId: string,
  targetCustomerId: string,
  sourceCustomerIds: string[],
): Promise<CustomerMergeResult> {
  const uniqueSources = Array.from(new Set(sourceCustomerIds))
    .filter((id) => id && id !== targetCustomerId);
  if (!db || !ownerId || !targetCustomerId || uniqueSources.length === 0) {
    throw new Error('Escolha um cadastro principal e ao menos uma origem diferente.');
  }

  const targetRef = doc(db, 'clientes', targetCustomerId);
  const targetSnap = await getDoc(targetRef);
  if (!targetSnap.exists() || targetSnap.data()?.ownerId !== ownerId) {
    throw new Error('O cadastro principal não pertence a esta loja ou não existe.');
  }
  if (targetSnap.data()?.archived === true) {
    throw new Error('Restaure o cadastro principal antes de unificar.');
  }

  // Trava todas as origens antes de copiar qualquer coisa. As rules impedem
  // novos lançamentos e alterações financeiras enquanto a trava existir; uma
  // segunda varredura abaixo recolhe vínculos de pedido que chegaram na janela.
  await runTransaction(db, async (tx) => {
    const liveTarget = await tx.get(targetRef);
    if (!liveTarget.exists() || liveTarget.data()?.ownerId !== ownerId || liveTarget.data()?.archived === true) {
      throw new Error('O cadastro principal mudou ou foi arquivado antes da unificação.');
    }
    const sources = await Promise.all(uniqueSources.map(async (sourceCustomerId) => {
      const sourceRef = doc(db, 'clientes', sourceCustomerId);
      return { sourceCustomerId, sourceRef, sourceSnap: await tx.get(sourceRef) };
    }));
    for (const { sourceCustomerId, sourceRef, sourceSnap } of sources) {
      if (!sourceSnap.exists() || sourceSnap.data()?.ownerId !== ownerId) {
        throw new Error(`O cadastro de origem ${sourceCustomerId} não pertence a esta loja ou não existe.`);
      }
      const sourceData: any = sourceSnap.data() || {};
      if (sourceData.archived === true && sourceData.mergedInto !== targetCustomerId) {
        throw new Error(`O cadastro de origem ${sourceCustomerId} está arquivado e não pode ser unificado.`);
      }
      const lockTarget = String(sourceData.mergeInProgress?.targetCustomerId || '');
      if (lockTarget && lockTarget !== targetCustomerId) {
        throw new Error(`O cadastro de origem ${sourceCustomerId} já está sendo unificado em outro destino.`);
      }
      if (!(sourceData.archived === true && sourceData.mergedInto === targetCustomerId)) {
        tx.update(sourceRef, {
          mergeInProgress: { targetCustomerId, startedAt: serverTimestamp() },
          creditEnabled: false,
        });
      }
    }
  });

  const [ownerOrders, ownerEncomendas, ownerCashTransactions] = await Promise.all([
    getDocs(query(collection(db, 'orders'), where('ownerId', '==', ownerId))),
    getDocs(query(collection(db, 'encomendas'), where('ownerId', '==', ownerId))),
    getDocs(query(collection(db, 'cash_transactions'), where('ownerId', '==', ownerId))),
  ]);
  let transactionsCopied = 0;
  let referencesUpdated = 0;
  let finalBalance = Number(targetSnap.data()?.creditBalance) || 0;

  for (const sourceCustomerId of uniqueSources) {
    const sourceRef = doc(db, 'clientes', sourceCustomerId);
    const sourceSnap = await getDoc(sourceRef);
    if (!sourceSnap.exists() || sourceSnap.data()?.ownerId !== ownerId) {
      throw new Error(`O cadastro de origem ${sourceCustomerId} não pertence a esta loja ou não existe.`);
    }

    const sourceData: any = sourceSnap.data() || {};
    if (sourceData.archived === true && sourceData.mergedInto !== targetCustomerId) {
      throw new Error(`O cadastro de origem ${sourceCustomerId} esta arquivado e nao pode ser unificado.`);
    }

    const transactionSnap = await getDocs(collection(db, 'clientes', sourceCustomerId, 'credit_transactions'));
    const sourceTransactionIds = new Set(transactionSnap.docs.map((transactionDoc) => transactionDoc.id));
    await commitInChunks(transactionSnap.docs, (batch, transactionDoc) => {
      batch.set(
        doc(db, 'clientes', targetCustomerId, 'credit_transactions', mergedTransactionId(sourceCustomerId, transactionDoc.id)),
        {
          ...transactionDoc.data(),
          mergedFromCustomerId: sourceCustomerId,
          mergedFromTransactionId: transactionDoc.id,
        },
        { merge: true },
      );
    }, db);
    transactionsCopied += transactionSnap.size;

    const references = [
      ...ownerOrders.docs
        .filter((orderDoc) => referencesCustomer(orderDoc.data(), sourceCustomerId))
        .map((referenceDoc) => ({ referenceDoc, patch: { clienteId: targetCustomerId } })),
      ...ownerEncomendas.docs
        .filter((orderDoc) => referencesCustomer(orderDoc.data(), sourceCustomerId))
        .map((referenceDoc) => ({ referenceDoc, patch: { clienteId: targetCustomerId } })),
      ...ownerCashTransactions.docs
        .filter((cashDoc) => referencesCustomer(cashDoc.data(), sourceCustomerId))
        .map((referenceDoc) => {
          // Se o Acerto aponta para um lancamento que nao existe na origem,
          // manter o cliente arquivado e mais seguro do que fabricar outro link.
          const patch = mergedCashReferencePatch(
            sourceCustomerId,
            targetCustomerId,
            referenceDoc.data(),
            sourceTransactionIds,
          );
          if (!patch) return null;
          return {
            referenceDoc,
            patch,
          };
        })
        .filter(Boolean),
    ] as Array<{ referenceDoc: any; patch: Record<string, unknown> }>;
    await commitInChunks(references, (batch, reference) => {
      batch.update(reference.referenceDoc.ref, reference.patch);
    }, db);
    referencesUpdated += references.length;
    const alreadyRedirectedPaths = new Set(
      references.map((reference) => String(reference.referenceDoc.ref.path || '')),
    );

    // A identidade pode ter sido resolvida imediatamente antes da trava e o
    // pedido gravado depois da primeira fotografia. Reconsultar antes de
    // arquivar reduz essa janela e mantém a operação repetível.
    const [lateOrders, lateEncomendas, lateCashTransactions] = await Promise.all([
      getDocs(query(collection(db, 'orders'), where('ownerId', '==', ownerId))),
      getDocs(query(collection(db, 'encomendas'), where('ownerId', '==', ownerId))),
      getDocs(query(collection(db, 'cash_transactions'), where('ownerId', '==', ownerId))),
    ]);
    const lateCandidates = [
      ...lateOrders.docs
        .filter((orderDoc) => referencesCustomer(orderDoc.data(), sourceCustomerId))
        .map((referenceDoc) => ({ referenceDoc, patch: { clienteId: targetCustomerId } })),
      ...lateEncomendas.docs
        .filter((orderDoc) => referencesCustomer(orderDoc.data(), sourceCustomerId))
        .map((referenceDoc) => ({ referenceDoc, patch: { clienteId: targetCustomerId } })),
      ...lateCashTransactions.docs
        .filter((cashDoc) => referencesCustomer(cashDoc.data(), sourceCustomerId))
        .map((referenceDoc) => {
          const patch = mergedCashReferencePatch(
            sourceCustomerId,
            targetCustomerId,
            referenceDoc.data(),
            sourceTransactionIds,
          );
          return patch ? { referenceDoc, patch } : null;
        })
        .filter(Boolean),
    ];
    const lateReferences = lateCandidates.reduce<Array<{
      referenceDoc: any;
      patch: Record<string, unknown>;
    }>>((result, reference) => {
      if (reference && !alreadyRedirectedPaths.has(String(reference.referenceDoc.ref.path || ''))) {
        result.push({ referenceDoc: reference.referenceDoc, patch: reference.patch });
      }
      return result;
    }, []);
    await commitInChunks(lateReferences, (batch, reference) => {
      batch.update(reference.referenceDoc.ref, reference.patch);
    }, db);
    referencesUpdated += lateReferences.length;

    const sourceBalance = creditBalanceFromTransactions(
      transactionSnap.docs.map((transactionDoc) => transactionDoc.data()),
    );
    finalBalance = await runTransaction(db, async (tx) => {
      const latestTarget = await tx.get(targetRef);
      const latestSource = await tx.get(sourceRef);
      if (!latestTarget.exists() || latestTarget.data()?.ownerId !== ownerId || latestTarget.data()?.archived === true) {
        throw new Error('O cadastro principal mudou durante a unificação.');
      }
      if (!latestSource.exists() || latestSource.data()?.ownerId !== ownerId) {
        throw new Error(`O cadastro de origem ${sourceCustomerId} mudou durante a unificação.`);
      }

      const targetData: any = latestTarget.data() || {};
      const latestSourceData: any = latestSource.data() || {};
      const mergedFrom = Array.isArray(targetData.mergedFrom) ? targetData.mergedFrom : [];
      const alreadyApplied = mergedFrom.includes(sourceCustomerId);
      const nextBalance = alreadyApplied
        ? Number(targetData.creditBalance) || 0
        : (Number(targetData.creditBalance) || 0) + sourceBalance;

      if (!alreadyApplied) {
        tx.update(targetRef, {
          mergedFrom: arrayUnion(sourceCustomerId),
          ...mergeCustomerMetrics(targetData, latestSourceData),
          creditBalance: nextBalance,
        });
      }
      tx.update(sourceRef, {
        archived: true,
        archivedAt: latestSourceData.archivedAt || serverTimestamp(),
        archiveReason: 'merged',
        mergedInto: targetCustomerId,
        creditEnabled: false,
        mergeInProgress: deleteField(),
      });
      return nextBalance;
    });
  }

  // A leitura final é apenas para a mensagem da interface. O valor foi somado
  // transacionalmente por origem e nunca sobrescreve increments concorrentes.
  const finalTarget = await getDoc(targetRef);
  finalBalance = Number(finalTarget.data()?.creditBalance) || finalBalance;

  return {
    sources: uniqueSources.length,
    transactionsCopied,
    referencesUpdated,
    finalBalance,
  };
}
