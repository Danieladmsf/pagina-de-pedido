'use client';

import React, { useEffect, useRef, useState } from 'react';
import { collection, doc, query, updateDoc, where } from 'firebase/firestore';
import { useFirestore, useUser, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { usePdvAccess } from '@/contexts/PdvAccessContext';
import { useToast } from '@/hooks/use-toast';
import { printOrderReceipt } from '@/lib/order-receipt-html';
import { warmupQz } from '@/lib/qz-print';
import { claimAutoPrint, resolvePrintMode } from '@/lib/receipt-print';
import { playNewOrderBeep, playOrderSound6s } from '@/lib/order-sound';
import { can } from '@/lib/pdv-permissions';
import { syncCustomerFromOrder } from '@/lib/customers/customer-sync';

/**
 * Vigia de PEDIDOS NOVOS montado no layout do route-group (sistema) — portanto
 * roda IGUAL na Frente de Caixa (/pdv) e na Retaguarda (/gestao). Como o layout
 * NÃO remonta ao trocar de rota, o alerta sobrevive à navegação entre as duas.
 *
 * Motivo: antes, todo o alerta (som + impressão automática + aviso do navegador)
 * vivia só dentro da tela do PDV. Ao abrir a Retaguarda, a tela do PDV desmontava
 * e o vigia parava — pedido chegava e NÃO tocava nem imprimia. Subindo o vigia
 * pra cá, o alerta acontece em qualquer tela aberta.
 *
 * Escopo: SÓ o alerta imediato do pedido que acabou de entrar (tocar / imprimir /
 * avisar). A reconciliação persistente da identidade também mora aqui; baixa de
 * estoque, confete e WhatsApp seguem no PDV como subsistemas separados.
 */
export function OrderAlertsWatcher() {
  const db = useFirestore();
  const { user } = useUser();
  const { role, ownerId, operatorPermissions } = usePdvAccess();
  const { toast } = useToast();

  const isRealUser = !!(user && !user.isAnonymous);

  // Mesmo recorte de leitura de pedidos do PDV: evita 'permission-denied' quando
  // o operador não tem nenhuma aba operacional liberada.
  const canReadOperationalOrders = role === 'owner' || (!!operatorPermissions && (
    can(operatorPermissions.pdv, 'tabs.delivery')
    || can(operatorPermissions.pdv, 'tabs.novo_pedido')
    || can(operatorPermissions.pdv, 'tabs.mesas')
  ));
  const canReadEncomendas = role === 'owner'
    || (!!operatorPermissions && can(operatorPermissions.pdv, 'tabs.encomendas_pedidos'));

  // Esquenta a conexão com o QZ Tray uma vez por sessão, aqui no layout, pra já
  // estar pronto mesmo que a 1ª tela aberta seja a Retaguarda. Se o QZ não estiver
  // no PC, isto não faz nada — a impressão automática simplesmente não ocorre.
  useEffect(() => { warmupQz(); }, []);

  // Permissão de notificação do navegador (idempotente), independente de rota.
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const storeProfileRef = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return doc(db, 'store_profiles', ownerId);
  }, [db, isRealUser, ownerId]);
  const { data: storeProfile } = useDoc(storeProfileRef);

  const ordersQuery = useMemoFirebase(() => {
    if (!db || !isRealUser || !canReadOperationalOrders) return null;
    return query(collection(db, 'orders'), where('ownerId', '==', ownerId));
  }, [canReadOperationalOrders, db, isRealUser, ownerId]);
  const { data: ordersRaw } = useCollection(ordersQuery);

  // Encomendas ficam em coleção própria (confeitaria). Espelha o alerta.
  const encomendasQuery = useMemoFirebase(() => {
    if (!db || !isRealUser || !canReadEncomendas || (storeProfile as any)?.theme !== 'confeitaria') return null;
    return query(collection(db, 'encomendas'), where('ownerId', '==', ownerId));
  }, [canReadEncomendas, db, isRealUser, ownerId, storeProfile]);
  const { data: encomendasRaw } = useCollection(encomendasQuery);

  const seenOrderIdsRef = useRef<Set<string> | null>(null);
  const seenEncomendaIdsRef = useRef<Set<string> | null>(null);
  const identityInFlightRef = useRef<Set<string>>(new Set());
  const identityDoneRef = useRef<Set<string>>(new Set());
  const [identityRetryTick, setIdentityRetryTick] = useState(0);

  useEffect(() => {
    if (role !== 'owner') return;
    const timer = window.setInterval(() => setIdentityRetryTick((value) => value + 1), 2 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [role]);

  // Pedidos públicos e lançamentos de operador não podem escrever em
  // `clientes`. Eles deixam uma marca persistente para o dono reconciliar aqui,
  // inclusive na primeira carga e em qualquer tela do sistema. Em pedidos a
  // marca permanece até entrega/cancelamento, para a métrica ser contabilizada
  // mesmo quando a finalização aconteceu enquanto o dono estava offline.
  useEffect(() => {
    if (!db || !user || role !== 'owner' || user.uid !== ownerId) return;

    const candidates = [
      ...((ordersRaw || []) as any[]).map((record) => ({ collectionName: 'orders', record })),
      ...((encomendasRaw || []) as any[]).map((record) => ({ collectionName: 'encomendas', record })),
    ].filter(({ record }) => record?.id && record.customerIdentityPending === true);

    for (const { collectionName, record } of candidates) {
      const runId = `${collectionName}/${record.id}`;
      const signature = [
        runId,
        record.status || '',
        record.clienteId || '',
        record.customerPhone || '',
        record.customerName || '',
        record.customerCounted === true ? 'counted' : 'uncounted',
      ].join('|');
      if (identityInFlightRef.current.has(runId) || identityDoneRef.current.has(signature)) continue;
      identityInFlightRef.current.add(runId);

      void (async () => {
        try {
          const isOrder = collectionName === 'orders';
          const delivered = isOrder && record.status === 'delivered';
          const canceled = isOrder && ['canceled', 'cancelled'].includes(record.status);
          const result = await syncCustomerFromOrder(db, record, {
            ownerId,
            countOrder: delivered,
            linkCollection: collectionName as 'orders' | 'encomendas',
            allowArchivedCustomer: false,
          });

          // Encomenda não entra em totalPedidos. Pedido continua marcado enquanto
          // está aberto, para ser contabilizado quando chegar a `delivered`.
          if (result.ambiguous) {
            // Continua pendente: depois de o dono corrigir/unificar os cadastros,
            // a tentativa periódica consegue vincular e contabilizar sem backfill.
            await updateDoc(doc(db, collectionName, record.id), {
              customerIdentityPending: true,
              customerIdentityConflict: true,
            });
            return;
          }
          if (!isOrder || delivered || canceled || !result.customerId) {
            await updateDoc(doc(db, collectionName, record.id), {
              customerIdentityPending: false,
              customerIdentityConflict: false,
            });
          } else if (record.customerIdentityConflict === true) {
            await updateDoc(doc(db, collectionName, record.id), {
              customerIdentityConflict: false,
            });
          }
          identityDoneRef.current.add(signature);
        } catch (error) {
          // A marca permanece verdadeira: nova alteração ou próxima sessão tenta
          // novamente sem perder o pedido criado offline.
          console.warn(`[customer-identity] falha ao reconciliar ${runId}:`, error);
        } finally {
          identityInFlightRef.current.delete(runId);
        }
      })();
    }
  }, [db, encomendasRaw, identityRetryTick, ordersRaw, ownerId, role, user]);

  // ── Alerta de PEDIDO NOVO (delivery/retirada online) ──
  useEffect(() => {
    if (!ordersRaw || !db || !user) return;
    const currentIds = new Set((ordersRaw as any[]).map((o) => o.id));
    if (seenOrderIdsRef.current === null) {
      seenOrderIdsRef.current = currentIds; // 1ª carga: não apita os já existentes
      return;
    }

    // Só pendentes que vieram do cardápio (source !== 'pdv'): pedido criado no PDV
    // já imprime o ticket localmente, não reimprimir aqui.
    const pendingNewOnes = (ordersRaw as any[]).filter(
      (o) => !seenOrderIdsRef.current!.has(o.id) && o.status === 'pending' && o.source !== 'pdv',
    );

    if (pendingNewOnes.length > 0) {
      const printMode = resolvePrintMode(storeProfile);
      if (printMode === 'manual') {
        playNewOrderBeep();
      } else if (printMode === 'auto_sound') {
        playOrderSound6s();
      }
      toast({ title: 'Novo pedido recebido!', description: `${pendingNewOnes.length} pedido(s) aguardando confirmação.` });
      try {
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          new Notification('Novo pedido!', { body: `${pendingNewOnes.length} pedido(s) aguardando confirmação.` });
        }
      } catch { /* navegador sem suporte / sem permissão */ }

      // ── Impressão Automática (INTELIGENTE) ──
      // Só imprime automaticamente onde há impressão silenciosa de verdade (QZ Tray
      // nesta máquina). Sem QZ, o fallback é no-op: um PC de monitoramento sem
      // impressora NÃO abre o modal do navegador a cada pedido.
      //
      // A reserva (claimAutoPrint) é o que impede o cupom dobrado quando o PDV e
      // a Retaguarda estão abertos em duas abas do mesmo PC: este watcher vive no
      // layout compartilhado, então as duas abas veem o mesmo pedido chegar.
      if (typeof window !== 'undefined' && printMode !== 'manual') {
        pendingNewOnes.forEach((ord: any, index: number) => {
          setTimeout(async () => {
            if (!(await claimAutoPrint(ord.id))) {
              console.info('[QZ] pedido já reservado por outra aba desta máquina → não reimprime');
              return;
            }
            printOrderReceipt({
              order: ord,
              storeInfo: storeProfile,
              fallback: () => console.info('[QZ] sem impressão silenciosa nesta máquina → pedido NÃO impresso automaticamente (sem modal). Use os botões manuais se precisar.'),
            });
          }, index * 2000);
        });
      }
    }

    seenOrderIdsRef.current = currentIds;
  }, [ordersRaw, toast, db, user, storeProfile]);

  // ── Alerta de NOVA ENCOMENDA (confeitaria) ──
  // Detecção por id não-visto: trocar o status (mesmo id) NÃO re-alerta. Sem
  // impressão automática (encomenda é sob medida; o lojista imprime pelo card).
  useEffect(() => {
    if (!encomendasRaw || !db || !user) return;
    const currentIds = new Set((encomendasRaw as any[]).map((e) => e.id));
    if (seenEncomendaIdsRef.current === null) {
      seenEncomendaIdsRef.current = currentIds;
      return;
    }
    const newOnes = (encomendasRaw as any[]).filter((e) => !seenEncomendaIdsRef.current!.has(e.id));
    if (newOnes.length > 0) {
      // Encomenda nunca fica muda: não há impressão como alternativa.
      if (resolvePrintMode(storeProfile) === 'auto_sound') playOrderSound6s(); else playNewOrderBeep();
      toast({ title: 'Nova encomenda recebida!', description: `${newOnes.length} encomenda(s) aguardando confirmação.` });
      try {
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          new Notification('Nova encomenda!', { body: `${newOnes.length} encomenda(s) aguardando confirmação.` });
        }
      } catch { /* navegador sem suporte / sem permissão */ }
    }
    seenEncomendaIdsRef.current = currentIds;
  }, [encomendasRaw, toast, db, user, storeProfile]);

  return null;
}
