'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase';
import { usePdvAccess } from '@/contexts/PdvAccessContext';
import { useCaixaAbertoEm } from '@/hooks/useCaixaAbertoEm';
import { usePublicAudience } from '@/hooks/usePublicAudience';
import { useVisitantesDaLoja } from '@/hooks/useVisitantesDaLoja';
import { AudienceCard } from '@/components/system/AudienceCard';
import { makeProfilePhotoLoader } from '@/lib/wapi/profile-photo';
import { resumoDoDia, visitantesParaAvatares } from '@/lib/visitantes';

const CHAVE_RECOLHIDO = 'audience-badge-recolhido';

/**
 * Placar flutuante da audiência do cardápio: quantas pessoas visitaram a loja
 * desde que o caixa abriu, quem são elas e quantas estão com o cardápio aberto
 * agora.
 *
 * Vive no layout do sistema (junto do OrderAlertsWatcher) para acompanhar tanto
 * o PDV quanto a Retaguarda sem remontar na troca de tela. Some com o caixa
 * fechado: o número é da sessão de caixa, fora dela não significa nada.
 *
 * Aqui só mora a busca dos dados — o desenho é o `AudienceCard`.
 */
export function AudienceBadge() {
  const { user } = useUser();
  const router = useRouter();
  const { ownerId } = usePdvAccess();
  const caixaAbertoEm = useCaixaAbertoEm(ownerId);
  const [recolhido, setRecolhido] = useState(false);

  useEffect(() => {
    try {
      setRecolhido(window.localStorage.getItem(CHAVE_RECOLHIDO) === '1');
    } catch {
      /* storage bloqueado: começa aberto */
    }
  }, []);

  const { online, visitasNaSessao, semAcesso } = usePublicAudience(ownerId, caixaAbertoEm);
  const { visitantes } = useVisitantesDaLoja(ownerId, caixaAbertoEm);

  const loadPhoto = useMemo(() => makeProfilePhotoLoader(user, ownerId || ''), [user, ownerId]);
  const pessoas = useMemo(() => visitantesParaAvatares(visitantes), [visitantes]);
  const resumo = useMemo(
    () => resumoDoDia(visitantes, caixaAbertoEm?.getTime() ?? 0),
    [visitantes, caixaAbertoEm]
  );

  const desde = useMemo(() => {
    if (!caixaAbertoEm) return '';
    return caixaAbertoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }, [caixaAbertoEm]);

  if (semAcesso || !caixaAbertoEm) return null;

  const alternar = () => {
    const proximo = !recolhido;
    setRecolhido(proximo);
    try {
      window.localStorage.setItem(CHAVE_RECOLHIDO, proximo ? '1' : '0');
    } catch {
      /* sem storage: vale só nesta sessão */
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 print:hidden">
      <AudienceCard
        visitas={visitasNaSessao ?? 0}
        online={online}
        desde={desde}
        pessoas={pessoas}
        carrinhosParados={resumo.abandonados}
        valorParado={resumo.valorAbandonado}
        loadPhoto={loadPhoto}
        onAbrirVisitantes={() => router.push('/visitantes')}
        recolhido={recolhido}
        onAlternar={alternar}
      />
    </div>
  );
}
