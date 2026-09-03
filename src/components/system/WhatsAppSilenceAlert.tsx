'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useUser } from '@/firebase';
import { usePdvAccess } from '@/contexts/PdvAccessContext';

/**
 * Aviso de "parou de entrar mensagem no WhatsApp".
 *
 * Existe por causa do dia 02/09/2026: as respostas automáticas ficaram 4h32 sem
 * sair e a única tela que falava do WhatsApp mostrava "Conectado / Online" —
 * verdade técnica (o celular estava conectado, o envio funcionava) que naquele
 * momento enganava. A loja só descobriu porque a cliente estranhou.
 *
 * Mora no layout do sistema, junto do OrderAlertsWatcher, para acompanhar PDV e
 * Retaguarda sem remontar. Cada batida também é o segundo gatilho do vigia do
 * servidor: a rota tenta religar o recebimento antes de responder.
 */

/** De quanto em quanto tempo se pergunta ao servidor. */
const INTERVALO_DA_BATIDA_MS = 5 * 60 * 1000;
/** Primeira batida: espera a tela assentar antes de somar mais uma chamada. */
const ATRASO_DA_PRIMEIRA_MS = 20 * 1000;
/** Quanto tempo o aviso fica quieto depois de dispensado. */
const SILENCIO_APOS_DISPENSAR_MS = 30 * 60 * 1000;

interface EstadoDoRecebimento {
  precisaAlertar: boolean;
  descricao: string;
  numeroWhatsapp: string;
}

export function WhatsAppSilenceAlert() {
  const { user } = useUser();
  const { ownerId } = usePdvAccess();
  const [estado, setEstado] = useState<EstadoDoRecebimento | null>(null);
  const dispensadoAteRef = useRef(0);

  const isRealUser = !!(user && !user.isAnonymous);

  const conferir = useCallback(async () => {
    if (!user || !ownerId) return;

    try {
      const token = await user.getIdToken();
      const resposta = await fetch(`/wapi/webhook-health/${ownerId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok || dados?.error) return;

      setEstado({
        precisaAlertar: Boolean(dados.precisaAlertar),
        descricao: String(dados.descricao || ''),
        numeroWhatsapp: String(dados.numeroWhatsapp || ''),
      });
    } catch {
      // Falha de rede não vira alarme: o aviso é sobre o WhatsApp da loja, e
      // dizer "parou" porque a conferência não completou seria mentir para o
      // outro lado — o mesmo erro que a tela de conexão já cometeu uma vez.
    }
  }, [ownerId, user]);

  useEffect(() => {
    if (!isRealUser || !ownerId) return;

    const primeira = window.setTimeout(conferir, ATRASO_DA_PRIMEIRA_MS);
    const repetida = window.setInterval(conferir, INTERVALO_DA_BATIDA_MS);

    return () => {
      window.clearTimeout(primeira);
      window.clearInterval(repetida);
    };
  }, [conferir, isRealUser, ownerId]);

  const dispensar = () => {
    dispensadoAteRef.current = Date.now() + SILENCIO_APOS_DISPENSAR_MS;
    setEstado((atual) => (atual ? { ...atual, precisaAlertar: false } : atual));
  };

  if (!estado?.precisaAlertar) return null;
  if (Date.now() < dispensadoAteRef.current) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex justify-center px-3 pt-3 pointer-events-none">
      <div className="pointer-events-auto flex w-full max-w-2xl items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-lg">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />

        <div className="min-w-0 flex-1">
          <p className="font-black text-amber-900 text-sm">
            As respostas automáticas do WhatsApp pararam
          </p>
          <p className="mt-0.5 text-amber-800 text-sm leading-snug">
            Nenhuma mensagem de cliente chega ao sistema {estado.descricao}. Quem chamar a loja
            no WhatsApp <strong>não vai receber a resposta automática</strong> — e essas mensagens
            não voltam depois. Já estamos tentando religar sozinhos; se continuar, abra a aba
            <strong> WhatsApp</strong> e reconecte o aparelho.
          </p>
        </div>

        <button
          type="button"
          onClick={dispensar}
          aria-label="Dispensar aviso por 30 minutos"
          className="shrink-0 rounded-lg p-1.5 text-amber-700 transition hover:bg-amber-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
