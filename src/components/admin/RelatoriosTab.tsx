'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  CakeSlice,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Download,
  LineChart,
  Minus,
  PackageX,
  Scale,
  Search,
  ShoppingBag,
  Trophy,
  Wallet,
} from 'lucide-react';
import { useCollection, useMemoFirebase } from '@/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CurvaDoProduto } from '@/components/admin/relatorios/CurvaDoProduto';
import { brl } from '@/lib/utils';
import { emDinheiro } from '@/lib/dinheiro';
import { baixarCsv } from '@/lib/csv';
import { emKg, emPorcento } from '@/lib/relatorios/formato';
import {
  PRESETS_DO_RELATORIO,
  janelaDeComparacao,
  janelaDoRelatorio,
  variacaoEntre,
  type PeriodoDoRelatorio,
  type PresetDoRelatorio,
} from '@/lib/relatorios/periodo';
import {
  filtrarRanking,
  ordenarRanking,
  rankingDeProdutos,
  type LinhaDeProduto,
  type OrdemDoRanking,
} from '@/lib/relatorios/ranking';
import { balanceteMensal } from '@/lib/relatorios/balancete';
import { encomendasComoVendas } from '@/lib/relatorios/encomendas';
import { faturamentoDoPeriodo, porFormaDePagamento, vendasDoPeriodo } from '@/lib/faturamento';
import { escalaDoPeriodo, serieDoPeriodo, vendasPorCanal, vendasUmaAUma } from '@/lib/relatorios/visao';
import { csvDoBalancete, csvDoRanking, nomeDoArquivo } from '@/lib/relatorios/export';

interface RelatoriosTabProps {
  db: any;
  ownerId: string;
  orders: any[];
  items: any[];
  categories: any[];
  storeProfile: any;
  /** Período com que a aba abre (padrão: hoje). */
  periodoInicial?: PeriodoDoRelatorio;
}

/** De onde vem a venda que entra na conta. */
const ORIGENS = [
  { id: 'tudo', label: 'Tudo' },
  { id: 'cardapio', label: 'Só cardápio' },
  { id: 'encomendas', label: 'Só encomendas' },
] as const;

type FiltroOrigem = (typeof ORIGENS)[number]['id'];

const ORDENS: { id: OrdemDoRanking; label: string }[] = [
  { id: 'quantidade', label: 'Mais vendidos' },
  { id: 'valor', label: 'Maior faturamento' },
  { id: 'nome', label: 'Nome (A-Z)' },
];

function hojeNoInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const dataCurta = (d: Date | null) => (d ? d.toLocaleDateString('pt-BR') : null);

