'use client';

import React, { useMemo, useRef, useState } from 'react';
import { useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, doc, setDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { uploadImage } from '@/lib/upload';
import { buildStoreLink } from '@/lib/whatsapp-messages';
import {
  Megaphone, Send, ImagePlus, Users, Clock, Sparkles, Info, X, Save,
  Rocket, ChevronRight, Timer, Loader2, CheckCircle2, AlertTriangle, Ban,
} from 'lucide-react';
import { WhatsAppPreview } from './WhatsAppPreview';
import {
  AUDIENCE_PRESETS, MESSAGE_TOKENS, EMPTY_DRAFT, renderMessage, estimateMinutes, resolveAudience,
  type ClientLike,
} from '@/lib/campanhas/audience';
import type { AudienceId, CampaignDraft } from '@/lib/campanhas/types';
import { sendCampaign, type SendProgress, type SendCampaignResult } from '@/lib/campanhas/campaign-service';

interface CampanhasTabProps {
  db?: any;
  user?: any;
  storeProfile?: any;
}

const DELAY_PRESETS = [5, 8, 12, 20];

export function CampanhasTab({ db, user, storeProfile }: CampanhasTabProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<CampaignDraft>(EMPTY_DRAFT);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const [result, setResult] = useState<SendCampaignResult | null>(null);
  const cancelRef = useRef(false);

  const storeName = storeProfile?.general?.name || storeProfile?.storeName || 'Minha Loja';
  const storeLogo = storeProfile?.general?.logoUrl || storeProfile?.logoUrl;
  const link = buildStoreLink(storeProfile, user?.uid, typeof window !== 'undefined' ? window.location.origin : undefined);

  // Base de clientes (mesma fonte da aba Clientes)
  const clientesQuery = useMemoFirebase(
    () => (db && user ? query(collection(db, 'clientes'), where('ownerId', '==', user.uid)) : null),
    [db, user],
  );
  const { data: clientesRaw } = useCollection(clientesQuery);
  const clients = (clientesRaw || []) as ClientLike[];

  // Histórico de campanhas
  const campaignsQuery = useMemoFirebase(
    () => (db && user ? query(collection(db, 'campaigns'), where('ownerId', '==', user.uid)) : null),
    [db, user],
  );
  const { data: campaignsRaw } = useCollection(campaignsQuery);
  const history = useMemo(
    () => [...((campaignsRaw || []) as any[])].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [campaignsRaw],
  );

  const set = (patch: Partial<CampaignDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const audience = AUDIENCE_PRESETS.find((a) => a.id === draft.audienceId)!;
  const targets = useMemo(() => resolveAudience(clients, draft.audienceId), [clients, draft.audienceId]);
  const audienceCount = targets.length;
  const minutes = estimateMinutes(audienceCount, draft.delaySeconds);

  const previewText = useMemo(
    () => renderMessage(draft.message, { primeiro_nome: 'Maria', nome: 'Maria Silva', loja: storeName, link }),
    [draft.message, storeName, link],
  );

  const canSend = (draft.message.trim().length > 0 || !!imageFile) && audienceCount > 0;

  const insertToken = (token: string) => set({ message: (draft.message ? draft.message + ' ' : '') + token });

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setImageFile(file); set({ imageUrl: URL.createObjectURL(file) }); }
    e.target.value = '';
  };
  const removeImage = () => { setImageFile(null); set({ imageUrl: null }); };

  const startDispatch = async () => {
    if (!db || !user) return;
    setSending(true);
    setResult(null);
    setProgress({ total: audienceCount, sent: 0, failed: 0, done: false });
    cancelRef.current = false;
    try {
      let uploadedUrl: string | null = null;
      if (imageFile) uploadedUrl = await uploadImage(imageFile);

      const res = await sendCampaign({
        empresaId: user.uid,
        getToken: () => user.getIdToken(),
        targets,
        message: draft.message,
        imageUrl: uploadedUrl,
        loja: storeName,
        link,
        delaySeconds: draft.delaySeconds,
        onProgress: setProgress,
        shouldCancel: () => cancelRef.current,
      });
      setResult(res);

      // Salva no histórico
      const id = doc(collection(db, 'campaigns')).id;
      await setDoc(doc(db, 'campaigns', id), {
        id,
        ownerId: user.uid,
        name: draft.name?.trim() || `Campanha ${audience.label}`,
        audienceId: draft.audienceId,
        audienceLabel: audience.label,
        message: draft.message,
        hasImage: !!uploadedUrl,
        total: res.total,
        sent: res.sent,
        failed: res.failed,
        canceled: res.canceled,
        createdAt: new Date().toISOString(),
      });

      toast({ title: 'Campanha finalizada', description: `${res.sent} enviada(s), ${res.failed} falha(s).` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erro na campanha', description: e?.message || 'Falha ao disparar.' });
    } finally {
      setSending(false);
    }
  };

  const closeDialog = () => {
    if (sending) return; // não fecha durante o envio
    setConfirmOpen(false);
    if (result) {
      // limpa o formulário após concluir
      setDraft(EMPTY_DRAFT);
      setImageFile(null);
      setResult(null);
      setProgress(null);
    }
  };

  const progressPct = progress && progress.total > 0
    ? Math.round(((progress.sent + progress.failed) / progress.total) * 100)
    : 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-slate-50">
      <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6">

        {/* ── Hero ── */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-600 to-teal-700 p-6 text-white shadow-lg sm:p-8">
          <div className="absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -bottom-12 right-24 h-32 w-32 rounded-full bg-teal-300/20 blur-2xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
                <Megaphone className="h-7 w-7" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Campanhas</h1>
                <p className="mt-0.5 max-w-md text-sm text-emerald-50/90">
                  Crie mensagens com texto e imagem e dispare para listas de clientes pelo WhatsApp.
                </p>
              </div>
            </div>
            <Badge className="w-fit gap-1.5 border-white/30 bg-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15">
              <Sparkles className="h-3.5 w-3.5" /> {clients.length} clientes na base
            </Badge>
          </div>
        </div>

        {/* ── Stats ── */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard icon={Users} tint="emerald" label="Público selecionado" value={`${audienceCount} contatos`}
            hint={audience.label} />
          <StatCard icon={Timer} tint="sky" label="Intervalo entre envios" value={`${draft.delaySeconds}s`}
            hint="Espaçamento anti-bloqueio" />
          <StatCard icon={Clock} tint="violet" label="Tempo estimado" value={minutes > 0 ? `~${minutes} min` : '—'}
            hint="Baseado no público e no intervalo" />
        </div>

        {/* ── Conteúdo ── */}
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
          <div className="space-y-5">

            <Section title="Nome da campanha" subtitle="Só para você identificar no histórico">
              <Input value={draft.name} onChange={(e) => set({ name: e.target.value })}
                placeholder="Ex.: Promoção de Sexta — Pizza em dobro" className="h-11" />
            </Section>

            <Section title="Para quem enviar" subtitle="Escolha a lista de transmissão (só contatos com WhatsApp)">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {AUDIENCE_PRESETS.map((a) => {
                  const active = draft.audienceId === a.id;
                  const count = resolveAudience(clients, a.id as AudienceId).length;
                  return (
                    <button key={a.id} type="button" onClick={() => set({ audienceId: a.id as AudienceId })}
                      className={`group flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-all ${
                        active ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/20' : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40'
                      }`}>
                      <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        active ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-emerald-100 group-hover:text-emerald-600'
                      }`}>
                        <Users className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-800">{a.label}</p>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${active ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
                        </div>
                        <p className="text-[11px] leading-snug text-slate-500">{a.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Section>

            <Section title="Mensagem" subtitle="Personalize com as variáveis abaixo">
              <Textarea value={draft.message} onChange={(e) => set({ message: e.target.value })}
                placeholder={'Olá {primeiro_nome}! 🍕 Hoje na {loja} tem oferta especial...'}
                className="min-h-[140px] resize-none text-sm leading-relaxed" />
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {MESSAGE_TOKENS.map((t) => (
                  <button key={t.token} type="button" onClick={() => insertToken(t.token)}
                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700"
                    title={`Inserir ${t.label}`}>
                    + {t.label}
                  </button>
                ))}
              </div>

              <div className="mt-4">
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
                {draft.imageUrl ? (
                  <div className="relative inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={draft.imageUrl} alt="anexo" className="h-28 w-28 rounded-2xl object-cover ring-1 ring-slate-200" />
                    <button type="button" onClick={removeImage}
                      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-white shadow ring-2 ring-white">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white py-5 text-sm font-medium text-slate-500 transition-colors hover:border-emerald-400 hover:bg-emerald-50/40 hover:text-emerald-600">
                    <ImagePlus className="h-5 w-5" /> Anexar imagem (opcional)
                  </button>
                )}
              </div>
            </Section>

            <Section title="Velocidade do disparo" subtitle="Intervalos maiores reduzem o risco de bloqueio">
              <div className="flex flex-wrap gap-2">
                {DELAY_PRESETS.map((d) => (
                  <button key={d} type="button" onClick={() => set({ delaySeconds: d })}
                    className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all ${
                      draft.delaySeconds === d ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300'
                    }`}>
                    {d}s
                  </button>
                ))}
              </div>
            </Section>

            <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <Info className="h-5 w-5 shrink-0 text-amber-500" />
              <p className="text-[12px] leading-relaxed text-amber-800">
                <strong>Envie só para quem é seu cliente.</strong> Disparos em massa não solicitados podem fazer o
                WhatsApp bloquear o número. Use intervalos, varie o texto e evite exagerar no volume diário.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
              {!canSend && (
                <p className="flex-1 text-[12px] text-slate-400">
                  {audienceCount === 0 ? 'Nenhum contato com WhatsApp neste público.' : 'Escreva uma mensagem ou anexe uma imagem.'}
                </p>
              )}
              <Button className="gap-2 bg-emerald-600 px-6 hover:bg-emerald-700 disabled:opacity-60"
                disabled={!canSend} onClick={() => setConfirmOpen(true)}>
                <Rocket className="h-4 w-4" /> Disparar campanha
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="lg:sticky lg:top-4 lg:self-start">
            <WhatsAppPreview storeName={storeName} storeLogo={storeLogo} message={previewText} imageUrl={draft.imageUrl} />
          </div>
        </div>

        {/* Histórico */}
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Histórico de campanhas</h2>
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Send className="h-5 w-5" /></div>
              <p className="mt-3 text-sm font-medium text-slate-600">Nenhuma campanha enviada ainda</p>
              <p className="text-[12px] text-slate-400">Suas campanhas e métricas de entrega aparecerão aqui.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
                    <Megaphone className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{c.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {c.audienceLabel} · {new Date(c.createdAt).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-[11px]">
                    <span className="rounded-full bg-emerald-50 px-2 py-1 font-bold text-emerald-700">{c.sent} enviadas</span>
                    {c.failed > 0 && <span className="rounded-full bg-rose-50 px-2 py-1 font-bold text-rose-600">{c.failed} falhas</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Dialog: confirmar / progresso / resultado ── */}
      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent className="sm:max-w-[440px]">
          {result ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {result.canceled ? <Ban className="h-5 w-5 text-amber-500" /> : <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
                  {result.canceled ? 'Campanha interrompida' : 'Campanha concluída'}
                </DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-3 gap-3 py-2">
                <ResultStat label="Enviadas" value={result.sent} tint="emerald" />
                <ResultStat label="Falhas" value={result.failed} tint="rose" />
                <ResultStat label="Total" value={result.total} tint="slate" />
              </div>
              {result.failed > 0 && (
                <p className="flex items-start gap-2 rounded-lg bg-rose-50 p-2.5 text-[11px] text-rose-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Algumas mensagens falharam (número sem WhatsApp, limite de taxa ou conexão). Você pode reenviar criando outra campanha.
                </p>
              )}
              <DialogFooter>
                <Button onClick={closeDialog} className="bg-emerald-600 hover:bg-emerald-700">Concluir</Button>
              </DialogFooter>
            </>
          ) : sending ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-emerald-500" /> Enviando campanha…
                </DialogTitle>
              </DialogHeader>
              <div className="py-2">
                <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                  <span>{(progress?.sent || 0) + (progress?.failed || 0)} de {progress?.total || audienceCount}</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px]">
                  <span className="text-emerald-600 font-semibold">{progress?.sent || 0} enviadas</span>
                  {(progress?.failed || 0) > 0 && <span className="text-rose-500 font-semibold">{progress?.failed} falhas</span>}
                  {progress?.current && <span className="truncate text-slate-400">→ {progress.current}</span>}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { cancelRef.current = true; }} className="gap-1.5 text-rose-600 border-rose-200 hover:bg-rose-50">
                  <Ban className="h-4 w-4" /> Interromper
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Rocket className="h-5 w-5 text-emerald-500" /> Confirmar disparo</DialogTitle>
              </DialogHeader>
              <div className="space-y-2 py-2 text-sm">
                <Row label="Público" value={audience.label} />
                <Row label="Contatos" value={`${audienceCount}`} />
                <Row label="Imagem" value={imageFile ? 'Sim' : 'Não'} />
                <Row label="Intervalo" value={`${draft.delaySeconds}s entre envios`} />
                <Row label="Tempo estimado" value={minutes > 0 ? `~${minutes} min` : '—'} />
              </div>
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-800">
                <Info className="h-4 w-4 shrink-0" /> Serão enviadas <strong>{audienceCount}</strong> mensagens reais pelo WhatsApp. Confirme antes de prosseguir.
              </p>
              <DialogFooter className="gap-2">
                <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
                <Button onClick={startDispatch} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                  <Send className="h-4 w-4" /> Enviar agora
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Subcomponentes locais ── */

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        {subtitle && <p className="text-[11px] text-slate-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, hint, tint }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string; hint: string; tint: 'emerald' | 'sky' | 'violet';
}) {
  const tints: Record<string, string> = {
    emerald: 'bg-emerald-100 text-emerald-600', sky: 'bg-sky-100 text-sky-600', violet: 'bg-violet-100 text-violet-600',
  };
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tints[tint]}`}><Icon className="h-5 w-5" /></div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p className="truncate text-base font-bold text-slate-800">{value}</p>
        <p className="truncate text-[11px] text-slate-400">{hint}</p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function ResultStat({ label, value, tint }: { label: string; value: number; tint: 'emerald' | 'rose' | 'slate' }) {
  const tints: Record<string, string> = {
    emerald: 'text-emerald-600 bg-emerald-50', rose: 'text-rose-600 bg-rose-50', slate: 'text-slate-700 bg-slate-100',
  };
  return (
    <div className={`rounded-xl p-3 text-center ${tints[tint]}`}>
      <p className="text-2xl font-black">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-70">{label}</p>
    </div>
  );
}
