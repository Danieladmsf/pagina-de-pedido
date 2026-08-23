'use client';

import { useEffect, useState } from 'react';
import { collection, limit as limitar, onSnapshot, query, where } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import type { JanelaDoRelatorio } from '@/lib/relatorios/periodo';
import { vendasNaJanela, type VendaDoRelatorio } from '@/lib/relatorios/venda';

/**
 * As vendas de uma janela de tempo, de TODOS os canais.
 *
 * A consulta filtra só por `ownerId` (índice que já existe) e o corte de data
 * fica em `vendasNaJanela`, no cliente. Motivo: pedido do PDV criado até
 * 29/07/2026 não tem `createdAt`, e pedido nenhum tem os dois campos garantidos
 * — filtrar por data no Firestore descartaria em silêncio metade das vendas de
 * um dia real. `dataDaVenda` já sabe qual campo vale, e cancelada já fica de
 * fora por lá.
 *
 * O teto existe para a tela não puxar a loja inteira: são ~250 pedidos por
 * semana nas lojas medidas, então 3.000 cobre um mês com folga.
 */
export function useVendasDoPeriodo(
  ownerId: string | null | undefined,
  janela: JanelaDoRelatorio | null | undefined,
  limite = 3000,
) {
  const db = useFirestore();
  const [vendas, setVendas] = useState<{ venda: VendaDoRelatorio; data: Date }[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [semAcesso, setSemAcesso] = useState(false);

  const inicioMs = janela?.inicio?.getTime() ?? null;
  const fimMs = janela?.fim?.getTime() ?? null;

  useEffect(() => {
    if (!db || !ownerId || !janela) {
      setVendas([]);
      setCarregando(false);
      return;
    }
    setCarregando(true);

    const parar = onSnapshot(
      query(collection(db, 'orders'), where('ownerId', '==', ownerId), limitar(limite)),
      (snap) => {
        const todas = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        setVendas(vendasNaJanela(todas, janela));
        setCarregando(false);
      },
      (erro) => {
        if ((erro as { code?: string })?.code === 'permission-denied') setSemAcesso(true);
        setCarregando(false);
      },
    );
    return () => parar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, ownerId, inicioMs, fimMs, limite]);

  return { vendas, carregando, semAcesso };
}
