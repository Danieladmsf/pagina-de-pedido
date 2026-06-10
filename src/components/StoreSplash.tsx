import React from 'react';
import { Loader2 } from 'lucide-react';

// Tela de abertura da página do cliente: logo e nome da loja enquanto o
// cardápio carrega. Sem logo cadastrado, mantém o spinner genérico antigo.
// Componente puro (sem hooks) para servir de fallback do Suspense no servidor
// e de tela de loading no client.
export function StoreSplash({
  logoUrl,
  storeName,
  bgColor,
}: {
  logoUrl?: string;
  storeName?: string;
  bgColor?: string;
}) {
  if (!logoUrl) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: bgColor || '#FAFAF7' }}>
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground font-medium">Buscando sabores...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ backgroundColor: bgColor || '#FAFAF7' }}>
      <div className="text-center space-y-5">
        <img
          src={logoUrl}
          alt={storeName || 'Logo da loja'}
          className="w-28 h-28 md:w-36 md:h-36 rounded-3xl object-cover mx-auto shadow-2xl ring-4 ring-white"
        />
        {storeName ? (
          <h1 className="text-2xl md:text-3xl font-black tracking-tight text-slate-800">{storeName}</h1>
        ) : null}
        <div className="flex items-center justify-center gap-2 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm font-medium">Abrindo cardápio...</span>
        </div>
      </div>
    </div>
  );
}
