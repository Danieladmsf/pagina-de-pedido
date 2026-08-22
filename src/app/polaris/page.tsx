import React from 'react';
import type { Metadata } from 'next';
import { PolarisLanding } from '@/components/landing/PolarisLanding';
import { metadataDaLanding } from '@/lib/landing-seo';

// Endereço antigo da vitrine, mantido para não quebrar links já divulgados. O
// canônico aponta para a raiz, então o buscador conta as duas como uma página
// só. Aqui não há desvio para o PDV: quem abre /polaris quer ver a vitrine.
export const metadata: Metadata = metadataDaLanding('/');

export default function PolarisLandingPage() {
  return <PolarisLanding />;
}
