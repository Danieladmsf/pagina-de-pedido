'use client';

import React, { useEffect, useRef } from 'react';
import { collection, doc, query, where } from 'firebase/firestore';
import { useFirestore, useUser, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { usePdvAccess } from '@/contexts/PdvAccessContext';
import { useToast } from '@/hooks/use-toast';
import { printOrderReceipt } from '@/lib/order-receipt-html';
import { warmupQz, type PrinterSize } from '@/lib/qz-print';
import { playNewOrderBeep, playOrderSound6s } from '@/lib/order-sound';
import { can } from '@/lib/pdv-permissions';

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
 * avisar). Baixa de estoque, cadastro de cliente, confete e WhatsApp seguem na
 * tela do PDV — são subsistemas à parte e continuam onde estavam.
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
      const isManualPrint = !!((storeProfile as any)?.general?.manualPrint || (storeProfile as any)?.manualPrint);
      // printMode: 'auto_silent' | 'auto_sound' | 'manual'. Deriva do legado
      // manualPrint quando o perfil ainda não tem o campo novo.
      const printMode = (storeProfile as any)?.general?.printMode || (storeProfile as any)?.printMode
        || (isManualPrint ? 'manual' : 'auto_silent');
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
      if (typeof window !== 'undefined' && !isManualPrint) {
        const printerSize = (((storeProfile as any)?.general?.printerSize || (storeProfile as any)?.printerSize) === '58mm' ? '58mm' : '80mm') as PrinterSize;
        pendingNewOnes.forEach((ord: any, index: number) => {
          setTimeout(() => {
            printOrderReceipt({
              order: ord,
              storeInfo: storeProfile,
              printerSize,
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
      const printMode = (storeProfile as any)?.general?.printMode || (storeProfile as any)?.printMode || 'auto_silent';
      if (printMode === 'auto_sound') playOrderSound6s(); else playNewOrderBeep();
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
