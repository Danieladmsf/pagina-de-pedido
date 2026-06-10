'use client';

import React, { useState, useEffect } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { Loader2, Check, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { THEME_LIST, ThemePreset, themeToCssVars, ensureBrandFontsLoaded } from '@/lib/themes';

interface WelcomeWizardProps {
  db: any;
  userId: string;
  storeName?: string;
  onComplete: () => void;
}

export function WelcomeWizard({ db, userId, storeName, onComplete }: WelcomeWizardProps) {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => { ensureBrandFontsLoaded(); }, []);

  const selected = selectedId ? THEME_LIST.find((t) => t.id === selectedId) : null;

  const handleConfirm = async () => {
    if (!selectedId || !db || !userId) return;
    setIsSaving(true);
    try {
      await setDoc(
        doc(db, 'store_profiles', userId),
        {
          theme: selectedId,
          onboardingCompleted: true,
        },
        { merge: true }
      );
      toast({ title: 'Tudo pronto!', description: 'Seu cardápio já está com a nova identidade visual.' });
      onComplete();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err.message || 'Não foi possível salvar.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full my-8 overflow-hidden">
        <div className="bg-gradient-to-br from-primary to-primary/80 text-white p-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/20 mb-3">
            <Sparkles className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-black mb-1">
            Bem-vindo{storeName ? `, ${storeName}` : ''}!
          </h2>
          <p className="text-white/90 text-sm">
            Escolha o estilo do seu cardápio digital. Essa escolha faz parte da configuração da loja.
          </p>
        </div>

        <div className="p-5 grid grid-cols-2 gap-3">
          {THEME_LIST.map((preset) => {
            const isSelected = selectedId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setSelectedId(preset.id)}
                className={`relative text-left rounded-xl border-2 transition-all overflow-hidden ${
                  isSelected ? 'border-primary ring-2 ring-primary/30 shadow-lg' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div
                  className="p-4 h-32 flex flex-col justify-end relative"
                  style={themeToCssVars(preset)}
                >
                  {isSelected && (
                    <div className="absolute top-2 right-2 bg-primary text-white rounded-full w-6 h-6 flex items-center justify-center shadow">
                      <Check className="w-4 h-4" />
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-3xl">{preset.icon}</span>
                    <div>
                      <h3
                        className="font-black text-lg leading-tight"
                        style={{ fontFamily: preset.fonts.heading, color: preset.colors.text }}
                      >
                        {preset.label}
                      </h3>
                      <div className="flex gap-1 mt-1">
                        <span className="w-3 h-3 rounded-full" style={{ background: preset.colors.primary }} />
                        <span className="w-3 h-3 rounded-full" style={{ background: preset.colors.accent }} />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="p-3 bg-white">
                  <p className="text-xs text-slate-600 leading-snug">{preset.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="border-t bg-slate-50 p-4 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {selected ? (
              <>
                Estilo selecionado: <span className="font-bold text-slate-700">{selected.icon} {selected.label}</span>
              </>
            ) : (
              'Selecione um estilo para começar.'
            )}
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedId('padrao');
                setTimeout(() => handleConfirm(), 0);
              }}
              disabled={isSaving}
            >
              Pular
            </Button>
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/90 text-white font-bold"
              disabled={!selectedId || isSaving}
              onClick={handleConfirm}
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Aplicar e continuar'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
