'use client';

import { useEffect, useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { LancamentoCaixa } from '@/hooks/useCaixa';
import { planejarVenda, type PlanoVenda } from '@/lib/vendas/cancelar-venda';

/**
 * Lê o que o cancelamento da venda vai desfazer (caixa e Prazo) enquanto a tela
 * de confirmação está aberta. Só leitura: quem grava é `cancelarVendaCompleta`,
 * que lê de novo na hora de confirmar.
 */
export function usePrevisaoVenda(args: {
  ativo: boolean;
  db: Firestore | null | undefined;
  ownerId: string | null | undefined;
  orderId: string | null | undefined;
  pedido: { id: string; clienteId?: string; customerName?: string } | null;
  lancamentos?: LancamentoCaixa[];
}) {
  const { ativo, db, ownerId, orderId, pedido, lancamentos } = args;
  const [plano, setPlano] = useState<PlanoVenda | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);
  const chaveLancamentos = lancamentos?.map((l) => `${l.id}:${l.canceled ? 1 : 0}`).join(',');

  useEffect(() => {
    if (!ativo || !db || !ownerId) {
      setPlano(null);
      return;
    }
    let vivo = true;
    setCarregando(true);
    setErro(false);
    planejarVenda({ db, ownerId, orderId: orderId ?? null, pedido, lancamentos })
      .then((p) => { if (vivo) setPlano(p); })
      .catch(() => { if (vivo) { setPlano(null); setErro(true); } })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
    // `pedido` e `lancamentos` entram pela chave: o objeto muda a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, db, ownerId, orderId, pedido?.id, pedido?.clienteId, chaveLancamentos]);

  return { plano, carregando, erro };
}
