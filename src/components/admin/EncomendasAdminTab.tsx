'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { collection, query, where, doc, updateDoc, setDoc } from 'firebase/firestore';
import { useCollection, useMemoFirebase } from '@/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Encomenda, EncomendaStatus, ENCOMENDA_STATUS_LABEL } from '@/lib/encomendas/types';
import {
  CalendarDays, Store, Bike, MessageCircle, Copy, Check, Loader2, CakeSlice, Package, Link2,
} from 'lucide-react';

const money = (n: number) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDateBR = (iso: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

const ALL_STATUS: EncomendaStatus[] = ['orcamento', 'confirmada', 'producao', 'pronta', 'entregue', 'cancelada'];
const STATUS_STYLE: Record<EncomendaStatus, string> = {
  orcamento: 'bg-amber-100 text-amber-800 border-amber-200',
  confirmada: 'bg-blue-100 text-blue-800 border-blue-200',
  producao: 'bg-purple-100 text-purple-800 border-purple-200',
  pronta: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  entregue: 'bg-slate-100 text-slate-600 border-slate-200',
  cancelada: 'bg-red-100 text-red-700 border-red-200',
};

function waLink(phoneDigits: string) {
  const d = (phoneDigits || '').replace(/\D/g, '');
  const full = d.startsWith('55') ? d : `55${d}`;
  return `https://wa.me/${full}`;
}

export function EncomendasAdminTab({ db, user, storeProfile }: { db: any; user: any; storeProfile: any }) {
  const { toast } = useToast();

  // --- Config (store_profiles.{uid}.encomendas) ---
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

  // --- Lista de encomendas recebidas ---
  const encomendasQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(collection(db, 'encomendas'), where('ownerId', '==', user.uid));
  }, [db, user?.uid]);
  const { data: encomendasRaw, isLoading } = useCollection<Encomenda>(encomendasQuery);
  const encomendas = useMemo(
    () => (encomendasRaw || []).slice().sort((a, b) => (b.orderDateTime || '').localeCompare(a.orderDateTime || '')),
    [encomendasRaw],
  );

  async function changeStatus(id: string, status: EncomendaStatus) {
    try {
      await updateDoc(doc(db, 'encomendas', id), { status });
    } catch (err) {
      console.error('[encomendas-admin] erro ao atualizar status:', err);
      toast({ variant: 'destructive', title: 'Erro ao atualizar status' });
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
      {/* Configuração */}
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
                <Button type="button" variant="outline" onClick={copyShare} className="shrink-0">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
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

      {/* Lista */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Package className="h-5 w-5 text-primary" /> Encomendas recebidas {encomendas.length > 0 && <span className="text-sm font-normal text-muted-foreground">({encomendas.length})</span>}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Carregando…</div>
          ) : encomendas.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              <Package className="mx-auto mb-2 h-8 w-8 opacity-40" />
              <p>Nenhuma encomenda ainda.</p>
              <p className="text-sm">Compartilhe o link público para começar a receber pedidos.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {encomendas.map((e) => <EncomendaCard key={e.id} enc={e} onStatus={changeStatus} />)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EncomendaCard({ enc, onStatus }: { enc: Encomenda & { id: string }; onStatus: (id: string, s: EncomendaStatus) => void }) {
  const status = (enc.status || 'orcamento') as EncomendaStatus;
  const items: string[] = [];
  if (enc.bolo) items.push(`Bolo ${enc.bolo.size} · ${enc.bolo.filling}${enc.bolo.cover ? ` · ${enc.bolo.cover}` : ''}${enc.bolo.plate?.on ? ' · c/ plaquinha' : ''}`);
  for (const l of enc.especialItems || []) items.push(`${l.qty}× ${l.name}`);
  for (const l of enc.tortasItems || []) items.push(`${l.qty}× ${l.name}`);
  for (const l of enc.docinhosItems || []) items.push(`${l.qty}× ${l.name}`);

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">#{enc.id}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[status]}`}>{ENCOMENDA_STATUS_LABEL[status]}</span>
            {enc.isEmpresa && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">NF-e</span>}
          </div>
          <p className="mt-1 font-semibold text-foreground">{enc.customerName}</p>
          <a href={waLink(enc.customerPhone)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-emerald-600 hover:underline">
            <MessageCircle className="h-3.5 w-3.5" /> {enc.customerPhone}
          </a>
        </div>
        <div className="text-right">
          <p className="font-display text-lg font-bold text-primary">{money(enc.total)}</p>
          <p className="text-xs text-muted-foreground">Sinal {money(enc.sinal)} · saldo {money(enc.saldo)}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {items.map((it, i) => <span key={i} className="rounded-md bg-secondary/60 px-2 py-1 text-xs text-secondary-foreground">{it}</span>)}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
        <span className="flex items-center gap-3 text-muted-foreground">
          <span className="flex items-center gap-1"><CalendarDays className="h-4 w-4" /> {formatDateBR(enc.delivery?.date)} {enc.delivery?.time}</span>
          <span className="flex items-center gap-1">
            {enc.delivery?.type === 'delivery' ? <><Bike className="h-4 w-4" /> Entrega</> : <><Store className="h-4 w-4" /> Retirada</>}
          </span>
        </span>
        <label className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Status</span>
          <select
            value={status}
            onChange={(ev) => onStatus(enc.id, ev.target.value as EncomendaStatus)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {ALL_STATUS.map((s) => <option key={s} value={s}>{ENCOMENDA_STATUS_LABEL[s]}</option>)}
          </select>
        </label>
      </div>

      {enc.orderNotes && <p className="mt-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground"><b>Obs.:</b> {enc.orderNotes}</p>}
    </div>
  );
}
