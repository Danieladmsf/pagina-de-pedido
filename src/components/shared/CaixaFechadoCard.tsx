'use client';

import React from 'react';
import { Calculator } from 'lucide-react';

interface CaixaFechadoCardProps {
  /** Parágrafos explicativos exibidos na caixa cinza (variam por aba). */
  description: React.ReactNode;
  /** Botões de ação (variam por aba). */
  children: React.ReactNode;
}

/**
 * Card padrão de "Caixa Fechado" usado nas abas de venda (Caixa, Delivery,
 * Balcão e Mesa). O shell (ícone, título e moldura centralizada) é comum;
 * o texto e os botões variam por aba via `description` e `children`.
 */
export default function CaixaFechadoCard({ description, children }: CaixaFechadoCardProps) {
  return (
    <div className="flex-1 flex items-center justify-center min-h-0">
      <div className="bg-white border rounded-2xl py-6 px-6 text-center space-y-3 max-w-sm w-full shadow-sm">
        <Calculator className="h-12 w-12 text-muted-foreground/30 mx-auto" />
        <h2 className="text-lg font-bold text-slate-700 uppercase tracking-wider">Caixa Fechado</h2>
        <div className="bg-slate-50 border rounded-xl p-3 text-xs text-muted-foreground space-y-0.5">
          {description}
        </div>
        <div className="flex gap-3 justify-center">
          {children}
        </div>
      </div>
    </div>
  );
}
