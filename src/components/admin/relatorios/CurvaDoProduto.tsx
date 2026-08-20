'use client';

import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Download, LineChart } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { brl } from '@/lib/utils';
import { baixarCsv } from '@/lib/csv';
import { emKg } from '@/lib/relatorios/formato';
import {
  PRESETS_DO_RELATORIO,
  janelaDoRelatorio,
  type PeriodoDoRelatorio,
  type PresetDoRelatorio,
} from '@/lib/relatorios/periodo';
import type { LinhaDeProduto } from '@/lib/relatorios/ranking';
import {
  GRANULARIDADES,
  granularidadeSugerida,
  serieDoProduto,
  type Granularidade,
} from '@/lib/relatorios/serie-produto';
import { csvDaSerie, nomeDoArquivo } from '@/lib/relatorios/export';

/** Presets curtos do modal: a curva de um produto quase sempre é lida em meses. */
const PRESETS_DA_CURVA: PresetDoRelatorio[] = ['30d', 'mes_atual', '3m', '6m', '12m', 'tudo'];

/**
 * A casca do modal. Só cuida de abrir e fechar.
 *
 * O conteúdo é montado com `key` no produto, então trocar de produto REMONTA e
 * o período volta ao do ranking sozinho — sem estado derivado de prop para
 * sincronizar na mão.
 */
