'use client';

import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useToast } from '@/hooks/use-toast';
import { uploadImage } from '@/lib/upload';
import type { EncomendaConfig } from '@/lib/encomendas/config';
import type { EncomendaContent } from '@/lib/encomendas/content';
import { Landing } from '@/components/encomendas/Landing';
import { Loader2, Upload, ExternalLink } from 'lucide-react';

type FieldDef = { key: keyof EncomendaContent; label: string; multiline?: boolean; hint?: string };
type Grupo = { id: string; titulo: string; campos: FieldDef[] };

const GRUPOS: Grupo[] = [
  {
    id: 'topo',
    titulo: 'Topo da página',
    campos: [
      { key: 'subtitleLabel', label: 'Frase pequena abaixo do nome' },
      { key: 'heroBadge', label: 'Selo do topo' },
      { key: 'heroTitle', label: 'Título principal' },
      { key: 'heroEmphasis', label: 'Palavra em destaque', hint: 'Aparece em itálico e colorida dentro do título (precisa estar escrita no título).' },
      { key: 'heroSubtitle', label: 'Texto de apresentação', multiline: true },
      { key: 'ctaLabel', label: 'Texto do botão principal' },
    ],
  },
  { id: 'fazemos', titulo: 'O que fazemos', campos: [{ key: 'whatTitle', label: 'Título da seção' }] },
  {
    id: 'sobre',
    titulo: 'Sobre',
    campos: [
      { key: 'aboutTitle', label: 'Título da seção' },
      { key: 'aboutText', label: 'Texto', multiline: true },
    ],
  },
  {
    id: 'final',
    titulo: 'Faixa final',
    campos: [
      { key: 'ctaTitle', label: 'Título da faixa' },
      { key: 'ctaSubtitle', label: 'Texto da faixa', multiline: true, hint: 'Escreva {sinal} onde quiser que apareça o percentual do sinal.' },
    ],
  },
];

// Aba "Página do cliente": fotos, textos e prévia ao vivo. Controlada — o estado
// e o salvar moram na EncomendasAdminTab.
export function EncomendaEditor({ content, onChange, showInApp, onShowInApp, liveConfig, shareUrl }: {
  content: EncomendaContent;
  onChange: (patch: Partial<EncomendaContent>) => void;
  showInApp: boolean;
  onShowInApp: (v: boolean) => void;
  liveConfig: EncomendaConfig;
  shareUrl: string;
}) {
  const { toast } = useToast();
  const falhaUpload = () => toast({ variant: 'destructive', title: 'Falha no envio da foto', description: 'Tente de novo.' });

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
      {/* Controles */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4 rounded-2xl border bg-white p-3 shadow-sm">
          <div>
            <p className="text-sm font-semibold text-slate-800">Botão de Encomendas no cardápio</p>
            <p className="text-xs text-muted-foreground">Coloca um botão &quot;Encomendas&quot; no topo do cardápio e um atalho &quot;Minhas encomendas&quot; no menu do cliente.</p>
          </div>
          <Switch checked={showInApp} onCheckedChange={onShowInApp} />
        </div>

        <div className="rounded-2xl border bg-white px-4 shadow-sm">
          <Accordion type="single" collapsible defaultValue="fotos">
            <AccordionItem value="fotos" className="last:border-b-0">
              <AccordionTrigger className="py-3 text-sm font-bold text-slate-800 hover:no-underline">Logo e foto do topo</AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-2 gap-3">
                  <PhotoField label="Logo" url={content.logoUrl} onChange={(u) => onChange({ logoUrl: u })} onError={falhaUpload} round />
                  <PhotoField label="Foto do topo" url={content.heroImageUrl} onChange={(u) => onChange({ heroImageUrl: u })} onError={falhaUpload} />
                </div>
              </AccordionContent>
            </AccordionItem>
            {GRUPOS.map((g, gi) => (
              <AccordionItem key={g.id} value={g.id} className={gi === GRUPOS.length - 1 ? 'border-b-0' : ''}>
                <AccordionTrigger className="py-3 text-sm font-bold text-slate-800 hover:no-underline">{g.titulo}</AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 px-0.5">
                    {g.campos.map((f) => (
                      <div key={f.key} className="space-y-1">
                        <Label className="text-xs font-semibold text-slate-600">{f.label}</Label>
                        {f.multiline
                          ? <Textarea className="text-sm" value={content[f.key]} onChange={(e) => onChange({ [f.key]: e.target.value })} rows={3} />
                          : <Input className="h-9 text-sm" value={content[f.key]} onChange={(e) => onChange({ [f.key]: e.target.value })} />}
                        {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>

      {/* Prévia ao vivo */}
      <div className="space-y-2 lg:sticky lg:top-0">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-slate-800">Prévia</p>
          {shareUrl && (
            <Button variant="outline" size="sm" className="h-8" onClick={() => window.open(shareUrl, '_blank')}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Abrir página real
            </Button>
          )}
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
      <Label className="text-xs font-semibold text-slate-600">{label}</Label>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className={`relative flex aspect-square w-full max-w-[120px] items-center justify-center overflow-hidden border-2 border-dashed bg-muted/40 text-muted-foreground transition-colors hover:border-primary/50 ${round ? 'rounded-full' : 'rounded-xl'}`}
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
