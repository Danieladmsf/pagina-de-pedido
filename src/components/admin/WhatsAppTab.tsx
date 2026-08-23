'use client';

import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import {
  AlertTriangle,
  CakeSlice,
  Check,
  CheckCircle2,
  Copy,
  Hash,
  Link2,
  Loader2,
  MessageCircle,
  Phone,
  Power,
  QrCode,
  Save,
  Send,
  ShoppingBag,
  Smartphone,
  Wifi,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  ORDER_LINK_CARD_SHORT,
  adicionarPedidoDeContato,
  buildOrderLinkPathForCode,
  getAvailableVariants,
  getMessageVariantCode,
  getVariantByCode,
  storeHasEncomendas,
  storeWhatsappDigits,
  type OrderLinkCardId,
  type OrderLinkVariant,
} from '@/lib/order-link';
import { CANAIS, CANAL_LABEL, adicionarOrigem, montarOrigem, type CanalOrigem } from '@/lib/origem';
import { revalidateStorePages } from '@/lib/revalidate-store';
import {
  DEFAULT_WHATSAPP_MESSAGES,
  WHATSAPP_MESSAGE_LABELS,
  buildStoreLink,
  formatWorkingHours,
  getWhatsAppMessages,
  renderWhatsAppTemplate,
  formatNextOpeningTime,
} from '@/lib/whatsapp-messages';
import type { WhatsAppMessageKey, WhatsAppMessageTemplates } from '@/lib/whatsapp-messages';

interface WhatsAppTabProps {
  user: User | null;
  storeProfile?: any;
  db?: any;
}

const MESSAGE_KEYS: WhatsAppMessageKey[] = [
  'firstContact',
  'orderReceived',
  'pixProofRequest',
  'orderReadyDelivery',
  'orderReadyPickup',
  'orderReadyDineIn',
  'orderOutForDelivery',
  'orderPickupReady',
  'orderDineInReady',
  'orderCanceled',
  'storeClosed',
];

// O QR Code do W-API (/instance/qr-code) NAO e uma leitura: e a acao de parear
// um aparelho. Pedir QR em laco enquanto a loja aparece como desconectada
// derruba a sessao que estava de pe no celular — era exatamente por isso que o
// WhatsApp caia sempre que alguem abria esta tela. Agora o pareamento so comeca
// quando o dono pede, e para sozinho depois de alguns minutos.
const QR_CODE_REFRESH_INTERVAL_MS = 25000;
const QR_CODE_MAX_REFRESHES = 8;
const CONNECTED_STATUS_REFRESH_INTERVAL_MS = 20000;
const DISCONNECTED_STATUS_REFRESH_INTERVAL_MS = 15000;

type IntegrationStatus = 'not_configured' | 'pending_qr' | 'connected' | 'disconnected' | 'error';

interface Integration {
  empresaId: string;
  wapiInstanceId: string;
  instanceName: string;
  status: IntegrationStatus;
  connected: boolean;
  numeroWhatsapp?: string;
  qrCode?: string;
  lastError?: string;
  lastStatusAt?: string;
  tokenConfigured: boolean;
}

function statusLabel(status?: IntegrationStatus) {
  switch (status) {
    case 'connected': return 'Conectado';
    case 'pending_qr': return 'Aguardando conexao';
    case 'disconnected': return 'Desconectado';
    case 'error': return 'Erro';
    default: return 'Nao configurado';
  }
}

function statusDotClass(status?: IntegrationStatus) {
  switch (status) {
    case 'connected': return 'bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.18)]';
    case 'pending_qr': return 'bg-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,0.18)] animate-pulse';
    case 'disconnected': return 'bg-slate-400 shadow-[0_0_0_4px_rgba(148,163,184,0.18)]';
    case 'error': return 'bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.18)]';
    default: return 'bg-slate-300 shadow-[0_0_0_4px_rgba(148,163,184,0.15)]';
  }
}

function statusBadgeClass(status?: IntegrationStatus) {
  switch (status) {
    case 'connected': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'pending_qr': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'disconnected': return 'bg-slate-50 text-slate-700 border-slate-200';
    case 'error': return 'bg-red-50 text-red-700 border-red-200';
    default: return 'bg-slate-50 text-slate-600 border-slate-200';
  }
}

