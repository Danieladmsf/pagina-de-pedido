'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { uploadImage } from '@/lib/upload';
import { buildEncomendaConfig } from '@/lib/encomendas/config';
import { type EncomendaContent, mergeContent } from '@/lib/encomendas/content';
import { type DayHours, DAY_ORDER, DAY_SHORT, fromStoreWorkingHours } from '@/lib/encomendas/schedule';
import { Landing } from '@/components/encomendas/Landing';
import { revalidateStorePages } from '@/lib/revalidate-store';
import { Loader2, ImageIcon, Upload, ExternalLink, Save, Type, Clock, Copy as CopyIcon } from 'lucide-react';

type FieldDef = { key: keyof EncomendaContent; label: string; multiline?: boolean; hint?: string };
const TEXT_FIELDS: FieldDef[] = [
  { key: 'subtitleLabel', label: 'Sublabel do topo' },
  { key: 'heroBadge', label: 'Selo do topo' },
  { key: 'heroTitle', label: 'Título principal (hero)' },
  { key: 'heroEmphasis', label: 'Palavra em destaque', hint: 'Fica em itálico/rosa dentro do título (precisa aparecer no título).' },
  { key: 'heroSubtitle', label: 'Subtítulo do hero', multiline: true },
  { key: 'ctaLabel', label: 'Texto do botão principal' },
  { key: 'whatTitle', label: 'Título da seção "O que fazemos"' },
  { key: 'aboutTitle', label: 'Título da seção "Sobre"' },
  { key: 'aboutText', label: 'Texto "Sobre"', multiline: true },
  { key: 'ctaTitle', label: 'Título da faixa final' },
  { key: 'ctaSubtitle', label: 'Subtítulo da faixa final', multiline: true, hint: 'Use {sinal} para inserir o percentual do sinal.' },
];

// O bloco "Horário" (rodapé da landing) mora FORA de `content`, direto em
// encomendas.* — que é de onde buildEncomendaConfig lê e o wizard reaproveita o
// daysLabel. Os defaults saem do próprio config para não duplicar.
type Schedule = { scheduleMode: 'text' | 'week'; daysLabel: string; hours: string; weekHours: DayHours[] };
function readSchedule(storeProfile: any): Schedule {
  const c = buildEncomendaConfig(storeProfile);
  // No modo 'week' o daysLabel do config é derivado; aqui o input de texto livre
  // precisa do valor CRU, senão trocar de modo sobrescreve o que o lojista digitou.
  const raw = storeProfile?.encomendas?.daysLabel;
  return {
    scheduleMode: c.scheduleMode,
    daysLabel: typeof raw === 'string' && raw ? raw : (c.scheduleMode === 'text' ? c.daysLabel : 'Terça a Sábado'),
    hours: c.hours,
    weekHours: c.weekHours,
  };
}

