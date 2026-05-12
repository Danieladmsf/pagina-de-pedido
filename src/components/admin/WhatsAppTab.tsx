'use client';

import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Copy,
  Loader2,
  MessageCircle,
  Phone,
  Power,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Wifi,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

interface WhatsAppTabProps {
  user: User | null;
  storeProfile?: any;
}

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

export function WhatsAppTab({ user, storeProfile }: WhatsAppTabProps) {
  const { toast } = useToast();
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [qrCode, setQrCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('Ola! Esta e uma mensagem de teste do cardapio digital.');

  const empresaId = user?.uid || '';
  const storeName = storeProfile?.general?.name || storeProfile?.storeName || user?.displayName || 'Minha loja';

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
      return;
    }
    try {
      const data = await apiFetch(`/wapi/integration/${empresaId}`);
      if (data.integration) {
        setIntegration(data.integration);
        if (data.integration.qrCode) setQrCode(data.integration.qrCode);
      }
    } catch {
      // Sem dados salvos — mostra tela de criacao
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

  useEffect(() => {
    loadSavedIntegration().then(() => {
      // Depois de carregar do Firestore, faz checagem ao vivo em background
      loadStatus(true);
    });
  }, [loadSavedIntegration, loadStatus]);

  useEffect(() => {
    if (!integration || integration.connected || !qrCode) return;
    const timer = setInterval(() => loadStatus(true), 8000);
    return () => clearInterval(timer);
  }, [integration, qrCode, loadStatus]);

  async function createInstance() {
    setLoading(true);
    try {
      const data = await apiFetch('/wapi/create-instance', {
        method: 'POST',
        body: JSON.stringify({ empresaId, instanceName: storeName }),
      });
      setIntegration(data.integration);
      setQrCode(data.qrCode || data.integration?.qrCode || '');
      toast({ title: 'Instancia criada', description: 'Escaneie o QR Code para conectar o WhatsApp.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Erro ao criar instancia', description: error.message });
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
      toast({ title: 'Instancia vinculada', description: 'A instancia foi vinculada a esta loja com sucesso.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Erro ao vincular', description: error.message });
    } finally {
      setLoading(false);
    }
  }

  async function refreshQrCode() {
    setLoading(true);
    try {
      const data = await apiFetch(`/wapi/qrcode/${empresaId}`);
      setIntegration(data.integration);
      setQrCode(data.qrCode || '');
      toast({ title: 'QR Code atualizado' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Erro ao buscar QR Code', description: error.message });
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
    if (!confirm('Desconectar e remover esta instancia WhatsApp? Voce podera criar uma nova depois.')) return;
    setLoading(true);
    try {
      await apiFetch('/wapi/disconnect', {
        method: 'POST',
        body: JSON.stringify({ empresaId }),
      });
      setIntegration(null);
      setQrCode('');
      toast({ title: 'WhatsApp desconectado', description: 'Clique em Criar instancia para conectar novamente.' });
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
      toast({ title: 'Mensagem enviada', description: 'A W-API colocou a mensagem na fila de envio.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Erro ao enviar mensagem', description: error.message });
    } finally {
      setLoading(false);
    }
  }

  async function copyInstanceId() {
    if (!integration?.wapiInstanceId) return;
    try {
      await navigator.clipboard.writeText(integration.wapiInstanceId);
      toast({ title: 'ID copiado', description: 'Identificador da instancia copiado para a area de transferencia.' });
    } catch {
      toast({ variant: 'destructive', title: 'Nao foi possivel copiar', description: 'Selecione e copie manualmente.' });
    }
  }

  const isConnected = integration?.connected || integration?.status === 'connected';
  const status = integration?.status;

  return (
    <div className="max-w-[1500px] w-full mx-auto p-4 md:p-8 space-y-6 overflow-y-auto custom-scrollbar">
      {/* HERO */}
      <div className="relative overflow-hidden rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-white p-6 md:p-8">
        <div className="absolute -top-16 -right-16 h-56 w-56 rounded-full bg-emerald-200/40 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-emerald-100/60 blur-3xl pointer-events-none" />

        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div className="flex items-start gap-4">
            <div className="hidden md:flex h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 items-center justify-center shadow-lg shadow-emerald-500/30 shrink-0">
              <MessageCircle className="h-7 w-7 text-white" />
            </div>
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-wider mb-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Integracao WhatsApp Business
              </div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900">Conectar WhatsApp</h1>
              <p className="text-slate-600 mt-1 text-sm md:text-[15px] max-w-2xl">
                Cada loja tem uma instancia W-API isolada, com QR Code e status proprios.
                As notificacoes de pedidos sao enviadas automaticamente por esse numero.
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
            {!initialLoading && integration?.lastStatusAt && (
              <p className="text-[11px] text-slate-500">
                Verificado em {new Date(integration.lastStatusAt).toLocaleString('pt-BR')}
              </p>
            )}
          </div>
        </div>
      </div>

      <Alert className="border-emerald-200 bg-emerald-50/60">
        <ShieldCheck className="h-4 w-4 text-emerald-700" />
        <AlertTitle className="text-emerald-900">Tokens protegidos</AlertTitle>
        <AlertDescription className="text-emerald-800">
          O token principal da W-API fica apenas no servidor. O token da instancia e salvo criptografado e nao aparece no navegador.
        </AlertDescription>
      </Alert>

      {initialLoading ? (
        <LoadingState />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6">
          {/* INSTANCE CARD */}
          <Card className="rounded-2xl border-slate-200 shadow-sm overflow-hidden">
            <CardHeader className="border-b bg-gradient-to-r from-white to-slate-50/50 py-4">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <QrCode className="h-5 w-5 text-emerald-600" />
                  Instancia da loja
                </span>
                {integration && (
                  <Badge variant="outline" className="font-mono text-[10px] font-bold">
                    {integration.wapiInstanceId.slice(0, 12)}...
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 md:p-6 space-y-5">
              {!integration ? (
                <EmptyState onCreate={createInstance} onLink={linkInstance} loading={loading} disabled={!user} />
              ) : (
                <>
                  <InfoGrid
                    storeName={storeName}
                    integration={integration}
                    onCopyId={copyInstanceId}
                  />

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => loadStatus()}
                      disabled={loadingStatus || loading}
                      className="rounded-full h-9"
                    >
                      {loadingStatus ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                      Verificar status
                    </Button>
                    <Button variant="outline" onClick={refreshQrCode} disabled={loading} className="rounded-full h-9">
                      <QrCode className="h-4 w-4 mr-2" />
                      Atualizar QR
                    </Button>
                    <Button variant="outline" onClick={reconnect} disabled={loading} className="rounded-full h-9">
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Reconectar
                    </Button>
                    <Button
                      variant="outline"
                      onClick={disconnect}
                      disabled={loading}
                      className="rounded-full h-9 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                    >
                      <Power className="h-4 w-4 mr-2" />
                      Desconectar
                    </Button>
                  </div>

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
                  Crie a instancia para liberar o envio de mensagens.
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
                  <li className="flex gap-2"><ChevronRight className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />Cada empresa usa uma instancia W-API exclusiva.</li>
                  <li className="flex gap-2"><ChevronRight className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />O QR Code expira em poucos minutos, gere um novo se precisar.</li>
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

function EmptyState({ onCreate, onLink, loading, disabled }: { onCreate: () => void; onLink: (id: string, token: string) => void; loading: boolean; disabled: boolean }) {
  const [showManual, setShowManual] = useState(false);
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
          Crie uma instancia exclusiva da W-API para esta loja e gere o QR Code para parear seu numero.
        </p>

        {!showManual ? (
          <>
            <Button
              onClick={onCreate}
              disabled={loading || disabled}
              className="mt-6 rounded-full bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 shadow-lg shadow-emerald-500/30 h-11 px-6 w-full max-w-sm mx-auto"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <QrCode className="h-4 w-4 mr-2" />}
              Criar instancia automaticamente
            </Button>
            
            <div className="mt-4">
              <button 
                onClick={() => setShowManual(true)} 
                className="text-xs text-emerald-700 font-medium hover:underline"
              >
                Ou vincular instancia W-API ja existente
              </button>
            </div>
          </>
        ) : (
          <div className="mt-6 max-w-sm mx-auto bg-white p-5 rounded-2xl border border-emerald-100 shadow-sm text-left">
            <h3 className="text-sm font-bold text-slate-800 mb-3">Vincular Instancia Manualmente</h3>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-600">ID da Instancia</Label>
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
                <Label className="text-xs text-slate-600">Token da Instancia</Label>
                <Input 
                  id="wapiToken"
                  name="wapiToken"
                  type="password"
                  autoComplete="new-password"
                  data-lpignore="true"
                  value={manualToken} 
                  onChange={(e) => setManualToken(e.target.value)} 
                  placeholder="Cole o token aqui" 
                  className="text-xs h-9"
                  disabled={disabled}
                />
              </div>
              <div className="pt-2 flex gap-2">
                <Button 
                  variant="outline" 
                  className="flex-1 h-9 text-xs" 
                  onClick={() => setShowManual(false)}
                >
                  Cancelar
                </Button>
                <Button 
                  className="flex-1 h-9 text-xs bg-emerald-600 hover:bg-emerald-700" 
                  disabled={!manualId.trim() || !manualToken.trim() || loading || disabled}
                  onClick={() => onLink(manualId.trim(), manualToken.trim())}
                >
                  {loading ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <QrCode className="h-3 w-3 mr-2" />}
                  Vincular e Gerar QR
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="mt-7 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto text-left">
          {[
            { n: 1, t: 'Criar/Vincular', d: 'Tenha uma sessao W-API exclusiva vinculada a esta loja.' },
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
  onCopyId,
}: {
  storeName: string;
  integration: Integration;
  onCopyId: () => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="rounded-xl border bg-white p-3.5">
        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Empresa</p>
        <p className="font-bold text-slate-900 truncate mt-0.5">{storeName}</p>
      </div>
      <div className="rounded-xl border bg-white p-3.5">
        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Instancia W-API</p>
        <button
          onClick={onCopyId}
          className="group flex items-center gap-1.5 mt-0.5 hover:text-emerald-600 transition-colors"
          title="Copiar ID"
        >
          <span className="font-mono text-xs font-bold text-slate-900 truncate group-hover:text-emerald-600">
            {integration.wapiInstanceId}
          </span>
          <Copy className="h-3 w-3 text-slate-400 group-hover:text-emerald-600 shrink-0" />
        </button>
      </div>
      <div className="rounded-xl border bg-white p-3.5">
        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Numero conectado</p>
        <p className="font-bold text-slate-900 mt-0.5 flex items-center gap-1.5">
          {integration.numeroWhatsapp ? (
            <>
              <Phone className="h-3.5 w-3.5 text-emerald-600" />
              {integration.numeroWhatsapp}
            </>
          ) : (
            <span className="text-slate-400 font-normal text-sm">Aguardando conexao</span>
          )}
        </p>
      </div>
      <div className="rounded-xl border bg-white p-3.5">
        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Ultima verificacao</p>
        <p className="font-bold text-slate-900 text-sm mt-0.5">
          {integration.lastStatusAt ? new Date(integration.lastStatusAt).toLocaleString('pt-BR') : '-'}
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
            <p className="text-[11px] text-slate-500 mt-2">O status atualiza automaticamente a cada 8 segundos.</p>
          </div>
        </div>
      ) : (
        <div className="text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-amber-100 flex items-center justify-center mb-3">
            <AlertTriangle className="h-7 w-7 text-amber-600" />
          </div>
          <p className="font-bold text-slate-900">QR Code indisponivel no momento</p>
          <p className="text-sm text-slate-600 mt-1">
            {status === 'error' ? 'Houve um erro na instancia.' : 'Clique em Atualizar QR ou Reconectar para gerar um novo codigo.'}
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
            As notificacoes desta loja serao enviadas automaticamente por esta instancia.
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
