'use client';

import { useEffect, useState } from 'react';
import { collection, limit as limitar, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import { agruparPorPessoa, type Visitante } from '@/lib/visitantes';

/**
 * Quem passou pelo cardápio na sessão de caixa, ao vivo.
 *
 * Ordenado pela última movimentação: no card do placar as fotos mais recentes
 * ficam na frente, e na tela de visitantes a fila é remontada por oportunidade.
 * Fora da sessão de caixa não há o que mostrar — a lista volta vazia.
 */
export function useVisitantesDaLoja(
  ownerId: string | null | undefined,
  desde: Date | null | undefined,
  limite = 200
) {
  const db = useFirestore();
  const [visitantes, setVisitantes] = useState<Visitante[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [semAcesso, setSemAcesso] = useState(false);

  useEffect(() => {
    if (!db || !ownerId || !desde) {
      setVisitantes([]);
      setCarregando(false);
      return;
    }
    setCarregando(true);
    const q = query(
      collection(db, 'store_visitors'),
      where('storeId', '==', ownerId),
      where('ultimaVez', '>=', desde),
      orderBy('ultimaVez', 'desc'),
      limitar(limite)
    );
    const parar = onSnapshot(
      q,
      (snap) => {
        // Um documento por navegador; aqui a unidade passa a ser a PESSOA. Quem
        // abre o link do WhatsApp três vezes vira três documentos (o webview do
        // app perde o storage entre as aberturas) e apareceria três vezes na
        // fila, com a mesma foto repetida no placar.
        setVisitantes(
          agruparPorPessoa(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Visitante)
          )
        );
        setCarregando(false);
      },
      (erro) => {
        // Só falta de permissão vira "sem acesso". Índice ainda subindo (logo
        // depois do deploy) não é problema de permissão e não pode dizer à
        // dona que ela perdeu acesso à própria loja.
        if ((erro as { code?: string })?.code === 'permission-denied') setSemAcesso(true);
        setCarregando(false);
      }
    );
    return () => parar();
  }, [db, ownerId, desde?.getTime(), limite]); // eslint-disable-line react-hooks/exhaustive-deps

  return { visitantes, carregando, semAcesso };
}
