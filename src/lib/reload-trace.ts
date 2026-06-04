// Diagnóstico temporário: rastreia o que dispara reloads/logout da página.
// Grava no localStorage para sobreviver ao reload e poder ser inspecionado depois.

const KEY = '__reload_trace';

export function traceReload(reason: string, extra?: any) {
  try {
    const entry = {
      reason,
      extra: extra ?? null,
      at: new Date().toISOString(),
      url: typeof location !== 'undefined' ? location.href : '',
    };
    // eslint-disable-next-line no-console
    console.warn('🔁 [RELOAD/LOGOUT TRIGGER]', reason, entry);
    if (typeof localStorage !== 'undefined') {
      const hist = JSON.parse(localStorage.getItem(KEY) || '[]');
      hist.push(entry);
      localStorage.setItem(KEY, JSON.stringify(hist.slice(-30)));
    }
  } catch {
    /* ignore */
  }
}

export function dumpReloadTrace() {
  try {
    if (typeof window === 'undefined') return;
    const navType = (() => {
      try {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        return nav?.type || 'unknown';
      } catch {
        return 'unknown';
      }
    })();
    // eslint-disable-next-line no-console
    console.warn(`🧭 [PAGE LOAD] navigationType=${navType}`);
    const hist = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (hist.length) {
      // eslint-disable-next-line no-console
      console.warn('🧾 [RELOAD TRACE — últimos gatilhos registrados]', hist);
    }
  } catch {
    /* ignore */
  }
}