export function EncomendaEditor({ db, user, storeProfile }: { db: any; user: any; storeProfile: any }) {
  const { toast } = useToast();
  const [content, setContent] = useState<EncomendaContent>(mergeContent(storeProfile?.encomendas?.content));
  const [schedule, setSchedule] = useState<Schedule>(() => readSchedule(storeProfile));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setContent(mergeContent(storeProfile?.encomendas?.content));
    setSchedule(readSchedule(storeProfile));
    setDirty(false);
  }, [storeProfile]);

  const set = (key: keyof EncomendaContent, value: string) => {
    setContent((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const setSched = <K extends keyof Schedule>(key: K, value: Schedule[K]) => {
    setSchedule((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const setDay = (index: number, patch: Partial<DayHours>) => {
    setSchedule((prev) => ({
      ...prev,
      weekHours: prev.weekHours.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    }));
    setDirty(true);
  };

  // Horário fixo da semana do perfil da loja, se já estiver preenchido lá.
  const storeWeek = useMemo(() => fromStoreWorkingHours(storeProfile?.workingHours), [storeProfile?.workingHours]);

  // Config "ao vivo": o que está sendo editado passa pelo MESMO buildEncomendaConfig
  // da página real, então a prévia deriva tudo (inclusive o daysLabel) igualzinho.
  const liveConfig = useMemo(() => {
    const base = buildEncomendaConfig({
      ...storeProfile,
      encomendas: { ...(storeProfile?.encomendas || {}), ...schedule, content },
    });
    return { ...base, content, logoUrl: content.logoUrl || base.logoUrl };
  }, [storeProfile, content, schedule]);

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const slug = storeProfile?.shortSlug || user?.uid || '';
    return slug ? `${window.location.origin}/${slug}/encomendas` : '';
  }, [storeProfile?.shortSlug, user?.uid]);

  async function save() {
    if (!db || !user?.uid) return;
    setSaving(true);
    try {
      await setDoc(doc(db, 'store_profiles', user.uid), { encomendas: { content, ...schedule } }, { merge: true });
      revalidateStorePages(user.uid);
      setDirty(false);
      toast({ title: 'Página atualizada', description: 'As mudanças já valem no link público.' });
    } catch (err) {
      console.error('[encomendas-editor] erro ao salvar:', err);
      toast({ variant: 'destructive', title: 'Erro ao salvar', description: 'Tente novamente.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(320px,380px)_1fr]">
      {/* Controles */}
      <div className="space-y-5">
        <div className="rounded-xl border bg-card p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted-foreground"><ImageIcon className="h-4 w-4" /> Fotos</p>
          <div className="grid grid-cols-2 gap-3">
            <PhotoField label="Logo" url={content.logoUrl} onChange={(u) => set('logoUrl', u)} onError={() => toast({ variant: 'destructive', title: 'Falha no upload' })} round />
            <PhotoField label="Foto do topo" url={content.heroImageUrl} onChange={(u) => set('heroImageUrl', u)} onError={() => toast({ variant: 'destructive', title: 'Falha no upload' })} />
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted-foreground"><Type className="h-4 w-4" /> Textos</p>
          <div className="space-y-3">
            {TEXT_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label className="text-xs">{f.label}</Label>
                {f.multiline
                  ? <Textarea value={content[f.key]} onChange={(e) => set(f.key, e.target.value)} rows={3} />
                  : <Input value={content[f.key]} onChange={(e) => set(f.key, e.target.value)} />}
                {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted-foreground"><Clock className="h-4 w-4" /> Horário</p>

          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-2.5">
            <div>
              <p className="text-xs font-semibold">Separar por dia da semana</p>
              <p className="text-[11px] text-muted-foreground">Cada dia com seu horário, em vez de duas linhas de texto.</p>
            </div>
            <Switch
              checked={schedule.scheduleMode === 'week'}
              onCheckedChange={(on) => setSched('scheduleMode', on ? 'week' : 'text')}
            />
          </div>

          {schedule.scheduleMode === 'week' ? (
            <div className="space-y-2">
              {storeWeek && (
                <Button type="button" variant="outline" size="sm" className="w-full text-xs"
                  onClick={() => setSched('weekHours', storeWeek)}>
                  <CopyIcon className="mr-1.5 h-3.5 w-3.5" /> Copiar o horário da loja
                </Button>
              )}
              <div className="space-y-1">
                {DAY_ORDER.map((d) => {
                  const day = schedule.weekHours[d];
                  return (
                    <div key={d} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${day.closed ? 'bg-muted/40' : 'bg-background'}`}>
                      <span className="w-8 shrink-0 text-xs font-semibold">{DAY_SHORT[d]}</span>
                      <Switch checked={!day.closed} onCheckedChange={(on) => setDay(d, { closed: !on })} className="scale-75" />
                      {day.closed ? (
                        <span className="flex-1 text-right text-[11px] text-muted-foreground">Fechado</span>
                      ) : (
                        <div className="flex flex-1 items-center justify-end gap-1">
                          <Input type="time" value={day.open} onChange={(e) => setDay(d, { open: e.target.value })} className="h-7 w-[5.5rem] px-1.5 text-[11px]" />
                          <span className="text-xs text-muted-foreground">às</span>
                          <Input type="time" value={day.close} onChange={(e) => setDay(d, { close: e.target.value })} className="h-7 w-[5.5rem] px-1.5 text-[11px]" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">Dias seguidos com o mesmo horário aparecem juntos na página ("Ter a Sáb"). Isso é só o que o cliente lê — quem libera ou bloqueia a data do pedido são os dias marcados na configuração acima.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Dias de funcionamento</Label>
                <Input value={schedule.daysLabel} onChange={(e) => setSched('daysLabel', e.target.value)} placeholder="Ex.: Terça a Sábado" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Horário de atendimento</Label>
                <Input value={schedule.hours} onChange={(e) => setSched('hours', e.target.value)} placeholder="Ex.: 09h às 18h" />
              </div>
              <p className="text-[11px] text-muted-foreground">São as duas linhas do bloco "Horário", no rodapé da página. Os dias também aparecem na hora de escolher a data do pedido.</p>
            </div>
          )}
        </div>
      </div>

      {/* Prévia ao vivo */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-muted-foreground">Prévia ao vivo</p>
          <div className="flex items-center gap-2">
            {shareUrl && (
              <Button variant="outline" size="sm" onClick={() => window.open(shareUrl, '_blank')}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Abrir página real
              </Button>
            )}
            <Button size="sm" onClick={save} disabled={saving || !dirty}>
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              {dirty ? 'Salvar mudanças' : 'Salvo'}
            </Button>
          </div>
        </div>
        <div className="encomendas-confeitaria max-h-[78vh] overflow-y-auto rounded-xl border shadow-inner">
          {/* onStart no-op: é só prévia; o cliente usa a página real */}
          <Landing config={liveConfig} onStart={() => { }} />
        </div>
      </div>
    </div>
  );
}

function PhotoField({ label, url, onChange, onError, round }: {
  label: string; url: string; onChange: (url: string) => void; onError: () => void; round?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const u = await uploadImage(file);
      onChange(u);
    } catch (err) {
      console.error('[encomendas-editor] upload:', err);
      onError();
    } finally {
      setUploading(false);
      if (ref.current) ref.current.value = '';
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className={`relative flex aspect-square w-full items-center justify-center overflow-hidden border-2 border-dashed bg-muted/40 text-muted-foreground transition-colors hover:border-primary/50 ${round ? 'rounded-full' : 'rounded-xl'}`}
        title="Trocar foto"
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-[11px]"><Upload className="h-4 w-4" /> Enviar</span>
        )}
      </button>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={onFile} />
    </div>
  );
}
