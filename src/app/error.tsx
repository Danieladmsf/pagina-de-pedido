
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

    // Um deploy troca o hash de todos os arquivos JS. Uma aba que ficou aberta
    // com o build antigo (o PDV fica visível o dia todo e o auto-reload do PWA
    // só age com a aba escondida) falha ao carregar um chunk que não existe
    // mais no servidor e cai aqui. Nesse caso o reload resolve sozinho: busca o
    // build novo. Throttle de 1 min via sessionStorage para nunca entrar em
    // loop de reload se o erro persistir (ex.: sem rede de verdade).
    const texto = `${error?.name ?? ''} ${error?.message ?? ''}`;
    const pareceBuildVelho = /ChunkLoadError|Loading chunk|chunk \d+ failed|dynamically imported module|Importing a module script failed/i.test(texto);
    if (pareceBuildVelho) {
      const KEY = 'stale-build-reload-at';
      const ultimo = Number(sessionStorage.getItem(KEY) || 0);
      if (Date.now() - ultimo > 60_000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
      }
    }
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
