'use client';

import { useEffect, useState } from 'react';
import { consultarSenhaDeCancelamento } from '@/lib/vendas/senha-cancelamento-client';

/**
 * A loja tem senha de cancelamento? `null` enquanto pergunta ao servidor (o
 * botão de confirmar espera) e também se a consulta falhar: sem saber, o modal
 * não deixa cancelar — melhor tentar de novo do que pular a senha.
 */
export function useSenhaDeCancelamento(ativo: boolean, user: { getIdToken: () => Promise<string> } | null | undefined) {
  const [configurada, setConfigurada] = useState<boolean | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    if (!ativo || !user) return;
    let vivo = true;
    setConfigurada(null);
    setFalhou(false);
    consultarSenhaDeCancelamento(user)
      .then((r) => {
        if (!vivo) return;
        if (r.mensagem) setFalhou(true);
        else setConfigurada(r.configured);
      })
      .catch(() => { if (vivo) setFalhou(true); });
    return () => { vivo = false; };
  }, [ativo, user]);

  return { configurada, falhou };
}
