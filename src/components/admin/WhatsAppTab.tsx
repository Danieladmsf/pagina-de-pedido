'use client';

import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MessageCircle,
  Power,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

function statusClass(status?: IntegrationStatus) {
  switch (status) {
    case 'connected': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'pending_qr': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'disconnected': return 'bg-slate-100 text-slate-700 border-slate-200';
    case 'error': return 'bg-red-100 text-red-700 border-red-200';
    default: return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

export function WhatsAppTab({ user, storeProfile }: WhatsAppTabProps) {
  const { toast } = useToast();
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [qrCode, setQrCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
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

  const loadStatus = React.useCallback(async (silent = false) => {
    if (!empresaId) return;
    if (!silent) setLoadingStatus(true);
    try {
      const data = await apiFetch(`/wapi/status/${empresaId}`);
      setIntegration(data.integration);
      if (data.integration?.qrCode) setQrCode(data.integration.qrCode);
    } catch (error: any) {
      if (!/ainda nao configurado/i.test(error.message)) {
        if (!silent) toast({ variant: 'destructive', title: 'Erro no WhatsApp', description: error.message });
      }
      setIntegration(null);
    } finally {
      if (!silent) setLoadingStatus(false);
    }
  }, [empresaId, user]);

  useEffect(() => {
    loadStatus(true);
  }, [loadStatus]);

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
    if (!confirm('Desconectar este WhatsApp da loja?')) return;
    setLoading(true);
    try {
      const data = await apiFetch('/wapi/disconnect', {
        method: 'POST',
        body: JSON.stringify({ empresaId }),
      });
      setIntegration(data.integration);
      setQrCode('');
      toast({ title: 'WhatsApp desconectado' });
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

  const isConnected = integration?.connected || integration?.status === 'connected';

  return (
    <div className="max-w-[1500px] w-full mx-auto p-4 md:p-6 space-y-5 overflow-y-auto custom-scrollbar">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold uppercase tracking-wider mb-3">
            <MessageCircle className="h-3.5 w-3.5" />
            WhatsApp
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900">Conectar WhatsApp</h1>
          <p className="text-muted-foreground mt-1 font-medium">
            Cada loja tem uma instancia W-API isolada, com QR Code e status proprios.
          </p>
        </div>

        <Badge className={`border font-bold px-3 py-1.5 ${statusClass(integration?.status)}`}>
          {statusLabel(integration?.status)}
        </Badge>
      </div>

      <Alert className="border-emerald-200 bg-emerald-50/80">
        <ShieldCheck className="h-4 w-4 text-emerald-700" />
        <AlertTitle className="text-emerald-900">Tokens protegidos</AlertTitle>
        <AlertDescription className="text-emerald-800">
          O token principal da W-API fica apenas no servidor. O token da instancia e salvo criptografado e nao aparece no navegador.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-5">
        <Card className="rounded-2xl border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="border-b bg-white">
            <CardTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-emerald-600" />
              Instancia da loja
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-5">
            {!integration ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                <Smartphone className="h-10 w-10 text-slate-400 mx-auto mb-3" />
                <h2 className="font-black text-slate-800">WhatsApp ainda nao conectado</h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                  Clique para criar uma instancia exclusiva dessa empresa na W-API e gerar o QR Code.
                </p>
                <Button onClick={createInstance} disabled={loading || !user} className="mt-5 rounded-full bg-emerald-600 hover:bg-emerald-700">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <QrCode className="h-4 w-4 mr-2" />}
                  Criar instancia e gerar QR Code
                </Button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-xl border bg-slate-50 p-3">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Empresa</p>
                    <p className="font-bold text-slate-900 truncate">{storeName}</p>
                  </div>
                  <div className="rounded-xl border bg-slate-50 p-3">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Instancia W-API</p>
                    <p className="font-mono text-xs font-bold text-slate-900 truncate">{integration.wapiInstanceId}</p>
                  </div>
                  <div className="rounded-xl border bg-slate-50 p-3">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Numero conectado</p>
                    <p className="font-bold text-slate-900">{integration.numeroWhatsapp || '-'}</p>
                  </div>
                  <div className="rounded-xl border bg-slate-50 p-3">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Ultima verificacao</p>
                    <p className="font-bold text-slate-900">
                      {integration.lastStatusAt ? new Date(integration.lastStatusAt).toLocaleString('pt-BR') : '-'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => loadStatus()} disabled={loadingStatus || loading} className="rounded-full">
                    {loadingStatus ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Verificar status
                  </Button>
                  <Button variant="outline" onClick={refreshQrCode} disabled={loading} className="rounded-full">
                    <QrCode className="h-4 w-4 mr-2" />
                    Atualizar QR
                  </Button>
                  <Button variant="outline" onClick={reconnect} disabled={loading} className="rounded-full">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Reconectar
                  </Button>
                  <Button variant="outline" onClick={disconnect} disabled={loading} className="rounded-full text-red-600 border-red-200 hover:bg-red-50">
                    <Power className="h-4 w-4 mr-2" />
                    Desconectar
                  </Button>
                </div>

                {!isConnected && (
                  <div className="rounded-2xl border bg-white p-5 flex flex-col items-center justify-center min-h-[340px]">
                    {qrCode ? (
                      <>
                        <img src={qrCode} alt="QR Code WhatsApp" className="w-64 h-64 object-contain rounded-xl border bg-white p-2" />
                        <p className="text-sm text-muted-foreground mt-4 text-center max-w-sm">
                          Abra o WhatsApp no celular da loja e escaneie o QR Code. O status atualiza automaticamente.
                        </p>
                      </>
                    ) : (
                      <div className="text-center">
                        <AlertTriangle className="h-9 w-9 text-amber-500 mx-auto mb-3" />
                        <p className="font-bold">QR Code indisponivel no momento.</p>
                        <p className="text-sm text-muted-foreground">Clique em Atualizar QR ou Reconectar.</p>
                      </div>
                    )}
                  </div>
                )}

                {isConnected && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 flex items-start gap-3">
                    <CheckCircle2 className="h-6 w-6 text-emerald-600 mt-0.5" />
                    <div>
                      <p className="font-black text-emerald-900">WhatsApp conectado</p>
                      <p className="text-sm text-emerald-800">
                        As notificacoes desta loja serao enviadas por esta instancia.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="border-b bg-white">
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-emerald-600" />
              Enviar mensagem de teste
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input
                value={testPhone}
                onChange={(event) => setTestPhone(event.target.value)}
                placeholder="Ex: 16999999999"
              />
              <p className="text-xs text-muted-foreground">Use DDD + numero. Se nao tiver 55, o sistema adiciona automaticamente.</p>
            </div>
            <div className="space-y-2">
              <Label>Mensagem</Label>
              <Textarea
                value={testMessage}
                onChange={(event) => setTestMessage(event.target.value)}
                className="min-h-[130px]"
              />
            </div>
            <Button
              onClick={sendTestMessage}
              disabled={loading || !integration || !isConnected || !testPhone.trim() || !testMessage.trim()}
              className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Enviar teste
            </Button>
            {!isConnected && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                Conecte o WhatsApp antes de enviar mensagens.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
