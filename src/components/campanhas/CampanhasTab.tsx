'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Megaphone, Send, ImagePlus, Users, Clock, Sparkles, Info, X, Save,
  Rocket, ChevronRight, Timer,
} from 'lucide-react';
import { WhatsAppPreview } from './WhatsAppPreview';
import { AUDIENCE_PRESETS, MESSAGE_TOKENS, EMPTY_DRAFT, renderMessage, estimateMinutes } from '@/lib/campanhas/audience';
import type { AudienceId, CampaignDraft } from '@/lib/campanhas/types';

interface CampanhasTabProps {
  storeProfile?: any;
  /** Tamanho da base de clientes (ligaremos depois). */
  clientsCount?: number;
}

const DELAY_PRESETS = [5, 8, 12, 20];

export function CampanhasTab({ storeProfile, clientsCount }: CampanhasTabProps) {
  const [draft, setDraft] = useState<CampaignDraft>(EMPTY_DRAFT);
  const fileRef = useRef<HTMLInputElement>(null);

  const storeName = storeProfile?.general?.name || storeProfile?.storeName || 'Minha Loja';
  const storeLogo = storeProfile?.general?.logoUrl || storeProfile?.logoUrl;

  const set = (patch: Partial<CampaignDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const previewText = useMemo(
    () => renderMessage(draft.message, {
      primeiro_nome: 'Maria',
      nome: 'Maria Silva',
      loja: storeName,
      link: 'cardapio.app/sua-loja',
    }),
    [draft.message, storeName],
  );

  const audience = AUDIENCE_PRESETS.find((a) => a.id === draft.audienceId)!;
  const minutes = typeof clientsCount === 'number' ? estimateMinutes(clientsCount, draft.delaySeconds) : null;

  const insertToken = (token: string) => set({ message: (draft.message ? draft.message + ' ' : '') + token });

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) set({ imageUrl: URL.createObjectURL(file) });
    e.target.value = '';
  };

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
              <Sparkles className="h-3.5 w-3.5" /> Conecte a API para disparar
            </Badge>
          </div>
        </div>

        {/* ── Stats ── */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard icon={Users} tint="emerald" label="Público selecionado" value={audience.label}
            hint={typeof clientsCount === 'number' ? `${clientsCount} contatos na base` : 'Conecte a base para contar'} />
          <StatCard icon={Timer} tint="sky" label="Intervalo entre envios" value={`${draft.delaySeconds}s`}
            hint="Espaçamento anti-bloqueio" />
          <StatCard icon={Clock} tint="violet" label="Tempo estimado" value={minutes !== null ? `~${minutes} min` : '—'}
            hint="Baseado no público e no intervalo" />
        </div>

        {/* ── Conteúdo ── */}
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">

          {/* Coluna esquerda: composição */}
          <div className="space-y-5">

            {/* Nome da campanha */}
            <Section title="Nome da campanha" subtitle="Só para você identificar no histórico">
              <Input
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Ex.: Promoção de Sexta — Pizza em dobro"
                className="h-11"
              />
            </Section>

            {/* Público */}
            <Section title="Para quem enviar" subtitle="Escolha a lista de transmissão">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {AUDIENCE_PRESETS.map((a) => {
                  const active = draft.audienceId === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => set({ audienceId: a.id as AudienceId })}
                      className={`group flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-all ${
                        active
                          ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/20'
                          : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40'
                      }`}
                    >
                      <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        active ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-emerald-100 group-hover:text-emerald-600'
                      }`}>
                        <Users className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{a.label}</p>
                        <p className="text-[11px] leading-snug text-slate-500">{a.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Section>

            {/* Mensagem */}
            <Section title="Mensagem" subtitle="Personalize com as variáveis abaixo">
              <Textarea
                value={draft.message}
                onChange={(e) => set({ message: e.target.value })}
                placeholder={'Olá {primeiro_nome}! 🍕 Hoje na {loja} tem oferta especial...'}
                className="min-h-[140px] resize-none text-sm leading-relaxed"
              />
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {MESSAGE_TOKENS.map((t) => (
                  <button
                    key={t.token}
                    type="button"
                    onClick={() => insertToken(t.token)}
                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700"
                    title={`Inserir ${t.label}`}
                  >
                    + {t.label}
                  </button>
                ))}
              </div>

              {/* Imagem */}
              <div className="mt-4">
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
                {draft.imageUrl ? (
                  <div className="relative inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={draft.imageUrl} alt="anexo" className="h-28 w-28 rounded-2xl object-cover ring-1 ring-slate-200" />
                    <button
                      type="button"
                      onClick={() => set({ imageUrl: null })}
                      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-white shadow ring-2 ring-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white py-5 text-sm font-medium text-slate-500 transition-colors hover:border-emerald-400 hover:bg-emerald-50/40 hover:text-emerald-600"
                  >
                    <ImagePlus className="h-5 w-5" /> Anexar imagem (opcional)
                  </button>
                )}
              </div>
            </Section>

            {/* Intervalo */}
            <Section title="Velocidade do disparo" subtitle="Intervalos maiores reduzem o risco de bloqueio">
              <div className="flex flex-wrap gap-2">
                {DELAY_PRESETS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => set({ delaySeconds: d })}
                    className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all ${
                      draft.delaySeconds === d
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300'
                    }`}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </Section>

            {/* Aviso de boas práticas */}
            <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <Info className="h-5 w-5 shrink-0 text-amber-500" />
              <p className="text-[12px] leading-relaxed text-amber-800">
                <strong>Envie só para quem é seu cliente.</strong> Disparos em massa não solicitados podem fazer o
                WhatsApp bloquear o número. Use intervalos, varie o texto e evite exagerar no volume diário.
              </p>
            </div>

            {/* Ações */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button variant="outline" className="gap-2" disabled>
                <Save className="h-4 w-4" /> Salvar rascunho
              </Button>
              <Button
                className="gap-2 bg-emerald-600 px-6 hover:bg-emerald-700 disabled:opacity-60"
                disabled
                title="Disponível após conectar a API"
              >
                <Rocket className="h-4 w-4" /> Disparar campanha
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Coluna direita: preview fixo */}
          <div className="lg:sticky lg:top-4 lg:self-start">
            <WhatsAppPreview
              storeName={storeName}
              storeLogo={storeLogo}
              message={previewText}
              imageUrl={draft.imageUrl}
            />
          </div>
        </div>

        {/* Histórico (placeholder) */}
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Histórico de campanhas</h2>
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <Send className="h-5 w-5" />
            </div>
            <p className="mt-3 text-sm font-medium text-slate-600">Nenhuma campanha enviada ainda</p>
            <p className="text-[12px] text-slate-400">Suas campanhas e métricas de entrega aparecerão aqui.</p>
          </div>
        </div>

      </div>
    </div>
  );
}

/* ── Subcomponentes locais de apresentação ── */

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

function StatCard({
  icon: Icon, label, value, hint, tint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; hint: string;
  tint: 'emerald' | 'sky' | 'violet';
}) {
  const tints: Record<string, string> = {
    emerald: 'bg-emerald-100 text-emerald-600',
    sky: 'bg-sky-100 text-sky-600',
    violet: 'bg-violet-100 text-violet-600',
  };
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tints[tint]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p className="truncate text-base font-bold text-slate-800">{value}</p>
        <p className="truncate text-[11px] text-slate-400">{hint}</p>
      </div>
    </div>
  );
}
