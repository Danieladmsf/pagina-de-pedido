'use client';

import { useEffect } from 'react';

// Versão do bundle que está rodando AGORA (assada no build via next.config.ts).
const RUNNING_VERSION = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';

export function PWARegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Registra o service worker e força uma verificação de atualização logo de
    // cara e sempre que a aba volta a ficar visível.
    let registration: ServiceWorkerRegistration | null = null;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          registration = reg;
          reg.update().catch(() => {});
        })
        .catch(() => {});
    }

    // Detecção de nova versão publicada (deploy). Comparamos a versão do bundle
    // em execução com a versão atual do servidor. Se mudou, agendamos um reload —
    // mas só recarregamos quando a tela NÃO está em uso (aba escondida/minimizada),
    // para nunca interromper o operador no meio de um pedido.
    let updatePending = false;

    const reloadIfSafe = () => {
      if (!updatePending) return;
      if (document.visibilityState === 'hidden') {
        window.location.reload();
      }
    };

    const checkVersion = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.version && RUNNING_VERSION !== 'dev' && data.version !== RUNNING_VERSION) {
          updatePending = true;
          registration?.update().catch(() => {});
          reloadIfSafe();
        }
      } catch {
        // rede instável: ignora e tenta de novo no próximo ciclo
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        registration?.update().catch(() => {});
        void checkVersion();
      } else {
        // ficou escondida: bom momento para aplicar uma atualização pendente
        reloadIfSafe();
      }
    };

    // Quando um novo service worker assume o controle, recarrega uma única vez.
    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      if (document.visibilityState === 'hidden') {
        window.location.reload();
      } else {
        updatePending = true;
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    }
    document.addEventListener('visibilitychange', onVisibility);

    // Verifica a versão periodicamente (a cada 3 min).
    void checkVersion();
    const interval = window.setInterval(checkVersion, 3 * 60 * 1000);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      }
    };
  }, []);

  return null;
}
