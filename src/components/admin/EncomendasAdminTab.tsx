'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { CalendarDays, CakeSlice, Wallet, Smartphone, Copy, Check, ExternalLink, Loader2 } from 'lucide-react';
import { EncomendaEditor } from '@/components/encomendas/EncomendaEditor';
import { EncomendaCatalogEditor } from '@/components/encomendas/EncomendaCatalogEditor';
import { EncomendaAgendaPanel } from '@/components/encomendas/EncomendaAgendaPanel';
import { EncomendaPagamentoPanel } from '@/components/encomendas/EncomendaPagamentoPanel';
import { revalidateStorePages } from '@/lib/revalidate-store';
import { buildEncomendaConfig } from '@/lib/encomendas/config';
import type { LinkedProduct } from '@/lib/encomendas/catalog';
import { type AbaDeEncomendas, type RascunhoEncomendas, abasComMudanca, aposGravar, igual, montarGravacao, rascunhoDoPerfil } from '@/lib/encomendas/rascunho';

// Aba lateral "Encomendas" = CONFIGURAÇÃO da página pública (a lista de pedidos
// recebidos fica na aba operacional "Encomendas" do topo). Um rascunho só para as
// quatro abas, uma barra de salvar só: trocar de aba não perde o que foi digitado.

const ABAS: { id: AbaDeEncomendas; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'agenda', label: 'Agenda', Icon: CalendarDays },
  { id: 'produtos', label: 'Produtos', Icon: CakeSlice },
  { id: 'pagamento', label: 'Pagamento e entrega', Icon: Wallet },
  { id: 'pagina', label: 'Página do cliente', Icon: Smartphone },
];

