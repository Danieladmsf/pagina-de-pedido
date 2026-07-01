'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { uploadImage } from '@/lib/upload';
import { buildEncomendaConfig } from '@/lib/encomendas/config';
import { type EncomendaContent, mergeContent } from '@/lib/encomendas/content';
import { Landing } from '@/components/encomendas/Landing';
import { Loader2, ImageIcon, Upload, ExternalLink, Save, Type } from 'lucide-react';

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

export function EncomendaEditor({ db, user, storeProfile }: { db: any; user: any; storeProfile: any }) {
  const { toast } = useToast();
  const [content, setContent] = useState<EncomendaContent>(mergeContent(storeProfile?.encomendas?.content));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setContent(mergeContent(storeProfile?.encomendas?.content));
    setDirty(false);
  }, [storeProfile]);

  const set = (key: keyof EncomendaContent, value: string) => {
    setContent((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  // Config "ao vivo": base do storeProfile + o conteúdo sendo editado (para a prévia).
  const liveConfig = useMemo(() => {
    const base = buildEncomendaConfig(storeProfile);
    return { ...base, content, logoUrl: content.logoUrl || base.logoUrl };
  }, [storeProfile, content]);

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const slug = storeProfile?.shortSlug || user?.uid || '';
    return slug ? `${window.location.origin}/${slug}/encomendas` : '';
  }, [storeProfile?.shortSlug, user?.uid]);

  async function save() {
    if (!db || !user?.uid) return;
    setSaving(true);
    try {
      await setDoc(doc(db, 'store_profiles', user.uid), { encomendas: { content } }, { merge: true });
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
