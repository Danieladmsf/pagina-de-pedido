'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { type ProductKind } from '@/lib/encomendas/catalog';
import type { EncomendaConfig } from '@/lib/encomendas/config';
import { StepIndicator, OptionCard, StepHeader, SkuRow, money } from '@/components/encomendas/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn, neighborhoodMatchesQuery } from '@/lib/utils';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useCustomerFirebase } from '@/firebase/customer-client';
import { ensureAuthenticated } from '@/firebase/non-blocking-login';
import { uploadFileToApp } from '@/lib/upload';
import { useToast } from '@/hooks/use-toast';
import type { Encomenda, EncomendaLineItem } from '@/lib/encomendas/types';
import {
  ArrowLeft, ArrowRight, Gift, Building2, Copy, MapPin, Store, Bike, Upload,
  CalendarDays, Clock, MessageCircle, Cake, Sparkles, Home, Check, Loader2, Trash2,
} from 'lucide-react';

type Qmap = Record<string, number>;

// Literal no bundle do cliente (seguro). NÃO vem do config/RSC: emoji de 4 bytes
// corrompe ao cruzar o boundary server→client. Ver nota em lib/encomendas/config.ts.
const EMOJI_FALLBACK = '🎂';

function formatDateBR(iso: string) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

const WEEKDAY_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// Data local em ISO (yyyy-mm-dd) somando `days` dias — sem toISOString(),
// que converte para UTC e vira o dia errado à noite no fuso BR.
function localIsoPlusDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function weekdayOfIso(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).getDay();
}

// ID curto (mesmo alfabeto/entropia dos pedidos do cardápio — ver CartDrawer).
function genEncomendaId() {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => A[b % A.length]).join('');
}

// Agrupa SKUs pelo campo `group` preservando a ordem do catálogo; itens sem
// grupo ficam numa seção sem título no topo.
function groupSkus<T extends { group?: string }>(list: T[]): { group: string; items: T[] }[] {
  const out: { group: string; items: T[] }[] = [];
  for (const it of list) {
    const g = it.group || '';
    const bucket = out.find((o) => o.group === g);
    if (bucket) bucket.items.push(it);
    else out.push({ group: g, items: [it] });
  }
  return out;
}

