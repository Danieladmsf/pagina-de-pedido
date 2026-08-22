'use client';

import React, { useMemo } from 'react';
import {
  ArrowDownCircle,
  ArrowLeft,
  ArrowUpCircle,
  CheckCircle2,
  Download,
  PackageSearch,
  PowerOff,
  ShoppingBag,
  TriangleAlert,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { baixarCsv } from '@/lib/csv';
import { getEffectiveStock } from '@/lib/inventory';
import {
  csvDoExtrato,
  doMaisNovoParaOMaisVelho,
  montarExtratoDoItem,
  rotuloDoTipo,
  type LinhaDoExtrato,
} from '@/lib/estoque/extrato';

/**
 * O extrato de um produto, do jeito que a dona confere a bandeja.
 *
 * A aba Estoque mostrava só o número de hoje, e "não bate com o físico" não
 * tem resposta em cima de um número solto. Aqui está a linha do tempo inteira,
 * com o saldo depois de cada movimento — e, mais importante, com as
 * CONFERÊNCIAS: toda entrada lançada na mão guarda quanto havia antes, então o
 * extrato sabe dizer se o estoque chegou naquele dia com o número certo. Onde
 * não chegou, a linha fica marcada e a dona tem a data para investigar.
 */
export function ExtratoDoItemPage({
  item,
  items,
  movimentos,
  pedidos,
  onVoltar,
  onEntrada,
  onSaida,
  canEdit,
}: {
  item: any;
  items: any[] | null;
  movimentos: any[] | null;
  pedidos: any[] | null;
  onVoltar: () => void;
  onEntrada?: () => void;
  onSaida?: () => void;
  canEdit?: boolean;
}) {
  const estoqueEfetivo = getEffectiveStock(item, items || []);
  const controlado = estoqueEfetivo !== null;
  const derivado = !!item?.isCombo || item?.saleUnit === 'kg';

  const extrato = useMemo(
    () =>
      montarExtratoDoItem({
        itemId: item?.id,
        estoqueAtual: item?.stockQuantity,
        movimentos,
        pedidos,
      }),
    [item?.id, item?.stockQuantity, movimentos, pedidos],
  );

  const linhas = useMemo(() => doMaisNovoParaOMaisVelho(extrato.linhas), [extrato.linhas]);
  const { conferencia } = extrato;
  const temDivergencia = conferencia.totalDivergente !== 0 || extrato.diferencaFinal !== 0;

  const baixar = () => {
    const nome = String(item?.name || 'produto')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 40);
    baixarCsv(csvDoExtrato(extrato, item?.name || 'Produto'), `estoque-${nome}-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <div className="flex h-full min-h-0 w-full max-w-[1200px] mx-auto flex-col gap-4 pt-4 pb-2">
      <header className="shrink-0 px-2">
        <button
          type="button"
          onClick={onVoltar}
          className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-500 transition-colors hover:text-slate-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar para o estoque
        </button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-black tracking-tight text-slate-800">{item?.name || 'Produto'}</h1>
              {item?.isAvailable === false && (
                <Badge variant="secondary" className="border-slate-300 bg-slate-100 text-[10px] text-slate-600">
                  Fora do cardápio
                </Badge>
              )}
              {derivado && (
                <Badge variant="secondary" className="border-amber-200 bg-amber-50 text-[10px] text-amber-700">
                  {item?.isCombo ? 'Combo · estoque vem dos itens' : 'Vendido por peso'}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Tudo que entrou e saiu deste produto, do mais recente para o mais antigo.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {canEdit && !derivado && onEntrada && (
              <Button size="sm" variant="outline" onClick={onEntrada} className="gap-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50">
                <ArrowUpCircle className="h-3.5 w-3.5" /> {controlado ? 'Entrada' : 'Controlar'}
              </Button>
            )}
            {canEdit && !derivado && onSaida && controlado && (
              <Button size="sm" variant="outline" onClick={onSaida} className="gap-1 border-red-200 text-red-700 hover:bg-red-50">
                <ArrowDownCircle className="h-3.5 w-3.5" /> Saída
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={baixar} disabled={linhas.length === 0} className="gap-1">
              <Download className="h-3.5 w-3.5" /> Baixar
            </Button>
          </div>
        </div>
      </header>

      {/* Números do produto */}
      <div className="grid shrink-0 grid-cols-2 gap-3 px-2 md:grid-cols-4">
        <Numero
          rotulo="Estoque hoje"
          valor={controlado ? `${estoqueEfetivo}` : 'Sem controle'}
          hint={controlado ? 'unidades no app' : 'vende sem limite'}
          destaque
        />
        <Numero rotulo="Entrou" valor={`+${extrato.entradas}`} hint="lançado na mão" tom="emerald" />
        <Numero rotulo="Vendido" valor={`-${extrato.vendido}`} hint="baixado por pedidos" tom="blue" />
        <Numero
          rotulo="Saiu na mão"
          valor={extrato.saidasManuais ? `-${extrato.saidasManuais}` : '0'}
          hint="perda, brinde, acerto"
          tom="rose"
        />
      </div>

      {/* O veredito da conferência */}
      <div className="shrink-0 px-2">
        {!controlado ? (
          <Aviso tom="slate" Icon={PowerOff}>
            Este produto não é contado. As vendas não descontam nada e ele nunca aparece como esgotado.
            Use <strong>Controlar</strong> para começar a contar a partir de hoje.
          </Aviso>
        ) : conferencia.pontos === 0 ? (
          <Aviso tom="slate" Icon={PackageSearch}>
            Ainda não há conferência: ela aparece quando você lança a próxima entrada ou saída.
            O app compara o que havia no estoque com o que as vendas deixaram, e avisa se não bater.
          </Aviso>
        ) : temDivergencia ? (
          <Aviso tom="amber" Icon={TriangleAlert}>
            <strong>
              {conferencia.ok} de {conferencia.pontos} conferência{conferencia.pontos === 1 ? '' : 's'} fecharam.
            </strong>{' '}
            {conferencia.totalDivergente !== 0 && (
              <>
                Em algum momento {conferencia.totalDivergente < 0 ? 'sumiram' : 'apareceram'}{' '}
                <strong>{Math.abs(conferencia.totalDivergente)} unidade{Math.abs(conferencia.totalDivergente) === 1 ? '' : 's'}</strong>{' '}
                sem passar pelo app — as linhas marcadas abaixo mostram o dia.{' '}
              </>
            )}
            Costuma ser doce consumido, quebrado ou dado de brinde. Lance como <strong>Saída</strong> para a conta voltar a fechar.
          </Aviso>
        ) : (
          <Aviso tom="emerald" Icon={CheckCircle2}>
            <strong>A conta fecha.</strong> {conferencia.pontos === 1 ? 'A conferência feita' : `As ${conferencia.pontos} conferências feitas`}{' '}
            {conferencia.pontos === 1 ? 'bateu' : 'bateram'} com o que as vendas deixaram — nada saiu por fora do app.
          </Aviso>
        )}
      </div>

      {/* O extrato */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 custom-scrollbar">
        <div className="rounded-xl border bg-white">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-white">
              <TableRow>
                <TableHead className="w-[160px] pl-6">Quando</TableHead>
                <TableHead className="w-[130px]">O que foi</TableHead>
                <TableHead className="w-[90px] text-center">Qtd</TableHead>
                <TableHead className="w-[110px] text-center">Ficou com</TableHead>
                <TableHead className="pr-6">Detalhe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-sm text-muted-foreground">
                    Nenhuma movimentação registrada para este produto.
                  </TableCell>
                </TableRow>
              ) : (
                linhas.map((linha) => <LinhaDoHistorico key={linha.id} linha={linha} />)
              )}
            </TableBody>
          </Table>
        </div>

        {extrato.diferencaFinal !== 0 && (
          <p className="mt-2 px-1 text-[11px] text-amber-700">
            O estoque de hoje ({extrato.estoqueAtual}) está{' '}
            {extrato.diferencaFinal > 0 ? `${extrato.diferencaFinal} acima` : `${Math.abs(extrato.diferencaFinal)} abaixo`}{' '}
            do que este extrato explica ({extrato.saldoFinal}).
          </p>
        )}
      </div>
    </div>
  );
}

function LinhaDoHistorico({ linha }: { linha: LinhaDoExtrato }) {
  const entrou = linha.delta > 0;
  const ehVenda = linha.tipo === 'venda';
  const temDiferenca = linha.diferenca !== undefined && linha.diferenca !== 0;

  return (
    <>
      <TableRow className={temDiferenca ? 'bg-amber-50/60 hover:bg-amber-50/60' : undefined}>
        <TableCell className="pl-6 whitespace-nowrap text-xs text-muted-foreground">
          {linha.quando ? linha.quando.toLocaleString('pt-BR') : '—'}
        </TableCell>
        <TableCell>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${
              ehVenda
                ? 'bg-blue-50 text-blue-700'
                : entrou
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-rose-50 text-rose-700'
            }`}
          >
            {ehVenda ? <ShoppingBag className="h-3 w-3" /> : entrou ? <ArrowUpCircle className="h-3 w-3" /> : <ArrowDownCircle className="h-3 w-3" />}
            {rotuloDoTipo(linha.tipo)}
          </span>
        </TableCell>
        <TableCell className={`text-center font-bold ${entrou ? 'text-emerald-600' : 'text-rose-600'}`}>
          {entrou ? '+' : ''}
          {linha.delta}
        </TableCell>
        <TableCell className="text-center font-semibold text-slate-700">
          {linha.saldoDepois === null ? <span className="text-xs text-muted-foreground">—</span> : linha.saldoDepois}
        </TableCell>
        <TableCell className="pr-6 text-xs text-muted-foreground">
          {linha.pedido ? (
            <span>
              Pedido <span className="font-semibold text-slate-700">#{linha.pedido.codigo}</span>
              {linha.pedido.cliente ? ` · ${linha.pedido.cliente}` : ''} · {linha.pedido.canal}
            </span>
          ) : (
            <span>
              {linha.observacao || 'Lançado na aba Estoque'}
              {linha.quem ? ` · ${linha.quem}` : ''}
            </span>
          )}
        </TableCell>
      </TableRow>

      {temDiferenca && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={5} className="border-0 pb-3 pl-6 pr-6 pt-0">
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Aqui a conta não fechou: quando esta {rotuloDoTipo(linha.tipo).toLowerCase()} foi lançada, havia{' '}
                <strong>{Math.abs(linha.diferenca!)} unidade{Math.abs(linha.diferenca!) === 1 ? '' : 's'} a {linha.diferenca! < 0 ? 'menos' : 'mais'}</strong>{' '}
                do que as vendas deixavam. A diferença nasceu entre esta linha e a conferência anterior.
              </span>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function Numero({
  rotulo,
  valor,
  hint,
  tom = 'slate',
  destaque,
}: {
  rotulo: string;
  valor: string;
  hint: string;
  tom?: 'slate' | 'emerald' | 'blue' | 'rose';
  destaque?: boolean;
}) {
  const cores: Record<string, string> = {
    slate: 'text-slate-800',
    emerald: 'text-emerald-600',
    blue: 'text-blue-600',
    rose: 'text-rose-600',
  };
  return (
    <div className={`rounded-xl border bg-white px-4 py-3 ${destaque ? 'ring-2 ring-slate-200' : ''}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className={`mt-0.5 text-2xl font-black leading-none ${cores[tom]}`}>{valor}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function Aviso({
  tom,
  Icon,
  children,
}: {
  tom: 'emerald' | 'amber' | 'slate';
  Icon: typeof CheckCircle2;
  children: React.ReactNode;
}) {
  const cores = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
  }[tom];
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${cores}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}
