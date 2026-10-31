'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { CurrencyInput } from '@/components/ui/currency-input';
import { useToast } from '@/hooks/use-toast';
import { uploadImage } from '@/lib/upload';
import type { EncomendaCatalog, LinkedProduct, ProductKind, SkuOption } from '@/lib/encomendas/catalog';
import { Loader2, Plus, Trash2, Upload, Link2, Unlink, Search, ChevronDown, AlertTriangle } from 'lucide-react';
import { brl } from '@/lib/utils';

const genId = () => Math.random().toString(36).slice(2, 9);
const SELECT_CLS = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm';
const LABEL_CLS = 'text-xs font-semibold text-slate-600';

type SubAba = 'sabores' | 'tamanhos' | 'massas' | 'acabamentos' | 'recheios' | 'coberturas' | 'plaquinha';

// Aba Produtos, controlada: o catálogo e o salvar moram na EncomendasAdminTab.
export function EncomendaCatalogEditor({ cat, onChange, menuProducts }: {
  cat: EncomendaCatalog;
  onChange: (fn: (prev: EncomendaCatalog) => EncomendaCatalog) => void;
  menuProducts: LinkedProduct[];
}) {
  const { toast } = useToast();
  const [kind, setKind] = useState<ProductKind>(cat.products[0]?.kind ?? 'bolo');
  const [subAba, setSubAba] = useState<SubAba>('sabores');
  // Itens com a linha aberta. Mora aqui para sobreviver a trocar de produto.
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const alternar = (id: string) => setAbertos((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Sempre sobre o catálogo mais recente: a foto termina de subir segundos depois,
  // e aplicar sobre o catálogo daquele render apagaria o que foi editado no meio.
  const mut = (fn: (c: any) => void) => onChange((prev) => {
    const c = structuredClone(prev) as any;
    fn(c);
    return c;
  });
  const updItem = (key: keyof EncomendaCatalog, idx: number, patch: any) => mut((c) => { c[key][idx] = { ...c[key][idx], ...patch }; });
  const delItem = (key: keyof EncomendaCatalog, idx: number) => mut((c) => { c[key].splice(idx, 1); });
  const addItem = (key: keyof EncomendaCatalog, item: any) => mut((c) => { c[key].push(item); });
  const setStr = (key: keyof EncomendaCatalog, idx: number, val: string) => mut((c) => { c[key][idx] = val; });
  const onErr = () => toast({ variant: 'destructive', title: 'Falha no envio da foto', description: 'Tente de novo.' });

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

  // Loja no modelo "cardápio por kg" (Gostinho): edita sabores/pesos/massa/adicionais.
  const simple = (cat.cakes?.length || 0) > 0;

  const contagem = (k: ProductKind): string => {
    const n = (x: unknown[]) => x?.length || 0;
    if (k === 'bolo') return simple ? `${n(cat.cakes)} sabores` : `${n(cat.cakeSizes)} tamanhos`;
    const itens = k === 'tortas' ? n(cat.tortas) : k === 'docinhos' ? n(cat.docinhos) : n(cat.especialItems);
    return `${itens} ${itens === 1 ? 'item' : 'itens'}`;
  };

  const idx = Math.max(0, cat.products.findIndex((p) => p.kind === kind));
  const prod = cat.products[idx];

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
      {/* Lista lateral (em tela estreita vira faixa rolável) */}
      <div className="flex gap-2 overflow-x-auto pb-1 lg:sticky lg:top-0 lg:flex-col lg:overflow-visible lg:pb-0">
        {cat.products.map((p) => {
          const on = p.kind === prod?.kind;
          return (
            <button key={p.kind} type="button" onClick={() => setKind(p.kind)}
              className={`flex min-w-[200px] items-center gap-3 rounded-2xl border p-2.5 text-left shadow-sm transition-colors lg:min-w-0 ${on ? 'border-emerald-600 bg-emerald-50' : 'bg-white hover:bg-slate-50'}`}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white text-lg">
                {p.imageUrl ? (/* eslint-disable-next-line @next/next/no-img-element */ <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />) : p.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-slate-800">{p.title}</span>
                <span className="block text-xs text-muted-foreground">{contagem(p.kind)}</span>
              </span>
              {p.enabled === false && <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Oculto</span>}
            </button>
          );
        })}
      </div>

      {prod && (
        <Card className="min-w-0 border shadow-sm rounded-2xl">
          <CardContent className="space-y-4 p-4">
            {/* Topo do produto: foto, nome, descrição e se aparece no pedido */}
            <div className="flex flex-wrap items-center gap-3">
              <MiniPhoto url={prod.imageUrl || ''} onChange={(u) => updItem('products', idx, { imageUrl: u })} onError={onErr} fallback={prod.icon} />
              <Input value={prod.title} onChange={(e) => updItem('products', idx, { title: e.target.value })} className="h-9 w-56 text-sm font-semibold" aria-label="Nome do produto" />
              <Input value={prod.description} onChange={(e) => updItem('products', idx, { description: e.target.value })} className="h-9 min-w-[200px] flex-1 text-sm" aria-label="Descrição do produto" />
              <label className="flex shrink-0 items-center gap-2 text-xs font-semibold text-slate-600">
                Aparece no pedido
                <Switch checked={prod.enabled !== false} onCheckedChange={(v) => updItem('products', idx, { enabled: v })} />
              </label>
            </div>

            <Separator />

            {prod.kind === 'bolo' && (
              <BoloPainel cat={cat} simple={simple} subAba={subAba} setSubAba={setSubAba} mut={mut} updItem={updItem} delItem={delItem} addItem={addItem} setStr={setStr} />
            )}

            {prod.kind === 'especial' && (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1"><Label className={LABEL_CLS}>Título</Label><Input className="h-9 text-sm" value={cat.especialInfo.title} onChange={(e) => mut((c) => { c.especialInfo.title = e.target.value; })} /></div>
                  <div className="space-y-1"><Label className={LABEL_CLS}>Aviso de retirada</Label><Input className="h-9 text-sm" value={cat.especialInfo.windowLabel} onChange={(e) => mut((c) => { c.especialInfo.windowLabel = e.target.value; })} /></div>
                </div>
                <div className="space-y-1"><Label className={LABEL_CLS}>Descrição</Label><Input className="h-9 text-sm" value={cat.especialInfo.desc} onChange={(e) => mut((c) => { c.especialInfo.desc = e.target.value; })} /></div>
                <Separator />
                <p className="text-xs text-muted-foreground">O cliente só finaliza levando ao menos 1 item <b>Principal</b>; itens <b>Adicionais</b> acompanham (ex.: molho extra, calda).</p>
                <SkuEditor items={cat.especialItems} roles minimums products={menuProducts} abertos={abertos} alternar={alternar}
                  onAddFromMenu={(p) => addItem('especialItems', { ...skuFromProduct(p), role: 'principal' })}
                  onUpd={(i, patch) => updItem('especialItems', i, patch)} onDel={(i) => delItem('especialItems', i)}
                  onAdd={() => addItem('especialItems', { id: genId(), name: '', price: 0, role: 'principal' })} onErr={onErr} />
              </div>
            )}

            {prod.kind === 'tortas' && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Na seta de cada item você escolhe a cobrança (por cento ou por unidade) e o grupo, que vira uma seção na página.</p>
                <SkuEditor items={cat.tortas} groups cento products={menuProducts} abertos={abertos} alternar={alternar}
                  onAddFromMenu={(p) => addItem('tortas', { ...skuFromProduct(p), group: cat.tortas[cat.tortas.length - 1]?.group || '' })}
                  onUpd={(i, patch) => updItem('tortas', i, patch)} onDel={(i) => delItem('tortas', i)}
                  onAdd={() => addItem('tortas', { id: genId(), name: '', price: 0, group: cat.tortas[cat.tortas.length - 1]?.group || '' })} onErr={onErr} />
              </div>
            )}

            {prod.kind === 'docinhos' && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Na seta de cada item você escolhe a cobrança (por cento ou por unidade), o mínimo por sabor e o grupo, que vira uma seção na página.</p>
                <SkuEditor items={cat.docinhos} groups minimums cento products={menuProducts} abertos={abertos} alternar={alternar}
                  onAddFromMenu={(p) => addItem('docinhos', { ...skuFromProduct(p), group: cat.docinhos[cat.docinhos.length - 1]?.group || '', minQty: 0, stepQty: 1 })}
                  onUpd={(i, patch) => updItem('docinhos', i, patch)} onDel={(i) => delItem('docinhos', i)}
                  onAdd={() => addItem('docinhos', { id: genId(), name: '', price: 0, group: cat.docinhos[cat.docinhos.length - 1]?.group || '', minQty: 0, stepQty: 1 })} onErr={onErr} />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ---------- Bolo ---------- */
function BoloPainel({ cat, simple, subAba, setSubAba, mut, updItem, delItem, addItem, setStr }: {
  cat: EncomendaCatalog; simple: boolean; subAba: SubAba; setSubAba: (s: SubAba) => void;
  mut: (fn: (c: any) => void) => void;
  updItem: (key: keyof EncomendaCatalog, idx: number, patch: any) => void;
  delItem: (key: keyof EncomendaCatalog, idx: number) => void;
  addItem: (key: keyof EncomendaCatalog, item: any) => void;
  setStr: (key: keyof EncomendaCatalog, idx: number, val: string) => void;
}) {
  const abas: { id: SubAba; label: string; n?: number }[] = simple
    ? [
      { id: 'sabores', label: 'Sabores', n: cat.cakes.length },
      { id: 'tamanhos', label: 'Tamanhos', n: cat.cakeWeights.length },
      { id: 'massas', label: 'Massas', n: cat.cakeDoughs.length },
      { id: 'acabamentos', label: 'Acabamentos', n: cat.cakeExtras.length },
    ]
    : [
      { id: 'tamanhos', label: 'Tamanhos', n: cat.cakeSizes.length },
      { id: 'massas', label: 'Massas', n: cat.cakeDoughs.length },
      { id: 'recheios', label: 'Recheios', n: cat.cakeFillings.length },
      { id: 'coberturas', label: 'Coberturas', n: cat.cakeCovers.length },
      { id: 'plaquinha', label: 'Plaquinha' },
    ];
  // A aba guardada pode não existir neste modelo (ex.: "Sabores" no modelo antigo).
  const ativa = abas.some((a) => a.id === subAba) ? subAba : abas[0].id;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {abas.map((a) => (
          <button key={a.id} type="button" onClick={() => setSubAba(a.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${ativa === a.id ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {a.label}{a.n !== undefined && <span className={`ml-1.5 ${ativa === a.id ? 'text-emerald-100' : 'text-slate-400'}`}>{a.n}</span>}
          </button>
        ))}
      </div>

      {simple && ativa === 'sabores' && (
        <>
          <p className="text-xs text-muted-foreground">Cada sabor tem seu preço por quilo. O cliente escolhe o sabor e depois o peso.</p>
          <Tabela colunas="minmax(0,1fr) 110px" titulos={['Sabor', 'Preço por kg']} dupla>
            {cat.cakes.map((ck, i) => (
              <Linha key={ck.id} colunas="minmax(0,1fr) 110px" onRemove={() => delItem('cakes', i)}>
                <Input className="h-9 text-sm" value={ck.name} onChange={(e) => updItem('cakes', i, { name: e.target.value })} aria-label="Sabor" />
                <CurrencyInput className="h-9 text-sm" value={ck.pricePerKg} onChange={(v) => updItem('cakes', i, { pricePerKg: v })} />
              </Linha>
            ))}
          </Tabela>
          <AddBtn onClick={() => addItem('cakes', { id: genId(), name: '', pricePerKg: 0 })} label="Adicionar sabor" />
        </>
      )}

      {simple && ativa === 'tamanhos' && (
        <>
          <p className="text-xs text-muted-foreground">Preço fixo (ex.: Baby) OU por kg (multiplica o preço do sabor). Embalagem soma ao total (ex.: Baby e 1 kg = 16). Deixe em branco o que não usar.</p>
          <Tabela colunas="84px minmax(0,1fr) 72px 104px 104px 176px" titulos={['Nome', 'Descrição', 'Kg', 'Preço fixo', 'Embalagem', 'Formatos']} minLargura={760}>
            {cat.cakeWeights.map((w, i) => (
              <Linha key={w.id} colunas="84px minmax(0,1fr) 72px 104px 104px 176px" onRemove={() => delItem('cakeWeights', i)}>
                <Input className="h-9 text-sm" value={w.label} onChange={(e) => updItem('cakeWeights', i, { label: e.target.value })} aria-label="Nome" />
                <Input className="h-9 text-sm" value={w.sub || ''} onChange={(e) => updItem('cakeWeights', i, { sub: e.target.value })} aria-label="Descrição" />
                <Input type="number" min={0} step="0.1" className="h-9 text-sm" value={w.kg ?? ''} placeholder="—" aria-label="Kg"
                  onChange={(e) => updItem('cakeWeights', i, { kg: e.target.value === '' ? undefined : Number(e.target.value) })} />
                <PrecoOpcional value={w.fixedPrice} onChange={(v) => updItem('cakeWeights', i, { fixedPrice: v })} label="Preço fixo" />
                <PrecoOpcional value={w.packaging} onChange={(v) => updItem('cakeWeights', i, { packaging: v })} label="Embalagem" />
                <div className="flex items-center gap-3">
                  {['redondo', 'quadrado'].map((sh) => (
                    <label key={sh} className="flex items-center gap-1 text-xs capitalize">
                      <input type="checkbox" checked={(w.shapes || []).includes(sh)} onChange={(e) => { const cur = new Set(w.shapes || []); if (e.target.checked) cur.add(sh); else cur.delete(sh); updItem('cakeWeights', i, { shapes: [...cur] }); }} /> {sh}
                    </label>
                  ))}
                </div>
              </Linha>
            ))}
          </Tabela>
          <AddBtn onClick={() => addItem('cakeWeights', { id: genId(), label: '', kg: 1, shapes: ['redondo'] })} label="Adicionar tamanho" />
        </>
      )}

      {ativa === 'massas' && (
        <>
          {simple && <p className="text-xs text-muted-foreground">Sem custo. Ex.: Branca, Preta.</p>}
          <StrList items={cat.cakeDoughs} onChange={(i, v) => setStr('cakeDoughs', i, v)} onRemove={(i) => delItem('cakeDoughs', i)} onAdd={() => addItem('cakeDoughs', '')} placeholder={simple ? 'Ex.: Branca' : 'Ex.: Massa branca (baunilha)'} />
        </>
      )}

      {simple && ativa === 'acabamentos' && (
        <>
          <p className="text-xs text-muted-foreground">&quot;Por kg&quot; multiplica pelo peso (ex.: R$ 20/kg num bolo de 3 kg = R$ 60). &quot;A cada 2 kg&quot; cobra de novo a cada 2 kg (ganache num bolo de 4 kg = 2×). &quot;Valor fixo&quot; cobra uma vez só.</p>
          <Tabela colunas="minmax(0,1fr) 110px 150px" titulos={['Adicional', 'Preço', 'Cobrança']}>
            {cat.cakeExtras.map((x, i) => (
              <Linha key={x.id} colunas="minmax(0,1fr) 110px 150px" onRemove={() => delItem('cakeExtras', i)}>
                <Input className="h-9 text-sm" value={x.name} onChange={(e) => updItem('cakeExtras', i, { name: e.target.value })} aria-label="Adicional" />
                <CurrencyInput className="h-9 text-sm" value={x.price} onChange={(v) => updItem('cakeExtras', i, { price: v })} />
                <select value={x.per === '2kg' ? '2kg' : x.per === 'kg' ? 'kg' : 'unidade'} onChange={(e) => updItem('cakeExtras', i, { per: e.target.value })} className={SELECT_CLS} aria-label="Cobrança">
                  <option value="unidade">Valor fixo</option>
                  <option value="kg">Por kg</option>
                  <option value="2kg">A cada 2 kg</option>
                </select>
              </Linha>
            ))}
          </Tabela>
          <AddBtn onClick={() => addItem('cakeExtras', { id: genId(), name: '', price: 0, per: 'unidade' })} label="Adicionar acabamento" />
        </>
      )}

      {!simple && ativa === 'tamanhos' && (
        <>
          <Tabela colunas="72px minmax(0,1fr) 110px 130px" titulos={['Sigla', 'Descrição', 'Preço', 'Formato']} minLargura={520}>
            {cat.cakeSizes.map((s, i) => (
              <Linha key={s.id} colunas="72px minmax(0,1fr) 110px 130px" onRemove={() => delItem('cakeSizes', i)}>
                <Input className="h-9 text-sm" value={s.label} onChange={(e) => updItem('cakeSizes', i, { label: e.target.value })} aria-label="Sigla" />
                <Input className="h-9 text-sm" value={s.sub} onChange={(e) => updItem('cakeSizes', i, { sub: e.target.value })} aria-label="Descrição" />
                <CurrencyInput className="h-9 text-sm" value={s.basePrice} onChange={(v) => updItem('cakeSizes', i, { basePrice: v })} />
                <select value={s.shape} onChange={(e) => updItem('cakeSizes', i, { shape: e.target.value })} className={SELECT_CLS} aria-label="Formato">
                  <option value="redondo">Redondo</option>
                  <option value="retangular">Retangular</option>
                </select>
              </Linha>
            ))}
          </Tabela>
          <AddBtn onClick={() => addItem('cakeSizes', { id: genId(), label: '', sub: '', basePrice: 0, shape: 'redondo' })} label="Adicionar tamanho" />
        </>
      )}

      {!simple && ativa === 'recheios' && (
        <>
          <p className="text-xs text-muted-foreground">O nível agrupa os recheios (ex.: Clássico incluso; Premium com acréscimo).</p>
          <Tabela colunas="minmax(0,1fr) 150px 110px" titulos={['Recheio', 'Nível', 'Acréscimo']} minLargura={520}>
            {cat.cakeFillings.map((f, i) => (
              <Linha key={f.id} colunas="minmax(0,1fr) 150px 110px" onRemove={() => delItem('cakeFillings', i)}>
                <Input className="h-9 text-sm" value={f.name} onChange={(e) => updItem('cakeFillings', i, { name: e.target.value })} aria-label="Recheio" />
                <select value={f.tier} onChange={(e) => updItem('cakeFillings', i, { tier: e.target.value })} className={SELECT_CLS} aria-label="Nível">
                  {cat.fillingTiers.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <CurrencyInput className="h-9 text-sm" value={f.price} onChange={(v) => updItem('cakeFillings', i, { price: v })} />
              </Linha>
            ))}
          </Tabela>
          <AddBtn onClick={() => addItem('cakeFillings', { id: genId(), name: '', tier: cat.fillingTiers[0] || 'Clássico', price: 0 })} label="Adicionar recheio" />
          <Separator />
          <Label className={LABEL_CLS}>Níveis de recheio</Label>
          <StrList items={cat.fillingTiers} onChange={(i, v) => setStr('fillingTiers', i, v)} onRemove={(i) => delItem('fillingTiers', i)} onAdd={() => addItem('fillingTiers', '')} placeholder="Ex.: Premium" />
        </>
      )}

      {!simple && ativa === 'coberturas' && (
        <>
          <Tabela colunas="180px minmax(0,1fr) 110px" titulos={['Cobertura', 'Descrição', 'Acréscimo']} minLargura={560}>
            {cat.cakeCovers.map((cv, i) => (
              <Linha key={cv.id} colunas="180px minmax(0,1fr) 110px" onRemove={() => delItem('cakeCovers', i)}>
                <Input className="h-9 text-sm" value={cv.name} onChange={(e) => updItem('cakeCovers', i, { name: e.target.value })} aria-label="Cobertura" />
                <Input className="h-9 text-sm" value={cv.desc} onChange={(e) => updItem('cakeCovers', i, { desc: e.target.value })} aria-label="Descrição" />
                <CurrencyInput className="h-9 text-sm" value={cv.price} onChange={(v) => updItem('cakeCovers', i, { price: v })} />
              </Linha>
            ))}
          </Tabela>
          <AddBtn onClick={() => addItem('cakeCovers', { id: genId(), name: '', desc: '', price: 0 })} label="Adicionar cobertura" />
        </>
      )}

      {!simple && ativa === 'plaquinha' && (
        <div className="flex items-center gap-2">
          <Label className="text-sm text-slate-700">Preço da plaquinha personalizada</Label>
          <CurrencyInput className="h-9 w-32 text-sm" value={cat.platePrice} onChange={(v) => mut((c) => { c.platePrice = v; })} />
        </div>
      )}
    </div>
  );
}

/* ---------- helpers de UI ---------- */

// Tabela com cabeçalho uma vez só. `dupla` = duas colunas de linhas a partir de lg.
function Tabela({ colunas, titulos, children, dupla, minLargura }: {
  colunas: string; titulos: string[]; children: React.ReactNode; dupla?: boolean; minLargura?: number;
}) {
  const cab = (
    <div className="grid items-center gap-2 px-0.5 pb-1" style={{ gridTemplateColumns: `${colunas} 32px` }}>
      {titulos.map((t) => <span key={t} className={LABEL_CLS}>{t}</span>)}
      <span />
    </div>
  );
  return (
    <div className="overflow-x-auto">
      <div style={minLargura ? { minWidth: minLargura } : undefined}>
        {dupla ? (
          <>
            <div className="grid gap-x-6 lg:grid-cols-2">{cab}<div className="hidden lg:block">{cab}</div></div>
            <div className="grid gap-x-6 lg:grid-cols-2">{children}</div>
          </>
        ) : (
          <>
            {cab}
            <div>{children}</div>
          </>
        )}
      </div>
    </div>
  );
}
function Linha({ colunas, onRemove, children }: { colunas: string; onRemove: () => void; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-2 border-b border-slate-100 py-1" style={{ gridTemplateColumns: `${colunas} 32px` }}>
      {children}
      <button type="button" onClick={onRemove} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Remover">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
function AddBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return <Button type="button" variant="outline" size="sm" onClick={onClick} className="h-8"><Plus className="mr-1.5 h-3.5 w-3.5" /> {label}</Button>;
}

// Preço que pode ficar em branco (= não usa). Digitar funciona como o CurrencyInput
// (centavos entram pela direita); zero ou apagar tudo volta a "em branco".
function PrecoOpcional({ value, onChange, label }: { value: number | undefined; onChange: (v: number | undefined) => void; label: string }) {
  const texto = typeof value === 'number' && value > 0 ? (value).toFixed(2).replace('.', ',') : '';
  return (
    <Input inputMode="numeric" className="h-9 text-sm" value={texto} placeholder="—" aria-label={label}
      onChange={(e) => {
        const cents = parseInt(e.target.value.replace(/\D/g, '') || '0', 10);
        onChange(cents > 0 ? cents / 100 : undefined);
      }} />
  );
}

function StrList({ items, onChange, onRemove, onAdd, placeholder }: {
  items: string[]; onChange: (i: number, v: string) => void; onRemove: (i: number) => void; onAdd: () => void; placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((v, i) => (
          <div key={i} className="flex items-center gap-1">
            <Input className="h-9 text-sm" value={v} placeholder={placeholder} onChange={(e) => onChange(i, e.target.value)} />
            <button type="button" onClick={() => onRemove(i)} title="Remover" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
      <AddBtn onClick={onAdd} label="Adicionar" />
    </div>
  );
}

function SkuEditor({ items, onUpd, onDel, onAdd, onErr, groups, minimums, roles, cento: centoOption, products, onAddFromMenu, abertos, alternar }: {
  items: SkuOption[]; onUpd: (i: number, patch: any) => void; onDel: (i: number) => void; onAdd: () => void; onErr: () => void;
  groups?: boolean;   // campo "Grupo" (cria seções na página, ex.: "Tortas Pequenas (P)")
  minimums?: boolean; // campos "Mín." e "De X em X" (ex.: 50 docinhos por sabor)
  roles?: boolean;    // Especial: item Principal (obrigatório) ou Adicional
  cento?: boolean;    // "por cento": mostra preço das 50 e do cento + seletor de cobrança
  products?: LinkedProduct[];                 // produtos da aba Produtos, para vincular
  onAddFromMenu?: (p: LinkedProduct) => void; // adiciona um SKU vinculado ao produto
  abertos: Set<string>;
  alternar: (id: string) => void;
}) {
  const byId = useMemo(() => new Map((products || []).map((p) => [p.id, p])), [products]);
  return (
    <div>
      {/* Lista PLANA na ordem do array: o título de grupo é irmão da linha. Digitar o
          nome do grupo só troca o texto do título, sem remontar a linha (foco intacto). */}
      <div>
        {items.map((it, i) => {
          // Item vinculado ao cardápio: nome/preço/foto vêm do cadastro do produto
          // (só leitura aqui); se o produto sumiu do cardápio, volta a ser editável.
          const linked = it.productId ? byId.get(it.productId) : undefined;
          const orphan = !!it.productId && !linked && (products?.length || 0) > 0;
          const cento = typeof it.priceCento === 'number';
          const aberto = abertos.has(it.id);
          const grupo = it.group || '';
          const mostrarTitulo = !!groups && (i === 0 ? !!grupo : grupo !== (items[i - 1].group || ''));
          return (
            <React.Fragment key={it.id}>
              {mostrarTitulo && (
                <p className="mt-3 border-b pb-1 text-xs font-bold uppercase tracking-wide text-emerald-700 first:mt-0">{grupo || 'Sem grupo'}</p>
              )}
              <div className="border-b border-slate-100 py-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  {linked ? (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40 text-muted-foreground" title="Foto vem do cadastro do produto">
                      {(linked.imageUrl || it.imageUrl)
                        ? (/* eslint-disable-next-line @next/next/no-img-element */ <img src={linked.imageUrl || it.imageUrl} alt="" className="h-full w-full object-cover" />)
                        : <Link2 className="h-4 w-4" />}
                    </div>
                  ) : (
                    <MiniPhoto size="h-9 w-9" url={it.imageUrl || ''} onChange={(u) => onUpd(i, { imageUrl: u })} onError={onErr} />
                  )}
                  <div className="relative min-w-[10rem] flex-1">
                    <Input value={linked?.name ?? it.name} placeholder="Nome do item" disabled={!!linked} onChange={(e) => onUpd(i, { name: e.target.value })} className={`h-9 text-sm font-medium ${linked ? 'pr-8' : ''}`} aria-label="Nome do item" />
                    {linked && <Link2 className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-emerald-600" aria-label="Vinculado ao cardápio" />}
                  </div>
                  {cento ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">50 un</span>
                      <CurrencyInput className="h-9 w-24 text-sm" value={it.price50 ?? 0} onChange={(v) => onUpd(i, { price50: v })} />
                      <span className="text-xs text-muted-foreground">Cento</span>
                      <CurrencyInput className="h-9 w-24 text-sm" value={it.priceCento ?? 0} onChange={(v) => onUpd(i, { priceCento: v })} />
                    </div>
                  ) : (
                    <CurrencyInput className="h-9 w-24 text-sm" value={typeof linked?.price === 'number' ? linked.price : it.price} disabled={!!linked} onChange={(v) => onUpd(i, { price: v })} />
                  )}
                  <Switch checked={it.enabled !== false} onCheckedChange={(v) => onUpd(i, { enabled: v })} title={it.enabled === false ? 'Oculto no pedido' : 'Aparece no pedido'} />
                  <button type="button" onClick={() => alternar(it.id)} title={aberto ? 'Fechar detalhes' : 'Mais detalhes'} aria-expanded={aberto}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100">
                    <ChevronDown className={`h-4 w-4 transition-transform ${aberto ? 'rotate-180' : ''}`} />
                  </button>
                  <button type="button" onClick={() => onDel(i)} title="Remover item" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                </div>

                {orphan && (
                  <p className="mt-1 flex items-center gap-1.5 pl-11 text-xs font-medium text-amber-600">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Produto removido do cardápio — usando os últimos dados salvos.
                    <button type="button" onClick={() => onUpd(i, { productId: '' })} className="ml-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Desvincular do produto do cardápio">
                      <Unlink className="h-3 w-3" /> Desvincular
                    </button>
                  </p>
                )}

                {aberto && (
                  <div className="mt-2 flex flex-wrap items-end gap-3 pl-11">
                    <div className="min-w-[200px] flex-1 space-y-1">
                      <Label className={LABEL_CLS}>Descrição</Label>
                      <Input value={it.desc || ''} placeholder={linked ? 'Opcional; vazio usa a do produto' : 'Opcional'} onChange={(e) => onUpd(i, { desc: e.target.value })} className="h-9 text-sm" />
                    </div>
                    {groups && (
                      <div className="min-w-[160px] flex-1 space-y-1">
                        <Label className={LABEL_CLS}>Grupo (seção na página)</Label>
                        <Input value={it.group || ''} placeholder="Ex.: Tortas Pequenas (P)" onChange={(e) => onUpd(i, { group: e.target.value })} className="h-9 text-sm" />
                      </div>
                    )}
                    {minimums && (
                      <>
                        <div className="w-20 shrink-0 space-y-1">
                          <Label className={LABEL_CLS}>Mín.</Label>
                          <Input type="number" min={0} value={it.minQty || 0} onChange={(e) => onUpd(i, { minQty: Number(e.target.value) || 0 })} className="h-9 text-sm" />
                        </div>
                        <div className="w-24 shrink-0 space-y-1">
                          <Label className={LABEL_CLS}>De X em X</Label>
                          <Input type="number" min={1} value={it.stepQty || 1} onChange={(e) => onUpd(i, { stepQty: Number(e.target.value) || 1 })} className="h-9 text-sm" />
                        </div>
                      </>
                    )}
                    {roles && (
                      <div className="w-32 shrink-0 space-y-1">
                        <Label className={LABEL_CLS}>Tipo</Label>
                        <select value={it.role === 'adicional' ? 'adicional' : 'principal'} onChange={(e) => onUpd(i, { role: e.target.value })} className={SELECT_CLS}>
                          <option value="principal">Principal</option>
                          <option value="adicional">Adicional</option>
                        </select>
                      </div>
                    )}
                    {centoOption && (
                      <div className="w-32 shrink-0 space-y-1">
                        <Label className={LABEL_CLS}>Cobrança</Label>
                        <select value={cento ? 'cento' : 'unidade'} onChange={(e) => onUpd(i, e.target.value === 'cento' ? { priceCento: it.priceCento ?? 0, price50: it.price50 ?? 0 } : { priceCento: undefined, price50: undefined })} className={SELECT_CLS}>
                          <option value="unidade">Por unidade</option>
                          <option value="cento">Por cento</option>
                        </select>
                      </div>
                    )}
                    {linked && (
                      <div className="flex shrink-0 items-center gap-2 pb-1.5 text-xs">
                        <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700"><Link2 className="h-3 w-3" /> Vinculado ao cardápio</span>
                        <button type="button" onClick={() => onUpd(i, { productId: '' })} className="flex items-center gap-1 rounded-md px-2 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Desvincular do produto do cardápio">
                          <Unlink className="h-3 w-3" /> Desvincular
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
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
    <div className="relative">
      <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => { setOpen((v) => !v); setQ(''); }} disabled={products.length === 0}
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
                  <span className="block text-xs text-muted-foreground">{brl((typeof p.price === 'number' ? p.price : 0))}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniPhoto({ url, onChange, onError, fallback, size = 'h-12 w-12' }: { url: string; onChange: (url: string) => void; onError: () => void; fallback?: string; size?: string }) {
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
      <button type="button" onClick={() => ref.current?.click()} className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed bg-muted/40 text-muted-foreground hover:border-primary/50`} title="Trocar foto">
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" />
          : url ? (/* eslint-disable-next-line @next/next/no-img-element */ <img src={url} alt="" className="h-full w-full object-cover" />)
          : fallback ? <span className="text-lg">{fallback}</span>
          : <Upload className="h-4 w-4" />}
      </button>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={onFile} />
    </>
  );
}