export function WhatsAppTab({ user, storeProfile, db }: WhatsAppTabProps) {
  const { toast } = useToast();
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [qrCode, setQrCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [testPhone, setTestPhone] = useState('');
  const [pairing, setPairing] = useState(false);
  const [qrAttempts, setQrAttempts] = useState(0);
  const [checkFailed, setCheckFailed] = useState('');
  const [testMessage, setTestMessage] = useState('Ola! Esta e uma mensagem de teste do cardapio digital.');
  const [activeSection, setActiveSection] = useState<'conexao' | 'mensagens' | 'links'>('conexao');
  const [messageTemplates, setMessageTemplates] = useState<WhatsAppMessageTemplates>(() => getWhatsAppMessages(storeProfile?.whatsappMessages));
  const [savingMessages, setSavingMessages] = useState(false);
  const [messageVariant, setMessageVariant] = useState<string>(() => getMessageVariantCode(storeProfile));
  const [savingOrderLink, setSavingOrderLink] = useState(false);

  const empresaId = user?.uid || '';
  const storeName = storeProfile?.general?.name || storeProfile?.storeName || user?.displayName || 'Minha loja';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  // Endereco da loja SEM variante nenhuma: e a base que a tela de links usa pra
  // montar cada endereco (?pedir=de, /encomendas, ...).
  const baseStoreLink = empresaId ? buildStoreLink({ ...(storeProfile || {}), orderLink: null }, empresaId, origin) : '';

  // Previa ao vivo do {link} das mensagens: ja reflete a variante marcada, mesmo
  // antes de salvar.
  const storeLink = empresaId
    ? buildStoreLink({ ...(storeProfile || {}), orderLink: { messageVariant } }, empresaId, origin)
    : '';

  useEffect(() => {
    setMessageTemplates(getWhatsAppMessages(storeProfile?.whatsappMessages));
  }, [storeProfile?.whatsappMessages]);

  useEffect(() => {
    setMessageVariant(getMessageVariantCode(storeProfile));
  }, [storeProfile?.orderLink]);

  async function apiFetch(path: string, options: RequestInit = {}) {
    if (!user) throw new Error('Usuario nao autenticado.');
    const token = await user.getIdToken();
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) {
      throw new Error(data?.error || 'Falha na comunicacao com o WhatsApp.');
    }
    return data;
  }

  // Carrega os dados salvos do Firestore (rapido, sem chamar W-API)
  const loadSavedIntegration = React.useCallback(async () => {
    if (!empresaId) {
      setInitialLoading(false);
      return false;
    }
    try {
      const data = await apiFetch(`/wapi/integration/${empresaId}`);
      setCheckFailed('');
      if (data.integration?.tokenConfigured) {
        setIntegration(data.integration);
        return true;
      }

      // O servidor respondeu e disse, explicitamente, que nao ha integracao.
      setIntegration(null);
      setQrCode('');
      return false;
    } catch (error: any) {
      // Falha de rede, sessao ou Firestore NAO significa que a loja perdeu a
      // conexao. Zerar a tela aqui fazia o dono ver "WhatsApp nao conectado" com
      // a credencial intacta no banco — e clicar em Desconectar, que ai sim
      // apagava tudo de verdade. Preserva o que estiver na tela e avisa.
      setCheckFailed(error?.message || 'Nao consegui verificar a conexao agora.');
      return false;
    } finally {
      setInitialLoading(false);
    }
  }, [empresaId, user]);

  // Consulta status ao vivo na W-API e atualiza
  const loadStatus = React.useCallback(async (silent = false) => {
    if (!empresaId) return;
    if (!silent) setLoadingStatus(true);
    try {
      const data = await apiFetch(`/wapi/status/${empresaId}`);
      setIntegration(data.integration);
      setCheckFailed('');
    } catch (error: any) {
      // Se falhar a checagem ao vivo, NAO apaga a integracao salva
      if (!/ainda nao configurado/i.test(error.message)) {
        setCheckFailed(error?.message || 'Nao consegui verificar a conexao agora.');
        if (!silent) toast({ variant: 'destructive', title: 'Erro no WhatsApp', description: error.message });
      } else {
        // Realmente nao tem integracao configurada
        setIntegration(null);
        setQrCode('');
      }
    } finally {
      if (!silent) setLoadingStatus(false);
    }
  }, [empresaId, user]);

  const refreshQrCode = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiFetch(`/wapi/qrcode/${empresaId}`);
      setIntegration(data.integration);
      const nextQrCode = data.qrCode || data.integration?.qrCode || '';
      if (nextQrCode || !silent) setQrCode(nextQrCode);
      if (!silent) toast({ title: 'QR Code atualizado' });
    } catch (error: any) {
      if (!silent) toast({ variant: 'destructive', title: 'Erro ao buscar QR Code', description: error.message });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [empresaId, user]);

  useEffect(() => {
    let cancelled = false;
    loadSavedIntegration().then((hasIntegration) => {
      // Depois de carregar do Firestore, faz checagem ao vivo em background
      if (!cancelled && hasIntegration) loadStatus(true);
    });
    return () => {
      cancelled = true;
    };
  }, [loadSavedIntegration, loadStatus]);

  useEffect(() => {
    if (!integration) return;
    const interval = integration.connected ? CONNECTED_STATUS_REFRESH_INTERVAL_MS : DISCONNECTED_STATUS_REFRESH_INTERVAL_MS;
    const timer = setInterval(() => loadStatus(true), interval);
    return () => clearInterval(timer);
  }, [integration?.wapiInstanceId, integration?.connected, loadStatus]);

  // Conectou: encerra o pareamento e joga o QR fora.
  useEffect(() => {
    if (!integration?.connected) return;
    setPairing(false);
    setQrAttempts(0);
    setQrCode('');
  }, [integration?.connected]);

  // Renova o QR só enquanto o dono estiver de fato parenado um aparelho, e por
  // tempo limitado. Nunca em segundo plano: ver a página não pode derrubar a
  // conexão de quem está trabalhando.
  useEffect(() => {
    if (!pairing || !integration || integration.connected) return;
    if (qrAttempts >= QR_CODE_MAX_REFRESHES) return;
    const timer = setTimeout(() => {
      setQrAttempts((attempts) => attempts + 1);
      refreshQrCode(true);
    }, QR_CODE_REFRESH_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [pairing, qrAttempts, integration?.wapiInstanceId, integration?.connected, refreshQrCode]);

  function startPairing() {
    setQrAttempts(0);
    setPairing(true);
    refreshQrCode(false);
  }

  async function linkInstance(wapiInstanceId: string, token: string) {
    setLoading(true);
    try {
      const data = await apiFetch('/wapi/link-instance', {
        method: 'POST',
        body: JSON.stringify({ empresaId, instanceName: storeName, wapiInstanceId, token }),
      });
      setIntegration(data.integration);
      setCheckFailed('');
      const nextQrCode = data.qrCode || data.integration?.qrCode || '';
      setQrCode(nextQrCode);
      if (!data.integration?.connected) {
        setQrAttempts(0);
        setPairing(true);
      }
      toast({
        title: 'WhatsApp vinculado',
        description: data.integration?.connected
          ? 'A conexao foi vinculada e ja esta ativa.'
          : 'Conexao vinculada. Escaneie o QR Code para ativar.',
      });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Erro ao vincular', description: error.message });
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    if (!confirm('Desconectar este WhatsApp da loja? Voce podera conectar novamente depois.')) return;
    setLoading(true);
    try {
      await apiFetch('/wapi/disconnect', {
        method: 'POST',
        body: JSON.stringify({ empresaId }),
      });
      setIntegration(null);
      setQrCode('');
      setPairing(false);
      setQrAttempts(0);
      toast({ title: 'WhatsApp desconectado', description: 'Clique em Conectar WhatsApp para conectar novamente.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Erro ao desconectar', description: error.message });
    } finally {
      setLoading(false);
    }
  }

  async function sendTestMessage() {
    setLoading(true);
    try {
      await apiFetch('/wapi/send-message', {
        method: 'POST',
        body: JSON.stringify({
          empresaId,
          phone: testPhone,
          message: testMessage,
          type: 'manual_test',
        }),
      });
      toast({ title: 'Mensagem enviada', description: 'A mensagem entrou na fila de envio.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Erro ao enviar mensagem', description: error.message });
    } finally {
      setLoading(false);
    }
  }

  async function saveMessageTemplates() {
    if (!db || !empresaId) {
      toast({ variant: 'destructive', title: 'Erro ao salvar', description: 'Usuario ou banco de dados indisponivel.' });
      return;
    }

    setSavingMessages(true);
    try {
      await setDoc(doc(db, 'store_profiles', empresaId), {
        whatsappMessages: messageTemplates,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      toast({ title: 'Mensagens salvas', description: 'Os proximos envios automaticos usarao estes textos.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Erro ao salvar mensagens', description: error.message || 'Falha ao salvar.' });
    } finally {
      setSavingMessages(false);
    }
  }

  async function saveOrderLink() {
    if (!db || !empresaId) {
      toast({ variant: 'destructive', title: 'Erro ao salvar', description: 'Usuario ou banco de dados indisponivel.' });
      return;
    }

    setSavingOrderLink(true);
    try {
      await setDoc(doc(db, 'store_profiles', empresaId), {
        orderLink: { messageVariant },
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      revalidateStorePages(empresaId);
      toast({ title: 'Link salvo', description: 'As proximas mensagens automaticas ja usam esse link.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Erro ao salvar o link', description: error.message || 'Falha ao salvar.' });
    } finally {
      setSavingOrderLink(false);
    }
  }

  const isConnected = integration?.connected || integration?.status === 'connected';
  const status = integration?.status;

  return (
    <div className="max-w-[1500px] w-full mx-auto p-4 md:p-8 space-y-5 overflow-y-auto custom-scrollbar">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="hidden md:flex h-11 w-11 rounded-xl bg-emerald-600 items-center justify-center shadow-sm shrink-0">
              <MessageCircle className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Integracao WhatsApp Business</p>
              <h1 className="text-xl md:text-2xl font-black tracking-tight text-slate-900">WhatsApp da loja</h1>
              <p className="text-slate-600 mt-1 text-sm max-w-2xl">
                Use o numero da loja para receber mensagens e enviar avisos aos clientes automaticamente.
              </p>
            </div>
          </div>

          <div className="flex flex-col items-start md:items-end gap-2">
            {initialLoading ? (
              <Skeleton className="h-9 w-44 rounded-full" />
            ) : (
              <div className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full border ${statusBadgeClass(status)}`}>
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusDotClass(status)}`} />
                <span className="text-sm font-bold">{statusLabel(status)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {checkFailed && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <p className="font-bold">Nao consegui verificar a conexao agora</p>
            <p className="mt-0.5 text-amber-800">
              Isto e uma falha de comunicacao momentanea — a conexao do WhatsApp da loja continua
              salva e funcionando. Nao e preciso desconectar nem cadastrar nada de novo.
            </p>
            <p className="mt-1 text-[11px] text-amber-700/80">{checkFailed}</p>
          </div>
        </div>
      )}

      {/* Um assunto por secao. Recurso novo entra numa secao existente ou ganha
          a sua — nunca empilhado no fim de uma que ja esta cheia. */}
      <div className="grid w-full grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm md:w-[720px]">
        {([
          { id: 'conexao', label: 'Conexao', icon: Wifi },
          { id: 'mensagens', label: 'Mensagens automaticas', icon: MessageCircle },
          { id: 'links', label: 'Links de pedido', icon: Link2 },
        ] as const).map((section) => (
          <Button
            key={section.id}
            type="button"
            variant={activeSection === section.id ? 'default' : 'ghost'}
            onClick={() => setActiveSection(section.id)}
            className={`rounded-xl h-11 px-2 text-xs sm:text-sm whitespace-normal leading-tight ${activeSection === section.id ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
          >
            <section.icon className="h-4 w-4 mr-2 shrink-0" />
            {section.label}
          </Button>
        ))}
      </div>

      {activeSection === 'links' ? (
        <OrderLinksSection
          messageVariant={messageVariant}
          setMessageVariant={setMessageVariant}
          onSave={saveOrderLink}
          saving={savingOrderLink}
          baseStoreLink={baseStoreLink}
          storeProfile={storeProfile}
        />
      ) : activeSection === 'mensagens' ? (
        <MessageTemplatesSection
          templates={messageTemplates}
          setTemplates={setMessageTemplates}
          onSave={saveMessageTemplates}
          saving={savingMessages}
          storeLink={storeLink}
          storeName={storeName}
          workingHours={storeProfile?.workingHours}
          storeProfile={storeProfile}
          messageVariant={messageVariant}
          onManageLinks={() => setActiveSection('links')}
        />
      ) : initialLoading ? (
        <LoadingState />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6">
          {/* INSTANCE CARD */}
          <Card className="rounded-2xl border-slate-200 shadow-sm overflow-hidden">
            <CardHeader className="border-b bg-gradient-to-r from-white to-slate-50/50 py-4">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <QrCode className="h-5 w-5 text-emerald-600" />
                  WhatsApp da loja
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 md:p-6 space-y-5">
              {!integration ? (
                <EmptyState onLink={linkInstance} loading={loading} disabled={!user} />
              ) : (
                <>
                  <InfoGrid
                    storeName={storeName}
                    integration={integration}
                  />

                  <ConnectionSupportActions
                    loading={loading || loadingStatus}
                    onDisconnect={disconnect}
                  />

                  {!isConnected ? (
                    <QrSection
                      qrCode={qrCode}
                      status={status}
                      pairing={pairing}
                      loading={loading}
                      exhausted={qrAttempts >= QR_CODE_MAX_REFRESHES}
                      onStartPairing={startPairing}
                    />
                  ) : (
                    <ConnectedCard numero={integration.numeroWhatsapp} />
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* SEND TEST CARD */}
          <Card className="rounded-2xl border-slate-200 shadow-sm overflow-hidden">
            <CardHeader className="border-b bg-gradient-to-r from-white to-slate-50/50 py-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Send className="h-5 w-5 text-emerald-600" />
                Enviar mensagem de teste
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 md:p-6 space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-bold text-slate-700">Telefone</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    value={testPhone}
                    onChange={(event) => setTestPhone(event.target.value)}
                    placeholder="Ex: 16999999999"
                    className="pl-9 rounded-xl"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Use DDD + numero. Se nao tiver 55, o sistema adiciona automaticamente.</p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold text-slate-700">Mensagem</Label>
                <Textarea
                  value={testMessage}
                  onChange={(event) => setTestMessage(event.target.value)}
                  className="min-h-[130px] rounded-xl resize-none"
                />
              </div>
              <Button
                onClick={sendTestMessage}
                disabled={loading || !integration || !isConnected || !testPhone.trim() || !testMessage.trim()}
                className="w-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 shadow-md shadow-emerald-500/20 h-11"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                Enviar teste
              </Button>

              {!integration && (
                <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3">
                  Conecte o WhatsApp da loja para liberar o envio de mensagens.
                </p>
              )}
              {integration && !isConnected && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  Conecte o WhatsApp escaneando o QR Code antes de enviar mensagens.
                </p>
              )}

            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function ConnectionSupportActions({
  loading,
  onDisconnect,
}: {
  loading: boolean;
  onDisconnect: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="ghost"
        onClick={onDisconnect}
        disabled={loading}
        className="h-9 rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700"
      >
        <Power className="h-4 w-4" />
        Desconectar
      </Button>
    </div>
  );
}

const ORDER_LINK_CARD_ICONS: Record<OrderLinkCardId, React.ElementType> = {
  menu: ShoppingBag,
  encomendas: CakeSlice,
  whatsapp: MessageCircle,
};

// QR do link, para o que nao e clicavel: embalagem, panfleto, cartao, placa no
// balcao. Com a marca de origem junto, a loja finalmente mede o papel — e
// descobre se a caixa do bolo traz gente de volta.
//
// A biblioteca entra por import dinamico: ela so faz falta quando alguem pede o
// QR, e nao tem por que pesar o carregamento da Retaguarda inteira.
function QrDoLink({ url, nomeDoArquivo }: { url: string; nomeDoArquivo: string }) {
  const { toast } = useToast();
  const [imagem, setImagem] = useState('');
  const [gerando, setGerando] = useState(false);

  async function gerar() {
    if (imagem) {
      setImagem('');
      return;
    }
    setGerando(true);
    try {
      const QRCode = (await import('qrcode')).default;
      // 1024px e correcao alta: QR impresso e depois amassado, molhado ou com
      // logo por cima ainda precisa ler.
      setImagem(await QRCode.toDataURL(url, { width: 1024, margin: 2, errorCorrectionLevel: 'H' }));
    } catch {
      toast({ variant: 'destructive', title: 'Nao consegui gerar o QR', description: 'Tente de novo.' });
    } finally {
      setGerando(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={gerar} disabled={gerando} className="h-9 shrink-0 rounded-xl">
        {gerando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />}
        {imagem ? 'Fechar QR' : 'QR code'}
      </Button>

      {imagem && (
        <div className="mt-2 flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imagem} alt="QR code do link" className="h-36 w-36 rounded-xl bg-white p-2 shadow-sm" />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="text-xs font-bold text-slate-700">Imprima onde o cliente pega na mao</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              Embalagem, panfleto, cartao ou placa no balcao. Quem apontar a camera cai no cardapio
              com a marca deste link — e voce ve quantos vieram dai.
            </p>
            <a
              href={imagem}
              download={`${nomeDoArquivo}.png`}
              className="mt-2 inline-flex h-8 items-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100"
            >
              Baixar PNG
            </a>
          </div>
        </div>
      )}
    </>
  );
}

// Uma linha da lista: o nome da combinacao, o que ela abre, onde colar e o
// endereco pronto para copiar. O radio marca qual delas entra nas mensagens
// automaticas — as outras a loja usa copiando e colando onde quiser.
function OrderLinkVariantRow({
  variant,
  url,
  selected,
  onSelect,
}: {
  variant: OrderLinkVariant;
  url: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast({ variant: 'destructive', title: 'Nao consegui copiar', description: 'Copie o endereco manualmente.' });
    }
  }

  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`cursor-pointer rounded-2xl border p-4 transition-all ${
        selected
          ? 'border-emerald-500 bg-emerald-50/50 shadow-sm ring-1 ring-emerald-500/20'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
            selected ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-transparent'
          }`}
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`text-sm font-black ${selected ? 'text-emerald-900' : 'text-slate-800'}`}>{variant.title}</p>
            {selected && (
              <span className="rounded-md bg-emerald-600 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-white">
                Usado nas mensagens
              </span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {variant.cards.map((id) => {
              const Icon = ORDER_LINK_CARD_ICONS[id];
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600"
                >
                  <Icon className="h-3 w-3" />
                  {ORDER_LINK_CARD_SHORT[id]}
                </span>
              );
            })}
          </div>

          <p className="mt-2 text-xs leading-snug text-slate-600">{variant.opens}</p>
          <p className="mt-1 text-xs leading-snug text-slate-500">
            <span className="font-bold text-slate-600">Ideal para:</span> {variant.goodFor}
          </p>

          <div onClick={(event) => event.stopPropagation()}>
            <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
              <Input value={url} readOnly onFocus={(e) => e.target.select()} className="h-9 rounded-xl bg-white font-mono text-[11px]" />
              <Button type="button" variant="outline" onClick={copyUrl} className="h-9 shrink-0 rounded-xl">
                {copied ? <Check className="mr-2 h-4 w-4 text-emerald-600" /> : <Copy className="mr-2 h-4 w-4" />}
                {copied ? 'Copiado' : 'Copiar'}
              </Button>
              <QrDoLink url={url} nomeDoArquivo={`cardapio-${variant.code}`} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// "Onde voce vai colar este link?": a marca de origem que faz a tela de
// visitantes conseguir dizer QUEM TROUXE cada pessoa.
//
// A escolha nao e salva em lugar nenhum de proposito: ela so muda o endereco
// que o dono esta copiando agora. A loja tem um link por lugar onde divulga, e
// guardar "a origem atual" num campo global daria a impressao errada de que
// existe uma so.
function OrigemDoLinkPicker({
  canal,
  setCanal,
  campanha,
  setCampanha,
  pedirContato,
  setPedirContato,
  temWhatsapp,
}: {
  canal: CanalOrigem | '';
  setCanal: (valor: CanalOrigem | '') => void;
  campanha: string;
  setCampanha: (valor: string) => void;
  pedirContato: boolean;
  setPedirContato: (valor: boolean) => void;
  temWhatsapp: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-black text-slate-800">Onde voce vai colar este link?</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        Marcando o lugar, a tela &quot;Quem passou no cardapio&quot; passa a mostrar quantas pessoas
        vieram de cada um — e quantas compraram. Sem marcar, o link continua funcionando igual.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setCanal('')}
          className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
            canal === ''
              ? 'border-slate-800 bg-slate-800 text-white'
              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
          }`}
        >
          Sem marca
        </button>
        {CANAIS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setCanal(id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
              canal === id
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            {CANAL_LABEL[id]}
          </button>
        ))}
      </div>

      {canal !== '' && (
        <div className="mt-3">
          <Label className="text-xs font-bold text-slate-600">
            Nome deste anuncio <span className="font-normal text-slate-400">(opcional)</span>
          </Label>
          <Input
            value={campanha}
            onChange={(event) => setCampanha(event.target.value)}
            placeholder="bio, post do dia das maes, panfleto de agosto..."
            className="mt-1 h-9 rounded-xl"
            maxLength={30}
          />
          <p className="mt-1 text-[11px] leading-snug text-slate-500">
            Use quando tiver mais de um link no mesmo lugar — assim da para saber qual post trouxe
            gente.
          </p>
        </div>
      )}

      {/* O unico caminho legitimo para o telefone: a propria pessoa mandar a
          mensagem. Nenhum site le o numero de quem abre a pagina. */}
      <div className="mt-4 border-t border-slate-100 pt-3.5">
        <button
          type="button"
          onClick={() => temWhatsapp && setPedirContato(!pedirContato)}
          disabled={!temWhatsapp}
          className="flex w-full items-start gap-3 rounded-xl p-1 text-left transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
        >
          <span
            className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
              pedirContato && temWhatsapp ? 'bg-emerald-600' : 'bg-slate-300'
            }`}
          >
            <span
              className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                pedirContato && temWhatsapp ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-slate-800">Pedir o contato de quem e novo</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
              {temWhatsapp
                ? 'Quem nunca pediu aqui toca em "Delivery" e manda uma mensagem pronta pelo WhatsApp pedindo o cardapio. Voce recebe o numero e responde com o link. Quem ja e cliente vai direto, sem passar por isso.'
                : 'Cadastre o WhatsApp da loja em Perfil da loja para liberar.'}
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

// Secao "Links de pedido": lista todas as combinacoes que a loja consegue
// oferecer. O dono copia a que combina com o lugar onde vai colar, e marca uma
// para entrar no {link} das mensagens automaticas.
function OrderLinksSection({
  messageVariant,
  setMessageVariant,
  onSave,
  saving,
  baseStoreLink,
  storeProfile,
}: {
  messageVariant: string;
  setMessageVariant: (code: string) => void;
  onSave: () => void;
  saving: boolean;
  baseStoreLink: string;
  storeProfile?: any;
}) {
  const variants = getAvailableVariants(storeProfile);
  const diretos = variants.filter((variant) => variant.cards.length === 1);
  const comEscolha = variants.filter((variant) => variant.cards.length > 1);

  const hasEncomendas = storeHasEncomendas(storeProfile);
  const hasWhatsapp = Boolean(storeWhatsappDigits(storeProfile));

  const [canal, setCanal] = useState<CanalOrigem | ''>('');
  const [campanha, setCampanha] = useState('');
  const [pedirContato, setPedirContato] = useState(false);
  const origem = canal ? montarOrigem(canal, campanha) : '';

  function urlFor(variant: OrderLinkVariant) {
    if (!baseStoreLink) return 'Link ainda indisponivel';
    // A marca de origem entra por ultimo: ela acompanha o endereco para onde
    // quer que ele seja colado, sem mexer no que o link ABRE.
    const comCards = buildOrderLinkPathForCode(baseStoreLink, variant.code, storeProfile);
    return adicionarOrigem(
      adicionarPedidoDeContato(comCards, pedirContato && hasWhatsapp),
      origem
    );
  }

  function renderGroup(title: string, hint: string, list: OrderLinkVariant[]) {
    if (list.length === 0) return null;
    return (
      <div className="space-y-2.5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</p>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
        {list.map((variant) => (
          <OrderLinkVariantRow
            key={variant.code}
            variant={variant}
            url={urlFor(variant)}
            selected={messageVariant === variant.code}
            onSelect={() => setMessageVariant(variant.code)}
          />
        ))}
      </div>
    );
  }

  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm overflow-hidden">
      <CardHeader className="border-b bg-gradient-to-r from-white to-slate-50/50 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-5 w-5 text-emerald-600" />
              Links de pedido
            </CardTitle>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl">
              Todos levam para a sua loja, mas cada um abre uma coisa diferente. Copie o que combina
              com o lugar onde voce vai colar e marque qual deles entra nas mensagens automaticas.
            </p>
          </div>
          <Button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-full h-9 bg-emerald-600 hover:bg-emerald-700 shrink-0"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Salvar escolha
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-5 md:p-6 space-y-6">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
          <p className="text-xs leading-relaxed text-emerald-900">
            <span className="font-black">Por que mais de um link?</span> Quando a mensagem sai pelo
            WhatsApp, oferecer &quot;falar no WhatsApp&quot; e redundante — o cliente ja esta falando
            com voce. Ja num post ou na bio do Instagram, essa opcao faz falta.
          </p>
        </div>

        <OrigemDoLinkPicker
          canal={canal}
          setCanal={setCanal}
          campanha={campanha}
          setCampanha={setCampanha}
          pedirContato={pedirContato}
          setPedirContato={setPedirContato}
          temWhatsapp={hasWhatsapp}
        />

        {renderGroup('Abre direto', 'Sem perguntar nada: o cliente ja cai no lugar.', diretos)}
        {renderGroup('Tela de escolha', 'O cliente escolhe entre as opcoes ao abrir.', comEscolha)}

        {(!hasEncomendas || !hasWhatsapp) && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Links que ainda nao aparecem</p>
            {!hasEncomendas && (
              <p className="text-xs text-slate-600">
                <span className="font-bold">Encomendas:</span> disponivel para lojas de confeitaria com
                as encomendas ligadas na aba Encomendas.
              </p>
            )}
            {!hasWhatsapp && (
              <p className="text-xs text-slate-600">
                <span className="font-bold">Falar no WhatsApp:</span> cadastre o WhatsApp da loja em
                Perfil da loja para liberar.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MessageTemplatesSection({
  templates,
  setTemplates,
  onSave,
  saving,
  storeLink,
  storeName,
  workingHours,
  storeProfile,
  messageVariant,
  onManageLinks,
}: {
  templates: WhatsAppMessageTemplates;
  setTemplates: React.Dispatch<React.SetStateAction<WhatsAppMessageTemplates>>;
  onSave: () => void;
  saving: boolean;
  storeLink: string;
  storeName: string;
  workingHours?: any[];
  storeProfile?: any;
  messageVariant: string;
  onManageLinks: () => void;
}) {
  const pixKeySample = (storeProfile?.creditPixKey || '').trim();
  const pixNameSample = (storeProfile?.creditPixName || '').trim();
  const pixBlockSample = pixKeySample
    ? `\n🔑 *Chave Pix:* ${pixKeySample}${pixNameSample ? `\n👤 ${pixNameSample}` : ''}\n`
    : '\n🔑 *Chave Pix:* (defina em Perfil da loja)\n';

  const sampleValues = {
    loja: storeName,
    link: storeLink || '{link}',
    cliente: 'Maria Silva',
    primeiro_nome: 'Maria',
    pedido: 'A1B2C3',
    itens: 'Prato Feito - *PF: Filé de peixe *>Escolha sua Guarnição\n1x Batata frita  - R$0,00\n>Preferências \n1x Com feijão  Tradicional - R$0,00\n\nOBS: Nenhuma\nQuantidade: 1\nValor: R$28,90',
    total: 'R$ 28,90',
    pagamento: 'Crédito',
    tempo_estimado: '\n⏳ Tempo estimado de entrega: 00:50',
    proxima_abertura: formatNextOpeningTime(workingHours, storeProfile?.plannedClosures, storeProfile?.general?.timezone),
    horarios: formatWorkingHours(workingHours),
    celular: '(14) 99766-4759',
    endereco: 'Comer no local: Antonio Pizzi, 21, João Berbel II',
    subtotal: 'R$ 28,90',
    taxa_entrega: 'R$ 0,00',
    chave_pix: pixBlockSample,
  };

  return (
    <div className="space-y-5">
      <Card className="rounded-2xl border-slate-200 shadow-sm overflow-hidden">
        <CardHeader className="border-b bg-gradient-to-r from-white to-slate-50/50 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageCircle className="h-5 w-5 text-emerald-600" />
                Mensagens automaticas
              </CardTitle>
              <p className="text-xs text-slate-500 mt-1">
                Variaveis disponiveis: {'{cliente}'}, {'{primeiro_nome}'}, {'{pedido}'}, {'{itens}'}, {'{total}'}, {'{pagamento}'}, {'{tempo_estimado}'}, {'{link}'}, {'{loja}'}, {'{horarios}'}, {'{celular}'}, {'{endereco}'}, {'{subtotal}'}, {'{taxa_entrega}'}, {'{chave_pix}'} (so na mensagem de Pix).
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setTemplates({ ...DEFAULT_WHATSAPP_MESSAGES })}
                disabled={saving}
                className="rounded-full h-9"
              >
                Restaurar padrao
              </Button>
              <Button
                type="button"
                onClick={onSave}
                disabled={saving}
                className="rounded-full h-9 bg-emerald-600 hover:bg-emerald-700"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Salvar mensagens
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5 md:p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1.3fr] gap-3 rounded-2xl border bg-slate-50/70 p-4">
            {/* Resumo, nao um segundo painel: quem manda no link e a secao
                "Links de pedido". Aqui so mostra o que esta valendo. */}
            <div>
              <Label className="text-xs font-bold text-slate-700">Endereco que entra no {'{link}'}</Label>
              <Input value={storeLink || 'Link ainda indisponivel'} readOnly className="mt-2 rounded-xl bg-white font-mono text-xs" />
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[11px] text-slate-500">
                  Abre: <span className="font-bold text-slate-700">{getVariantByCode(messageVariant)?.title || 'Delivery'}</span>
                </span>
                <button
                  type="button"
                  onClick={onManageLinks}
                  className="text-[11px] font-bold text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
                >
                  Trocar em Links de pedido
                </button>
              </div>
            </div>
            <div>
              <Label className="text-xs font-bold text-slate-700">Horario usado na mensagem de fechado</Label>
              <pre className="mt-2 max-h-28 overflow-auto rounded-xl border bg-white p-3 text-xs text-slate-600 whitespace-pre-wrap">{formatWorkingHours(workingHours)}</pre>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {MESSAGE_KEYS.map((key) => (
              <div key={key} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm font-black text-slate-800">{WHATSAPP_MESSAGE_LABELS[key]}</Label>
                </div>
                <Textarea
                  value={templates[key]}
                  onChange={(event) => setTemplates((prev) => ({ ...prev, [key]: event.target.value }))}
                  className="min-h-[150px] rounded-xl text-sm leading-relaxed"
                />
                <div className="rounded-xl bg-slate-50 border p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Previa</p>
                  <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {renderWhatsAppTemplate(templates[key], sampleValues)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6">
      <Card className="rounded-2xl border-slate-200 shadow-sm overflow-hidden">
        <CardHeader className="border-b py-4">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </div>
          <Skeleton className="h-64 rounded-2xl" />
        </CardContent>
      </Card>
      <Card className="rounded-2xl border-slate-200 shadow-sm overflow-hidden">
        <CardHeader className="border-b py-4">
          <Skeleton className="h-5 w-56" />
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-11 rounded-full" />
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyState({ onLink, loading, disabled }: { onLink: (id: string, token: string) => void; loading: boolean; disabled: boolean }) {
  const [manualId, setManualId] = useState('');
  const [manualToken, setManualToken] = useState('');

  return (
    <div className="rounded-2xl border border-dashed border-emerald-300 bg-gradient-to-br from-emerald-50/80 via-white to-emerald-50/40 p-8 md:p-10 text-center relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 h-32 w-32 rounded-full bg-emerald-200/40 blur-2xl pointer-events-none" />
      <div className="relative">
        <div className="mx-auto h-16 w-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/30 mb-4">
          <Smartphone className="h-8 w-8 text-white" />
        </div>
        <h2 className="font-black text-lg text-slate-900">WhatsApp ainda nao conectado</h2>
        <p className="text-sm text-slate-600 mt-1.5 max-w-md mx-auto">
          Gere o QR Code e conecte o numero que a loja vai usar para falar com os clientes.
        </p>

        <div className="mt-6 max-w-sm mx-auto bg-white p-5 rounded-2xl border border-emerald-100 shadow-sm text-left">
          <h3 className="text-sm font-bold text-slate-800 mb-3">Usar instancia ja paga</h3>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">ID da instancia</Label>
              <Input
                id="wapiInstanceId"
                name="wapiInstanceId"
                autoComplete="off"
                data-lpignore="true"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="Ex: LITE-HYYZ0N..."
                className="text-xs h-9"
                disabled={disabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">Token da instancia</Label>
              <Input
                id="wapiToken"
                name="wapiToken"
                type="password"
                autoComplete="new-password"
                data-lpignore="true"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="Cole a chave aqui"
                className="text-xs h-9"
                disabled={disabled}
              />
            </div>
            <div className="pt-2 flex gap-2">
              <Button
                variant="outline"
                className="flex-1 h-9 text-xs"
                onClick={() => {
                  setManualId('');
                  setManualToken('');
                }}
                disabled={loading || disabled}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 h-9 text-xs bg-emerald-600 hover:bg-emerald-700"
                disabled={!manualId.trim() || !manualToken.trim() || loading || disabled}
                onClick={() => onLink(manualId.trim(), manualToken.trim())}
              >
                {loading ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <QrCode className="h-3 w-3 mr-2" />}
                Salvar e gerar QR
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-7 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto text-left">
          {[
            { n: 1, t: 'Conectar', d: 'Prepare o QR Code para o WhatsApp da loja.' },
            { n: 2, t: 'Escanear QR', d: 'Abra o WhatsApp do celular e leia o codigo gerado.' },
            { n: 3, t: 'Pronto', d: 'Notificacoes comecam a ser enviadas automaticamente.' },
          ].map((step) => (
            <div key={step.n} className="rounded-xl border border-emerald-100 bg-white/80 backdrop-blur p-3">
              <div className="h-6 w-6 rounded-full bg-emerald-600 text-white font-bold text-xs flex items-center justify-center mb-2">
                {step.n}
              </div>
              <p className="text-xs font-bold text-slate-900">{step.t}</p>
              <p className="text-[11px] text-slate-600 leading-snug mt-0.5">{step.d}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InfoGrid({
  storeName,
  integration,
}: {
  storeName: string;
  integration: Integration;
}) {
  const { toast } = useToast();

  const copyInstanceId = async () => {
    if (!integration.wapiInstanceId) return;
    try {
      await navigator.clipboard.writeText(integration.wapiInstanceId);
      toast({ title: 'ID copiado', description: 'ID da instancia copiado para a area de transferencia.' });
    } catch {
      toast({ variant: 'destructive', title: 'Nao foi possivel copiar', description: 'Copie o ID manualmente.' });
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="rounded-xl border bg-white p-3.5">
        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Loja</p>
        <p className="font-bold text-slate-900 truncate mt-0.5">{storeName}</p>
      </div>
      <div className="rounded-xl border bg-white p-3.5">
        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
          {integration.numeroWhatsapp ? 'Numero conectado' : 'Conexao'}
        </p>
        <p className="font-bold text-slate-900 mt-0.5 flex items-center gap-1.5">
          {integration.numeroWhatsapp ? (
            <>
              <Phone className="h-3.5 w-3.5 text-emerald-600" />
              {integration.numeroWhatsapp}
            </>
          ) : integration.connected || integration.status === 'connected' ? (
            <span className="text-emerald-700 text-sm">WhatsApp conectado</span>
          ) : (
            <span className="text-slate-400 font-normal text-sm">Aguardando conexao</span>
          )}
        </p>
      </div>
      <div className="rounded-xl border bg-white p-3.5 md:col-span-2">
        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 flex items-center gap-1">
          <Hash className="h-3 w-3 text-slate-400" />
          ID da instancia
        </p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <code className="font-mono text-sm font-bold text-slate-900 truncate">
            {integration.wapiInstanceId || '—'}
          </code>
          {integration.wapiInstanceId && (
            <button
              type="button"
              onClick={copyInstanceId}
              title="Copiar ID da instancia"
              className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50 hover:text-emerald-700 transition-colors"
            >
              <Copy className="h-3 w-3" />
              Copiar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function QrSection({
  qrCode,
  status,
  pairing,
  loading,
  exhausted,
  onStartPairing,
}: {
  qrCode: string;
  status?: IntegrationStatus;
  pairing: boolean;
  loading: boolean;
  exhausted: boolean;
  onStartPairing: () => void;
}) {
  return (
    <div className="rounded-2xl border bg-gradient-to-br from-white via-emerald-50/30 to-white p-6 flex flex-col items-center justify-center min-h-[360px] relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(16,185,129,0.08),transparent_70%)] pointer-events-none" />

      {!pairing ? (
        <div className="relative text-center max-w-sm">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-emerald-100 flex items-center justify-center mb-3">
            <Smartphone className="h-7 w-7 text-emerald-700" />
          </div>
          <p className="font-black text-slate-900">Conectar o celular da loja</p>
          <p className="text-sm text-slate-600 mt-1.5">
            Gere o QR Code so quando o celular estiver na mao para escanear. Gerar o codigo
            desconecta qualquer aparelho que ja esteja ligado nesta conexao.
          </p>
          <Button
            onClick={onStartPairing}
            disabled={loading}
            className="mt-5 rounded-full h-11 px-6 bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-500/20"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <QrCode className="h-4 w-4 mr-2" />}
            Gerar QR Code
          </Button>
          {status === 'error' && (
            <p className="text-xs text-red-700 mt-3">Houve um erro na ultima conexao.</p>
          )}
        </div>
      ) : qrCode ? (
        <div className="relative flex flex-col items-center">
          <div className="relative">
            <div className="absolute inset-0 rounded-2xl bg-emerald-400/20 blur-xl" />
            <div className="relative rounded-2xl border-2 border-emerald-100 bg-white p-3 shadow-lg shadow-emerald-500/10">
              <img src={qrCode} alt="QR Code WhatsApp" className="w-60 h-60 object-contain" />
            </div>
            <div className="absolute -top-2 -right-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500 text-white text-[10px] font-bold uppercase tracking-wider shadow-md">
              <Loader2 className="h-3 w-3 animate-spin" />
              Aguardando
            </div>
          </div>

          <div className="mt-5 max-w-sm text-center">
            <p className="font-bold text-slate-900 text-sm">Escaneie o QR Code com seu celular</p>
            <ol className="text-xs text-slate-600 mt-2 space-y-1 text-left bg-white/80 backdrop-blur rounded-xl border border-slate-200 p-3">
              <li><span className="font-bold text-emerald-700">1.</span> Abra o WhatsApp no celular da loja</li>
              <li><span className="font-bold text-emerald-700">2.</span> Toque em <strong>Configuracoes &gt; Aparelhos conectados</strong></li>
              <li><span className="font-bold text-emerald-700">3.</span> Selecione <strong>Conectar um aparelho</strong> e aponte para o codigo</li>
            </ol>
            <p className="text-[11px] text-slate-500 mt-2">
              {exhausted
                ? 'O codigo expirou. Clique em Gerar novo QR Code quando estiver pronto.'
                : 'A tela acompanha a conexao automaticamente.'}
            </p>
            {exhausted && (
              <Button
                onClick={onStartPairing}
                disabled={loading}
                variant="outline"
                className="mt-3 rounded-full h-9"
              >
                <QrCode className="h-4 w-4 mr-2" />
                Gerar novo QR Code
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-amber-100 flex items-center justify-center mb-3">
            <AlertTriangle className="h-7 w-7 text-amber-600" />
          </div>
          <p className="font-bold text-slate-900">QR Code indisponivel no momento</p>
          <p className="text-sm text-slate-600 mt-1">
            {status === 'error' ? 'Houve um erro na conexao.' : 'Tente gerar o codigo de novo em instantes.'}
          </p>
          <Button onClick={onStartPairing} disabled={loading} variant="outline" className="mt-4 rounded-full h-9">
            <QrCode className="h-4 w-4 mr-2" />
            Gerar QR Code
          </Button>
        </div>
      )}
    </div>
  );
}

function ConnectedCard({ numero }: { numero?: string }) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-emerald-50/60 to-white p-5 relative overflow-hidden">
      <div className="absolute top-0 right-0 h-32 w-32 bg-emerald-200/30 blur-3xl rounded-full pointer-events-none" />
      <div className="relative flex items-start gap-4">
        <div className="h-12 w-12 rounded-2xl bg-emerald-600 flex items-center justify-center shadow-md shadow-emerald-500/30 shrink-0">
          <CheckCircle2 className="h-6 w-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-black text-emerald-900 text-base">WhatsApp conectado</p>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-emerald-200 text-emerald-700 text-[10px] font-bold">
              <Wifi className="h-3 w-3" />
              Online
            </span>
          </div>
          <p className="text-sm text-emerald-800 mt-1">
            As notificacoes desta loja serao enviadas automaticamente por este WhatsApp.
          </p>
          {numero && (
            <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-emerald-200">
              <Phone className="h-3.5 w-3.5 text-emerald-600" />
              <span className="font-mono text-sm font-bold text-slate-900">{numero}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
