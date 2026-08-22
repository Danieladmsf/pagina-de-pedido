'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/firebase';
import { temSessaoLocal } from '@/lib/sessao-local';

// Na página inicial, quem já trabalha na loja não quer ver a vitrine: vai
// direto para o PDV. Quem chega de fora (buscador, link, cliente novo) fica na
// vitrine.
//
// A decisão é toda no navegador porque a sessão do Firebase mora no aparelho —
// o servidor não tem como saber quem está do outro lado, e é justamente por
// isso que o HTML da vitrine pode sair pronto e ser indexado.
//
// São duas checagens, nesta ordem:
//   1. o marcador local, que responde na hora e evita o pisca-pisca da vitrine;
//   2. o Firebase, para o caso do primeiro acesso nesta máquina (ou de o
//      marcador ter sido limpo), que demora um instante para restaurar.
export function RedirecionaParaOPainel() {
  const auth = useAuth();
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);

  useEffect(() => {
    if (!temSessaoLocal()) return;
    setSaindo(true);
    router.replace('/pdv');
  }, [router]);

  useEffect(() => {
    if (!auth) return;

    let cancelado = false;
    auth
      .authStateReady()
      .then(() => {
        if (cancelado) return;
        const usuario = auth.currentUser;
        if (!usuario || usuario.isAnonymous) return;
        setSaindo(true);
        router.replace('/pdv');
      })
      .catch(() => {
        // sem sessão legível: a vitrine continua na tela, que é o certo
      });

    return () => {
      cancelado = true;
    };
  }, [auth, router]);

  if (!saindo) return null;

  // Cobre a vitrine enquanto a navegação acontece, senão o dono da loja vê a
  // página de vendas por um instante toda vez que abre o sistema.
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#FAFAF7]">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
    </div>
  );
}
