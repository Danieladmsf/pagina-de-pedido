import React from 'react';
import type { Metadata } from 'next';

// Tela de senha: título próprio (o padrão era "Cardápio Digital") e fora do
// índice de busca. Existe como layout porque a page é 'use client' e client
// component não pode exportar metadata.
export const metadata: Metadata = {
  title: 'Entrar — Polaris PDV',
  description: 'Acesso ao painel da sua loja no Polaris PDV.',
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
