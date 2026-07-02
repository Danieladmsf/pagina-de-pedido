'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { uploadImage } from '@/lib/upload';
import { mergeCatalog, type EncomendaCatalog, type SkuOption } from '@/lib/encomendas/catalog';
import { Loader2, Save, Plus, Trash2, Upload, ExternalLink } from 'lucide-react';

const genId = () => Math.random().toString(36).slice(2, 9);
const num = (v: string) => Number(String(v).replace(',', '.')) || 0;

export function EncomendaCatalogEditor({ db, user, storeProfile }: { db: any; user: any; storeProfile: any }) {
  const { toast } = useToast();
  const [cat, setCat] = useState<EncomendaCatalog>(mergeCatalog(storeProfile?.encomendas?.catalog));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setCat(mergeCatalog(storeProfile?.encomendas?.catalog));
    setDirty(false);
  }, [storeProfile]);

  const mut = (fn: (c: any) => void) => {
    setCat((prev) => { const c = structuredClone(prev) as any; fn(c); return c; });
    setDirty(true);
  };
  const updItem = (key: keyof EncomendaCatalog, idx: number, patch: any) => mut((c) => { c[key][idx] = { ...c[key][idx], ...patch }; });
  const delItem = (key: keyof EncomendaCatalog, idx: number) => mut((c) => { c[key].splice(idx, 1); });
  const addItem = (key: keyof EncomendaCatalog, item: any) => mut((c) => { c[key].push(item); });
  const setStr = (key: keyof EncomendaCatalog, idx: number, val: string) => mut((c) => { c[key][idx] = val; });

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const slug = storeProfile?.shortSlug || user?.uid || '';
    return slug ? `${window.location.origin}/${slug}/encomendas` : '';
  }, [storeProfile?.shortSlug, user?.uid]);

  async function save() {
    if (!db || !user?.uid) return;
    setSaving(true);
    try {
      await setDoc(doc(db, 'store_profiles', user.uid), { encomendas: { catalog: cat } }, { merge: true });
      setDirty(false);
      toast({ title: 'Catálogo salvo', description: 'Os produtos já valem no link público.' });
    } catch (err) {
      console.error('[encomendas-catalog] erro ao salvar:', err);
      toast({ variant: 'destructive', title: 'Erro ao salvar', description: 'Tente novamente.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between gap-2 rounded-lg bg-card/95 px-1 py-2 backdrop-blur">
        <p className="text-sm text-muted-foreground">Edite os produtos, preços e fotos que aparecem no pedido.</p>
        <div className="flex items-center gap-2">
          {shareUrl && (
            <Button variant="outline" size="sm" onClick={() => window.open(shareUrl, '_blank')}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Ver página
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={saving || !dirty}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            {dirty ? 'Salvar catálogo' : 'Salvo'}
          </Button>
        </div>
      </div>

      {/* Produtos oferecidos */}
      <Section title="Produtos oferecidos" hint="Desative um tipo para escondê-lo do pedido.">
        <div className="space-y-3">
          {cat.products.map((p, i) => (
            <div key={p.kind} className="flex items-start gap-3 rounded-lg border p-3">
              <MiniPhoto url={p.imageUrl || ''} onChange={(u) => updItem('products', i, { imageUrl: u })} onError={() => toast({ variant: 'destructive', title: 'Falha no upload' })} fallback={p.icon} />
              <div className="min-w-0 flex-1 space-y-2">
                <Input value={p.title} onChange={(e) => updItem('products', i, { title: e.target.value })} className="font-semibold" />
                <Input value={p.description} onChange={(e) => updItem('products', i, { description: e.target.value })} className="text-sm" />
              </div>
              <label className="flex shrink-0 flex-col items-center gap-1 text-[10px] text-muted-foreground">
                {p.enabled === false ? 'Oculto' : 'Ativo'}
                <Switch checked={p.enabled !== false} onCheckedChange={(v) => updItem('products', i, { enabled: v })} />
              </label>
            </div>
          ))}
        </div>
      </Section>

      {/* Bolo */}
      <Section title="Bolo — tamanhos">
        {cat.cakeSizes.map((s, i) => (
          <Row key={s.id} onRemove={() => delItem('cakeSizes', i)}>
            <Col label="Sigla" w="70px"><Input value={s.label} onChange={(e) => updItem('cakeSizes', i, { label: e.target.value })} /></Col>
            <Col label="Descrição"><Input value={s.sub} onChange={(e) => updItem('cakeSizes', i, { sub: e.target.value })} /></Col>
            <Col label="Preço" w="110px"><Input inputMode="decimal" value={s.basePrice} onChange={(e) => updItem('cakeSizes', i, { basePrice: num(e.target.value) })} /></Col>
            <Col label="Formato" w="130px">
              <select value={s.shape} onChange={(e) => updItem('cakeSizes', i, { shape: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
                <option value="redondo">Redondo</option>
                <option value="retangular">Retangular</option>
              </select>
            </Col>
          </Row>
        ))}
        <AddBtn onClick={() => addItem('cakeSizes', { id: genId(), label: '', sub: '', basePrice: 0, shape: 'redondo' })} label="Adicionar tamanho" />
      </Section>

      <Section title="Bolo — massas">
        <StrList items={cat.cakeDoughs} onChange={(i, v) => setStr('cakeDoughs', i, v)} onRemove={(i) => delItem('cakeDoughs', i)} onAdd={() => addItem('cakeDoughs', '')} placeholder="Ex.: Massa branca (baunilha)" />
      </Section>

      <Section title="Bolo — recheios" hint="O nível agrupa os recheios (ex.: Clássico incluso; Premium com acréscimo).">
        {cat.cakeFillings.map((f, i) => (
          <Row key={f.id} onRemove={() => delItem('cakeFillings', i)}>
            <Col label="Recheio"><Input value={f.name} onChange={(e) => updItem('cakeFillings', i, { name: e.target.value })} /></Col>
            <Col label="Nível" w="150px">
              <select value={f.tier} onChange={(e) => updItem('cakeFillings', i, { tier: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
                {cat.fillingTiers.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Col>
            <Col label="Acréscimo" w="110px"><Input inputMode="decimal" value={f.price} onChange={(e) => updItem('cakeFillings', i, { price: num(e.target.value) })} /></Col>
          </Row>
        ))}
        <AddBtn onClick={() => addItem('cakeFillings', { id: genId(), name: '', tier: cat.fillingTiers[0] || 'Clássico', price: 0 })} label="Adicionar recheio" />
        <div className="mt-3">
          <Label className="text-xs text-muted-foreground">Níveis de recheio</Label>
          <StrList items={cat.fillingTiers} onChange={(i, v) => setStr('fillingTiers', i, v)} onRemove={(i) => delItem('fillingTiers', i)} onAdd={() => addItem('fillingTiers', '')} placeholder="Ex.: Premium" />
        </div>
      </Section>

      <Section title="Bolo — coberturas">
        {cat.cakeCovers.map((cv, i) => (
          <Row key={cv.id} onRemove={() => delItem('cakeCovers', i)}>
            <Col label="Cobertura" w="180px"><Input value={cv.name} onChange={(e) => updItem('cakeCovers', i, { name: e.target.value })} /></Col>
            <Col label="Descrição"><Input value={cv.desc} onChange={(e) => updItem('cakeCovers', i, { desc: e.target.value })} /></Col>
            <Col label="Acréscimo" w="110px"><Input inputMode="decimal" value={cv.price} onChange={(e) => updItem('cakeCovers', i, { price: num(e.target.value) })} /></Col>
          </Row>
        ))}
        <AddBtn onClick={() => addItem('cakeCovers', { id: genId(), name: '', desc: '', price: 0 })} label="Adicionar cobertura" />
      </Section>

      <Section title="Bolo — plaquinha">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Preço da plaquinha personalizada</Label>
          <Input inputMode="decimal" value={cat.platePrice} onChange={(e) => mut((c) => { c.platePrice = num(e.target.value); })} className="w-32" />
        </div>
      </Section>

      {/* Especial */}
      <Section title="Especial da casa">
        <div className="grid gap-2 sm:grid-cols-2">
          <Col label="Título"><Input value={cat.especialInfo.title} onChange={(e) => mut((c) => { c.especialInfo.title = e.target.value; })} /></Col>
          <Col label="Aviso de retirada"><Input value={cat.especialInfo.windowLabel} onChange={(e) => mut((c) => { c.especialInfo.windowLabel = e.target.value; })} /></Col>
        </div>
        <div className="mt-2"><Col label="Descrição"><Input value={cat.especialInfo.desc} onChange={(e) => mut((c) => { c.especialInfo.desc = e.target.value; })} /></Col></div>
        <p className="mt-3 text-xs text-muted-foreground">O cliente só finaliza levando ao menos 1 item <b>Principal</b>; itens <b>Adicionais</b> acompanham (ex.: molho extra, calda).</p>
        <div className="mt-2"><SkuEditor items={cat.especialItems} roles minimums onUpd={(i, patch) => updItem('especialItems', i, patch)} onDel={(i) => delItem('especialItems', i)} onAdd={() => addItem('especialItems', { id: genId(), name: '', price: 0, role: 'principal' })} onErr={() => toast({ variant: 'destructive', title: 'Falha no upload' })} /></div>
      </Section>

      {/* Tortas / Docinhos */}
      <Section title="Tortas" hint='Use o campo "Grupo" para criar seções na página (ex.: Tortas Pequenas (P), Tortas Grandes (G)).'>
        <SkuEditor items={cat.tortas} groups onUpd={(i, patch) => updItem('tortas', i, patch)} onDel={(i) => delItem('tortas', i)} onAdd={() => addItem('tortas', { id: genId(), name: '', price: 0, group: cat.tortas[cat.tortas.length - 1]?.group || '' })} onErr={() => toast({ variant: 'destructive', title: 'Falha no upload' })} />
      </Section>

      <Section title="Docinhos" hint='Preço por unidade. "Mín." é o pedido mínimo por sabor (ex.: 50) e "De X em X" o salto do contador. Use "Grupo" para seções (ex.: Doces finos, Adicionais opcionais).'>
        <SkuEditor items={cat.docinhos} groups minimums onUpd={(i, patch) => updItem('docinhos', i, patch)} onDel={(i) => delItem('docinhos', i)} onAdd={() => addItem('docinhos', { id: genId(), name: '', price: 0, group: cat.docinhos[cat.docinhos.length - 1]?.group || '', minQty: 0, stepQty: 1 })} onErr={() => toast({ variant: 'destructive', title: 'Falha no upload' })} />
      </Section>

      {/* Horários */}
      <Section title="Horários de entrega/retirada">
        <StrList items={cat.deliveryTimes} onChange={(i, v) => setStr('deliveryTimes', i, v)} onRemove={(i) => delItem('deliveryTimes', i)} onAdd={() => addItem('deliveryTimes', '')} placeholder="Ex.: 14:00" grid />
      </Section>
    </div>
  );
}

/* ---------- helpers de UI ---------- */
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm font-bold uppercase tracking-wide text-primary">{title}</p>
      {hint && <p className="mb-2 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}
function Row({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="mb-2 flex flex-wrap items-end gap-2 rounded-lg border p-2">
      {children}
      <button type="button" onClick={onRemove} className="ml-auto flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Remover">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
function Col({ label, w, children }: { label: string; w?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 flex-1 space-y-1" style={w ? { flex: `0 0 ${w}`, maxWidth: w } : undefined}>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
function AddBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return <Button type="button" variant="outline" size="sm" onClick={onClick} className="mt-1"><Plus className="mr-1.5 h-3.5 w-3.5" /> {label}</Button>;
}

function StrList({ items, onChange, onRemove, onAdd, placeholder, grid }: {
  items: string[]; onChange: (i: number, v: string) => void; onRemove: (i: number) => void; onAdd: () => void; placeholder?: string; grid?: boolean;
}) {
  return (
    <div>
      <div className={grid ? 'grid grid-cols-2 gap-2 sm:grid-cols-3' : 'space-y-2'}>
        {items.map((v, i) => (
          <div key={i} className="flex items-center gap-1">
            <Input value={v} placeholder={placeholder} onChange={(e) => onChange(i, e.target.value)} />
            <button type="button" onClick={() => onRemove(i)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
      <AddBtn onClick={onAdd} label="Adicionar" />
    </div>
  );
}

function SkuEditor({ items, onUpd, onDel, onAdd, onErr, groups, minimums, roles }: {
  items: SkuOption[]; onUpd: (i: number, patch: any) => void; onDel: (i: number) => void; onAdd: () => void; onErr: () => void;
  groups?: boolean;   // campo "Grupo" (cria seções na página, ex.: "Tortas Pequenas (P)")
  minimums?: boolean; // campos "Mín." e "De X em X" (ex.: 50 docinhos por sabor)
  roles?: boolean;    // Especial: item Principal (obrigatório) ou Adicional
}) {
  return (
    <div>
      {items.map((it, i) => (
        <div key={it.id} className="mb-2 space-y-2 rounded-lg border p-2">
          <div className="flex items-start gap-2">
            <MiniPhoto url={it.imageUrl || ''} onChange={(u) => onUpd(i, { imageUrl: u })} onError={onErr} />
            <div className="min-w-0 flex-1 space-y-1">
              <Input value={it.name} placeholder="Nome do item" onChange={(e) => onUpd(i, { name: e.target.value })} className="font-medium" />
              <Input value={it.desc || ''} placeholder="Descrição (opcional)" onChange={(e) => onUpd(i, { desc: e.target.value })} className="text-sm" />
            </div>
            <div className="w-24 shrink-0 space-y-1">
              <Label className="text-[11px] text-muted-foreground">Preço</Label>
              <Input inputMode="decimal" value={it.price} onChange={(e) => onUpd(i, { price: num(e.target.value) })} />
            </div>
            <button type="button" onClick={() => onDel(i)} className="mt-6 flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
          </div>
          <div className="flex flex-wrap items-end gap-2 pl-14">
              {groups && (
                <div className="min-w-0 flex-1 space-y-1" style={{ minWidth: 160 }}>
                  <Label className="text-[11px] text-muted-foreground">Grupo (seção na página)</Label>
                  <Input value={it.group || ''} placeholder="Ex.: Tortas Pequenas (P)" onChange={(e) => onUpd(i, { group: e.target.value })} className="text-sm" />
                </div>
              )}
              {minimums && (
                <>
                  <div className="w-20 shrink-0 space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Mín.</Label>
                    <Input inputMode="numeric" value={it.minQty || 0} onChange={(e) => onUpd(i, { minQty: num(e.target.value) })} />
                  </div>
                  <div className="w-24 shrink-0 space-y-1">
                    <Label className="text-[11px] text-muted-foreground">De X em X</Label>
                    <Input inputMode="numeric" value={it.stepQty || 1} onChange={(e) => onUpd(i, { stepQty: num(e.target.value) || 1 })} />
                  </div>
                </>
              )}
              {roles && (
                <div className="w-32 shrink-0 space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Tipo</Label>
                  <select value={it.role === 'adicional' ? 'adicional' : 'principal'} onChange={(e) => onUpd(i, { role: e.target.value })}
                    className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
                    <option value="principal">Principal</option>
                    <option value="adicional">Adicional</option>
                  </select>
                </div>
              )}
              <label className="ml-auto flex shrink-0 flex-col items-center gap-1 text-[10px] text-muted-foreground">
                {it.enabled === false ? 'Oculto' : 'Ativo'}
                <Switch checked={it.enabled !== false} onCheckedChange={(v) => onUpd(i, { enabled: v })} />
              </label>
          </div>
        </div>
      ))}
      <AddBtn onClick={onAdd} label="Adicionar item" />
    </div>
  );
}

function MiniPhoto({ url, onChange, onError, fallback }: { url: string; onChange: (url: string) => void; onError: () => void; fallback?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try { onChange(await uploadImage(file)); } catch { onError(); } finally { setUploading(false); if (ref.current) ref.current.value = ''; }
  }
  return (
    <>
      <button type="button" onClick={() => ref.current?.click()} className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed bg-muted/40 text-muted-foreground hover:border-primary/50" title="Trocar foto">
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" />
          : url ? (/* eslint-disable-next-line @next/next/no-img-element */ <img src={url} alt="" className="h-full w-full object-cover" />)
          : fallback ? <span className="text-lg">{fallback}</span>
          : <Upload className="h-4 w-4" />}
      </button>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={onFile} />
    </>
  );
}
