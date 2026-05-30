'use client';

import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  MessageCircle,
  Phone,
  Power,
  QrCode,
  RefreshCw,
  Save,
  Send,
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
  'orderReadyDelivery',
  'orderReadyPickup',
  'orderReadyDineIn',
  'orderOutForDelivery',
  'orderPickupReady',
  'orderDineInReady',
  'storeClosed',
];

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
    case 'pending_qr': return 'Aguardando QR Code';
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
  const [testMessage, setTestMessage] = useState('Ola! Esta e uma mensagem de teste do cardapio digital.');
  const [activeSection, setActiveSection] = useState<'conexao' | 'mensagens'>('conexao');
  const [messageTemplates, setMessageTemplates] = useState<WhatsAppMessageTemplates>(() => getWhatsAppMessages(storeProfile?.whatsappMessages));
  const [savingMessages, setSavingMessages] = useState(false);

  const empresaId = user?.uid || '';
  const storeName = storeProfile?.general?.name || storeProfile?.storeName || user?.displayName || 'Minha loja';
  const storeLink = empresaId && typeof window !== 'undefined' ? buildStoreLink(storeProfile, empresaId, window.location.origin) : '';

  useEffect(() => {
    setMessageTemplates(getWhatsAppMessages(storeProfile?.whatsappMessages));
  }, [storeProfile?.whatsappMessages]);

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
      if (data.integration?.tokenConfigured) {
        setIntegration(data.integration);
        if (data.integration.qrCode) setQrCode(data.integration.qrCode);
        return true;
      }

      setIntegration(null);
      setQrCode('');
      return false;
    } catch {
      // Sem dados salvos; mostra tela de criacao
      setIntegration(null);
      setQrCode('');
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
      if (data.integration?.qrCode) setQrCode(data.integration.qrCode);
    } catch (error: any) {
      // Se falhar a checagem ao vivo, NAO apaga a integracao salva
      if (!/ainda nao configurado/i.test(error.message)) {
        if (!silent) toast({ variant: 'destructive', title: 'Erro no WhatsApp', description: error.message });
      } else {
        // Realmente nao tem integracao configurada
        setIntegration(null);
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
      setQrCode(data.qrCode || '');
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
    const interval = integration.connected ? 60000 : 8000;
    const timer = setInterval(() => loadStatus(true), interval);
    return () => clearInterval(timer);
  }, [integration?.wapiInstanceId, integration?.connected, loadStatus]);

  useEffect(() => {
    if (!integration || integration.connected || qrCode) return;
    refreshQrCode(true);
  }, [integration?.wapiInstanceId, integration?.connected, qrCode, refreshQrCode]);

  async function createInstance() {
    setLoading(true);
    try {
      const data = await apiFetch('/wapi/create-instance', {
        method: 'POST',
        body: JSON.stringify({ empresaId, instanceName: storeName }),
      });
      setIntegration(data.integration);
      setQrCode(data.qrCode || data.integration?.qrCode || '');
      toast({ title: 'WhatsApp pronto para conectar', description: 'Escaneie o QR Code para conectar o numero da loja.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Erro ao preparar WhatsApp', description: error.message });
    } finally {
      setLoading(false);
    }
  }

  async function linkInstance(wapiInstanceId: string, token: string) {
    setLoading(true);
    try {
      const data = await apiFetch('/wapi/link-instance', {
        method: 'POST',
        body: JSON.stringify({ empresaId, instanceName: storeName, wapiInstanceId, token }),
      });
      setIntegration(data.integration);
      setQrCode(data.qrCode || data.integration?.qrCode || '');
      toast({ title: 'WhatsApp vinculado', description: 'A conexao foi vinculada a esta loja com sucesso.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Erro ao vincular', description: error.message });
    } finally {
      setLoading(false);
    }
  }

  async function reconnect() {
    setLoading(true);
    try {
      const data = await apiFetch('/wapi/reconnect', {
        method: 'POST',
        body: JSON.stringify({ empresaId }),
      });
      setIntegration(data.integration);
      setQrCode(data.qrCode || '');
      toast({ title: 'Reconexao iniciada', description: 'Escaneie o novo QR Code se necessario.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Erro ao reconectar', description: error.message });
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

      <div className="grid w-full grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm md:w-[520px]">
        <Button
          type="button"
          variant={activeSection === 'conexao' ? 'default' : 'ghost'}
          onClick={() => setActiveSection('conexao')}
          className={`rounded-xl h-11 px-2 text-xs sm:text-sm whitespace-normal leading-tight ${activeSection === 'conexao' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
        >
          <Wifi className="h-4 w-4 mr-2" />
          Conexao
        </Button>
        <Button
          type="button"
          variant={activeSection === 'mensagens' ? 'default' : 'ghost'}
          onClick={() => setActiveSection('mensagens')}
          className={`rounded-xl h-11 px-2 text-xs sm:text-sm whitespace-normal leading-tight ${activeSection === 'mensagens' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
        >
          <MessageCircle className="h-4 w-4 mr-2" />
          Mensagens automaticas
        </Button>
      </div>

      {activeSection === 'mensagens' ? (
        <MessageTemplatesSection
          templates={messageTemplates}
          setTemplates={setMessageTemplates}
          onSave={saveMessageTemplates}
          saving={savingMessages}
          storeLink={storeLink}
          storeName={storeName}
          workingHours={storeProfile?.workingHours}
          storeProfile={storeProfile}
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
                    connected={isConnected}
                    loading={loading || loadingStatus}
                    status={status}
                    onRefreshQr={() => refreshQrCode()}
                    onReconnect={reconnect}
                    onDisconnect={disconnect}
                  />

                  {!isConnected ? (
                    <QrSection qrCode={qrCode} status={status} />
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

              {/* Help block */}
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">Como funciona</p>
                <ul className="text-xs text-slate-600 space-y-1.5">
                  <li className="flex gap-2"><ChevronRight className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />Cada loja usa o seu proprio WhatsApp.</li>
                  <li className="flex gap-2"><ChevronRight className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />A conexao e acompanhada automaticamente.</li>
                  <li className="flex gap-2"><ChevronRight className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />Mantenha o celular online para nao perder notificacoes.</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function ConnectionSupportActions({
  connected,
  loading,
  status,
  onRefreshQr,
  onReconnect,
  onDisconnect,
}: {
  connected: boolean;
  loading: boolean;
  status?: IntegrationStatus;
  onRefreshQr: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  const needsQr = !connected && status !== 'connected';
  const needsReconnect = !connected || status === 'disconnected' || status === 'error';

  return (
    <div className="flex flex-wrap gap-2">
      {needsQr && (
        <Button variant="outline" onClick={onRefreshQr} disabled={loading} className="h-9 rounded-lg bg-white">
          <QrCode className="h-4 w-4" />
          Novo QR
        </Button>
      )}
      {needsReconnect && (
        <Button variant="outline" onClick={onReconnect} disabled={loading} className="h-9 rounded-lg bg-white">
          <RefreshCw className="h-4 w-4" />
          Reconectar
        </Button>
      )}
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

function MessageTemplatesSection({
  templates,
  setTemplates,
  onSave,
  saving,
  storeLink,
  storeName,
  workingHours,
  storeProfile,
}: {
  templates: WhatsAppMessageTemplates;
  setTemplates: React.Dispatch<React.SetStateAction<WhatsAppMessageTemplates>>;
  onSave: () => void;
  saving: boolean;
  storeLink: string;
  storeName: string;
  workingHours?: any[];
  storeProfile?: any;
}) {
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
                Variaveis disponiveis: {'{cliente}'}, {'{primeiro_nome}'}, {'{pedido}'}, {'{itens}'}, {'{total}'}, {'{pagamento}'}, {'{tempo_estimado}'}, {'{link}'}, {'{loja}'}, {'{horarios}'}, {'{celular}'}, {'{endereco}'}, {'{subtotal}'}, {'{taxa_entrega}'}.
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
            <div>
              <Label className="text-xs font-bold text-slate-700">Link automatico do cardapio</Label>
              <Input value={storeLink || 'Link ainda indisponivel'} readOnly className="mt-2 rounded-xl bg-white font-mono text-xs" />
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
    </div>
  );
}

function QrSection({ qrCode, status }: { qrCode: string; status?: IntegrationStatus }) {
  return (
    <div className="rounded-2xl border bg-gradient-to-br from-white via-emerald-50/30 to-white p-6 flex flex-col items-center justify-center min-h-[360px] relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(16,185,129,0.08),transparent_70%)] pointer-events-none" />

      {qrCode ? (
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
            <p className="text-[11px] text-slate-500 mt-2">A tela acompanha a conexao automaticamente.</p>
          </div>
        </div>
      ) : (
        <div className="text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-amber-100 flex items-center justify-center mb-3">
            <AlertTriangle className="h-7 w-7 text-amber-600" />
          </div>
          <p className="font-bold text-slate-900">QR Code indisponivel no momento</p>
          <p className="text-sm text-slate-600 mt-1">
            {status === 'error' ? 'Houve um erro na conexao.' : 'Use Novo QR ou Reconectar para gerar um novo codigo.'}
          </p>
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
