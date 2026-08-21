import React from 'react';
import type { Metadata } from 'next';
import { SistemaGuard } from './SistemaGuard';

// O guard de autenticação continua igual, só que agora dentro de SistemaGuard
// ('use client'). Este layout virou server component por um motivo: client
// component não pode exportar metadata, e as telas de trabalho (PDV,
// Retaguarda, Visitantes) precisam dizer ao buscador para não indexá-las.
export const metadata: Metadata = {
  title: 'Polaris PDV',
  robots: { index: false, follow: false },
};

export default function SistemaLayout({ children }: { children: React.ReactNode }) {
  return <SistemaGuard>{children}</SistemaGuard>;
}