export function RelatoriosTab({ db, ownerId, orders, items, categories, storeProfile, periodoInicial }: RelatoriosTabProps) {
  // Abre no dia de hoje: é a primeira pergunta de quem entra no relatório.
  const [periodo, setPeriodo] = useState<PeriodoDoRelatorio>(periodoInicial || { preset: 'hoje' });
  // O relógio anda: "hoje até as 16:20" compara com a semana passada até a
  // MESMA hora. Sem isto a tela aberta às 10h seguiria comparando até as 10h.
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const [ordem, setOrdem] = useState<OrdemDoRanking>('quantidade');
  const [busca, setBusca] = useState('');
  const [mostrarSemVenda, setMostrarSemVenda] = useState(false);
  const [filtroOrigem, setFiltroOrigem] = useState<FiltroOrigem>('tudo');
  const [produtoAberto, setProdutoAberto] = useState<LinhaDeProduto | null>(null);

  const nomeDaLoja = storeProfile?.general?.name || storeProfile?.storeName || 'Minha Loja';

  // A coleção só existe na confeitaria — mesma trava que o Caixa usa para não
  // consultar encomenda numa loja que não tem encomenda.
  const ehConfeitaria = storeProfile?.theme === 'confeitaria';
  const encomendasQuery = useMemoFirebase(
    () =>
      db && ownerId && ehConfeitaria
        ? query(collection(db, 'encomendas'), where('ownerId', '==', ownerId))
        : null,
    [db, ownerId, ehConfeitaria],
  );
  const { data: encomendasRaw } = useCollection(encomendasQuery);

  /**
   * O dinheiro vem do caixa, igual ao Dashboard e à aba Caixa.
   *
   * O faturamento saía da soma dos documentos: o pedido pelo `totalAmount` e a
   * encomenda pelo `total` inteiro, na data em que foi encomendada. Isso conta
   * como recebido o que ainda não foi pago — em 22/08/2026 a Gostinho tinha
   * R$ 413,00 de encomenda entregue ou confirmada sem o pagamento completo, e
   * esse valor entrava no faturamento do mês assim mesmo. O ranking de produtos
   * continua por data da venda, que é o que responde "o que mais saiu".
   */
  const lancamentosQuery = useMemoFirebase(
    () =>
      db && ownerId
        ? query(collection(db, 'cash_transactions'), where('ownerId', '==', ownerId))
        : null,
    [db, ownerId],
  );
  const { data: lancamentosRaw } = useCollection(lancamentosQuery);
  // O catálogo entra para o relatório usar os nomes que a LOJA deu às seções:
  // aqui o slot interno "tortas" é "Brigadeiros" e "docinhos" é "Doces Finos".
  const catalogoDeEncomenda = storeProfile?.encomendas?.catalog;
  const vendasDeEncomenda = useMemo(
    () => encomendasComoVendas(encomendasRaw, { catalogo: catalogoDeEncomenda }),
    [encomendasRaw, catalogoDeEncomenda],
  );
  const temEncomendas = vendasDeEncomenda.length > 0;

  const vendas = useMemo(() => {
    const doCardapio = Array.isArray(orders) ? orders : [];
    if (!temEncomendas || filtroOrigem === 'cardapio') return doCardapio;
    if (filtroOrigem === 'encomendas') return vendasDeEncomenda;
    return [...doCardapio, ...vendasDeEncomenda];
  }, [orders, vendasDeEncomenda, temEncomendas, filtroOrigem]);

  // O relógio só entra na janela de quem está correndo (hoje, 7 dias, mês
  // atual...): o resto não muda de minuto em minuto e não precisa recalcular.
  const chaveDoRelogio = `${agora.getFullYear()}-${agora.getMonth()}-${agora.getDate()}-${agora.getHours()}-${agora.getMinutes()}`;
  const janela = useMemo(() => janelaDoRelatorio(periodo, agora), [periodo, chaveDoRelogio]); // eslint-disable-line react-hooks/exhaustive-deps
  const comparacao = useMemo(() => janelaDeComparacao(periodo, agora), [periodo, chaveDoRelogio]); // eslint-disable-line react-hooks/exhaustive-deps

  /** As vendas de uma janela, com o filtro de origem — a mesma régua para os dois lados. */
  const vendasDaJanela = (de: Date | null, ate: Date | null) =>
    vendasDoPeriodo({
      lancamentos: lancamentosRaw || [],
      pedidos: Array.isArray(orders) ? orders : [],
      encomendas: encomendasRaw || [],
      de,
      ate,
    }).filter((venda) => {
      if (filtroOrigem === 'encomendas') return venda.origem === 'encomenda';
      if (filtroOrigem === 'cardapio') return venda.origem !== 'encomenda';
      return true;
    });

  const resumir = (lista: { valor: number }[]) => {
    const faturamento = emDinheiro(lista.reduce((soma, venda) => soma + venda.valor, 0));
    return {
      faturamento,
      vendas: lista.length,
      ticketMedio: lista.length ? emDinheiro(faturamento / lista.length) : 0,
    };
  };

  const vendasDoRecorte = useMemo(
    () => vendasDaJanela(janela.inicio, janela.fim),
    [lancamentosRaw, orders, encomendasRaw, janela, filtroOrigem], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const vendasDaComparacao = useMemo(
    () => (comparacao ? vendasDaJanela(comparacao.inicio, comparacao.fim) : []),
    [lancamentosRaw, orders, encomendasRaw, comparacao, filtroOrigem], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const resumo = useMemo(() => resumir(vendasDoRecorte), [vendasDoRecorte]); // eslint-disable-line react-hooks/exhaustive-deps
  const resumoAnterior = useMemo(
    () => (comparacao ? resumir(vendasDaComparacao) : null),
    [comparacao, vendasDaComparacao], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** "↑ 12% vs. R$ 380,00" em cada número; com o que se compara vai numa linha só, acima. */
  // Período anterior sem venda nenhuma (loja que começou depois) não é base:
  // "vs. R$ 0,00" não diz nada. Some dos cartões e a linha de cima explica.
  const temBase = !!resumoAnterior && resumoAnterior.vendas > 0;
  const contra = (atual: number, campo: 'faturamento' | 'vendas' | 'ticketMedio', formatar: (n: number) => string) =>
    comparacao && resumoAnterior && temBase
      ? { variacao: variacaoEntre(atual, resumoAnterior[campo]), texto: formatar(resumoAnterior[campo]) }
      : undefined;

  // A tela se organiza pelo tamanho do período: um dia olha hora a hora, até
  // dois meses dia a dia, mais que isso mês a mês (lib/relatorios/visao). Antes
  // "Hoje" mostrava balancete de seis meses e a lista do que não vendeu no mês.
  const escala = escalaDoPeriodo(janela, agora);
  const ehHoje = periodo.preset === 'hoje';
  const nomeDoRecorte = ehHoje ? 'hoje' : periodo.preset === 'ontem' ? 'ontem' : janela.descricao;

  const serie = useMemo(
    () =>
      escala === 'mes'
        ? null
        : serieDoPeriodo({ escala, janela, comparacao, vendas: vendasDoRecorte, anteriores: vendasDaComparacao, agora }),
    [escala, janela, comparacao, vendasDoRecorte, vendasDaComparacao], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const melhorPonto = useMemo(
    () => (serie && serie.length ? serie.reduce((a, b) => (b.atual > a.atual ? b : a)) : null),
    [serie],
  );

  // Como pagaram: pelos lançamentos do caixa (a venda dividida conta em cada
  // forma), com o mesmo dia da venda e o mesmo filtro de origem.
  const formas = useMemo(() => {
    const { entradas } = faturamentoDoPeriodo({
      lancamentos: lancamentosRaw || [],
      pedidos: Array.isArray(orders) ? orders : [],
      de: janela.inicio,
      ate: janela.fim,
    });
    const doFiltro = entradas.filter((e) =>
      filtroOrigem === 'encomendas' ? e.origem === 'encomenda' : filtroOrigem === 'cardapio' ? e.origem !== 'encomenda' : true,
    );
    return porFormaDePagamento(doFiltro);
  }, [lancamentosRaw, orders, janela, filtroOrigem]);
  const canais = useMemo(() => vendasPorCanal(vendasDoRecorte), [vendasDoRecorte]);
  const vendasDoDia = useMemo(() => (escala === 'hora' ? vendasUmaAUma(vendasDoRecorte) : null), [escala, vendasDoRecorte]);

  const ranking = useMemo(
    () => rankingDeProdutos(vendas, { janela, catalogo: items, categorias: categories }),
    [vendas, janela, items, categories],
  );

  const linhas = useMemo(
    () => filtrarRanking(ordenarRanking(ranking.linhas, ordem), busca),
    [ranking.linhas, ordem, busca],
  );

  /** Referência da barra do ranking: a fatia do produto que mais faturou. */
  const maiorFatia = useMemo(
    () => Math.max(0.0001, ...ranking.linhas.map((l) => l.participacao)),
    [ranking.linhas],
  );

  // Mês a mês só em período longo, com os meses DO período e o dinheiro do
  // caixa — a mesma conta dos cartões de cima. Antes ele tinha seletor próprio
  // e somava o valor dos pedidos, outra fonte.
  const balancete = useMemo(() => {
    if (escala !== 'mes') return null;
    const meses =
      periodo.preset === '3m' ? 3
      : periodo.preset === '6m' ? 6
      : periodo.preset === '12m' ? 12
      : periodo.preset === 'tudo' || !janela.inicio ? null
      : (agora.getFullYear() - janela.inicio.getFullYear()) * 12 + agora.getMonth() - janela.inicio.getMonth() + 1;
    const doCaixa = vendasDoRecorte
      .filter((v) => v.quando != null)
      .map((v) => ({ id: v.vinculo || undefined, totalAmount: v.valor, orderDateTime: new Date(v.quando!).toISOString(), status: 'delivered' }));
    return balanceteMensal(doCaixa, { meses, agora });
  }, [escala, periodo.preset, janela, vendasDoRecorte]); // eslint-disable-line react-hooks/exhaustive-deps

  const baixarRanking = () => {
    baixarCsv(
      csvDoRanking(ranking, { loja: nomeDaLoja, periodo: `${janela.rotulo} (${janela.descricao})` }),
      nomeDoArquivo('ranking-produtos', nomeDaLoja),
    );
  };

  const baixarBalancete = () => {
    if (!balancete) return;
    baixarCsv(
      csvDoBalancete(balancete, { loja: nomeDaLoja, periodo: `${balancete.meses.length} meses` }),
      nomeDoArquivo('balancete-mensal', nomeDaLoja),
    );
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      <div className="max-w-[1600px] w-full mx-auto px-4 pb-8 mt-4 space-y-6">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-800">Relatórios</h1>
            <p className="text-muted-foreground mt-1 font-medium">
              O que mais sai, o que ficou parado e quanto entrou mês a mês.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {temEncomendas && filtroOrigem !== 'cardapio' && (
              <Badge variant="outline" className="gap-2 px-3 py-1.5 text-xs font-semibold bg-white">
                <CakeSlice className="h-3.5 w-3.5 text-pink-500" />
                {filtroOrigem === 'encomendas' ? 'Só encomendas' : 'Encomendas incluídas'}
              </Badge>
            )}
            <Badge variant="outline" className="gap-2 px-3 py-1.5 text-xs font-semibold bg-white">
              <CalendarDays className="h-3.5 w-3.5 text-emerald-600" />
              {janela.rotulo}
            </Badge>
          </div>
        </div>

        {/* Período do ranking */}
        <Card className="border shadow-sm rounded-2xl">
          <CardContent className="p-3 flex flex-wrap items-center gap-2">
            {PRESETS_DO_RELATORIO.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  setPeriodo((atual) =>
                    p.id === 'custom'
                      ? { preset: 'custom', de: atual.de || hojeNoInput(), ate: atual.ate || hojeNoInput() }
                      : { preset: p.id as PresetDoRelatorio },
                  )
                }
                className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
                  periodo.preset === p.id
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
            {periodo.preset === 'custom' && (
              <div className="flex items-center gap-2 ml-1">
                <input
                  type="date"
                  value={periodo.de || ''}
                  max={periodo.ate || undefined}
                  onChange={(e) => setPeriodo((atual) => ({ ...atual, preset: 'custom', de: e.target.value }))}
                  className="h-8 px-2 text-xs rounded-md border border-input bg-background"
                  aria-label="Data inicial"
                />
                <span className="text-xs text-muted-foreground">até</span>
                <input
                  type="date"
                  value={periodo.ate || ''}
                  min={periodo.de || undefined}
                  max={hojeNoInput()}
                  onChange={(e) => setPeriodo((atual) => ({ ...atual, preset: 'custom', ate: e.target.value }))}
                  className="h-8 px-2 text-xs rounded-md border border-input bg-background"
                  aria-label="Data final"
                />
              </div>
            )}

            {temEncomendas && (
              <div className="flex items-center gap-2 ml-auto pl-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Contar
                </span>
                {ORIGENS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setFiltroOrigem(o.id)}
                    className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-colors ${
                      filtroOrigem === o.id
                        ? 'bg-slate-800 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* KPIs do período escolhido */}
        {comparacao && (
          <p className="-mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Scale className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span>
              {/* O rótulo já diz até quando ("até as 16:20", "até o dia 16"):
                  período que ainda está correndo compara até o mesmo ponto. */}
              {temBase ? 'Comparando com ' : 'Não há vendas em '}
              <strong className="font-semibold text-slate-700">{comparacao.rotulo}</strong>
              {temBase ? '.' : ' para comparar.'}
            </span>
          </p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Kpi
            label="Faturamento"
            value={brl(resumo.faturamento)}
            sub={janela.descricao}
            Icon={Wallet}
            cor="emerald"
            comparacao={contra(resumo.faturamento, 'faturamento', brl)}
          />
          <Kpi
            label="Vendas"
            value={String(resumo.vendas)}
            sub={resumo.vendas === 1 ? 'venda no período' : 'vendas no período'}
            Icon={ShoppingBag}
            cor="violet"
            comparacao={contra(resumo.vendas, 'vendas', (n) => `${n} venda${n === 1 ? '' : 's'}`)}
          />
          <Kpi
            label="Ticket médio"
            value={brl(resumo.ticketMedio)}
            sub="por venda"
            Icon={BarChart3}
            cor="blue"
            comparacao={contra(resumo.ticketMedio, 'ticketMedio', brl)}
          />
          {escala === 'hora' ? (
            // Num dia, "X produtos sem nenhuma venda" é número de mês inteiro.
            <Kpi
              label="Itens vendidos"
              value={String(ranking.totalQuantidade)}
              sub={`${ranking.produtosDiferentes} produto${ranking.produtosDiferentes === 1 ? '' : 's'} diferente${ranking.produtosDiferentes === 1 ? '' : 's'}`}
              Icon={Trophy}
              cor="amber"
            />
          ) : (
            <Kpi
              label="Produtos diferentes"
              value={String(ranking.produtosDiferentes)}
              sub={`${ranking.semVenda.length} sem nenhuma venda`}
              Icon={Trophy}
              cor="amber"
            />
          )}
        </div>

        {/* Evolução — a escala segue o período: hora, dia ou mês */}
        {serie && (
          <Card className="border shadow-sm rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-emerald-600" />
                {escala === 'hora' ? 'Hora a hora' : 'Dia a dia'}
              </CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {escala === 'hora' ? 'Quanto entrou em cada hora' : 'Quanto entrou em cada dia'}
                {comparacao ? `, ao lado de ${comparacao.rotulo}` : ''}
                {melhorPonto && melhorPonto.atual > 0
                  ? ` · ${escala === 'hora' ? 'horário' : 'dia'} que mais vendeu: ${escala === 'hora' ? melhorPonto.rotulo : melhorPonto.rotuloLongo} (${brl(melhorPonto.atual)})`
                  : ''}
              </p>
            </CardHeader>
            <CardContent className="pt-2">
              {!serie.length || serie.every((p) => p.atual === 0 && p.anterior === 0) ? (
                <p className="text-sm text-muted-foreground italic text-center py-10">
                  {ehHoje ? 'Nenhuma venda hoje ainda.' : `Nenhuma venda em ${nomeDoRecorte}.`}
                </p>
              ) : (
                <>
                  <div className="h-[240px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={serie} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis
                          dataKey="rotulo"
                          stroke="#64748b"
                          fontSize={11}
                          tickLine={false}
                          axisLine={false}
                          interval="preserveStartEnd"
                          minTickGap={8}
                        />
                        <YAxis
                          stroke="#64748b"
                          fontSize={11}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) => `R$${v >= 1000 ? `${Math.round(v / 100) / 10}k` : Math.round(v)}`}
                        />
                        <Tooltip
                          cursor={{ fill: '#f1f5f9' }}
                          contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                          labelStyle={{ fontWeight: 700, color: '#0f172a' }}
                          labelFormatter={(_r: any, carga: any) => carga?.[0]?.payload?.rotuloLongo || ''}
                          formatter={(valor: any, nome: any, item: any) => [
                            nome === 'atual'
                              ? `${brl(valor)} · ${item?.payload?.vendas ?? 0} venda${item?.payload?.vendas === 1 ? '' : 's'}`
                              : brl(valor),
                            nome === 'atual' ? 'Agora' : comparacao?.rotulo || 'Anterior',
                          ]}
                        />
                        {comparacao && <Bar dataKey="anterior" fill="#cbd5e1" radius={[6, 6, 0, 0]} />}
                        <Bar dataKey="atual" fill="#059669" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  {comparacao && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" />
                        {ehHoje ? 'Hoje' : janela.rotulo}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-sm bg-slate-300" />
                        {comparacao.rotulo}
                      </span>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {balancete && (
          <Card className="border shadow-sm rounded-2xl">
            <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-emerald-600" />
                  Mês a mês
                </CardTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">Quanto entrou em cada mês do período.</p>
              </div>
              <button
                type="button"
                onClick={baixarBalancete}
                disabled={!balancete.meses.length}
                className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors flex items-center gap-1.5 disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
                Planilha
              </button>
            </CardHeader>
            <CardContent className="pt-2">
              {!balancete.meses.length ? (
                <p className="text-sm text-muted-foreground italic text-center py-10">Nenhuma venda no período.</p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                  <div className="lg:col-span-3">
                    <div className="h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={balancete.meses} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                          <XAxis dataKey="rotulo" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                          <YAxis
                            stroke="#64748b"
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v) => `R$${v >= 1000 ? `${Math.round(v / 100) / 10}k` : Math.round(v)}`}
                          />
                          <Tooltip
                            cursor={{ fill: '#f1f5f9' }}
                            contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                            labelStyle={{ fontWeight: 700, color: '#0f172a' }}
                            formatter={(valor: any, _nome: any, item: any) => [
                              `${brl(valor)} · ${item?.payload?.vendas ?? 0} venda${item?.payload?.vendas === 1 ? '' : 's'}`,
                              'Faturamento',
                            ]}
                            labelFormatter={(_rotulo: any, carga: any) => {
                              const mes = carga?.[0]?.payload;
                              if (!mes) return '';
                              return mes.emAndamento ? `${mes.rotuloLongo} (em andamento)` : mes.rotuloLongo;
                            }}
                          />
                          <Bar dataKey="faturamento" radius={[8, 8, 0, 0]}>
                            {/* O melhor mês em destaque; o mês corrente desbotado e
                                contornado, para a barra baixa não ser lida como
                                queda quando o mês só está pela metade. */}
                            {balancete.meses.map((mes) => (
                              <Cell
                                key={mes.chave}
                                fill={mes.emAndamento ? '#d1fae5' : mes.chave === balancete.melhor?.chave ? '#059669' : '#a7f3d0'}
                                stroke={mes.emAndamento ? '#10b981' : undefined}
                                strokeDasharray={mes.emAndamento ? '4 3' : undefined}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-3 text-xs text-muted-foreground">
                      <span>
                        Total: <strong className="text-slate-800">{brl(balancete.total)}</strong>
                      </span>
                      <span>
                        Média por mês: <strong className="text-slate-800">{brl(balancete.mediaMensal)}</strong>
                      </span>
                      {balancete.melhor && (
                        <span>
                          Melhor mês:{' '}
                          <strong className="text-emerald-700">
                            {balancete.melhor.rotuloLongo} ({brl(balancete.melhor.faturamento)})
                          </strong>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="lg:col-span-2 min-w-0">
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar rounded-xl border">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="text-left font-semibold px-3 py-2">Mês</th>
                            <th className="text-right font-semibold px-3 py-2">Faturamento</th>
                            <th className="text-right font-semibold px-3 py-2">Vendas</th>
                            <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">vs. anterior</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {[...balancete.meses].reverse().map((mes) => (
                            <tr key={mes.chave} className="hover:bg-slate-50">
                              <td className="px-3 py-2 font-semibold text-slate-700 capitalize whitespace-nowrap">
                                {mes.rotulo}
                                {mes.emAndamento && (
                                  <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded normal-case">
                                    em andamento
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-bold text-slate-800 whitespace-nowrap">
                                {brl(mes.faturamento)}
                              </td>
                              <td className="px-3 py-2 text-right text-muted-foreground">{mes.vendas}</td>
                              <td className="px-3 py-2 text-right whitespace-nowrap">
                                <Variacao valor={mes.variacao} parcial={mes.emAndamento} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Como pagaram e por onde a venda entrou */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Fatias
            titulo="Como pagaram"
            Icon={Wallet}
            vazio={`Nenhum pagamento em ${nomeDoRecorte}.`}
            linhas={formas.map((f) => ({ chave: f.forma, rotulo: f.forma, valor: f.total, vendas: f.vendas }))}
            unidade="lançamento"
          />
          <Fatias
            titulo="Por onde vendeu"
            Icon={ShoppingBag}
            vazio={`Nenhuma venda em ${nomeDoRecorte}.`}
            linhas={canais.map((c) => ({ chave: c.canal, rotulo: c.rotulo, valor: c.valor, vendas: c.vendas }))}
            unidade="venda"
          />
        </div>

        {/* As vendas do dia, uma a uma */}
        {vendasDoDia && (
          <Card className="border shadow-sm rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-violet-600" />
                {ehHoje ? 'Vendas de hoje' : `Vendas de ${nomeDoRecorte}`}
              </CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {vendasDoDia.length} venda{vendasDoDia.length === 1 ? '' : 's'}, da mais recente para a mais antiga.
              </p>
            </CardHeader>
            <CardContent className="pt-2">
              {!vendasDoDia.length ? (
                <p className="text-sm text-muted-foreground italic text-center py-8">
                  {ehHoje ? 'Nenhuma venda hoje ainda.' : `Nenhuma venda em ${nomeDoRecorte}.`}
                </p>
              ) : (
                <div className="max-h-[420px] overflow-y-auto custom-scrollbar rounded-xl border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-muted-foreground z-10">
                      <tr>
                        <th className="text-left font-semibold px-3 py-2 w-16">Hora</th>
                        <th className="text-left font-semibold px-3 py-2">Cliente</th>
                        <th className="text-left font-semibold px-3 py-2 hidden md:table-cell">Canal</th>
                        <th className="text-left font-semibold px-3 py-2 hidden sm:table-cell">Pagamento</th>
                        <th className="text-right font-semibold px-3 py-2 hidden lg:table-cell">Itens</th>
                        <th className="text-right font-semibold px-3 py-2">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {vendasDoDia.map((v) => (
                        <tr key={v.chave} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-semibold text-slate-600 tabular-nums">{v.hora}</td>
                          <td className="px-3 py-2 min-w-0">
                            <div className="font-semibold text-slate-800 truncate">{v.cliente}</div>
                            <div className="text-[11px] text-muted-foreground md:hidden">
                              {v.canal} · {v.formas}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground hidden md:table-cell whitespace-nowrap">{v.canal}</td>
                          <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{v.formas}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground hidden lg:table-cell">{v.itens || '—'}</td>
                          <td className="px-3 py-2 text-right font-bold text-slate-800 whitespace-nowrap">{brl(v.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="sticky bottom-0 bg-slate-50 border-t-2">
                      <tr className="text-sm">
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2 font-black text-slate-800">Total</td>
                        <td className="hidden md:table-cell" />
                        <td className="hidden sm:table-cell" />
                        <td className="hidden lg:table-cell" />
                        <td className="px-3 py-2 text-right font-black text-slate-800">{brl(resumo.faturamento)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Ranking completo */}
        <Card className="border shadow-sm rounded-2xl">
          <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" />
                {escala === 'hora' ? `O que saiu ${ehHoje ? 'hoje' : `em ${nomeDoRecorte}`}` : 'O que você vendeu — lista completa'}
              </CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {ranking.produtosDiferentes} produto{ranking.produtosDiferentes === 1 ? '' : 's'} diferente
                {ranking.produtosDiferentes === 1 ? '' : 's'} em {janela.descricao} · clique num produto para ver
                quando ele mais saiu
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar produto ou categoria"
                  className="h-8 pl-8 pr-2 text-xs rounded-lg border border-input bg-background w-56"
                />
              </div>
              {ORDENS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setOrdem(o.id)}
                  className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-colors ${
                    ordem === o.id ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {o.label}
                </button>
              ))}
              <button
                type="button"
                onClick={baixarRanking}
                disabled={!ranking.linhas.length}
                className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors flex items-center gap-1.5 disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
                Planilha
              </button>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {!ranking.linhas.length ? (
              <p className="text-sm text-muted-foreground italic text-center py-10">
                Nenhuma venda em {janela.descricao}.
              </p>
            ) : !linhas.length ? (
              <p className="text-sm text-muted-foreground italic text-center py-10">
                Nada encontrado para “{busca}”.
              </p>
            ) : (
              <>
                <div className="max-h-[560px] overflow-y-auto custom-scrollbar rounded-xl border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-muted-foreground z-10">
                      <tr>
                        <th className="text-left font-semibold px-3 py-2 w-12">#</th>
                        <th className="text-left font-semibold px-3 py-2">Produto</th>
                        <th className="text-left font-semibold px-3 py-2 hidden md:table-cell">Categoria</th>
                        <th className="text-right font-semibold px-3 py-2">Saiu</th>
                        <th className="text-right font-semibold px-3 py-2">Faturou</th>
                        <th className="text-left font-semibold px-3 py-2 w-40 hidden lg:table-cell whitespace-nowrap">
                          % do total
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {linhas.map((linha, indice) => {
                        const posicao = ordem === 'nome' ? null : indice + 1;
                        return (
                          <tr
                            key={linha.chave}
                            onClick={() => setProdutoAberto(linha)}
                            className="hover:bg-emerald-50/60 cursor-pointer group"
                            title={`Ver quando ${linha.nome} mais saiu`}
                          >
                            <td className="px-3 py-2">
                              <span
                                className={`h-7 w-7 rounded-lg flex items-center justify-center font-black text-xs ${
                                  posicao === 1
                                    ? 'bg-amber-100 text-amber-700'
                                    : posicao === 2
                                    ? 'bg-slate-200 text-slate-600'
                                    : posicao === 3
                                    ? 'bg-orange-100 text-orange-700'
                                    : 'bg-slate-50 text-slate-400'
                                }`}
                              >
                                {posicao ?? '·'}
                              </span>
                            </td>
                            <td className="px-3 py-2 min-w-0">
                              <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                                <span className="truncate">{linha.nome}</span>
                                {linha.porPeso && <Scale className="h-3 w-3 text-slate-400 shrink-0" />}
                                {linha.ehCombo && (
                                  <span className="text-[9px] font-bold uppercase tracking-wide bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded shrink-0">
                                    combo
                                  </span>
                                )}
                                {linha.origem === 'encomenda' && (
                                  <span className="text-[9px] font-bold uppercase tracking-wide bg-pink-100 text-pink-700 px-1.5 py-0.5 rounded shrink-0">
                                    encomenda
                                  </span>
                                )}
                                {linha.foraDoCardapio && (
                                  <span
                                    className="text-[9px] font-bold uppercase tracking-wide bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded shrink-0"
                                    title="Vendeu no período, mas não está mais no cardápio de hoje"
                                  >
                                    fora do cardápio
                                  </span>
                                )}
                                <LineChart className="h-3.5 w-3.5 text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                              </div>
                              <div className="text-[11px] text-muted-foreground md:hidden">{linha.categoria}</div>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">{linha.categoria}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              <div className="font-bold text-emerald-600">
                                {linha.porPeso ? emKg(linha.gramas) : linha.quantidade}
                              </div>
                              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                {linha.porPeso
                                  ? `${linha.quantidade} pesagem${linha.quantidade === 1 ? '' : 's'}`
                                  : `em ${linha.vendas} venda${linha.vendas === 1 ? '' : 's'}`}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-slate-800 whitespace-nowrap">
                              {brl(linha.valor)}
                            </td>
                            <td className="px-3 py-2 hidden lg:table-cell">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 flex-1 bg-slate-100 rounded-full overflow-hidden">
                                  {/* A barra é proporcional ao MAIOR produto, não aos
                                      100% do faturamento: num cardápio de 55 itens
                                      ninguém passa de 8%, e barra de 8% não se enxerga.
                                      O número ao lado continua sendo a fatia real. */}
                                  <div
                                    className="h-full bg-emerald-400 rounded-full"
                                    style={{ width: `${Math.max(3, (linha.participacao / maiorFatia) * 100)}%` }}
                                  />
                                </div>
                                <span className="text-[11px] text-muted-foreground w-10 text-right shrink-0">
                                  {emPorcento(linha.participacao)}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="sticky bottom-0 bg-slate-50 border-t-2">
                      <tr className="text-sm">
                        <td />
                        <td className="px-3 py-2 font-black text-slate-800">
                          Total{busca ? ' do período — a busca não muda o total' : ''}
                        </td>
                        <td className="hidden md:table-cell" />
                        <td className="px-3 py-2 text-right font-black text-emerald-700">{ranking.totalQuantidade}</td>
                        <td className="px-3 py-2 text-right font-black text-slate-800">{brl(ranking.totalValor)}</td>
                        <td className="hidden lg:table-cell" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  O valor de cada produto é preço × quantidade. Adicionais, taxa de entrega, desconto e acréscimo não
                  pertencem a um produto, então ficam fora desta coluna — por isso o total aqui ({brl(ranking.totalValor)})
                  pode diferir do faturamento do período ({brl(resumo.faturamento)}).
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* O que ficou parado — pergunta de semana/mês, não de um dia */}
        {escala !== 'hora' && (
        <Card className="border shadow-sm rounded-2xl">
          <button
            type="button"
            onClick={() => setMostrarSemVenda((v) => !v)}
            className="w-full text-left"
            aria-expanded={mostrarSemVenda}
          >
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <PackageX className="h-4 w-4 text-rose-500" />
                  Não vendeu nada em {janela.descricao}
                </CardTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {ranking.semVenda.length} produto{ranking.semVenda.length === 1 ? '' : 's'} do cardápio sem nenhuma
                  saída no período.
                </p>
              </div>
              {mostrarSemVenda ? (
                <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
              )}
            </CardHeader>
          </button>
          {mostrarSemVenda && (
            <CardContent className="pt-0">
              {!ranking.semVenda.length ? (
                <p className="text-sm text-emerald-700 font-medium text-center py-6">
                  Todo produto do cardápio vendeu pelo menos uma vez no período.
                </p>
              ) : (
                <div className="max-h-[400px] overflow-y-auto custom-scrollbar rounded-xl border divide-y">
                  {ranking.semVenda.map((produto) => (
                    <div key={produto.produtoId} className="flex items-center gap-3 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-700 truncate">{produto.nome}</div>
                        <div className="text-[11px] text-muted-foreground">{produto.categoria}</div>
                      </div>
                      <div className="text-right shrink-0">
                        {produto.ultimaVenda ? (
                          <>
                            <div className="text-xs font-semibold text-slate-600">
                              {dataCurta(produto.ultimaVenda)}
                            </div>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              última venda
                            </div>
                          </>
                        ) : (
                          <span className="text-[10px] font-bold uppercase tracking-wide bg-rose-50 text-rose-600 px-2 py-1 rounded">
                            nunca vendeu
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          )}
        </Card>
        )}
      </div>

      <CurvaDoProduto
        linha={produtoAberto}
        vendas={vendas}
        periodoDoRanking={periodo}
        loja={nomeDaLoja}
        onFechar={() => setProdutoAberto(null)}
      />
    </div>
  );
}


function Variacao({ valor, parcial = false }: { valor: number | null; parcial?: boolean }) {
  if (valor === null) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
        <Minus className="h-3 w-3" />
      </span>
    );
  }
  const subiu = valor >= 0;
  // No mês que ainda está correndo a comparação é de dias contra mês inteiro:
  // o número aparece, mas em cinza, para não ser lido como resultado fechado.
  const cor = parcial ? 'text-slate-400' : subiu ? 'text-emerald-600' : 'text-rose-600';
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-bold ${cor}`}
      title={parcial ? 'O mês ainda não terminou — a comparação com o mês anterior é parcial.' : undefined}
    >
      {subiu ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {emPorcento(Math.abs(valor))}
      {parcial && <span className="font-medium">parcial</span>}
    </span>
  );
}

/** Barras horizontais com valor, quantidade e fatia — formas de pagamento e canais. */
function Fatias({
  titulo,
  Icon,
  linhas,
  vazio,
  unidade,
}: {
  titulo: string;
  Icon: any;
  linhas: { chave: string; rotulo: string; valor: number; vendas: number }[];
  vazio: string;
  unidade: string;
}) {
  const total = linhas.reduce((s, l) => s + l.valor, 0);
  const maior = Math.max(0.0001, ...linhas.map((l) => l.valor));
  return (
    <Card className="border shadow-sm rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
          <Icon className="h-4 w-4 text-emerald-600" />
          {titulo}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-1">
        {!linhas.length ? (
          <p className="text-sm text-muted-foreground italic text-center py-6">{vazio}</p>
        ) : (
          <ul className="space-y-2.5">
            {linhas.map((l) => (
              <li key={l.chave}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-semibold text-slate-700 truncate">{l.rotulo}</span>
                  <span className="shrink-0 whitespace-nowrap">
                    <strong className="text-slate-800">{brl(l.valor)}</strong>
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      {l.vendas} {unidade}
                      {l.vendas === 1 ? '' : 's'} · {emPorcento(total > 0 ? l.valor / total : 0)}
                    </span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${Math.max(3, (l.valor / maior) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({
  label,
  value,
  sub,
  Icon,
  cor,
  comparacao,
}: {
  label: string;
  value: string;
  sub: string;
  Icon: any;
  cor: 'emerald' | 'blue' | 'violet' | 'amber';
  /** Contra o período equivalente (lib/relatorios/periodo `janelaDeComparacao`). */
  comparacao?: { variacao: number | null; texto: string };
}) {
  const palette = {
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-100' },
    blue: { bg: 'bg-blue-50', text: 'text-blue-600', ring: 'ring-blue-100' },
    violet: { bg: 'bg-violet-50', text: 'text-violet-600', ring: 'ring-violet-100' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-600', ring: 'ring-amber-100' },
  }[cor];

  return (
    <Card className="border shadow-sm rounded-2xl">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-2xl font-black text-slate-800 mt-1 truncate">{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</p>
            {comparacao && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
                <Variacao valor={comparacao.variacao} />
                <span className="truncate">vs. {comparacao.texto}</span>
              </p>
            )}
          </div>
          <div className={`shrink-0 h-10 w-10 rounded-xl flex items-center justify-center ring-4 ${palette.bg} ${palette.ring}`}>
            <Icon className={`h-5 w-5 ${palette.text}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
