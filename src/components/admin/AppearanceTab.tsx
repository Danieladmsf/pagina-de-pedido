'use client';

import React, { useState, useEffect, useRef } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { Loader2, Check, ExternalLink, Upload, Download, Trash2, ImageIcon, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { THEME_LIST, themeToCssVars, getTheme, ensureBrandFontsLoaded } from '@/lib/themes';
import { uploadImage } from '@/lib/upload';

interface AppearanceTabProps {
  db: any;
  user: any;
  storeProfile: any;
}

const DESKTOP_BANNER_PROMPT = `Crie um banner horizontal para header web.

Tamanho: 1832 x 560 px.
Use area segura interna obrigatoria:
- 70 px no topo
- 70 px na base
- 90 px nas laterais

Nenhum texto, logo ou elemento importante pode tocar ou ultrapassar essa area segura.
A logo deve ocupar no maximo 55% da altura util interna, com altura aproximada entre 260 e 320 px.

Evite cortes no topo, cortes inferiores, textos nas bordas e zoom excessivo.
Considere cortes responsivos de header web.
Safe area for responsive crop.`;

const MOBILE_BANNER_PROMPT = `Crie um banner vertical para header mobile.

Tamanho: 768 x 800 px.
Use area segura interna obrigatoria:
- 60 px no topo
- 60 px na base
- 50 px nas laterais

Nenhum texto, logo ou elemento importante pode tocar ou ultrapassar essa area segura.
A logo deve ficar proporcionalmente menor, com altura aproximada entre 280 e 360 px.

Evite zoom excessivo e mantenha espacamento visual confortavel em todos os lados.
Considere cortes responsivos.
Safe area for responsive crop.`;

export function AppearanceTab({ db, user, storeProfile }: AppearanceTabProps) {
  const { toast } = useToast();
  const currentThemeId = storeProfile?.theme || 'padrao';
  const [selectedId, setSelectedId] = useState<string>(currentThemeId);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setSelectedId(currentThemeId);
  }, [currentThemeId]);

  useEffect(() => { ensureBrandFontsLoaded(); }, []);

  const selected = getTheme(selectedId);
  const dirty = selectedId !== currentThemeId;

  const bannerUrl = storeProfile?.general?.bannerUrl as string | undefined;
  const bannerMobileUrl = storeProfile?.general?.bannerMobileUrl as string | undefined;
  const fileInputDesktopRef = useRef<HTMLInputElement>(null);
  const fileInputMobileRef = useRef<HTMLInputElement>(null);
  const [uploadingTarget, setUploadingTarget] = useState<'desktop' | 'mobile' | null>(null);

  const persistBannerField = async (field: 'bannerUrl' | 'bannerMobileUrl', value: string | null) => {
    if (!db || !user?.uid) return;
    await setDoc(
      doc(db, 'store_profiles', user.uid),
      { general: { [field]: value } },
      { merge: true }
    );
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>, target: 'desktop' | 'mobile') => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ variant: 'destructive', title: 'Arquivo inválido', description: 'Envie uma imagem (PNG, JPG, WebP).' });
      return;
    }
    setUploadingTarget(target);
    try {
      const url = await uploadImage(file);
      await persistBannerField(target === 'desktop' ? 'bannerUrl' : 'bannerMobileUrl', url);
      toast({ title: 'Banner atualizado!', description: 'A nova imagem já aparece no cardápio público.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro no upload', description: err.message || 'Não foi possível enviar.' });
    } finally {
      setUploadingTarget(null);
    }
  };

  const handleBannerRemove = async (target: 'desktop' | 'mobile') => {
    setUploadingTarget(target);
    try {
      await persistBannerField(target === 'desktop' ? 'bannerUrl' : 'bannerMobileUrl', null);
      toast({ title: 'Banner removido' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err.message || 'Falha ao remover.' });
    } finally {
      setUploadingTarget(null);
    }
  };

  const handleCopyPrompt = async (label: string, prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast({ title: 'Prompt copiado', description: `${label} pronto para colar na IA.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro ao copiar', description: err?.message || 'Copie o texto manualmente.' });
    }
  };

  const handleSave = async () => {
    if (!db || !user?.uid || !dirty) return;
    setIsSaving(true);
    try {
      await setDoc(
        doc(db, 'store_profiles', user.uid),
        { theme: selectedId, onboardingCompleted: true },
        { merge: true }
      );
      toast({ title: 'Aparência atualizada!', description: 'Seu cardápio público já mostra o novo estilo.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err.message || 'Não foi possível salvar.' });
    } finally {
      setIsSaving(false);
    }
  };

  const storeNameSlug = (storeProfile?.general?.name || storeProfile?.storeName || 'loja').replace(/\s+/g, '-').toLowerCase();
  const storeLink = typeof window !== 'undefined' && user?.uid ? `${window.location.origin}/${storeNameSlug}-${user.uid}` : '';

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-black text-slate-800">Aparência do cardápio</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Escolha um estilo visual para o cardápio que seus clientes veem.
          </p>
        </div>
        {storeLink && (
          <a
            href={storeLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary font-bold hover:underline flex items-center gap-1.5 shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Abrir cardápio público
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {THEME_LIST.map((preset) => {
          const isSelected = selectedId === preset.id;
          const isCurrent = currentThemeId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => setSelectedId(preset.id)}
              className={`relative text-left rounded-xl border-2 transition-all overflow-hidden ${
                isSelected ? 'border-primary ring-2 ring-primary/30 shadow-lg' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="p-5 h-36 flex flex-col justify-end relative" style={themeToCssVars(preset)}>
                {isCurrent && (
                  <span className="absolute top-2 left-2 bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shadow">
                    Em uso
                  </span>
                )}
                {isSelected && !isCurrent && (
                  <div className="absolute top-2 right-2 bg-primary text-white rounded-full w-6 h-6 flex items-center justify-center shadow">
                    <Check className="w-4 h-4" />
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <span className="text-4xl">{preset.icon}</span>
                  <div>
                    <h3
                      className="font-black text-xl leading-tight"
                      style={{ fontFamily: preset.fonts.heading, color: preset.colors.text }}
                    >
                      {preset.label}
                    </h3>
                    <div className="flex gap-1 mt-1.5">
                      <span className="w-4 h-4 rounded-full ring-1 ring-black/5" style={{ background: preset.colors.primary }} />
                      <span className="w-4 h-4 rounded-full ring-1 ring-black/5" style={{ background: preset.colors.accent }} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-white">
                <p className="text-xs text-slate-600 leading-snug">{preset.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="space-y-4 pt-4 border-t">
        <div>
          <h3 className="text-base font-bold text-slate-800">Banner do cardápio</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Imagens exibidas no topo da página de pedido. Sem banner, será usado apenas o fundo do tema.
            <br />
            <span className="text-[11px] opacity-80">Se você não enviar a versão mobile, a versão desktop será usada também no celular.</span>
          </p>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h4 className="text-sm font-black text-amber-950">Prompt para gerar banner sem cortes</h4>
              <p className="text-xs text-amber-900/75 mt-1">
                Copie e cole na IA que vai criar a imagem. Regra principal: texto, logo e elementos importantes devem ficar dentro da area segura.
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" className="h-8 bg-white/80 text-xs" onClick={() => handleCopyPrompt('Desktop', DESKTOP_BANNER_PROMPT)}>
                <Copy className="w-3.5 h-3.5 mr-1.5" /> Desktop
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8 bg-white/80 text-xs" onClick={() => handleCopyPrompt('Mobile', MOBILE_BANNER_PROMPT)}>
                <Copy className="w-3.5 h-3.5 mr-1.5" /> Mobile
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <div className="rounded-xl bg-white/80 border border-amber-100 p-3">
              <p className="text-[11px] font-black uppercase tracking-wider text-amber-700">Horizontal 1832 x 560</p>
              <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                Area segura: 70 px topo/base e 90 px laterais. Area util: 1652 x 420 px. Logo ideal: 260 a 320 px de altura.
              </p>
            </div>
            <div className="rounded-xl bg-white/80 border border-amber-100 p-3">
              <p className="text-[11px] font-black uppercase tracking-wider text-amber-700">Mobile 768 x 800</p>
              <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                Area segura: 60 px topo/base e 50 px laterais. Area util: 668 x 680 px. Logo ideal: 280 a 360 px de altura.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
          {/* Desktop */}
          <div className="flex flex-col gap-2 bg-slate-50/50 border border-slate-100 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">🖥️ Desktop</h4>
              <span className="text-[10px] text-muted-foreground">1832 × 560 px</span>
            </div>
            <div className="flex items-center justify-center min-h-[140px]">
              {bannerUrl ? (
                <div className="w-full aspect-[1832/560] bg-slate-100 rounded-lg overflow-hidden border border-slate-200">
                  <img src={bannerUrl} alt="Banner desktop" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-full aspect-[1832/560] border-2 border-dashed border-slate-200 rounded-lg flex flex-col items-center justify-center gap-1 text-center px-3">
                  <ImageIcon className="w-6 h-6 text-slate-300" />
                  <p className="text-[11px] text-muted-foreground">Sem banner desktop</p>
                </div>
              )}
            </div>
            <div className="flex gap-3 items-center justify-center min-h-[20px]">
              {bannerUrl && (
                <>
                  <a href={bannerUrl} download target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-bold hover:underline flex items-center gap-1.5">
                    <Download className="w-3.5 h-3.5" /> Baixar
                  </a>
                  <button type="button" onClick={() => handleBannerRemove('desktop')} disabled={uploadingTarget === 'desktop'} className="text-xs text-red-500 font-bold hover:underline flex items-center gap-1.5 disabled:opacity-50">
                    <Trash2 className="w-3.5 h-3.5" /> Remover
                  </button>
                </>
              )}
            </div>
            <input ref={fileInputDesktopRef} type="file" accept="image/*" onChange={(e) => handleBannerUpload(e, 'desktop')} className="hidden" />
            <Button size="sm" variant="outline" className="w-full mt-auto" onClick={() => fileInputDesktopRef.current?.click()} disabled={uploadingTarget === 'desktop'}>
              {uploadingTarget === 'desktop' ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enviando…</>
              ) : (
                <><Upload className="w-4 h-4 mr-2" /> {bannerUrl ? 'Trocar' : 'Enviar'}</>
              )}
            </Button>
          </div>

          {/* Mobile */}
          <div className="flex flex-col gap-2 bg-slate-50/50 border border-slate-100 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">📱 Mobile</h4>
              <span className="text-[10px] text-muted-foreground">vertical (ex: 768 × 800)</span>
            </div>
            <div className="flex items-center justify-center min-h-[140px]">
              {bannerMobileUrl ? (
                <div className="aspect-[768/800] bg-slate-100 rounded-lg overflow-hidden border border-slate-200 h-[140px]">
                  <img src={bannerMobileUrl} alt="Banner mobile" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="aspect-[768/800] border-2 border-dashed border-slate-200 rounded-lg flex flex-col items-center justify-center gap-1 text-center px-3 h-[140px]">
                  <ImageIcon className="w-6 h-6 text-slate-300" />
                  <p className="text-[10px] text-muted-foreground leading-tight whitespace-pre-line">
                    {bannerUrl
                      ? 'Sem imagem própria.\nO celular vai\nexibir a versão\ndesktop.'
                      : 'Sem imagem\npara celular.'}
                  </p>
                </div>
              )}
            </div>
            <div className="flex gap-3 items-center justify-center min-h-[20px]">
              {bannerMobileUrl && (
                <>
                  <a href={bannerMobileUrl} download target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-bold hover:underline flex items-center gap-1.5">
                    <Download className="w-3.5 h-3.5" /> Baixar
                  </a>
                  <button type="button" onClick={() => handleBannerRemove('mobile')} disabled={uploadingTarget === 'mobile'} className="text-xs text-red-500 font-bold hover:underline flex items-center gap-1.5 disabled:opacity-50">
                    <Trash2 className="w-3.5 h-3.5" /> Remover
                  </button>
                </>
              )}
            </div>
            <input ref={fileInputMobileRef} type="file" accept="image/*" onChange={(e) => handleBannerUpload(e, 'mobile')} className="hidden" />
            <Button size="sm" variant="outline" className="w-full mt-auto" onClick={() => fileInputMobileRef.current?.click()} disabled={uploadingTarget === 'mobile'}>
              {uploadingTarget === 'mobile' ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enviando…</>
              ) : (
                <><Upload className="w-4 h-4 mr-2" /> {bannerMobileUrl ? 'Trocar' : 'Enviar'}</>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 bg-white border-t border-slate-200 -mx-6 px-6 py-3 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {dirty ? (
            <>Estilo selecionado: <span className="font-bold text-slate-700">{selected.icon} {selected.label}</span></>
          ) : (
            <>Estilo atual: <span className="font-bold text-slate-700">{selected.icon} {selected.label}</span></>
          )}
        </p>
        <Button
          size="sm"
          className="bg-primary hover:bg-primary/90 text-white font-bold disabled:opacity-50"
          disabled={!dirty || isSaving}
          onClick={handleSave}
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Aplicar mudanças'}
        </Button>
      </div>
    </div>
  );
}
