import React from 'react';
import type { Metadata } from 'next';
import { PolarisLanding } from '@/components/landing/PolarisLanding';
import { RedirecionaParaOPainel } from './RedirecionaParaOPainel';
import { metadataDaLanding } from '@/lib/landing-seo';

// A página inicial é a vitrine do produto — é o endereço que as pessoas digitam
// e o que mais pesa em busca. Quem já tem sessão nesta máquina não a vê: o
// RedirecionaParaOPainel manda para o PDV, como a raiz fazia antes.
//
// As telas do sistema seguem nos endereços de sempre:
//   /pdv    → frente de caixa (Caixa, Delivery, Balcão, Mesa, Encomendas)
//   /gestao → retaguarda (Dashboard, Produtos, Clientes, Campanhas, Perfil...)
export const metadata: Metadata = metadataDaLanding('/');

export default function Home() {
  return (
    <>
      <RedirecionaParaOPainel />
      <PolarisLanding />
    </>
  );
}
