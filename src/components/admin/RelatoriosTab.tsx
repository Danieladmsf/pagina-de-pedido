'use client';

import React, { useMemo, useState } from 'react';
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
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Download,
  Minus,
  PackageX,
  Scale,
  Search,
  ShoppingBag,
  Trophy,
  Wallet,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { brl } from '@/lib/utils';
import { emDinheiro } from '@/lib/dinheiro';
import { baixarCsv } from '@/lib/csv';
import {
  PRESETS_DO_RELATORIO,
  janelaDoRelatorio,
  type PeriodoDoRelatorio,
  type PresetDoRelatorio,
} from '@/lib/relatorios/periodo';
import { vendasNaJanela } from '@/lib/relatorios/venda';
import {
  filtrarRanking,
  ordenarRanking,
  rankingDeProdutos,
  type OrdemDoRanking,
} from '@/lib/relatorios/ranking';
import { balanceteMensal } from '@/lib/relatorios/balancete';
import { csvDoBalancete, csvDoRanking, nomeDoArquivo } from '@/lib/relatorios/export';

interface RelatoriosTabProps {
  orders: any[];
  items: any[];
  categories: any[];
  storeProfile: any;
}

const JANELAS_DO_BALANCETE: { id: string; label: string; meses: number | null }[] = [
  { id: '3', label: '3 meses', meses: 3 },
  { id: '6', label: '6 meses', meses: 6 },
  { id: '12', label: '12 meses', meses: 12 },
  { id: 'tudo', label: 'Tudo', meses: null },
];

const ORDENS: { id: OrdemDoRanking; label: string }[] = [
  { id: 'quantidade', label: 'Mais vendidos' },
  { id: 'valor', label: 'Maior faturamento' },
  { id: 'nome', label: 'Nome (A-Z)' },
];

function hojeNoInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const emKg = (gramas: number) =>
  `${(gramas / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;

const emPorcento = (fracao: number) => `${(fracao * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

const dataCurta = (d: Date | null) => (d ? d.toLocaleDateString('pt-BR') : null);

export function RelatoriosTab({ orders, items, categories, storeProfile }: RelatoriosTabProps) {
  const [periodo, setPeriodo] = useState<PeriodoDoRelatorio>({ preset: 'mes_atual' });
  const [ordem, setOrdem] = useState<OrdemDoRanking>('quantidade');
  const [busca, setBusca] = useState('');
  const [janelaBalancete, setJanelaBalancete] = useState('6');
  const [mostrarSemVenda, setMostrarSemVenda] = useState(false);

  const nomeDaLoja = storeProfile?.general?.name || storeProfile?.storeName || 'Minha Loja';

  const janela = useMemo(() => janelaDoRelatorio(periodo), [periodo]);

  const resumo = useMemo(() => {
    const dentro = vendasNaJanela(orders, janela);
    const faturamento = emDinheiro(dentro.reduce((soma, v) => soma + (Number(v.venda.totalAmount) || 0), 0));
    return {
      faturamento,
      vendas: dentro.length,
      ticketMedio: dentro.length ? emDinheiro(faturamento / dentro.length) : 0,
    };
  }, [orders, janela]);

  const ranking = useMemo(
    () => rankingDeProdutos(orders, { janela, catalogo: items, categorias: categories }),
    [orders, janela, items, categories],
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

  const mesesPedidos = JANELAS_DO_BALANCETE.find((j) => j.id === janelaBalancete)?.meses ?? 6;
  const balancete = useMemo(() => balanceteMensal(orders, { meses: mesesPedidos }), [orders, mesesPedidos]);

  const baixarRanking = () => {
    baixarCsv(
      csvDoRanking(ranking, { loja: nomeDaLoja, periodo: `${janela.rotulo} (${janela.descricao})` }),
      nomeDoArquivo('ranking-produtos', nomeDaLoja),
    );
  };

  const baixarBalancete = () => {
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
          <Badge variant="outline" className="gap-2 px-3 py-1.5 text-xs font-semibold bg-white">
            <CalendarDays className="h-3.5 w-3.5 text-emerald-600" />
            {janela.rotulo}
          </Badge>
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
          </CardContent>
        </Card>

        {/* KPIs do período escolhido */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Kpi label="Faturamento" value={brl(resumo.faturamento)} sub={janela.descricao} Icon={Wallet} cor="emerald" />
          <Kpi
            label="Vendas"
            value={String(resumo.vendas)}
            sub={resumo.vendas === 1 ? 'venda no período' : 'vendas no período'}
            Icon={ShoppingBag}
            cor="violet"
          />
          <Kpi label="Ticket médio" value={brl(resumo.ticketMedio)} sub="por venda" Icon={BarChart3} cor="blue" />
          <Kpi
            label="Produtos diferentes"
            value={String(ranking.produtosDiferentes)}
            sub={`${ranking.semVenda.length} sem nenhuma venda`}
            Icon={Trophy}
            cor="amber"
          />
        </div>

        {/* Balancete mensal */}
        <Card className="border shadow-sm rounded-2xl">
          <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-emerald-600" />
                Balancete mensal
              </CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Quanto entrou em cada mês. Independente do período escolhido acima.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {JANELAS_DO_BALANCETE.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => setJanelaBalancete(j.id)}
                  className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-colors ${
                    janelaBalancete === j.id ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {j.label}
                </button>
              ))}
              <button
                type="button"
                onClick={baixarBalancete}
                disabled={!balancete.meses.length}
                className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors flex items-center gap-1.5 disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
                Planilha
              </button>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {!balancete.meses.length ? (
              <p className="text-sm text-muted-foreground italic text-center py-10">
                Nenhuma venda registrada ainda.
              </p>
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
                          {/* O melhor mês em destaque: é a pergunta que ela faz
                              olhando o gráfico. O mês corrente sai desbotado e
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

        {/* Ranking completo */}
        <Card className="border shadow-sm rounded-2xl">
          <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" />
                O que você vendeu — lista completa
              </CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {ranking.produtosDiferentes} produto{ranking.produtosDiferentes === 1 ? '' : 's'} diferente
                {ranking.produtosDiferentes === 1 ? '' : 's'} em {janela.descricao}
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
                          <tr key={linha.chave} className="hover:bg-slate-50">
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
                                {!linha.noCardapio && (
                                  <span
                                    className="text-[9px] font-bold uppercase tracking-wide bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded shrink-0"
                                    title="Vendeu no período, mas não está mais no cardápio de hoje"
                                  >
                                    fora do cardápio
                                  </span>
                                )}
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

        {/* O que ficou parado */}
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
      </div>
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

function Kpi({
  label,
  value,
  sub,
  Icon,
  cor,
}: {
  label: string;
  value: string;
  sub: string;
  Icon: any;
  cor: 'emerald' | 'blue' | 'violet' | 'amber';
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
          </div>
          <div className={`shrink-0 h-10 w-10 rounded-xl flex items-center justify-center ring-4 ${palette.bg} ${palette.ring}`}>
            <Icon className={`h-5 w-5 ${palette.text}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
