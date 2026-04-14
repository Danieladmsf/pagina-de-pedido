
'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log do erro para monitoramento
    console.error('App Error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-[#FAFAF7] text-center">
      <div className="bg-destructive/10 p-4 rounded-full mb-6">
        <AlertCircle className="h-12 w-12 text-destructive" />
      </div>
      <h2 className="text-2xl font-bold mb-2">Algo deu errado!</h2>
      <p className="text-muted-foreground max-w-md mb-8">
        Houve um erro técnico ao carregar a página. Isso pode ser uma falha de conexão ou uma instabilidade temporária.
      </p>
      <div className="flex gap-4">
        <Button onClick={() => reset()} className="flex gap-2">
          <RefreshCw className="h-4 w-4" /> Tentar Novamente
        </Button>
        <Button variant="outline" onClick={() => window.location.href = '/'}>
          Voltar ao Início
        </Button>
      </div>
      {process.env.NODE_ENV === 'development' && (
        <pre className="mt-8 p-4 bg-muted rounded text-xs text-left overflow-auto max-w-full">
          {error.message}
        </pre>
      )}
    </div>
  );
}
