'use client';

// Acompanhamento de encomendas do cliente (espelho enxuto de /my-orders, mas para
// a coleção `encomendas`). Busca pelo uid anônimo (customerUid) — as regras só
// liberam as próprias encomendas; o telefone serve para disparar o login anônimo.

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, doc, getDoc, query, where } from 'firebase/firestore';
import { useCollection, useMemoFirebase } from '@/firebase';
import { useCustomerFirebase } from '@/firebase/customer-client';
import { getTheme, themeToCssVars, ensureBrandFontsLoaded } from '@/lib/themes';
import { ensureAuthenticated } from '@/firebase/non-blocking-login';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronLeft, CakeSlice, Loader2, CalendarDays, Store, Bike, Search, XCircle, CheckCircle2 } from 'lucide-react';
import { ENCOMENDA_STATUS_LABEL, type EncomendaStatus } from '@/lib/encomendas/types';

const money = (n: number) => `R$ ${(Number(n) || 0).toFixed(2).replace('.', ',')}`;
const fmtDate = (iso?: string) => {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

const ENC_STEPS: { key: EncomendaStatus; label: string }[] = [
  { key: 'orcamento', label: 'Recebida' },
  { key: 'confirmada', label: 'Confirmada' },
  { key: 'producao', label: 'Em produção' },
  { key: 'pronta', label: 'Pronta' },
  { key: 'entregue', label: 'Entregue' },
];

function EncTimeline({ status }: { status: EncomendaStatus }) {
  if (status === 'cancelada') {
    return (
      <div className="flex items-center justify-center gap-1.5 rounded-md border border-red-200 bg-red-50 py-2 text-red-600">
        <XCircle className="h-4 w-4" />
        <span className="text-xs font-bold uppercase tracking-wide">Encomenda cancelada</span>
      </div>
    );
  }
  const currentIdx = ENC_STEPS.findIndex((s) => s.key === status);
  return (
    <div className="flex items-start">
      {ENC_STEPS.map((step, i) => {
        const done = i <= currentIdx;
        return (
          <React.Fragment key={step.key}>
            <div className="flex flex-col items-center gap-1" style={{ minWidth: 52 }}>
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${done ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                {done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
              </span>
              <span className={`text-center text-[10px] font-semibold ${done ? 'text-green-700' : 'text-slate-400'}`}>{step.label}</span>
            </div>
            {i < ENC_STEPS.length - 1 && (
              <div className={`mt-3 h-[2px] flex-1 ${i < currentIdx ? 'bg-green-500' : 'bg-slate-200'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function encItems(e: any): string[] {
  const parts: string[] = [];
  if (e.bolo) {
    const b = e.bolo;
    const nome = [b.flavor || b.filling, b.weight || b.size].filter(Boolean).join(' · ');
    parts.push(`Bolo ${nome}`.trim());
  }
  (e.tortasItems || []).forEach((it: any) => parts.push(`${it.qty}× ${it.name}`));
  (e.docinhosItems || []).forEach((it: any) => parts.push(`${it.qty}× ${it.name}`));
  (e.especialItems || []).forEach((it: any) => parts.push(`${it.qty}× ${it.name}`));
  return parts;
}

export default function MyEncomendasPage() {
  const { user, isUserLoading, firestore: db, auth } = useCustomerFirebase();
  const [customerPhone, setCustomerPhone] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [storeId, setStoreId] = useState<string | null>(null);
  const [backHref, setBackHref] = useState('/');
  const [themeId, setThemeId] = useState('padrao');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('customer_phone');
      if (saved) { setCustomerPhone(saved); setPhoneInput(saved); }
      const p = new URLSearchParams(window.location.search);
      const sId = p.get('storeId');
      const returnTo = p.get('returnTo');
      const safeReturn = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '';
      if (sId) { setStoreId(sId); localStorage.setItem('last_store_id', sId); }
      else { const last = localStorage.getItem('last_store_id'); if (last) setStoreId(last); }
      if (safeReturn) setBackHref(safeReturn);
      else { const lp = localStorage.getItem('last_store_path'); if (lp && lp.startsWith('/') && !lp.startsWith('//')) setBackHref(lp); }
    } catch {}
  }, []);

  // Tema da loja (rosa da confeitaria etc.) — store_profiles é leitura pública.
  useEffect(() => { ensureBrandFontsLoaded(); }, []);
  useEffect(() => {
    if (!db || !storeId) return;
    getDoc(doc(db, 'store_profiles', storeId))
      .then((snap) => { const t = (snap.data() as any)?.theme; if (t) setThemeId(t); })
      .catch(() => {});
  }, [db, storeId]);

  useEffect(() => {
    if (!auth || isUserLoading || user || !customerPhone) return;
    void ensureAuthenticated(auth);
  }, [auth, isUserLoading, user, customerPhone]);

  const encQuery = useMemoFirebase(() => {
    if (!db || !user || !customerPhone || !storeId) return null;
    return query(collection(db, 'encomendas'), where('customerUid', '==', user.uid));
  }, [db, user, customerPhone, storeId]);

  const { data: encRaw, isLoading } = useCollection(encQuery);

  const encomendas = useMemo(() => {
    if (!encRaw || !storeId) return [];
    return [...encRaw]
      .filter((e: any) => e.ownerId === storeId)
      .sort((a: any, b: any) => (b.orderDateTime || '').localeCompare(a.orderDateTime || ''));
  }, [encRaw, storeId]);

  const searchPhone = () => {
    const digits = phoneInput.replace(/\D/g, '');
    if (digits.length < 10) return;
    setCustomerPhone(phoneInput.trim());
    try { localStorage.setItem('customer_phone', phoneInput.trim()); } catch {}
  };

  return (
    <div className="min-h-screen bg-muted/30" style={themeToCssVars(getTheme(themeId))}>
      <header className="sticky top-0 z-20 border-b bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Link href={backHref} className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted" aria-label="Voltar">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="flex items-center gap-2 text-lg font-black text-foreground">
            <CakeSlice className="h-5 w-5 text-primary" /> Minhas encomendas
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-5">
        {!customerPhone ? (
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <Label className="text-sm font-bold">Informe seu telefone</Label>
            <p className="mb-3 mt-0.5 text-xs text-muted-foreground">Use o mesmo número do seu pedido para ver o status.</p>
            <div className="flex gap-2">
              <Input value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} inputMode="tel" placeholder="(00) 90000-0000"
                onKeyDown={(e) => { if (e.key === 'Enter') searchPhone(); }} />
              <Button onClick={searchPhone} className="shrink-0"><Search className="mr-1.5 h-4 w-4" /> Ver</Button>
            </div>
          </div>
        ) : isLoading || (!user && !!customerPhone) ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Carregando suas encomendas…
          </div>
        ) : encomendas.length === 0 ? (
          <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
            <CakeSlice className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 font-bold text-foreground">Nenhuma encomenda por aqui</p>
            <p className="mt-1 text-sm text-muted-foreground">Quando você fizer uma encomenda, o status aparece aqui.</p>
            <Link href={backHref} className="mt-4 inline-block text-sm font-bold text-primary underline-offset-4 hover:underline">Voltar para a loja</Link>
          </div>
        ) : (
          <div className="space-y-4">
            {encomendas.map((e: any) => (
              <div key={e.id} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
                <div className="flex items-center justify-between gap-2 border-b bg-secondary/30 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">Encomenda #{e.id}</p>
                    <p className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                      {e.delivery?.type === 'delivery' ? <Bike className="h-4 w-4 text-primary" /> : <Store className="h-4 w-4 text-primary" />}
                      {e.delivery?.type === 'delivery' ? 'Entrega' : 'Retirada'}
                      {e.delivery?.date && <span className="flex items-center gap-1 font-medium text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" /> {fmtDate(e.delivery.date)} {e.delivery.time || ''}</span>}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                    {ENCOMENDA_STATUS_LABEL[e.status as EncomendaStatus] || e.status}
                  </span>
                </div>
                <div className="px-4 py-4">
                  <EncTimeline status={e.status} />
                  <ul className="mt-4 space-y-1 border-t border-dashed pt-3 text-sm text-foreground/90">
                    {encItems(e).map((line, i) => <li key={i} className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-primary" /> {line}</li>)}
                  </ul>
                  <div className="mt-3 flex items-center justify-between border-t border-dashed pt-3">
                    <span className="text-sm text-muted-foreground">Total</span>
                    <span className="font-black text-primary">{money(e.total)}</span>
                  </div>
                  {typeof e.sinal === 'number' && e.sinal > 0 && (
                    <p className="mt-1 text-right text-xs text-muted-foreground">Sinal {money(e.sinal)} · saldo {money(e.saldo)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
