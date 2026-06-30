'use client';

import { useEffect, useState } from 'react';
import type { EncomendaConfig } from '@/lib/encomendas/config';
import { Landing } from '@/components/encomendas/Landing';
import { EncomendaWizard } from '@/components/encomendas/EncomendaWizard';
import { ensureBrandFontsLoaded } from '@/lib/themes';

export function EncomendasClient({ config }: { config: EncomendaConfig }) {
  const [view, setView] = useState<'landing' | 'wizard'>('landing');

  useEffect(() => {
    ensureBrandFontsLoaded();
  }, []);

  // Ao trocar de view, sobe a página (o wizard e a landing têm alturas distintas).
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);

  return (
    <div className="encomendas-confeitaria min-h-screen">
      {view === 'landing'
        ? <Landing config={config} onStart={() => setView('wizard')} />
        : <EncomendaWizard config={config} onHome={() => setView('landing')} />}
    </div>
  );
}
