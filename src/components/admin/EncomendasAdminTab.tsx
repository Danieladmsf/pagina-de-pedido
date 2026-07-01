'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { CakeSlice, Copy, Check, Loader2, Link2, ExternalLink, Wand2 } from 'lucide-react';

// Aba lateral "Encomendas" = CONFIGURAÇÃO da página pública (a lista de pedidos
// recebidos fica na aba operacional "Encomendas" do topo). Próxima etapa: editor
// visual (espelho da página) para trocar fotos, produtos reais e textos.

export function EncomendasAdminTab({ db, user, storeProfile }: { db: any; user: any; storeProfile: any }) {
  const { toast } = useToast();

  const [enabled, setEnabled] = useState(true);
  const [sinalPercent, setSinalPercent] = useState(30);
  const [pixKey, setPixKey] = useState('');
  const [minDays, setMinDays] = useState(3);
  const [daysLabel, setDaysLabel] = useState('Terça a Sábado');
  const [savingCfg, setSavingCfg] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const e = storeProfile?.encomendas || {};
    setEnabled(e.enabled !== false);
    setSinalPercent(typeof e.sinalPercent === 'number' ? e.sinalPercent : 30);
    setPixKey(e.pixKey || storeProfile?.creditPixKey || '');
    setMinDays(typeof e.minDays === 'number' ? e.minDays : 3);
    setDaysLabel(e.daysLabel || 'Terça a Sábado');
  }, [storeProfile]);

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const slug = storeProfile?.shortSlug || user?.uid || '';
    return slug ? `${window.location.origin}/${slug}/encomendas` : '';
  }, [storeProfile?.shortSlug, user?.uid]);

  async function saveConfig() {
    if (!db || !user?.uid) return;
    setSavingCfg(true);
    try {
      await setDoc(doc(db, 'store_profiles', user.uid), {
        encomendas: { enabled, sinalPercent: Number(sinalPercent) || 0, pixKey, minDays: Number(minDays) || 0, daysLabel },
      }, { merge: true });
      toast({ title: 'Configuração salva', description: 'As encomendas usam esses valores a partir de agora.' });
    } catch (err) {
      console.error('[encomendas-admin] erro ao salvar config:', err);
      toast({ variant: 'destructive', title: 'Erro ao salvar', description: 'Tente novamente.' });
    } finally {
      setSavingCfg(false);
    }
  }

  function copyShare() {
    if (!shareUrl) return;
    navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><CakeSlice className="h-5 w-5 text-primary" /> Encomendas — configuração</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="font-semibold">Página de encomendas ativa</p>
              <p className="text-sm text-muted-foreground">Quando ligada, os clientes podem montar encomendas pelo link abaixo.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {shareUrl && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-sm"><Link2 className="h-4 w-4" /> Link público</Label>
              <div className="flex items-center gap-2">
                <Input readOnly value={shareUrl} className="font-mono text-xs" />
                <Button type="button" variant="outline" onClick={copyShare} className="shrink-0" title="Copiar">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
                <Button type="button" variant="outline" className="shrink-0" title="Abrir" onClick={() => window.open(shareUrl, '_blank')}>
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm">Sinal / entrada (%)</Label>
              <Input type="number" min={0} max={100} value={sinalPercent} onChange={(e) => setSinalPercent(Number(e.target.value))} />
              <p className="text-xs text-muted-foreground">Percentual pago por PIX no ato do pedido.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Antecedência mínima (dias)</Label>
              <Input type="number" min={0} value={minDays} onChange={(e) => setMinDays(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Chave PIX (recebe o sinal)</Label>
              <Input value={pixKey} onChange={(e) => setPixKey(e.target.value)} placeholder="CPF/CNPJ, telefone, e-mail ou chave aleatória" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Dias de funcionamento (texto)</Label>
              <Input value={daysLabel} onChange={(e) => setDaysLabel(e.target.value)} placeholder="Ex.: Terça a Sábado" />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={saveConfig} disabled={savingCfg}>
              {savingCfg ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Salvar configuração
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Próxima etapa: editor visual (fotos, produtos reais, textos) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Wand2 className="h-5 w-5 text-primary" /> Personalizar a página (fotos, produtos e textos)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Em breve: um editor visual espelhando a página de pedido, onde você troca as fotos, cadastra os produtos reais
            (tamanhos, recheios, coberturas, tortas, docinhos e preços) e edita os textos. Por enquanto a página usa um
            catálogo padrão de exemplo.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
