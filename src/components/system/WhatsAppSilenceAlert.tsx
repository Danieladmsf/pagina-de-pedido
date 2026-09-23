'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AlertTriangle, QrCode, WifiOff, X } from 'lucide-react';
import { useUser } from '@/firebase';
import { usePdvAccess } from '@/contexts/PdvAccessContext';
import { EVENTO_WHATSAPP_CONECTOU } from '@/lib/wapi/webhook-health';

/**
 * Aviso de "parou de entrar mensagem no WhatsApp" e de "o WhatsApp da loja
 * está desconectado".
 *
 * Existe por causa do dia 02/09/2026: as respostas automáticas ficaram 4h32 sem
 * sair e a única tela que falava do WhatsApp mostrava "Conectado / Online" —
 * verdade técnica (o celular estava conectado, o envio funcionava) que naquele
 * momento enganava. A loja só descobriu porque a cliente estranhou.
 *
 * Os dois avisos pedem coisas opostas, e misturar um com o outro já custou caro.
 * Em 22/09/2026 o recebimento da Gostinho parou por 40 min, e este aviso mandava
 * "reconectar o aparelho" enquanto a aba WhatsApp mandava "desconectar e ler o
 * QR Code". Alguém fez isso um minuto depois de as mensagens voltarem sozinhas,
 * e a loja passou mais de 5h desconectada, sem nenhum aviso. Por isso:
 *
 * - mudo: não há nada a fazer além de responder pelo celular. O sistema tenta
 *   religar sozinho, e desconectar só transforma silêncio em loja desligada;
 * - desconectado: aí é com a loja, e só o dono religa, lendo o QR Code com o
 *   celular da loja (a rota do QR Code não aceita operador).
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
/** Onde o dono lê o QR Code: a Retaguarda abre na aba pedida pelo endereço. */
const ABA_WHATSAPP = '/gestao?aba=whatsapp';

interface EstadoDoRecebimento {
  /** `mudo` ou `desconectado` quando há o que avisar (ver webhook-health). */
  estado: string;
  precisaAlertar: boolean;
  descricao: string;
  numeroWhatsapp: string;
}

export function WhatsAppSilenceAlert() {
  const { user } = useUser();
  const { ownerId, role } = usePdvAccess();
  const router = useRouter();
  const pathname = usePathname();
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
        estado: String(dados.estado || ''),
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

  // A aba WhatsApp avisa quando o aparelho conecta, e o alerta de desconectado
  // some na hora. Só apaga: quem diz que está tudo bem continua sendo a batida,
  // que pergunta ao servidor.
  useEffect(() => {
    const aoConectar = () =>
      setEstado((atual) => (atual?.estado === 'desconectado' ? { ...atual, precisaAlertar: false } : atual));
    window.addEventListener(EVENTO_WHATSAPP_CONECTOU, aoConectar);
    return () => window.removeEventListener(EVENTO_WHATSAPP_CONECTOU, aoConectar);
  }, []);

  const dispensar = () => {
    dispensadoAteRef.current = Date.now() + SILENCIO_APOS_DISPENSAR_MS;
    setEstado((atual) => (atual ? { ...atual, precisaAlertar: false } : atual));
  };

  // Já dentro da Retaguarda, trocar só o endereço não troca a aba (ela lê a aba
  // pedida uma vez, ao abrir), então recarrega. De outra tela, navegar basta.
  const abrirAbaWhatsApp = () => {
    if (pathname === '/gestao') window.location.assign(ABA_WHATSAPP);
    else router.push(ABA_WHATSAPP);
  };

  if (!estado?.precisaAlertar) return null;
  if (Date.now() < dispensadoAteRef.current) return null;

  const desconectado = estado.estado === 'desconectado';

  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex justify-center px-3 pt-3 pointer-events-none">
      <div
        className={`pointer-events-auto flex w-full max-w-2xl items-start gap-3 rounded-2xl border px-4 py-3 shadow-lg ${
          desconectado ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'
        }`}
      >
        {desconectado ? (
          <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        ) : (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        )}

        <div className="min-w-0 flex-1">
          {desconectado ? (
            <>
              <p className="font-black text-red-900 text-sm">
                O WhatsApp da loja está desconectado
              </p>
              <p className="mt-0.5 text-red-800 text-sm leading-snug">
                Enquanto ele não for conectado de novo, os clientes <strong>não recebem resposta
                automática nem aviso de pedido</strong>.{' '}
                {role === 'owner' ? (
                  <>
                    Para religar, abra a aba <strong>WhatsApp</strong>, toque em{' '}
                    <strong>Gerar QR Code</strong> e leia o código com o celular da loja.
                  </>
                ) : (
                  <>
                    <strong>Avise o dono da loja:</strong> só ele consegue religar, lendo o QR Code
                    na aba WhatsApp da Retaguarda.
                  </>
                )}
              </p>
              {role === 'owner' && (
                <button
                  type="button"
                  onClick={abrirAbaWhatsApp}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-red-700"
                >
                  <QrCode className="h-3.5 w-3.5" />
                  Abrir aba WhatsApp
                </button>
              )}
            </>
          ) : (
            <>
              <p className="font-black text-amber-900 text-sm">
                As respostas automáticas do WhatsApp pararam
              </p>
              <p className="mt-0.5 text-amber-800 text-sm leading-snug">
                Nenhuma mensagem de cliente chega ao sistema {estado.descricao}, então quem chamar a
                loja <strong>não recebe a resposta automática</strong>. As mensagens continuam
                chegando no celular da loja: responda por lá enquanto isso. O sistema está tentando
                religar sozinho. <strong>Não desconecte o WhatsApp</strong> — isso deixa a loja sem
                respostas e sem avisos de pedido até alguém ler o QR Code de novo.
              </p>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={dispensar}
          aria-label="Dispensar aviso por 30 minutos"
          className={`shrink-0 rounded-lg p-1.5 transition ${
            desconectado ? 'text-red-700 hover:bg-red-100' : 'text-amber-700 hover:bg-amber-100'
          }`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