export function CurvaDoProduto({
  linha,
  vendas,
  periodoDoRanking,
  loja,
  onFechar,
}: {
  linha: LinhaDeProduto | null;
  vendas: any[];
  periodoDoRanking: PeriodoDoRelatorio;
  loja: string;
  onFechar: () => void;
}) {
  return (
    <Dialog open={!!linha} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-w-3xl">
        {linha && (
          <>
            {/* Título e subtítulo ficam na casca: `DialogTitle` do Radix exige o
                contexto do Dialog e não monta fora dele. */}
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-left pr-6">
                <LineChart className="h-4 w-4 text-emerald-600 shrink-0" />
                <span className="truncate">{linha.nome}</span>
                {linha.origem === 'encomenda' && (
                  <span className="text-[9px] font-bold uppercase tracking-wide bg-pink-100 text-pink-700 px-1.5 py-0.5 rounded shrink-0">
                    encomenda
                  </span>
                )}
              </DialogTitle>
              <p className="text-xs text-muted-foreground text-left">
                {linha.categoria} · quando este produto mais saiu
              </p>
            </DialogHeader>
            <CurvaDoProdutoConteudo
              key={linha.chave}
              linha={linha}
              vendas={vendas}
              periodoInicial={periodoDoRanking}
              loja={loja}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * O miolo do modal, separado da casca de propósito: o portal do Radix não
 * renderiza em SSR, então só assim dá para montar a curva num teste e na
 * prévia visual.
 */
export function CurvaDoProdutoConteudo({
  linha,
  vendas,
  periodoInicial,
  loja,
}: {
  linha: LinhaDeProduto;
  vendas: any[];
  periodoInicial: PeriodoDoRelatorio;
  loja: string;
}) {
  // Abre no mesmo período que ela está olhando no ranking, e daí ela amplia.
  // Personalizado não entra nos atalhos daqui: as datas ficam no filtro de
  // cima, e repetir os dois campos dentro do modal só ocuparia espaço.
  const [periodo, setPeriodo] = useState<PeriodoDoRelatorio>(periodoInicial);
  const [granularidade, setGranularidade] = useState<Granularidade | null>(null);

  const janela = useMemo(() => janelaDoRelatorio(periodo), [periodo]);
  const granularidadeEfetiva = granularidade ?? granularidadeSugerida(janela);

  const serie = useMemo(
    () => serieDoProduto(vendas, { chave: linha.chave, janela, granularidade: granularidadeEfetiva }),
    [linha.chave, vendas, janela, granularidadeEfetiva],
  );

  const unidade = GRANULARIDADES.find((g) => g.id === granularidadeEfetiva)?.singular || 'período';
  const emUnidades = (ponto: { quantidade: number; gramas: number }) =>
    serie.porPeso ? emKg(ponto.gramas) : `${ponto.quantidade} un`;

  const baixar = () => {
    baixarCsv(
      csvDaSerie(serie, { loja, produto: linha.nome, periodo: `${janela.rotulo} (${janela.descricao})` }),
      nomeDoArquivo(`vendas-${granularidadeEfetiva}`, linha.nome),
    );
  };

  return (
    <>
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS_DA_CURVA.map((id) => {
            const preset = PRESETS_DO_RELATORIO.find((p) => p.id === id)!;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPeriodo({ preset: id })}
                className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-colors ${
                  periodo.preset === id ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
          <span className="mx-1 h-4 w-px bg-slate-200" />
          {GRANULARIDADES.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGranularidade(g.id)}
              className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-colors ${
                granularidadeEfetiva === g.id
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {g.label}
            </button>
          ))}
          <button
            type="button"
            onClick={baixar}
            disabled={!serie.pontos.length}
            className="ml-auto text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors flex items-center gap-1.5 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Planilha
          </button>
        </div>

        {!serie.pontos.length ? (
          <p className="text-sm text-muted-foreground italic text-center py-12">
            Este produto não vendeu nada em {janela.descricao}.
          </p>
        ) : (
          <>
            {serie.melhor && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                  {unidade === 'mês' ? 'Melhor mês' : `Melhor ${unidade}`}
                </p>
                {/* `capitalize` põe maiúscula em toda palavra e escreve
                    "Julho De 2026"; só a primeira letra é o certo. */}
                <p className="text-lg font-black text-slate-800 first-letter:uppercase leading-tight">
                  {serie.melhor.rotuloLongo}
                </p>
                <p className="text-xs text-muted-foreground">
                  {emUnidades(serie.melhor)} · {brl(serie.melhor.valor)} · {serie.melhor.vendas} venda
                  {serie.melhor.vendas === 1 ? '' : 's'}
                </p>
              </div>
            )}

            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serie.pontos} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="rotulo"
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    interval={serie.pontos.length > 20 ? 'preserveStartEnd' : 0}
                  />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: '#f1f5f9' }}
                    contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                    labelStyle={{ fontWeight: 700, color: '#0f172a' }}
                    formatter={(_valor: any, _nome: any, item: any) => [
                      `${emUnidades(item.payload)} · ${brl(item.payload.valor)}`,
                      'Saiu',
                    ]}
                    labelFormatter={(_r: any, carga: any) => {
                      const ponto = carga?.[0]?.payload;
                      if (!ponto) return '';
                      return ponto.emAndamento ? `${ponto.rotuloLongo} (em andamento)` : ponto.rotuloLongo;
                    }}
                  />
                  {/* O eixo é a QUANTIDADE (ou o peso): a pergunta é "quando saiu
                      mais", não "quando faturou mais" — o dinheiro vai no tooltip. */}
                  <Bar dataKey={serie.porPeso ? 'gramas' : 'quantidade'} radius={[6, 6, 0, 0]}>
                    {serie.pontos.map((ponto) => (
                      <Cell
                        key={ponto.chave}
                        fill={ponto.emAndamento ? '#d1fae5' : ponto.chave === serie.melhor?.chave ? '#059669' : '#a7f3d0'}
                        stroke={ponto.emAndamento ? '#10b981' : undefined}
                        strokeDasharray={ponto.emAndamento ? '4 3' : undefined}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span>
                Total no período:{' '}
                <strong className="text-slate-800">
                  {serie.porPeso ? emKg(serie.totalGramas) : `${serie.totalQuantidade} un`}
                </strong>
              </span>
              <span>
                Faturou: <strong className="text-slate-800">{brl(serie.totalValor)}</strong>
              </span>
              <span>
                Em <strong className="text-slate-800">{serie.totalVendas}</strong> venda
                {serie.totalVendas === 1 ? '' : 's'}
              </span>
            </div>
          </>
        )}
    </>
  );
}
