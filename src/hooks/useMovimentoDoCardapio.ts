'use client';

import { useEffect, useState } from 'react';
import { collection, limit as limitar, onSnapshot, query, where } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import type { JanelaDoRelatorio } from '@/lib/relatorios/periodo';
import type { VisitaCrua } from '@/lib/audiencia-periodo';

/**
 * As visitas ao cardápio dentro de uma janela de tempo.
 *
 * `store_visits` é append-only e nunca foi lida fora da sessão de caixa — o
 * histórico inteiro estava no banco sem tela nenhuma. A consulta usa os DOIS
 * limites (`at >= inicio` e `at < fim`), o que o índice `storeId + at` já
 * atende; nada de índice novo.
 *
 * O corte do período fica na função pura (`movimentoPorDia`), não aqui: assim a
 * mesma lista serve para o total, para o gráfico e para o melhor dia sem três
 * consultas.
 */
export function useMovimentoDoCardapio(
  ownerId: string | null | undefined,
  janela: JanelaDoRelatorio | null | undefined,
  limite = 5000,
) {
  const db = useFirestore();
  const [visitas, setVisitas] = useState<VisitaCrua[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [semAcesso, setSemAcesso] = useState(false);

  const inicioMs = janela?.inicio?.getTime() ?? null;
  const fimMs = janela?.fim?.getTime() ?? null;

  useEffect(() => {
    if (!db || !ownerId) {
      setVisitas([]);
      setCarregando(false);
      return;
    }
    setCarregando(true);

    const restricoes: any[] = [where('storeId', '==', ownerId)];
    if (inicioMs !== null) restricoes.push(where('at', '>=', new Date(inicioMs)));
    if (fimMs !== null) restricoes.push(where('at', '<', new Date(fimMs)));

    const parar = onSnapshot(
      query(collection(db, 'store_visits'), ...restricoes, limitar(limite)),
      (snap) => {
        setVisitas(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        setCarregando(false);
      },
      (erro) => {
        // Índice ainda subindo não é falta de permissão, e não pode dizer à dona
        // que ela perdeu acesso à própria loja.
        if ((erro as { code?: string })?.code === 'permission-denied') setSemAcesso(true);
        setCarregando(false);
      },
    );
    return () => parar();
  }, [db, ownerId, inicioMs, fimMs, limite]);

  return { visitas, carregando, semAcesso };
}