export function EncomendasAdminTab({ db, user, storeProfile }: { db: any; user: any; storeProfile: any }) {
  const { toast } = useToast();
  const [aba, setAba] = useState<AbaDeEncomendas>('agenda');
  const [copied, setCopied] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [menuProducts, setMenuProducts] = useState<LinkedProduct[]>([]);

  const salvo = useMemo(() => rascunhoDoPerfil(storeProfile), [storeProfile]);
  const [rascunho, setRascunho] = useState<RascunhoEncomendas>(salvo);
  // Quando o perfil muda ao vivo, o rascunho só acompanha se NÃO houver edição em
  // andamento (rascunho ainda igual à base anterior) — senão perderia o que se digita.
  const base = useRef(salvo);
  useEffect(() => {
    // Em variável própria: o React pode rodar o setRascunho depois, e lendo
    // base.current lá dentro a comparação seria com o perfil já novo.
    const anterior = base.current;
    base.current = salvo;
    setRascunho((cur) => (igual(cur, anterior) ? salvo : cur));
  }, [salvo]);

  const sujo = !igual(rascunho, salvo);
  const sujas = useMemo(() => abasComMudanca(rascunho, salvo), [rascunho, salvo]);
  const nomesSujos = ABAS.filter((a) => sujas[a.id]).map((a) => a.label);

  const mudar = (patch: Partial<RascunhoEncomendas>) => setRascunho((cur) => ({ ...cur, ...patch }));

  // Produtos da aba Produtos (menuItems) — fonte dos itens vinculados (ponte cardápio→encomendas).
  useEffect(() => {
    if (!db || !user?.uid) return;
    getDocs(query(collection(db, 'menuItems'), where('ownerId', '==', user.uid)))
      .then((snap) => {
        const items = snap.docs.map((d) => ({ ...(d.data() as any), id: d.id }));
        items.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
        setMenuProducts(items);
      })
      .catch((err) => console.error('[encomendas-admin] erro ao carregar produtos do cardápio:', err));
  }, [db, user?.uid]);

  // Avisa antes de fechar a página com alteração não salva (mesmo padrão do MesasTab).
  useEffect(() => {
    if (!sujo) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [sujo]);

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const slug = storeProfile?.shortSlug || user?.uid || '';
    return slug ? `${window.location.origin}/${slug}/encomendas` : '';
  }, [storeProfile?.shortSlug, user?.uid]);

  // A prévia passa pelo MESMO buildEncomendaConfig da página real, com o rascunho.
  const liveConfig = useMemo(() => {
    const { content } = rascunho;
    const config = buildEncomendaConfig({
      ...storeProfile,
      encomendas: { ...(storeProfile?.encomendas || {}), ...rascunho },
    });
    return { ...config, content, logoUrl: content.logoUrl || config.logoUrl };
  }, [storeProfile, rascunho]);

  async function salvar() {
    if (!db || !user?.uid || salvando) return;
    const enviado = rascunho;
    setSalvando(true);
    try {
      const gravacao = montarGravacao(enviado, salvo, menuProducts);
      if (Object.keys(gravacao).length > 0) {
        await setDoc(doc(db, 'store_profiles', user.uid), { encomendas: gravacao }, { merge: true });
        revalidateStorePages(user.uid);
      }
      // Se a dona mexeu em algo durante o envio, a edição nova fica (e continua suja).
      setRascunho((cur) => (igual(cur, enviado) ? aposGravar(enviado, gravacao) : cur));
      toast({ title: 'Encomendas atualizadas', description: 'As mudanças já valem no link público.' });
    } catch (err) {
      console.error('[encomendas-admin] erro ao salvar:', err);
      toast({ variant: 'destructive', title: 'Erro ao salvar', description: 'Verifique a internet e tente de novo.' });
    } finally {
      setSalvando(false);
    }
  }

  function copyShare() {
    if (!shareUrl) return;
    navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const frase = nomesSujos.length === 0
    ? 'Você tem alterações não salvas.'
    : `Você tem alterações não salvas em ${nomesSujos.length === 1 ? nomesSujos[0] : `${nomesSujos.slice(0, -1).join(', ')} e ${nomesSujos[nomesSujos.length - 1]}`}.`;

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-slate-800">Encomendas</h1>
          <p className="text-muted-foreground mt-1 font-medium">Agenda, produtos e a página onde o cliente faz o pedido.</p>
        </div>
        <Card className="border shadow-sm rounded-2xl">
          <div className="flex items-center gap-3 px-3 py-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Switch checked={rascunho.enabled} onCheckedChange={(v) => mudar({ enabled: v })} />
              {rascunho.enabled ? 'Recebendo encomendas' : 'Página desligada'}
            </label>
            {shareUrl && (
              <>
                <Separator orientation="vertical" className="h-6" />
                <span className="max-w-[220px] truncate font-mono text-xs text-slate-600" title={shareUrl}>{shareUrl.replace(/^https?:\/\//, '')}</span>
                <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={copyShare} title="Copiar link">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
                <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" title="Abrir página" onClick={() => window.open(shareUrl, '_blank')}>
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </Card>
      </div>

      <Tabs value={aba} onValueChange={(v) => setAba(v as AbaDeEncomendas)}>
        <Card className="border shadow-sm rounded-2xl">
          <TabsList className="flex h-auto w-full justify-start gap-2 overflow-x-auto rounded-2xl bg-transparent p-3 text-slate-700">
            {ABAS.map(({ id, label, Icon }) => (
              <TabsTrigger key={id} value={id}
                className="shrink-0 gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-sm">
                <Icon className="h-3.5 w-3.5" /> {label}
                {sujas[id] && <span className="ml-0.5 h-2 w-2 rounded-full bg-amber-400" title="Mudança não salva" />}
              </TabsTrigger>
            ))}
          </TabsList>
        </Card>

        <TabsContent value="agenda" className="mt-4">
          <EncomendaAgendaPanel r={rascunho} onChange={mudar} storeProfile={storeProfile} />
        </TabsContent>
        {/* forceMount: mantém o produto aberto e as linhas expandidas ao trocar de aba */}
        <TabsContent value="produtos" forceMount className="mt-4 data-[state=inactive]:hidden">
          <EncomendaCatalogEditor
            cat={rascunho.catalog}
            onChange={(fn) => setRascunho((cur) => ({ ...cur, catalog: fn(cur.catalog) }))}
            menuProducts={menuProducts}
          />
        </TabsContent>
        <TabsContent value="pagamento" className="mt-4">
          <EncomendaPagamentoPanel r={rascunho} onChange={mudar} />
        </TabsContent>
        <TabsContent value="pagina" className="mt-4">
          <EncomendaEditor
            content={rascunho.content}
            onChange={(patch) => setRascunho((cur) => ({ ...cur, content: { ...cur.content, ...patch } }))}
            showInApp={rascunho.showInApp}
            onShowInApp={(v) => mudar({ showInApp: v })}
            liveConfig={liveConfig}
            shareUrl={shareUrl}
          />
        </TabsContent>
      </Tabs>

      {/* Barra de salvar: só com mudança. sticky (e não fixed) para respeitar o menu lateral aberto. */}
      {sujo && (
        // O placar de visitas (fixed, canto inferior direito, ~245px) cobriria o botão
        // Salvar em telas médias: aí a barra deixa a faixa dele livre.
        <div className="sticky bottom-0 z-30 min-[1024px]:max-[1559px]:mr-[250px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border bg-white px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
            <span className="min-w-[200px] flex-1 text-sm font-medium text-slate-600">{frase}</span>
            <Button variant="ghost" onClick={() => setRascunho(salvo)} disabled={salvando} className="text-slate-500">
              Descartar
            </Button>
            <Button onClick={salvar} disabled={salvando} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salvar alterações
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
