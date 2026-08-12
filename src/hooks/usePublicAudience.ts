'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteDoc, doc, limit, onSnapshot, query, where } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import {
  ONLINE_TTL_MS,
  classificarSessoes,
  paraMillis,
  type SessaoPresenca,
} from '@/lib/audience';

export interface PublicAudience {
  /** Clientes com o cardápio aberto agora. */
  online: number;
  /** Visitas ao cardápio desde a abertura do caixa (null = ainda carregando ou caixa fechado). */
  visitasNaSessao: number | null;
  /** Quando a sessão de caixa começou. */
  sessaoDesde: Date | null;
  /** Leitura negada (operador sem acesso) — a tela esconde o contador em vez de gritar. */
  semAcesso: boolean;
}

/**
 * Audiência do cardápio público, numa fonte só (a aba Delivery e o badge
 * flutuante liam/contavam por conta própria).
 *
 * O ponto delicado é o "online": `onSnapshot` só dispara quando ALGUM documento
 * muda. Quando o último cliente fecha a aba sem avisar, nenhum evento novo
 * chega e o número congela no valor antigo — a tela dizia "2 clientes online"
 * com a loja vazia. Por isso o corte por tempo é reavaliado por um relógio
 * local, não só na chegada do snapshot.
 */
export function usePublicAudience(ownerId: string | null | undefined, caixaAbertoEm?: Date | null): PublicAudience {
  const db = useFirestore();
  const [sessoes, setSessoes] = useState<SessaoPresenca[]>([]);
  const [visitas, setVisitas] = useState<number | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  const apagadas = useRef<Set<string>>(new Set());

  // Relógio local: faz o contador cair sozinho quando os pings param de chegar.
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), ONLINE_TTL_MS / 3);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!db || !ownerId) return;
    const q = query(collection(db, 'active_sessions'), where('storeId', '==', ownerId));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setSessoes(snap.docs.map((d) => ({ id: d.id, lastActive: d.data().lastActive })));
        setAgora(Date.now());
      },
      () => setSemAcesso(true)
    );
    return () => unsubscribe();
  }, [db, ownerId]);

  const { online, fantasmas } = useMemo(() => classificarSessoes(sessoes, agora), [sessoes, agora]);

  // Faxina oportunista: a aba fechada no celular não dispara `beforeunload`, e o
  // doc de presença ficava no banco para sempre — eram 2.954 sessões mortas, a
  // mais antiga de maio, todas lidas a cada abertura do painel. Quem está com o
  // painel aberto apaga o que encontra, em doses pequenas.
  useEffect(() => {
    if (!db || fantasmas.length === 0) return;
    for (const id of fantasmas) {
      if (apagadas.current.has(id)) continue;
      apagadas.current.add(id);
      deleteDoc(doc(db, 'active_sessions', id)).catch(() => {
        apagadas.current.delete(id);
      });
    }
  }, [db, fantasmas]);

  // Visitas da sessão de caixa. Sem caixa aberto não há sessão para contar.
  useEffect(() => {
    if (!db || !ownerId || !caixaAbertoEm) {
      setVisitas(null);
      return;
    }
    const q = query(
      collection(db, 'store_visits'),
      where('storeId', '==', ownerId),
      where('at', '>=', caixaAbertoEm),
      limit(5000)
    );
    const unsubscribe = onSnapshot(
      q,
      (snap) => setVisitas(snap.size),
      () => setSemAcesso(true)
    );
    return () => unsubscribe();
  }, [db, ownerId, caixaAbertoEm?.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    online: online.length,
    visitasNaSessao: visitas,
    sessaoDesde: caixaAbertoEm ?? null,
    semAcesso,
  };
}

export { paraMillis };