export function EncomendaWizard({ config, storeId, onHome }: { config: EncomendaConfig; storeId: string; onHome: () => void }) {
  // App Firebase isolado do cardápio (auth anônimo), igual ao CartDrawer.
  const { firebaseApp, firestore: db, auth } = useCustomerFirebase();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [birthday, setBirthday] = useState('');
  const [isEmpresa, setEmpresa] = useState(false);
  const [products, setProducts] = useState<Set<ProductKind>>(new Set());
  const [cakeSize, setCakeSize] = useState('');
  const [cakeDough, setCakeDough] = useState('');
  const [cakeFilling, setCakeFilling] = useState('');
  const [cakeCover, setCakeCover] = useState('naked');
  const [plateOn, setPlateOn] = useState(false);
  const [plate, setPlate] = useState({ name: '', age: '', theme: '', notes: '' });
  const [especial, setEspecial] = useState<Qmap>({});
  const [tortas, setTortas] = useState<Qmap>({});
  const [docinhos, setDocinhos] = useState<Qmap>({});
  const [delDate, setDelDate] = useState('');
  const [delTime, setDelTime] = useState('');
  const [delType, setDelType] = useState<'retirada' | 'delivery' | ''>('');
  const [orderNotes, setOrderNotes] = useState('');
  // Endereço de entrega (só quando delType === 'delivery')
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState(config.city || '');
  const [showNbSuggestions, setShowNbSuggestions] = useState(false);
  const [dynamicFee, setDynamicFee] = useState<number | null>(null); // null = "a combinar"
  const [calculatingFee, setCalculatingFee] = useState(false);
  // Uploads reais (Storage do app "customer", auth anônimo)
  const [plateImageUrl, setPlateImageUrl] = useState('');
  const [plateUploading, setPlateUploading] = useState(false);
  const [compUrl, setCompUrl] = useState('');
  const [compName, setCompName] = useState('');
  const [compUploading, setCompUploading] = useState(false);

  // Sobe um arquivo do cliente (foto da plaquinha / comprovante PIX). Máx. 5MB.
  const uploadCustomerFile = useCallback(async (file: File): Promise<string> => {
    if (file.size > 5 * 1024 * 1024) throw new Error('Arquivo acima de 5MB.');
    if (!firebaseApp || !auth) throw new Error('Conexão indisponível.');
    await ensureAuthenticated(auth);
    return uploadFileToApp(firebaseApp, file, `encomendas/${storeId || 'geral'}`);
  }, [firebaseApp, auth, storeId]);

  // Catálogo data-driven: vem do config (encomendas.catalog || defaults). Os aliases
  // mantêm o resto do wizard idêntico ao protótipo.
  const cat = config.catalog;
  const PRODUCTS = cat.products.filter((p) => p.enabled !== false);
  const CAKE_SIZES = cat.cakeSizes;
  const CAKE_DOUGHS = cat.cakeDoughs;
  const CAKE_FILLINGS = cat.cakeFillings;
  const FILLING_TIERS = cat.fillingTiers;
  const CAKE_COVERS = cat.cakeCovers;
  const PLATE_PRICE = cat.platePrice;
  const ESPECIAL_INFO = cat.especialInfo;
  const ESPECIAL_ITEMS = cat.especialItems.filter((x) => x.enabled !== false);
  const TORTAS = cat.tortas.filter((x) => x.enabled !== false);
  const DOCINHOS = cat.docinhos.filter((x) => x.enabled !== false);
  const DELIVERY_TIMES = cat.deliveryTimes;

  // Especial: exige ao menos 1 item "principal" (adicionais não contam sozinhos).
  const especialPrincipais = ESPECIAL_ITEMS.filter((x) => x.role !== 'adicional');
  const especialPrincipalOk = especialPrincipais.some((x) => (especial[x.id] || 0) > 0);

  const has = (k: ProductKind) => products.has(k);

  // Validação da data de retirada/entrega: antecedência mínima (config.minDays)
  // e dias da semana atendidos (config.weekDays; vazio = todos os dias).
  const minDateIso = localIsoPlusDays(config.minDays || 0);
  const dateError = (() => {
    if (!delDate) return '';
    if (delDate < minDateIso) {
      return `Precisamos de pelo menos ${config.minDays} ${config.minDays === 1 ? 'dia' : 'dias'} de antecedência — escolha a partir de ${formatDateBR(minDateIso)}.`;
    }
    if (config.weekDays.length > 0 && !config.weekDays.includes(weekdayOfIso(delDate))) {
      return `Não atendemos encomendas nesse dia. Dias disponíveis: ${config.weekDays.map((d) => WEEKDAY_LABELS[d]).join(', ')}.`;
    }
    return '';
  })();

  const steps = useMemo(() => {
    const s: { id: string }[] = [{ id: 'contato' }, { id: 'produtos' }];
    if (has('bolo')) s.push({ id: 'tamanho' }, { id: 'recheio' }, { id: 'cobertura' }, { id: 'plaquinha' });
    if (has('especial')) s.push({ id: 'especial' });
    if (has('tortas')) s.push({ id: 'tortas' });
    if (has('docinhos')) s.push({ id: 'docinhos' });
    s.push({ id: 'entrega' }, { id: 'resumo' });
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  const total = steps.length;
  const safeIdx = Math.min(stepIdx, total - 1);
  const step = steps[safeIdx];

  const sizeObj = CAKE_SIZES.find((x) => x.id === cakeSize);
  const fillObj = CAKE_FILLINGS.find((x) => x.id === cakeFilling);
  const coverObj = CAKE_COVERS.find((x) => x.id === cakeCover);
  const boloTotal = has('bolo') && sizeObj
    ? sizeObj.basePrice + (fillObj?.price || 0) + (coverObj?.price || 0) + (plateOn ? PLATE_PRICE : 0) : 0;
  const sumQ = (map: Qmap, list: { id: string; price: number }[]) =>
    list.reduce((acc, it) => acc + (map[it.id] || 0) * it.price, 0);
  const especialTotal = has('especial') ? sumQ(especial, ESPECIAL_ITEMS) : 0;
  const tortasTotal = has('tortas') ? sumQ(tortas, TORTAS) : 0;
  const docinhosTotal = has('docinhos') ? sumQ(docinhos, DOCINHOS) : 0;
  const subtotal = boloTotal + especialTotal + tortasTotal + docinhosTotal;
  // Taxa de entrega: mesma API do cardápio e do PDV (/api/delivery-fee), com o
  // MESMO payload (ver CartDrawer/NovoPedidoTab — memória delivery-fee-two-entry-points).
  // Se a API não resolver (sem regras, endereço não casou), fica "a combinar" (null)
  // e não infla o total exibido ao cliente.
  const feeKnown = delType === 'delivery' && dynamicFee !== null;
  const deliveryFee = feeKnown ? (dynamicFee as number) : 0;
  const grandTotal = subtotal + deliveryFee;

  const calculateDeliveryFee = useCallback(async (nbOverride?: string) => {
    const nb = nbOverride ?? neighborhood;
    const hasRules = (config.deliveryFeeRules?.length || 0) > 0 || (config.customAddressRules?.length || 0) > 0;
    if (!config.storeAddress || !hasRules || !street || street.length < 3) { setDynamicFee(null); return; }
    const customerAddress = [street, number, nb, city, 'Brasil'].filter(Boolean).join(', ');
    setCalculatingFee(true);
    try {
      const res = await fetch('/api/delivery-fee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeAddress: config.storeAddress,
          customerAddress,
          feeRules: config.deliveryFeeRules,
          customAddressRules: config.customAddressRules,
          neighborhoodHint: nb,
        }),
      });
      const data = await res.json();
      setDynamicFee(res.ok && typeof data.fee === 'number' ? data.fee : null);
    } catch (err) {
      console.error('[encomendas] erro ao calcular taxa:', err);
      setDynamicFee(null);
    } finally {
      setCalculatingFee(false);
    }
  }, [config.storeAddress, config.deliveryFeeRules, config.customAddressRules, street, number, neighborhood, city]);
  const sinal = Math.round(grandTotal * config.sinalPercent) / 100;
  const saldo = grandTotal - sinal;

  // Itens resolvidos (id/nome/preço) — reaproveitados no doc persistido.
  const toLines = (map: Qmap, list: { id: string; name: string; price: number }[]): EncomendaLineItem[] =>
    list.filter((x) => (map[x.id] || 0) > 0).map((x) => ({ id: x.id, name: x.name, qty: map[x.id], unitPrice: x.price, total: map[x.id] * x.price }));
  const especialLines = has('especial') ? toLines(especial, ESPECIAL_ITEMS) : [];
  const tortasLines = has('tortas') ? toLines(tortas, TORTAS) : [];
  const docinhosLines = has('docinhos') ? toLines(docinhos, DOCINHOS) : [];

  const canNext = (() => {
    switch (step.id) {
      case 'contato': return phone.trim().length >= 8 && name.trim().length > 1;
      case 'produtos': return products.size > 0;
      case 'tamanho': return !!cakeSize;
      case 'recheio': return !!cakeDough && !!cakeFilling;
      case 'cobertura': return !!cakeCover;
      case 'especial': return especialPrincipalOk;
      case 'tortas': return Object.values(tortas).some((v) => v > 0);
      case 'docinhos': return Object.values(docinhos).some((v) => v > 0);
      case 'entrega': return !!delDate && !!delTime && !!delType && !dateError &&
        (delType !== 'delivery' || (street.trim().length >= 3 && !!neighborhood.trim()));
      default: return true;
    }
  })();

  const next = () => setStepIdx((i) => Math.min(total - 1, i + 1));
  const back = () => (safeIdx === 0 ? onHome() : setStepIdx((i) => Math.max(0, i - 1)));
  const toggleProduct = (k: ProductKind) =>
    setProducts((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const showSubtotalBar = safeIdx > 1 && step.id !== 'resumo' && subtotal > 0;

  function buildWhatsappMessage() {
    const L: string[] = [];
    L.push(`*Nova encomenda* ${EMOJI_FALLBACK}`);
    L.push('');
    L.push(`*Cliente:* ${name}`);
    L.push(`*WhatsApp:* ${phone}`);
    if (birthday) L.push(`*Aniversário:* ${formatDateBR(birthday)}`);
    if (isEmpresa) L.push('*Emitir NF-e (empresa):* sim');

    const lines = (map: Qmap, list: any[]) =>
      list.filter((x) => (map[x.id] || 0) > 0).map((x) => `   - ${map[x.id]}× ${x.name} — ${money(map[x.id] * x.price)}`);

    if (has('bolo') && sizeObj) {
      L.push('', '*Bolo personalizado*');
      L.push(`   - Tamanho: ${sizeObj.label} (${sizeObj.sub})`);
      L.push(`   - Massa: ${cakeDough}`);
      L.push(`   - Recheio: ${fillObj?.name || '—'}`);
      L.push(`   - Cobertura: ${coverObj?.name || '—'}`);
      if (plateOn) {
        const det = [plate.name && `nome "${plate.name}"`, plate.age && `${plate.age} anos`, plate.theme && `tema ${plate.theme}`].filter(Boolean).join(', ');
        L.push(`   - Plaquinha: ${det || 'sim'}`);
        if (plate.notes) L.push(`     Obs. plaquinha: ${plate.notes}`);
        if (plateImageUrl) L.push(`     Imagem de referência: ${plateImageUrl}`);
      }
      L.push(`   Subtotal bolo: ${money(boloTotal)}`);
    }
    if (has('especial')) { L.push('', '*Especial da casa*'); L.push(...lines(especial, ESPECIAL_ITEMS)); }
    if (has('tortas')) { L.push('', '*Tortas*'); L.push(...lines(tortas, TORTAS)); }
    if (has('docinhos')) { L.push('', '*Docinhos*'); L.push(...lines(docinhos, DOCINHOS)); }

    L.push('', '*Entrega*');
    L.push(`   - Data: ${formatDateBR(delDate)} ${delTime || ''}`.trim());
    if (delType === 'delivery') {
      L.push('   - Forma: Entrega');
      const addr = [street, number, complement].filter(Boolean).join(', ');
      if (addr) L.push(`   - Endereço: ${addr}`);
      if (neighborhood || city) L.push(`   - Bairro: ${[neighborhood, city].filter(Boolean).join(' · ')}`);
      L.push(`   - Taxa de entrega: ${feeKnown ? money(deliveryFee) : 'a combinar'}`);
    } else {
      L.push('   - Forma: Retirada no local');
    }

    L.push('', `*Total: ${money(grandTotal)}*`);
    L.push(`Sinal (${config.sinalPercent}%): ${money(sinal)}${config.pixKey ? ` — PIX ${config.pixKey}` : ''}`);
    L.push(`Saldo na entrega: ${money(saldo)}`);
    if (compUrl) L.push(`Comprovante do sinal: ${compUrl}`);
    if (orderNotes) L.push('', `*Observação:* ${orderNotes}`);
    return L.join('\n');
  }

  function buildEncomendaDoc(id: string, customerUid: string): Encomenda {
    return {
      id,
      customerUid,
      ownerId: storeId,
      customerName: name.trim(),
      customerPhone: phone.replace(/\D/g, ''),
      customerBirthDate: birthday || '',
      isEmpresa,
      products: Array.from(products),
      bolo: has('bolo') && sizeObj ? {
        sizeId: sizeObj.id,
        size: sizeObj.label,
        dough: cakeDough,
        filling: fillObj?.name || '',
        cover: coverObj?.name || '',
        plate: { on: plateOn, name: plate.name, age: plate.age, theme: plate.theme, notes: plate.notes, imageUrl: plateImageUrl },
        total: boloTotal,
      } : null,
      especialItems: especialLines,
      tortasItems: tortasLines,
      docinhosItems: docinhosLines,
      delivery: {
        date: delDate,
        time: delTime,
        type: delType,
        ...(delType === 'delivery' ? {
          street, number, complement, neighborhood, city,
          feeStatus: feeKnown ? 'calculada' as const : 'a_combinar' as const,
        } : {}),
      },
      subtotal,
      deliveryFee,
      total: grandTotal,
      sinalPercent: config.sinalPercent,
      sinal,
      saldo,
      status: 'orcamento',
      comprovanteUrl: compUrl || '',
      orderNotes: orderNotes || '',
      source: 'encomenda_web',
      orderDateTime: new Date().toISOString(),
      createdAt: serverTimestamp(),
    };
  }

  async function finalizar() {
    if (submitting) return;
    const msg = encodeURIComponent(buildWhatsappMessage());
    const base = config.whatsappDigits ? `https://wa.me/${config.whatsappDigits}` : 'https://wa.me/';
    const waUrl = `${base}?text=${msg}`;
    // Abre a aba já no gesto do clique (evita bloqueio de popup); a URL do
    // WhatsApp é definida depois de tentar persistir a encomenda.
    const waTab = window.open('about:blank', '_blank');

    setSubmitting(true);
    try {
      if (db && auth && storeId) {
        const user = await ensureAuthenticated(auth);
        const id = genEncomendaId();
        await setDoc(doc(collection(db, 'encomendas'), id), buildEncomendaDoc(id, user.uid));
      }
    } catch (err) {
      console.error('[encomendas] falha ao registrar:', err);
      toast({
        variant: 'destructive',
        title: 'Não consegui registrar aqui',
        description: 'Sem problema — envie pelo WhatsApp que confirmamos manualmente.',
      });
    } finally {
      setSubmitting(false);
      if (waTab && !waTab.closed) waTab.location.href = waUrl;
      else window.open(waUrl, '_blank');
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-3 sm:px-4 pb-32 pt-5">
      <header className="mb-5 flex flex-col items-center gap-3">
        <div className="flex w-full items-center justify-between">
          <button onClick={onHome} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
            <Home className="h-4 w-4" /> Início
          </button>
          <div className="flex items-center gap-2 text-primary">
            <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-base">
              {config.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={config.logoUrl} alt={config.name} className="h-full w-full rounded-full object-cover" />
              ) : (config.logoEmoji || EMOJI_FALLBACK)}
            </span>
            <span className="font-display text-base font-bold">{config.name}</span>
          </div>
          <span className="w-12" />
        </div>
        <StepIndicator total={total} current={safeIdx + 1} />
      </header>

      <main className="flex-1">
        <div className="rounded-3xl border border-border bg-card/70 p-5 sm:p-7 shadow-soft backdrop-blur">
          {step.id === 'contato' && (
            <Section title="Vamos começar com seus dados.">
              <Field label="Telefone (WhatsApp)" required>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 90000-0000" inputMode="tel" />
              </Field>
              <Field label="Nome e sobrenome" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Como podemos te chamar?" />
              </Field>
              <Field label={<span className="flex items-center gap-1.5"><Gift className="h-4 w-4 text-primary" /> Data de aniversário <span className="font-normal text-muted-foreground">(opcional)</span></span>}>
                <Input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">Adoramos lembrar de você no seu dia 💛</p>
              </Field>
              <button type="button" onClick={() => setEmpresa((v) => !v)}
                className={`mt-2 flex w-full items-start gap-3 rounded-2xl border-2 p-4 text-left transition-colors ${isEmpresa ? 'border-primary bg-secondary/50' : 'border-dashed border-border hover:border-primary/40'}`}>
                <span aria-hidden className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors', isEmpresa ? 'border-primary bg-primary text-primary-foreground' : 'border-primary/30')}>
                  {isEmpresa && <Check className="h-3.5 w-3.5" />}
                </span>
                <span>
                  <span className="flex items-center gap-1.5 font-semibold text-foreground"><Building2 className="h-4 w-4 text-gold" /> Encomenda para empresa — emitir NF-e</span>
                  <span className="block text-xs text-muted-foreground">Marque se precisar de Nota Fiscal Eletrônica.</span>
                </span>
              </button>
            </Section>
          )}

          {step.id === 'produtos' && (
            <Section title="O que você quer encomendar?" subtitle="Pode combinar bolo, tortas, docinhos e o especial da casa no mesmo pedido.">
              <div className="grid gap-3 sm:grid-cols-2">
                {PRODUCTS.map((p) => (
                  <OptionCard key={p.kind} icon={p.icon} image={p.imageUrl} title={p.title} description={p.description}
                    selected={has(p.kind)} onClick={() => toggleProduct(p.kind)}
                    badge={p.kind === 'especial' ? 'Edição limitada' : undefined} />
                ))}
              </div>
            </Section>
          )}

          {step.id === 'tamanho' && (
            <Section title="Tamanho do bolo" kicker={`Passo ${safeIdx + 1} de ${total}`} subtitle="Escolha o tamanho ideal para a sua festa.">
              <div className="grid gap-3 sm:grid-cols-3">
                {CAKE_SIZES.map((s) => (
                  <button key={s.id} type="button" onClick={() => setCakeSize(s.id)}
                    className={`rounded-2xl border-2 p-4 text-left transition-all hover:-translate-y-0.5 ${cakeSize === s.id ? 'border-primary bg-secondary/50 ring-2 ring-primary/15' : 'border-border bg-card hover:border-primary/40'}`}>
                    <div className="flex items-baseline justify-between">
                      <p className="font-display text-2xl font-bold text-foreground">{s.label}</p>
                      <p className="text-sm font-bold text-primary">{money(s.basePrice)}</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{s.sub}</p>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">P a GG são <b>redondos</b>; XG e XXG são <b>retangulares</b>. O valor final soma o recheio e a cobertura.</p>
            </Section>
          )}

          {step.id === 'recheio' && (
            <Section title="Massa & recheio">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gold">Massa</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {CAKE_DOUGHS.map((d) => <OptionCard key={d} title={d} selected={cakeDough === d} onClick={() => setCakeDough(d)} />)}
              </div>
              {FILLING_TIERS.map((tier) => (
                <div key={tier} className="space-y-2.5">
                  <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-gold">Recheios {tier}</p>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {CAKE_FILLINGS.filter((f) => f.tier === tier).map((f) => (
                      <OptionCard key={f.id} title={f.name} price={f.price} included={f.price === 0}
                        selected={cakeFilling === f.id} onClick={() => setCakeFilling(f.id)} />
                    ))}
                  </div>
                </div>
              ))}
            </Section>
          )}

          {step.id === 'cobertura' && (
            <Section title="Cobertura" kicker={`Passo ${safeIdx + 1} de ${total}`} subtitle="Escolha o acabamento do bolo.">
              <div className="grid gap-3">
                {CAKE_COVERS.map((c) => (
                  <OptionCard key={c.id} title={c.name} description={c.desc} price={c.price} included={c.price === 0}
                    selected={cakeCover === c.id} onClick={() => setCakeCover(c.id)} />
                ))}
              </div>
            </Section>
          )}

          {step.id === 'plaquinha' && (
            <Section title="Personalização" kicker={`Passo ${safeIdx + 1} de ${total}`}>
              <OptionCard title="Plaquinha personalizada" description="Nome, idade, tema e imagem de referência (opcional)" price={PLATE_PRICE}
                selected={plateOn} onClick={() => setPlateOn((v) => !v)} />
              {plateOn && (
                <div className="mt-4 space-y-4 rounded-2xl bg-secondary/40 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gold">Detalhes da plaquinha</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Nome no bolo"><Input value={plate.name} onChange={(e) => setPlate({ ...plate, name: e.target.value })} /></Field>
                    <Field label="Idade"><Input value={plate.age} onChange={(e) => setPlate({ ...plate, age: e.target.value })} inputMode="numeric" /></Field>
                  </div>
                  <Field label="Tema"><Input value={plate.theme} onChange={(e) => setPlate({ ...plate, theme: e.target.value })} placeholder="Ex: jardim, futebol, princesa..." /></Field>
                  <Field label="Observações"><Textarea value={plate.notes} onChange={(e) => setPlate({ ...plate, notes: e.target.value })} placeholder="Cores, alergias, detalhes especiais..." rows={3} /></Field>
                  <Field label={<span>Imagem de referência <span className="font-normal text-muted-foreground">(opcional)</span></span>}>
                    <FileUploadBox
                      accept="image/*"
                      uploading={plateUploading}
                      previewUrl={plateImageUrl}
                      label="Enviar foto (até 5MB)"
                      onClear={() => setPlateImageUrl('')}
                      onFile={async (file) => {
                        setPlateUploading(true);
                        try { setPlateImageUrl(await uploadCustomerFile(file)); }
                        catch (err: any) {
                          console.error('[encomendas] upload plaquinha:', err);
                          toast({ variant: 'destructive', title: 'Não consegui enviar a foto', description: err?.message || 'Tente novamente.' });
                        } finally { setPlateUploading(false); }
                      }}
                    />
                  </Field>
                </div>
              )}
            </Section>
          )}

          {step.id === 'especial' && (
            <Section title="Especial da casa" kicker={`Passo ${safeIdx + 1} de ${total}`}>
              <div className="rounded-2xl border-2 border-primary/30 bg-secondary/50 p-4">
                <p className="font-display text-lg font-bold text-primary">✨ {ESPECIAL_INFO.title}</p>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{ESPECIAL_INFO.desc}</p>
                <p className="mt-2 text-xs font-semibold text-primary">{ESPECIAL_INFO.windowLabel}</p>
              </div>
              <div className="mt-3 space-y-2.5">
                {ESPECIAL_ITEMS.map((it) => (
                  <SkuRow key={it.id} name={it.name} desc={it.desc} price={it.price} image={it.imageUrl}
                    minQty={it.minQty || 0} step={it.stepQty || 1}
                    qty={especial[it.id] || 0} onQty={(v) => setEspecial({ ...especial, [it.id]: v })} />
                ))}
              </div>
              {!especialPrincipalOk && (
                <p className="mt-3 text-center text-xs font-semibold text-primary">
                  Adicione pelo menos 1 {especialPrincipais.length === 1 ? especialPrincipais[0].name : 'item principal'} para continuar.
                </p>
              )}
              <SelectedList title={ESPECIAL_INFO.title} map={especial} list={ESPECIAL_ITEMS}
                onRemove={(id) => setEspecial({ ...especial, [id]: 0 })} />
            </Section>
          )}

          {step.id === 'tortas' && (
            <Section title="Tortas geladas" kicker={`Passo ${safeIdx + 1} de ${total}`} subtitle="Escolha as tortas e a quantidade de cada.">
              {groupSkus(TORTAS).map(({ group, items }) => (
                <div key={group || '_'} className="space-y-2.5">
                  {group && <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-gold">{group}</p>}
                  {items.map((t) => (
                    <SkuRow key={t.id} name={t.name} desc={t.desc} price={t.price} image={t.imageUrl}
                      minQty={t.minQty || 0} step={t.stepQty || 1}
                      qty={tortas[t.id] || 0} onQty={(v) => setTortas({ ...tortas, [t.id]: v })} />
                  ))}
                </div>
              ))}
              <SelectedList title="Tortas" map={tortas} list={TORTAS}
                onRemove={(id) => setTortas({ ...tortas, [id]: 0 })} />
            </Section>
          )}

          {step.id === 'docinhos' && (
            <Section title="Docinhos finos" kicker={`Passo ${safeIdx + 1} de ${total}`}
              subtitle={DOCINHOS.some((d) => (d.minQty || 0) > 1) ? 'A quantidade mínima por sabor está indicada em cada item.' : 'Escolha os sabores e a quantidade de cada.'}>
              {groupSkus(DOCINHOS).map(({ group, items }) => (
                <div key={group || '_'} className="space-y-2.5">
                  {group && <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-gold">{group}</p>}
                  {items.map((d) => (
                    <SkuRow key={d.id} name={d.name} desc={d.desc} price={d.price} image={d.imageUrl}
                      minQty={d.minQty || 0} step={d.stepQty || 1}
                      qty={docinhos[d.id] || 0} onQty={(v) => setDocinhos({ ...docinhos, [d.id]: v })} />
                  ))}
                </div>
              ))}
              <SelectedList title="Docinhos" map={docinhos} list={DOCINHOS}
                onRemove={(id) => setDocinhos({ ...docinhos, [id]: 0 })} />
            </Section>
          )}

          {step.id === 'entrega' && (
            <Section title="Retirada ou entrega" kicker={`Passo ${safeIdx + 1} de ${total}`}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={<span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-primary" /> Data</span>} required>
                  <Input type="date" value={delDate} min={minDateIso} onChange={(e) => setDelDate(e.target.value)} />
                  {dateError
                    ? <p className="mt-1 text-xs font-semibold text-destructive">{dateError}</p>
                    : <p className="mt-1 text-xs text-muted-foreground">Mín. {config.minDays} dias · {config.daysLabel}</p>}
                </Field>
                <Field label={<span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-primary" /> Horário</span>} required>
                  <select value={delTime} onChange={(e) => setDelTime(e.target.value)}
                    className="flex h-10 w-full rounded-xl border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="">Escolher horário</option>
                    {DELIVERY_TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
              </div>
              <p className="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-gold">Como prefere receber? *</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <button type="button" onClick={() => setDelType('retirada')}
                  className={`flex items-start gap-3 rounded-2xl border-2 p-4 text-left transition-all ${delType === 'retirada' ? 'border-primary bg-secondary/50 ring-2 ring-primary/15' : 'border-border hover:border-primary/40'}`}>
                  <Store className="h-5 w-5 text-primary" />
                  <span><span className="block font-semibold">Retirar no local</span><span className="block text-xs text-muted-foreground">Sem custo adicional</span></span>
                </button>
                <button type="button" onClick={() => setDelType('delivery')}
                  className={`flex items-start gap-3 rounded-2xl border-2 p-4 text-left transition-all ${delType === 'delivery' ? 'border-primary bg-secondary/50 ring-2 ring-primary/15' : 'border-border hover:border-primary/40'}`}>
                  <Bike className="h-5 w-5 text-primary" />
                  <span><span className="block font-semibold">Entrega</span><span className="block text-xs text-muted-foreground">Taxa conforme o bairro</span></span>
                </button>
              </div>
              {delType === 'delivery' && (
                <div className="mt-4 space-y-3 rounded-2xl bg-secondary/40 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gold">Endereço de entrega</p>
                  <div className="grid gap-3 sm:grid-cols-[1fr_100px]">
                    <Field label="Rua / Avenida" required>
                      <Input value={street} onChange={(e) => setStreet(e.target.value)} onBlur={() => calculateDeliveryFee()} placeholder="Rua das Flores" />
                    </Field>
                    <Field label="Número">
                      <Input value={number} onChange={(e) => setNumber(e.target.value)} onBlur={() => calculateDeliveryFee()} inputMode="numeric" placeholder="123" />
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="relative">
                      <Field label="Bairro" required>
                        <Input value={neighborhood} autoComplete="off" placeholder="Digite o bairro..."
                          onChange={(e) => { setNeighborhood(e.target.value); setShowNbSuggestions(true); }}
                          onFocus={() => setShowNbSuggestions(true)}
                          onBlur={() => { setTimeout(() => setShowNbSuggestions(false), 200); calculateDeliveryFee(); }} />
                      </Field>
                      {showNbSuggestions && (() => {
                        const nbRules = (config.customAddressRules || []).filter((r: any) => r?.type === 'neighborhood' && r?.keyword);
                        const filtered = neighborhood.trim()
                          ? nbRules.filter((r: any) => neighborhoodMatchesQuery(r.keyword, neighborhood))
                          : nbRules;
                        if (filtered.length === 0) return null;
                        return (
                          <div className="absolute inset-x-0 z-30 mt-1 max-h-44 overflow-y-auto rounded-xl border border-border bg-card shadow-soft">
                            {filtered.map((rule: any, idx: number) => (
                              <button key={rule.keyword + idx} type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => { setNeighborhood(rule.keyword); setShowNbSuggestions(false); calculateDeliveryFee(rule.keyword); }}
                                className="block w-full truncate border-b border-border px-3 py-2 text-left text-xs transition-colors last:border-0 hover:bg-secondary/60">
                                {rule.keyword}
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    <Field label="Complemento">
                      <Input value={complement} onChange={(e) => setComplement(e.target.value)} placeholder="Apto, bloco..." />
                    </Field>
                  </div>
                  <Field label="Cidade">
                    <Input value={city} onChange={(e) => setCity(e.target.value)} onBlur={() => calculateDeliveryFee()} placeholder="Sua cidade" />
                  </Field>
                  <p className="text-sm font-semibold text-foreground">
                    Taxa de entrega:{' '}
                    {calculatingFee ? <Loader2 className="ml-1 inline h-3.5 w-3.5 animate-spin text-primary" />
                      : feeKnown ? <span className="text-primary">{money(deliveryFee)}</span>
                      : <span className="font-medium text-muted-foreground">a combinar no WhatsApp</span>}
                  </p>
                </div>
              )}
            </Section>
          )}

          {step.id === 'resumo' && (
            <ResumoStep config={config} name={name} phone={phone} products={products} sizeObj={sizeObj} cakeDough={cakeDough}
              fillObj={fillObj} coverObj={coverObj} plateOn={plateOn} plate={plate}
              especial={especial} tortas={tortas} docinhos={docinhos}
              delDate={delDate} delTime={delTime} delType={delType}
              delAddress={[street, number, complement].filter(Boolean).join(', ')}
              delNeighborhood={[neighborhood, city].filter(Boolean).join(' · ')}
              boloTotal={boloTotal} deliveryFee={deliveryFee} feeKnown={feeKnown} grandTotal={grandTotal} sinal={sinal} saldo={saldo}
              orderNotes={orderNotes} setOrderNotes={setOrderNotes}
              compUrl={compUrl} compName={compName} compUploading={compUploading}
              onClearComp={() => { setCompUrl(''); setCompName(''); }}
              onComprovante={async (file: File) => {
                setCompUploading(true);
                try { setCompUrl(await uploadCustomerFile(file)); setCompName(file.name); }
                catch (err: any) {
                  console.error('[encomendas] upload comprovante:', err);
                  toast({ variant: 'destructive', title: 'Não consegui enviar o comprovante', description: err?.message || 'Tente novamente.' });
                } finally { setCompUploading(false); }
              }} />
          )}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={back} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> {safeIdx === 0 ? 'Início' : 'Voltar'}
          </Button>
          {step.id !== 'resumo' ? (
            <Button onClick={next} disabled={!canNext} size="lg" className="rounded-full px-7 shadow-soft">
              {step.id === 'entrega' ? 'Revisar & pagar' : 'Continuar'} <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={finalizar} disabled={submitting} size="lg" className="rounded-full bg-[#1c1c1c] px-7 text-white hover:bg-black">
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-2 h-4 w-4" />} Enviar no WhatsApp
            </Button>
          )}
        </div>
      </main>

      {showSubtotalBar && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/90 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3">
            <span className="text-sm font-medium text-muted-foreground">Subtotal parcial</span>
            <span className="font-display text-xl font-bold text-primary">{money(subtotal)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Caixa de upload real (foto da plaquinha / comprovante PIX): botão tracejado
// enquanto vazio; depois mostra a prévia/nome do arquivo com opção de remover.
function FileUploadBox({ accept, uploading, previewUrl, fileName, label, hint, onFile, onClear }: {
  accept: string; uploading: boolean; previewUrl?: string; fileName?: string; label: string; hint?: string;
  onFile: (f: File) => void; onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasFile = !!previewUrl || !!fileName;
  return (
    <div>
      <input ref={inputRef} type="file" accept={accept} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); if (inputRef.current) inputRef.current.value = ''; }} />
      {hasFile ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border-2 border-primary/40 bg-secondary/40 p-3">
          <div className="flex min-w-0 items-center gap-3">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Check className="h-5 w-5" /></span>
            )}
            <span className="min-w-0 truncate text-sm font-medium text-foreground">{fileName || 'Foto enviada ✓'}</span>
          </div>
          <button type="button" onClick={onClear} title="Remover"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card py-6 text-sm text-muted-foreground transition-colors hover:border-primary/40 disabled:opacity-60">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? 'Enviando...' : label}
        </button>
      )}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// Mini-resumo da etapa: itens já escolhidos, com remoção rápida e subtotal da seção.
function SelectedList({ title, map, list, onRemove }: {
  title: string; map: Qmap; list: { id: string; name: string; price: number }[]; onRemove: (id: string) => void;
}) {
  const sel = list.filter((x) => (map[x.id] || 0) > 0);
  if (sel.length === 0) return null;
  const total = sel.reduce((acc, x) => acc + map[x.id] * x.price, 0);
  return (
    <div className="mt-4 rounded-2xl border border-border bg-secondary/30 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</p>
          <p className="font-display text-base font-bold text-foreground">{sel.length} {sel.length === 1 ? 'item' : 'itens'}</p>
        </div>
        <span className="font-display text-lg font-bold text-primary">{money(total)}</span>
      </div>
      <div className="mt-2 space-y-1.5 border-t border-dashed border-border pt-2">
        {sel.map((x) => (
          <div key={x.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate text-muted-foreground">{map[x.id]}× {x.name}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="font-medium text-foreground">{money(map[x.id] * x.price)}</span>
              <button type="button" onClick={() => onRemove(x.id)} title="Remover"
                className="text-muted-foreground transition-colors hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({ title, subtitle, kicker, children }: { title: string; subtitle?: string; kicker?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <StepHeader title={title} subtitle={subtitle} kicker={kicker} />
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, required, children }: { label: React.ReactNode; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-semibold text-foreground">{label}{required && <span className="ml-0.5 text-primary">*</span>}</Label>
      {children}
    </div>
  );
}

function ResumoStep(props: any) {
  const { config, name, phone, products, sizeObj, cakeDough, fillObj, coverObj, plateOn, plate,
    especial, tortas, docinhos, delDate, delTime, delType, delAddress, delNeighborhood,
    boloTotal, deliveryFee, feeKnown, grandTotal, sinal, saldo, orderNotes, setOrderNotes,
    compUrl, compName, compUploading, onComprovante, onClearComp } = props;
  const cat = config.catalog;
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(config.pixKey); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const lines = (map: Qmap, list: any[]) => list.filter((x) => (map[x.id] || 0) > 0).map((x) => ({ name: x.name, qty: map[x.id], total: map[x.id] * x.price }));

  return (
    <div className="space-y-5">
      <StepHeader title="Resumo do pedido" subtitle={`Confira tudo antes de enviar para ${config.name}.`} />
      <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <Row label="Cliente" value={name} />
        <Row label="WhatsApp" value={phone} />
        {products.has('bolo') && sizeObj && (
          <Block icon={<Cake className="h-4 w-4" />} title="Bolo">
            <Row label="Tamanho" value={sizeObj.label} />
            <Row label="Massa" value={cakeDough} />
            <Row label="Recheio" value={fillObj?.name} />
            <Row label="Cobertura" value={coverObj?.name} />
            {plateOn && <Row label="Plaquinha" value={[plate.name, plate.age].filter(Boolean).join(', ') || 'Sim'} />}
            <Row label="Subtotal bolo" value={money(boloTotal)} strong />
          </Block>
        )}
        {products.has('especial') && (
          <Block icon={<Sparkles className="h-4 w-4" />} title="Especial da casa">
            {lines(especial, cat.especialItems).map((l) => <Row key={l.name} label={`${l.qty}× ${l.name}`} value={money(l.total)} />)}
          </Block>
        )}
        {products.has('tortas') && (
          <Block title="Tortas">{lines(tortas, cat.tortas).map((l) => <Row key={l.name} label={`${l.qty}× ${l.name}`} value={money(l.total)} />)}</Block>
        )}
        {products.has('docinhos') && (
          <Block title="Docinhos">{lines(docinhos, cat.docinhos).map((l) => <Row key={l.name} label={`${l.qty}× ${l.name}`} value={money(l.total)} />)}</Block>
        )}
        <Block icon={<MapPin className="h-4 w-4" />} title="Entrega">
          <Row label="Data" value={`${formatDateBR(delDate)} ${delTime || ''}`} />
          <Row label="Forma" value={delType === 'delivery' ? 'Entrega' : 'Retirada no local'} />
          {delType === 'delivery' && delAddress && <Row label="Endereço" value={delAddress} />}
          {delType === 'delivery' && delNeighborhood && <Row label="Bairro" value={delNeighborhood} />}
          {delType === 'delivery' && <Row label="Taxa de entrega" value={feeKnown ? money(deliveryFee) : 'a combinar'} />}
        </Block>
        <div className="flex items-center justify-between border-t border-dashed border-border pt-3">
          <span className="font-display text-lg font-bold">Total</span>
          <span className="font-display text-xl font-bold text-primary">{money(grandTotal)}</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm font-semibold">Observação do pedido <span className="font-normal text-muted-foreground">(opcional)</span></Label>
        <Textarea value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} placeholder="Alergias, decoração, recados especiais..." rows={3} />
      </div>

      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-[#9d164c] p-5 text-white shadow-soft">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/70">Pagamento PIX</p>
        <p className="mt-1 font-display text-2xl font-bold">Entrada de {money(sinal)}</p>
        <p className="text-sm text-white/80">Sinal de {config.sinalPercent}% · saldo de {money(saldo)} na entrega</p>
        {config.pixKey && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-white/15 px-3 py-2.5">
            <span className="truncate font-mono text-sm">{config.pixKey}</span>
            <button onClick={copy} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-white">
              <Copy className="h-3.5 w-3.5" /> {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        )}
      </div>

      <div>
        <p className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-foreground"><Upload className="h-4 w-4" /> Anexar comprovante do PIX <span className="font-normal text-muted-foreground">(opcional)</span></p>
        <FileUploadBox
          accept="image/*,application/pdf"
          uploading={compUploading}
          previewUrl={compName?.toLowerCase().endsWith('.pdf') ? '' : compUrl}
          fileName={compName}
          label="Selecionar arquivo (até 5MB)"
          hint="JPG, PNG, WEBP ou PDF · agiliza a confirmação 💛"
          onClear={onClearComp}
          onFile={onComprovante}
        />
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value?: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'font-bold text-primary' : 'font-medium text-foreground'}>{value || '—'}</span>
    </div>
  );
}

function Block({ icon, title, children }: { icon?: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 border-t border-border pt-3">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gold">{icon}{title}</p>
      {children}
    </div>
  );
}
