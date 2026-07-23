'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { uploadImage } from '@/lib/upload';
import { applyProductLinks, mergeCatalog, type EncomendaCatalog, type LinkedProduct, type SkuOption } from '@/lib/encomendas/catalog';
import { revalidateStorePages } from '@/lib/revalidate-store';
import { Loader2, Save, Plus, Trash2, Upload, ExternalLink, Link2, Unlink, Search } from 'lucide-react';

const genId = () => Math.random().toString(36).slice(2, 9);
const num = (v: string) => Number(String(v).replace(',', '.')) || 0;

export function EncomendaCatalogEditor({ db, user, storeProfile }: { db: any; user: any; storeProfile: any }) {
  const { toast } = useToast();
  const [cat, setCat] = useState<EncomendaCatalog>(mergeCatalog(storeProfile?.encomendas?.catalog));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Produtos da aba Produtos (menuItems) — fonte dos SKUs vinculados (ponte cardápio→encomendas).
  const [menuProducts, setMenuProducts] = useState<LinkedProduct[]>([]);

  useEffect(() => {
    setCat(mergeCatalog(storeProfile?.encomendas?.catalog));
    setDirty(false);
  }, [storeProfile]);

  useEffect(() => {
    if (!db || !user?.uid) return;
    getDocs(query(collection(db, 'menuItems'), where('ownerId', '==', user.uid)))
      .then((snap) => {
        const items = snap.docs.map((d) => ({ ...(d.data() as any), id: d.id }));
        items.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
        setMenuProducts(items);
      })
      .catch((err) => console.error('[encomendas-catalog] erro ao carregar produtos do cardápio:', err));
  }, [db, user?.uid]);

  const mut = (fn: (c: any) => void) => {
    setCat((prev) => { const c = structuredClone(prev) as any; fn(c); return c; });
    setDirty(true);
  };
  const updItem = (key: keyof EncomendaCatalog, idx: number, patch: any) => mut((c) => { c[key][idx] = { ...c[key][idx], ...patch }; });
  const delItem = (key: keyof EncomendaCatalog, idx: number) => mut((c) => { c[key].splice(idx, 1); });
  const addItem = (key: keyof EncomendaCatalog, item: any) => mut((c) => { c[key].push(item); });
  const setStr = (key: keyof EncomendaCatalog, idx: number, val: string) => mut((c) => { c[key][idx] = val; });

  // SKU novo criado a partir de um produto cadastrado: guarda o vínculo (productId)
  // e um snapshot dos dados — o snapshot é fallback caso o produto seja apagado.
  const skuFromProduct = (p: LinkedProduct): SkuOption => ({
    id: genId(),
    productId: p.id,
    name: p.name || '',
    desc: p.description || '',
    price: typeof p.price === 'number' ? p.price : 0,
    imageUrl: p.imageUrl || '',
  });

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const slug = storeProfile?.shortSlug || user?.uid || '';
    return slug ? `${window.location.origin}/${slug}/encomendas` : '';
  }, [storeProfile?.shortSlug, user?.uid]);

  async function save() {
    if (!db || !user?.uid) return;
    setSaving(true);
    try {
      // Atualiza o snapshot dos itens vinculados com os dados atuais do cadastro:
      // é o fallback da página pública caso o produto seja apagado do cardápio.
      // JSON.stringify remove campos undefined (ex.: peso sem "preço fixo") —
      // o Firestore rejeita undefined; mergeCatalog recompõe defaults na leitura.
      const toSave = JSON.parse(JSON.stringify(applyProductLinks(cat, menuProducts)));
      await setDoc(doc(db, 'store_profiles', user.uid), { encomendas: { catalog: toSave } }, { merge: true });
      revalidateStorePages(user.uid);
      setCat(toSave);
      setDirty(false);
      toast({ title: 'Catálogo salvo', description: 'Os produtos já valem no link público.' });
    } catch (err) {
      console.error('[encomendas-catalog] erro ao salvar:', err);
      toast({ variant: 'destructive', title: 'Erro ao salvar', description: 'Tente novamente.' });
    } finally {
      setSaving(false);
    }
  }

  // Loja no modelo "cardápio por kg" (Gostinho): edita sabores/pesos/massa/adicionais.
  const simple = (cat.cakes?.length || 0) > 0;

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
      {simple ? (
        <>
          <Section title="Bolo — sabores (preço por kg)" hint="Cada sabor tem seu preço por quilo. O cliente escolhe o sabor e depois o peso.">
            {cat.cakes.map((ck, i) => (
              <Row key={ck.id} onRemove={() => delItem('cakes', i)}>
                <Col label="Sabor"><Input value={ck.name} onChange={(e) => updItem('cakes', i, { name: e.target.value })} /></Col>
                <Col label="R$/kg" w="120px"><Input inputMode="decimal" value={ck.pricePerKg} onChange={(e) => updItem('cakes', i, { pricePerKg: num(e.target.value) })} /></Col>
              </Row>
            ))}
            <AddBtn onClick={() => addItem('cakes', { id: genId(), name: '', pricePerKg: 0 })} label="Adicionar sabor" />
          </Section>

          <Section title="Bolo — tamanhos (peso)" hint="Preço fixo (ex.: Baby) OU por kg (multiplica o preço do sabor). Embalagem soma ao total (ex.: Baby e 1 kg = 16). Deixe em branco o que não usar.">
            {cat.cakeWeights.map((w, i) => (
              <Row key={w.id} onRemove={() => delItem('cakeWeights', i)}>
                <Col label="Nome" w="88px"><Input value={w.label} onChange={(e) => updItem('cakeWeights', i, { label: e.target.value })} /></Col>
                <Col label="Descrição"><Input value={w.sub || ''} onChange={(e) => updItem('cakeWeights', i, { sub: e.target.value })} /></Col>
                <Col label="Kg" w="60px"><Input inputMode="decimal" value={w.kg ?? ''} placeholder="—" onChange={(e) => updItem('cakeWeights', i, { kg: e.target.value === '' ? undefined : num(e.target.value) })} /></Col>
                <Col label="Preço fixo" w="88px"><Input inputMode="decimal" value={w.fixedPrice ?? ''} placeholder="—" onChange={(e) => updItem('cakeWeights', i, { fixedPrice: e.target.value === '' ? undefined : num(e.target.value) })} /></Col>
                <Col label="Embalagem" w="88px"><Input inputMode="decimal" value={w.packaging ?? ''} placeholder="—" onChange={(e) => updItem('cakeWeights', i, { packaging: e.target.value === '' ? undefined : num(e.target.value) })} /></Col>
                <Col label="Formatos" w="150px">
                  <div className="flex h-10 items-center gap-3">
                    {['redondo', 'quadrado'].map((sh) => (
                      <label key={sh} className="flex items-center gap-1 text-xs capitalize">
                        <input type="checkbox" checked={(w.shapes || []).includes(sh)} onChange={(e) => { const cur = new Set(w.shapes || []); if (e.target.checked) cur.add(sh); else cur.delete(sh); updItem('cakeWeights', i, { shapes: [...cur] }); }} /> {sh}
                      </label>
                    ))}
                  </div>
                </Col>
              </Row>
            ))}
            <AddBtn onClick={() => addItem('cakeWeights', { id: genId(), label: '', kg: 1, shapes: ['redondo'] })} label="Adicionar tamanho" />
          </Section>

          <Section title="Bolo — massa" hint="Sem custo. Ex.: Branca, Preta.">
            <StrList items={cat.cakeDoughs} onChange={(i, v) => setStr('cakeDoughs', i, v)} onRemove={(i) => delItem('cakeDoughs', i)} onAdd={() => addItem('cakeDoughs', '')} placeholder="Ex.: Branca" />
          </Section>

          <Section title="Bolo — acabamentos e adicionais" hint='"A cada 2 kg" multiplica pelo peso (ex.: ganache num bolo de 4 kg = 2×). "Valor fixo" cobra uma vez só.'>
            {cat.cakeExtras.map((x, i) => (
              <Row key={x.id} onRemove={() => delItem('cakeExtras', i)}>
                <Col label="Adicional"><Input value={x.name} onChange={(e) => updItem('cakeExtras', i, { name: e.target.value })} /></Col>
                <Col label="Preço" w="100px"><Input inputMode="decimal" value={x.price} onChange={(e) => updItem('cakeExtras', i, { price: num(e.target.value) })} /></Col>
                <Col label="Cobrança" w="150px">
                  <select value={x.per === '2kg' ? '2kg' : 'unidade'} onChange={(e) => updItem('cakeExtras', i, { per: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
                    <option value="unidade">Valor fixo</option>
                    <option value="2kg">A cada 2 kg</option>
                  </select>
                </Col>
              </Row>
            ))}
            <AddBtn onClick={() => addItem('cakeExtras', { id: genId(), name: '', price: 0, per: 'unidade' })} label="Adicionar acabamento" />
          </Section>
        </>
      ) : (
        <>
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
        </>
      )}

      {/* Especial */}
      <Section title="Especial da casa">
        <div className="grid gap-2 sm:grid-cols-2">
          <Col label="Título"><Input value={cat.especialInfo.title} onChange={(e) => mut((c) => { c.especialInfo.title = e.target.value; })} /></Col>
          <Col label="Aviso de retirada"><Input value={cat.especialInfo.windowLabel} onChange={(e) => mut((c) => { c.especialInfo.windowLabel = e.target.value; })} /></Col>
        </div>
        <div className="mt-2"><Col label="Descrição"><Input value={cat.especialInfo.desc} onChange={(e) => mut((c) => { c.especialInfo.desc = e.target.value; })} /></Col></div>
        <p className="mt-3 text-xs text-muted-foreground">O cliente só finaliza levando ao menos 1 item <b>Principal</b>; itens <b>Adicionais</b> acompanham (ex.: molho extra, calda).</p>
        <div className="mt-2"><SkuEditor items={cat.especialItems} roles minimums products={menuProducts} onAddFromMenu={(p) => addItem('especialItems', { ...skuFromProduct(p), role: 'principal' })} onUpd={(i, patch) => updItem('especialItems', i, patch)} onDel={(i) => delItem('especialItems', i)} onAdd={() => addItem('especialItems', { id: genId(), name: '', price: 0, role: 'principal' })} onErr={() => toast({ variant: 'destructive', title: 'Falha no upload' })} /></div>
      </Section>

      {/* Tortas / Docinhos */}
      <Section title="Brigadeiros / Tortas" hint='Por cento: preencha o preço das 50 e do cento (a Cobrança define). "Grupo" cria seções (ex.: Brigadeiros Tradicionais, Gourmet).'>
        <SkuEditor items={cat.tortas} groups cento products={menuProducts} onAddFromMenu={(p) => addItem('tortas', { ...skuFromProduct(p), group: cat.tortas[cat.tortas.length - 1]?.group || '' })} onUpd={(i, patch) => updItem('tortas', i, patch)} onDel={(i) => delItem('tortas', i)} onAdd={() => addItem('tortas', { id: genId(), name: '', price: 0, group: cat.tortas[cat.tortas.length - 1]?.group || '' })} onErr={() => toast({ variant: 'destructive', title: 'Falha no upload' })} />
      </Section>

      <Section title="Doces finos / Docinhos" hint='Cada item: "Por cento" (preço das 50 e do cento) ou "Por unidade" (com "Mín." por sabor). "Grupo" cria seções na página.'>
        <SkuEditor items={cat.docinhos} groups minimums cento products={menuProducts} onAddFromMenu={(p) => addItem('docinhos', { ...skuFromProduct(p), group: cat.docinhos[cat.docinhos.length - 1]?.group || '', minQty: 0, stepQty: 1 })} onUpd={(i, patch) => updItem('docinhos', i, patch)} onDel={(i) => delItem('docinhos', i)} onAdd={() => addItem('docinhos', { id: genId(), name: '', price: 0, group: cat.docinhos[cat.docinhos.length - 1]?.group || '', minQty: 0, stepQty: 1 })} onErr={() => toast({ variant: 'destructive', title: 'Falha no upload' })} />
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

function SkuEditor({ items, onUpd, onDel, onAdd, onErr, groups, minimums, roles, cento: centoOption, products, onAddFromMenu }: {
  items: SkuOption[]; onUpd: (i: number, patch: any) => void; onDel: (i: number) => void; onAdd: () => void; onErr: () => void;
  groups?: boolean;   // campo "Grupo" (cria seções na página, ex.: "Tortas Pequenas (P)")
  minimums?: boolean; // campos "Mín." e "De X em X" (ex.: 50 docinhos por sabor)
  roles?: boolean;    // Especial: item Principal (obrigatório) ou Adicional
  cento?: boolean;    // "por cento": mostra preço das 50 e do cento + seletor de cobrança
  products?: LinkedProduct[];                 // produtos da aba Produtos, para vincular
  onAddFromMenu?: (p: LinkedProduct) => void; // adiciona um SKU vinculado ao produto
}) {
  const byId = useMemo(() => new Map((products || []).map((p) => [p.id, p])), [products]);
  return (
    <div>
      {items.map((it, i) => {
        // Item vinculado ao cardápio: nome/preço/foto vêm do cadastro do produto
        // (só leitura aqui); se o produto sumiu do cardápio, volta a ser editável.
        const linked = it.productId ? byId.get(it.productId) : undefined;
        const orphan = !!it.productId && !linked && (products?.length || 0) > 0;
        const cento = typeof it.priceCento === 'number';
        return (
        <div key={it.id} className="mb-2 space-y-2 rounded-lg border p-2">
          {(linked || orphan) && (
            <div className="flex items-center gap-2 pl-1 text-[11px]">
              {linked ? (
                <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary"><Link2 className="h-3 w-3" /> Vinculado ao cardápio</span>
              ) : (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-600">Produto removido do cardápio — usando os últimos dados salvos</span>
              )}
              <button type="button" onClick={() => onUpd(i, { productId: '' })} className="ml-auto flex items-center gap-1 rounded-md px-2 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Desvincular do produto do cardápio">
                <Unlink className="h-3 w-3" /> Desvincular
              </button>
            </div>
          )}
          <div className="flex items-start gap-2">
            {linked ? (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40 text-muted-foreground" title="Foto vem do cadastro do produto">
                {(linked.imageUrl || it.imageUrl)
                  ? (/* eslint-disable-next-line @next/next/no-img-element */ <img src={linked.imageUrl || it.imageUrl} alt="" className="h-full w-full object-cover" />)
                  : <Link2 className="h-4 w-4" />}
              </div>
            ) : (
              <MiniPhoto url={it.imageUrl || ''} onChange={(u) => onUpd(i, { imageUrl: u })} onError={onErr} />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <Input value={linked?.name ?? it.name} placeholder="Nome do item" disabled={!!linked} onChange={(e) => onUpd(i, { name: e.target.value })} className="font-medium" />
              <Input value={it.desc || ''} placeholder={linked ? 'Descrição (opcional; vazio usa a do produto)' : 'Descrição (opcional)'} onChange={(e) => onUpd(i, { desc: e.target.value })} className="text-sm" />
            </div>
            {cento ? (
              <div className="flex shrink-0 gap-1.5">
                <div className="w-[68px] space-y-1"><Label className="text-[11px] text-muted-foreground">50 un</Label><Input inputMode="decimal" value={it.price50 ?? ''} onChange={(e) => onUpd(i, { price50: num(e.target.value) })} /></div>
                <div className="w-[68px] space-y-1"><Label className="text-[11px] text-muted-foreground">Cento</Label><Input inputMode="decimal" value={it.priceCento ?? ''} onChange={(e) => onUpd(i, { priceCento: num(e.target.value) })} /></div>
              </div>
            ) : (
              <div className="w-24 shrink-0 space-y-1">
                <Label className="text-[11px] text-muted-foreground">Preço</Label>
                <Input inputMode="decimal" value={typeof linked?.price === 'number' ? linked.price : it.price} disabled={!!linked} onChange={(e) => onUpd(i, { price: num(e.target.value) })} />
              </div>
            )}
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
              {centoOption && (
                <div className="w-32 shrink-0 space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Cobrança</Label>
                  <select value={cento ? 'cento' : 'unidade'} onChange={(e) => onUpd(i, e.target.value === 'cento' ? { priceCento: it.priceCento ?? 0, price50: it.price50 ?? 0 } : { priceCento: undefined, price50: undefined })}
                    className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
                    <option value="unidade">Por unidade</option>
                    <option value="cento">Por cento</option>
                  </select>
                </div>
              )}
              <label className="ml-auto flex shrink-0 flex-col items-center gap-1 text-[10px] text-muted-foreground">
                {it.enabled === false ? 'Oculto' : 'Ativo'}
                <Switch checked={it.enabled !== false} onCheckedChange={(v) => onUpd(i, { enabled: v })} />
              </label>
          </div>
        </div>
      );})}
      <div className="flex flex-wrap items-center gap-2">
        <AddBtn onClick={onAdd} label="Adicionar item" />
        {onAddFromMenu && <MenuProductPicker products={products || []} linkedIds={items.map((it) => it.productId).filter(Boolean) as string[]} onPick={onAddFromMenu} />}
      </div>
    </div>
  );
}

// Picker "Adicionar do cardápio": lista os produtos da aba Produtos com busca;
// escolher um cria um SKU vinculado (productId) na seção.
function MenuProductPicker({ products, linkedIds, onPick }: { products: LinkedProduct[]; linkedIds: string[]; onPick: (p: LinkedProduct) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return products.filter((p) => !term || (p.name || '').toLowerCase().includes(term));
  }, [products, q]);
  const linked = useMemo(() => new Set(linkedIds), [linkedIds]);

  return (
    <div className="relative mt-1">
      <Button type="button" variant="outline" size="sm" onClick={() => { setOpen((v) => !v); setQ(''); }} disabled={products.length === 0}
        title={products.length === 0 ? 'Nenhum produto cadastrado na aba Produtos' : undefined}>
        <Link2 className="mr-1.5 h-3.5 w-3.5" /> Adicionar do cardápio
      </Button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1 w-72 rounded-lg border bg-popover p-2 shadow-lg">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={q} placeholder="Buscar produto..." onChange={(e) => setQ(e.target.value)} className="h-8 pl-7 text-sm" />
          </div>
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {filtered.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">Nenhum produto encontrado.</p>}
            {filtered.map((p) => (
              <button key={p.id} type="button" onClick={() => { onPick(p); setOpen(false); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40 text-muted-foreground">
                  {p.imageUrl ? (/* eslint-disable-next-line @next/next/no-img-element */ <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />) : <Link2 className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name || 'Sem nome'}{linked.has(p.id) && <span className="ml-1 text-[10px] font-normal text-muted-foreground">(já vinculado)</span>}</span>
                  <span className="block text-xs text-muted-foreground">R$ {(typeof p.price === 'number' ? p.price : 0).toFixed(2).replace('.', ',')}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
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
