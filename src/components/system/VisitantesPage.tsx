'use client';

import React, { useMemo, useState } from 'react';
import { collection, doc, query, where } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  Eye,
  Loader2,
  MousePointerClick,
  Receipt,
  ShoppingBag,
  Store,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { usePdvAccess } from '@/contexts/PdvAccessContext';
import {
  canAccessRetaguarda,
  EMPTY_OPERATOR_RETAGUARDA_PERMISSIONS,
} from '@/lib/user-permissions';
import { useCaixaAbertoEm } from '@/hooks/useCaixaAbertoEm';
import { useMovimentoDoCardapio } from '@/hooks/useMovimentoDoCardapio';
import { usePublicAudience } from '@/hooks/usePublicAudience';
import { useVendasDoPeriodo } from '@/hooks/useVendasDoPeriodo';
import { useVisitantesDaLoja } from '@/hooks/useVisitantesDaLoja';
import {
  PRESETS_DA_AUDIENCIA,
  janelaDaAudiencia,
  movimentoPorDia,
  type PeriodoDaAudiencia,
  type PresetDaAudiencia,
} from '@/lib/audiencia-periodo';
import { ContactAvatar } from '@/components/shared/ContactAvatar';
import { WhatsAppIcon } from '@/components/shared/WhatsAppIcon';
import { makeProfilePhotoLoader } from '@/lib/wapi/profile-photo';
import { matchUniqueActiveCustomerByPhone, normalizeCreditPhone } from '@/lib/customer-credit';
import {
  NIVEL_DO_ESTADO,
  chamouNoWhatsapp,
  contarPorEstado,
  ehIdentificado,
  estadoDoVisitante,
  eventosDaSessao,
  iniciais,
  ordenarPorOportunidade,
  paraMillis,
  primeiroNome,
  rankingDeProdutos,
  resumoDoDia,
  type EstadoVisitante,
  type Visitante,
} from '@/lib/visitantes';
import { ORIGEM_DIRETA } from '@/lib/origem';
import { receitaPorOrigem } from '@/lib/receita-por-origem';
import { avisosDoCardapio } from '@/lib/avisos-do-cardapio';
import {
  buscasSemResultado,
  faixasDeCarrinhoParado,
  nomeDoDia,
  visitasNaPortaFechada,
} from '@/lib/decisoes-do-cardapio';
import { brl, cn } from '@/lib/utils';

/**
 * Quem passou no cardápio — a tela que a seta do placar abre.
 *
 * O placar responde QUANTAS visitas. Aqui a pergunta é outra: o que dá para
 * FAZER com elas ainda hoje. Por isso a ordem da tela é a ordem do trabalho:
 * primeiro quem montou carrinho e não fechou (é ligar e vender), depois quem
 * está olhando agora, e só no fim o histórico de quem passou.
 *
 * O período é escolhido em cima, e a tela não morre quando o caixa fecha:
 * `store_visits` é append-only e guarda o movimento de todos os dias. Antes a
 * loja passava a maior parte do tempo com a tela em branco — 618 visitas em 11
 * dias que ninguém nunca viu.
 *
 * O menor período aqui é o DIA, não a sessão de caixa: a sessão perde o que
 * acontece antes de abrir e depois de fechar (11,5% das visitas medidas). Quem
 * quer o número do turno tem o placar flutuante, que segue contando a sessão.
 * `useCaixaAbertoEm` fica só para escolher em que período a tela abre.
 */
export function VisitantesPage() {
  const db = useFirestore();
  const router = useRouter();
  const { user } = useUser();
  const { ownerId, role, operatorPermissions } = usePdvAccess();
  // Visitantes é um módulo como os outros: o dono liga ou desliga por pessoa.
  const podeVerVisitantes = canAccessRetaguarda(
    role,
    operatorPermissions?.retaguarda ?? EMPTY_OPERATOR_RETAGUARDA_PERMISSIONS,
    'visitantes',
  );
  const caixaAbertoEm = useCaixaAbertoEm(ownerId);
  // Enquanto a dona não escolhe, o período segue o estado da loja: com a loja
  // trabalhando o que interessa é o dia; com o caixa fechado, "hoje" quase
  // sempre tem duas visitas e nada para ler — a semana é que mostra movimento.
  const [escolha, setEscolha] = useState<PeriodoDaAudiencia | null>(null);
  const periodo: PeriodoDaAudiencia = escolha ?? (caixaAbertoEm ? { preset: 'hoje' } : { preset: '7d' });
  const [aberto, setAberto] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroDaLista>('todos');

  const janela = useMemo(
    () => janelaDaAudiencia(periodo),
    [periodo.preset, periodo.de, periodo.ate], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // 500 e não 200: desde que o número de "Pessoas" passou a sair desta lista,
  // um teto baixo faria o KPI mentir num período de 30 dias.
  const { visitantes, carregando, semAcesso } = useVisitantesDaLoja(ownerId, janela.inicio, 500, janela.fim);
  // `online` é sempre agora, independente do período — por isso a audiência
  // entra sem janela: passar uma faria o hook contar visitas de novo, em
  // paralelo com `useMovimentoDoCardapio`.
  const { online } = usePublicAudience(ownerId, null);
  const { visitas } = useMovimentoDoCardapio(ownerId, janela);
  const { vendas } = useVendasDoPeriodo(ownerId, janela);
  const movimento = useMemo(() => movimentoPorDia(visitas, janela), [visitas, janela]);

  const loadPhoto = useMemo(() => makeProfilePhotoLoader(user, ownerId || ''), [user, ownerId]);
  const inicioMs = janela.inicio?.getTime() ?? 0;

  // Dias do período em que houve visita mas ninguém foi identificado por
  // aparelho (`visitorId` só começou a ser gravado em 20/08/2026). Sem esse
  // aviso, "3 pessoas" ao lado de "144 visitas" se lê como erro da tela.
  const diasSemPessoas = useMemo(
    () => movimento.dias.filter((d) => d.visitas > 0 && !d.sabePessoas).length,
    [movimento.dias],
  );
  const olhandoOPassado = periodo.preset !== 'hoje';

  // Cadastro da loja: serve só para enriquecer quem já é cliente (quantos
  // pedidos, ticket médio). O vínculo de verdade é o `clienteId` gravado na
  // visita; o telefone só resolve quem ainda não tem o id — e mesmo assim
  // apenas quando há UM cliente possível.
  const clientesQuery = useMemoFirebase(() => {
    if (!db || !ownerId) return null;
    return query(collection(db, 'clientes'), where('ownerId', '==', ownerId));
  }, [db, ownerId]);
  const { data: clientes } = useCollection<any>(clientesQuery);

  // O horario de funcionamento: e ele que diz quem bateu na porta fechada.
  const perfilRef = useMemoFirebase(() => {
    if (!db || !ownerId) return null;
    return doc(db, 'store_profiles', ownerId);
  }, [db, ownerId]);
  const { data: storeProfile } = useDoc<any>(perfilRef);

  const acharCliente = useMemo(() => {
    const porId = new Map<string, any>();
    const lista: { id: string; data: any }[] = [];
    for (const c of clientes || []) {
      porId.set(c.id, c);
      lista.push({ id: c.id, data: c });
    }
    return (v: Visitante) => {
      if (v.clienteId && porId.has(v.clienteId)) return porId.get(v.clienteId);
      if (!v.telefone) return null;
      const achado = matchUniqueActiveCustomerByPhone(lista as any, v.telefone);
      return achado.kind === 'unique' ? (achado as any).customer.data : null;
    };
  }, [clientes]);

  const fila = useMemo(() => ordenarPorOportunidade(visitantes, inicioMs), [visitantes, inicioMs]);
  const resumo = useMemo(() => resumoDoDia(visitantes, inicioMs), [visitantes, inicioMs]);
  const produtos = useMemo(() => rankingDeProdutos(visitantes, inicioMs), [visitantes, inicioMs]);
  const contagem = useMemo(() => contarPorEstado(visitantes, inicioMs), [visitantes, inicioMs]);
  // Quanto cada origem trouxe. As vendas vêm de TODOS os canais: o pedido que
  // fechou no balcão depois de a pessoa olhar o cardápio é venda da origem que
  // a trouxe, não do balcão.
  const receita = useMemo(
    () =>
      receitaPorOrigem(
        visitantes,
        vendas.map(({ venda }) => ({
          id: venda.id,
          clienteId: (venda as any).clienteId,
          telefone: (venda as any).customerPhone,
          total: Number(venda.totalAmount) || 0,
        })),
      ),
    [visitantes, vendas],
  );
  const buscas = useMemo(() => buscasSemResultado(visitantes), [visitantes]);
  const faixas = useMemo(() => faixasDeCarrinhoParado(visitantes), [visitantes]);
  const portaFechada = useMemo(
    () => visitasNaPortaFechada(visitas, storeProfile),
    [visitas, storeProfile],
  );
  const avisos = useMemo(
    () =>
      avisosDoCardapio({
        origens: receita.linhas,
        portaFechada,
        buscas,
        carrinhosParados: resumo.abandonados,
        valorParado: resumo.valorAbandonado,
        periodo: janela.descricao,
      }),
    [receita.linhas, portaFechada, buscas, resumo.abandonados, resumo.valorAbandonado, janela.descricao],
  );
  const lista = useMemo(
    () => (filtro === 'todos' ? fila : fila.filter((v) => estadoDoVisitante(v, inicioMs) === filtro)),
    [fila, filtro, inicioMs]
  );

  if (!podeVerVisitantes || semAcesso) {
    return (
      <Moldura onVoltar={() => router.back()}>
        <Aviso
          titulo="Sem acesso a esta tela"
          texto="Seu acesso não inclui Visitantes. O dono libera isso em Usuários e acesso, na Retaguarda."
        />
      </Moldura>
    );
  }

  return (
    <Moldura onVoltar={() => router.back()} descricao={janela.descricao}>
      <BarraDePeriodo periodo={periodo} onMudar={setEscolha} />

      {/* A leitura que um sócio atento faria da tela inteira. Fica em cima
          porque é a única parte que a dona vai ler todo dia — o resto é para
          quando ela quiser conferir de onde saiu o número. */}
      {avisos.length > 0 && (
        <div className="mb-4 space-y-2">
          {avisos.map((aviso) => (
            <div
              key={aviso.id}
              className={cn(
                'flex items-start gap-2.5 rounded-2xl border px-4 py-3',
                aviso.tom === 'acao' && 'border-amber-200 bg-amber-50/80',
                aviso.tom === 'atencao' && 'border-sky-200 bg-sky-50/70',
                aviso.tom === 'bom' && 'border-emerald-200 bg-emerald-50/70',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 shrink-0',
                  aviso.tom === 'acao' && 'text-amber-600',
                  aviso.tom === 'atencao' && 'text-sky-600',
                  aviso.tom === 'bom' && 'text-emerald-600',
                )}
              >
                {aviso.tom === 'acao' && <ShoppingBag className="h-4 w-4" />}
                {aviso.tom === 'atencao' && <Eye className="h-4 w-4" />}
                {aviso.tom === 'bom' && <TrendingUp className="h-4 w-4" />}
              </span>
              <p
                className={cn(
                  'text-sm font-semibold leading-snug',
                  aviso.tom === 'acao' && 'text-amber-900',
                  aviso.tom === 'atencao' && 'text-sky-900',
                  aviso.tom === 'bom' && 'text-emerald-900',
                )}
              >
                {aviso.texto}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Números do período. "Visitas" e "pessoas" são coisas diferentes de
          propósito: a mesma pessoa abrindo o link duas vezes conta duas visitas
          e uma pessoa só. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Numero
          titulo="Visitas"
          valor={movimento.totalVisitas}
          icone={<MousePointerClick className="h-4 w-4" />}
          detalhe={movimento.dias.length > 1 ? `${movimento.mediaPorDia} por dia` : undefined}
        />
        {/* "Pessoas" sai da MESMA fonte da lista abaixo (`store_visitors`, já
            fundido por pessoa), e não da contagem de navegadores de
            `store_visits`: os dois números ficam lado a lado com o filtro
            "Todos", e 118 aqui com 120 ali se lê como defeito da tela. */}
        <Numero
          titulo="Pessoas"
          valor={movimento.sabePessoas ? resumo.pessoas : '—'}
          icone={<Users className="h-4 w-4" />}
          detalhe={
            movimento.sabePessoas
              ? `${resumo.identificadas} com cadastro`
              : 'aparelho ainda não era reconhecido'
          }
        />
        <Numero
          titulo="Carrinhos parados"
          valor={resumo.abandonados}
          icone={<ShoppingBag className="h-4 w-4" />}
          detalhe={resumo.valorAbandonado > 0 ? brl(resumo.valorAbandonado) : undefined}
          destaque={resumo.abandonados > 0}
        />
        <Numero titulo="Pedidos fechados" valor={resumo.comprando} icone={<Receipt className="h-4 w-4" />} detalhe={`${resumo.conversao}% de quem entrou`} />
        <Numero titulo="No cardápio agora" valor={online} icone={<Eye className="h-4 w-4" />} aoVivo={online > 0} />
      </div>

      {/* O movimento do cardápio dia a dia. É o que existe mesmo com o caixa
          fechado, e é a leitura que o placar da sessão nunca deu: se ontem
          entrou mais gente que hoje, e qual foi o melhor dia. */}
      {movimento.dias.length > 1 && (
        <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-black text-slate-800">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              Movimento por dia
            </h2>
            {movimento.melhorDia && (
              <p className="text-xs text-slate-500">
                Melhor dia:{' '}
                <strong className="text-emerald-700">
                  {movimento.melhorDia.rotuloLongo} ({movimento.melhorDia.visitas} visitas)
                </strong>
              </p>
            )}
          </div>
          <div className="mt-3 h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={movimento.dias} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="rotulo"
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  interval={movimento.dias.length > 20 ? 'preserveStartEnd' : 0}
                />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: '#f1f5f9' }}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                  labelStyle={{ fontWeight: 700, color: '#0f172a' }}
                  formatter={(valor: any, _n: any, item: any) => [
                    item?.payload?.sabePessoas
                      ? `${valor} visitas · ${item.payload.pessoas} pessoas`
                      : `${valor} visitas`,
                    'Cardápio aberto',
                  ]}
                  labelFormatter={(_r: any, carga: any) => carga?.[0]?.payload?.rotuloLongo || ''}
                />
                <Bar dataKey="visitas" radius={[6, 6, 0, 0]}>
                  {/* O dia de hoje sai tracejado: ele ainda não acabou, e uma
                      barra baixa não pode ser lida como queda. */}
                  {movimento.dias.map((d) => (
                    <Cell
                      key={d.chave}
                      fill={d.ehHoje ? '#d1fae5' : d.chave === movimento.melhorDia?.chave ? '#059669' : '#a7f3d0'}
                      stroke={d.ehHoje ? '#10b981' : undefined}
                      strokeDasharray={d.ehHoje ? '4 3' : undefined}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {diasSemPessoas > 0 && (
            <p className="mt-2 text-[11px] text-slate-400">
              Em {diasSemPessoas} {diasSemPessoas === 1 ? 'dia' : 'dias'} deste período o cardápio ainda não
              reconhecia o aparelho de quem entrava: dá para contar as visitas, não as pessoas.
            </p>
          )}
        </section>
      )}

      {carregando && visitantes.length === 0 && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      )}

      {/* Uma lista só.
          Antes eram duas — "Para chamar agora" e "Quem passou" — e as duas
          liam a MESMA fila: quem tinha carrinho parado aparecia nas duas, com
          a mesma foto e o mesmo nome. O recorte que era seção virou filtro, e
          a ordem por oportunidade continua pondo o dinheiro em cima. */}
      <section className="mt-7">
        {/* Duas perguntas diferentes, dois lugares: à esquerda navegar a fila,
            à direita quanto vale ligar. Antes as duas se misturavam numa pilha
            de pastilhas, e o valor total aparecia aqui pela TERCEIRA vez na
            mesma tela (o aviso do topo e o número "Carrinhos parados" já o
            dizem) — some daqui de propósito. */}
        <div className={cn('grid gap-4', faixas.length > 0 && 'lg:grid-cols-[minmax(0,1fr)_268px]')}>
          <div>
            <h2 className="text-lg font-black text-slate-800">Pessoas</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {resumo.pessoas === 0
                ? `Ninguém abriu o cardápio em ${janela.descricao}.`
                : `${resumo.pessoas} ${resumo.pessoas === 1 ? 'pessoa' : 'pessoas'} em ${janela.descricao}, de quem vale mais atenção para quem só passou. Toque para ver tudo o que a pessoa fez.`}
              {/* Sem o quadro ao lado, a ressalva não tem onde morar: fica aqui. */}
              {olhandoOPassado && resumo.pessoas > 0 && faixas.length === 0 && (
                <span className="block text-[11px] text-slate-400">
                  Alguns carrinhos são de dias atrás, e o que aparece é o carrinho de agora — não um retrato daquele dia.
                </span>
              )}
            </p>

            {resumo.pessoas > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {FILTROS.map((f) => {
                  const total = f.id === 'todos' ? resumo.pessoas : contagem[f.id];
                  const ativo = filtro === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFiltro(f.id)}
                      disabled={total === 0}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-40',
                        ativo ? 'bg-slate-800 text-white' : cn(f.fundo, f.texto, 'hover:brightness-95')
                      )}
                    >
                      {f.rotulo}
                      <span
                        className={cn(
                          'rounded-full px-1.5 text-[11px] font-black',
                          ativo ? 'bg-white/20 text-white' : 'bg-black/5'
                        )}
                      >
                        {total}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Onde está o dinheiro parado. A fila já ordena por oportunidade;
              isto responde outra coisa: quanto vale gastar tempo ligando.
              Carrinho de R$ 150 e carrinho de R$ 12 não pedem o mesmo esforço.
              Valores alinhados à direita para comparar de cima a baixo. */}
          {faixas.length > 0 && (
            <aside className="self-start rounded-2xl border border-amber-200 bg-amber-50/60 p-3.5">
              <div className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-amber-600" />
                <p className="text-[11px] font-black uppercase tracking-wide text-amber-700">
                  Onde está o parado
                </p>
              </div>

              <div className="mt-2.5 space-y-1.5">
                {faixas.map((faixa) => (
                  <div key={faixa.rotulo} className="flex items-baseline justify-between gap-2.5">
                    <p className="text-xs text-amber-900">
                      {faixa.rotulo}
                      <span className="text-amber-700">
                        {' '}· {faixa.pessoas} {faixa.pessoas === 1 ? 'pessoa' : 'pessoas'}
                      </span>
                    </p>
                    <p className="shrink-0 text-[13px] font-black text-amber-900">{brl(faixa.valor)}</p>
                  </div>
                ))}
              </div>

              {olhandoOPassado && (
                <p className="mt-2.5 border-t border-amber-200 pt-2 text-[11px] leading-snug text-amber-700">
                  Carrinho de dias atrás mostra o que está lá agora, não o daquele dia.
                </p>
              )}
            </aside>
          )}
        </div>

        <div className="mt-3 space-y-2">
          {lista.map((v) => (
            <CartaoDeVisitante
              key={v.id}
              visitante={v}
              cliente={acharCliente(v)}
              inicioMs={inicioMs}
              loadPhoto={loadPhoto}
              aberto={aberto === v.id}
              onAlternar={() => setAberto(aberto === v.id ? null : v.id)}
            />
          ))}
        </div>

        {resumo.pessoas > 0 && lista.length === 0 && (
          <p className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
            Ninguém neste filtro em {janela.descricao}.
          </p>
        )}
      </section>

      {/* De onde essa gente veio — e quanto cada lugar trouxe em dinheiro. Só
          aparece quando existe alguma origem marcada: numa loja que ainda não
          usou os links por canal, uma tabela inteira dizendo "sem marca" seria
          só ocupar espaço. */}
      {receita.linhas.some((linha) => linha.origem !== ORIGEM_DIRETA) && (
        <section className="mt-8">
          <h2 className="text-lg font-black text-slate-800">De onde vem a venda</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Conta quem TROUXE a pessoa, e soma o que ela comprou em qualquer canal — inclusive o
            pedido que fechou no WhatsApp ou no balcão depois de ela olhar o cardápio.
          </p>
          <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2 text-left font-bold">Origem</th>
                    <th className="px-3 py-2 text-right font-bold">Pessoas</th>
                    <th className="px-3 py-2 text-right font-bold">Olharam</th>
                    <th className="px-3 py-2 text-right font-bold">Compraram</th>
                    <th className="px-3 py-2 text-right font-bold">Pedidos</th>
                    <th className="px-3 py-2 text-right font-bold">Ticket</th>
                    <th className="px-4 py-2 text-right font-bold">Trouxe</th>
                  </tr>
                </thead>
                <tbody>
                  {receita.linhas.map((linha) => (
                    <tr key={linha.origem} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2.5 font-semibold text-slate-700">{linha.rotulo}</td>
                      <td className="px-3 py-2.5 text-right font-bold text-slate-700">{linha.pessoas}</td>
                      <td className="px-3 py-2.5 text-right text-slate-500">{linha.olharam}</td>
                      <td className="px-3 py-2.5 text-right text-slate-500">
                        {linha.compraram > 0 ? (
                          <>
                            {linha.compraram}
                            <span className="ml-1 text-[10px] font-bold text-slate-400">
                              {linha.conversao}%
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-500">{linha.pedidos || '—'}</td>
                      <td className="px-3 py-2.5 text-right text-slate-500">
                        {linha.ticket > 0 ? brl(linha.ticket) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-black text-emerald-700">
                        {linha.receita > 0 ? brl(linha.receita) : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sem esta linha a dona soma a coluna e acha que falta dinheiro. A
              venda de balcão sem cliente identificado não tem como ter origem. */}
          {receita.pedidosSoltos > 0 && (
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Fora da conta: <span className="font-bold">{brl(receita.receitaSolta)}</span> em{' '}
              {receita.pedidosSoltos}{' '}
              {receita.pedidosSoltos === 1 ? 'pedido' : 'pedidos'} de quem não passou pelo cardápio ou
              foi vendido sem identificar o cliente — venda de balcão não tem como dizer de onde veio.
            </p>
          )}
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            Para separar por lugar, gere o link em Retaguarda → WhatsApp → Links de pedido marcando
            onde ele vai ser colado.
          </p>
        </section>
      )}

      {/* Pedido de produto com as palavras do cliente. */}
      {buscas.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-black text-slate-800">Procuraram e não acharam</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            O que as pessoas digitaram na busca do cardápio e não encontrou nada. Pode ser produto
            que falta, ou nome que o cliente usa e o cadastro não tem.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {buscas.slice(0, 16).map((busca) => (
              <div
                key={busca.termo}
                className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2"
              >
                <span className="text-sm font-bold text-sky-900">{busca.termo}</span>
                <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-black text-sky-700">
                  {busca.pessoas} {busca.pessoas === 1 ? 'pessoa' : 'pessoas'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Demanda que a loja nunca viu: gente que chegou com a porta fechada. */}
      {portaFechada.visitas > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-black text-slate-800">Bateram na porta fechada</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Visitas que aconteceram fora do horário de funcionamento — {portaFechada.fatia}% do
            movimento de {janela.descricao}.
          </p>
          <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-3xl font-black leading-none text-slate-800">
              {portaFechada.visitas}
              <span className="ml-2 text-xs font-bold text-slate-400">
                {portaFechada.visitas === 1 ? 'visita com a loja fechada' : 'visitas com a loja fechada'}
              </span>
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                  Horários que mais aparecem
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {portaFechada.horas.slice(0, 5).map((h) => (
                    <span
                      key={h.hora}
                      className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700"
                    >
                      {String(h.hora).padStart(2, '0')}h · {h.visitas}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                  Dias que mais aparecem
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {portaFechada.dias.slice(0, 4).map((d) => (
                    <span
                      key={d.dia}
                      className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700"
                    >
                      {nomeDoDia(d.dia)} · {d.visitas}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
              Conta pelo horário de funcionamento de hoje — se ele mudou no período, os dias
              anteriores usam o horário novo. Caixa fechado não entra nesta conta.
            </p>
          </div>
        </section>
      )}

      {/* O cardápio visto de fora: o que chama e o que trava. */}
      {produtos.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-black text-slate-800">O que olharam no cardápio</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Produto aberto para ver detalhes. &quot;Pessoas&quot; conta gente; &quot;aberturas&quot; conta as vezes.
          </p>
          <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2 text-left font-bold">Produto</th>
                    <th className="px-3 py-2 text-right font-bold">Pessoas</th>
                    <th className="px-3 py-2 text-right font-bold">Aberturas</th>
                    <th className="px-4 py-2 text-right font-bold">Parado no carrinho</th>
                  </tr>
                </thead>
                <tbody>
                  {produtos.slice(0, 12).map((p) => (
                    <tr key={p.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2.5 font-semibold text-slate-700">{p.nome || 'Produto'}</td>
                      <td className="px-3 py-2.5 text-right font-bold text-slate-700">{p.pessoas}</td>
                      <td className="px-3 py-2.5 text-right text-slate-500">{p.vistas}</td>
                      <td className="px-4 py-2.5 text-right font-bold text-amber-700">
                        {p.valorParado > 0 ? brl(p.valorParado) : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <p className="mt-8 text-center text-[11px] leading-relaxed text-slate-400">
        Só aparece aqui quem abriu o cardápio da loja. Aparelhos da própria loja ficam de fora da conta.
      </p>
    </Moldura>
  );
}

/**
 * Escolha do período. O menor recorte é o DIA.
 *
 * Houve aqui um botão "Sessão de caixa", ao lado de "Hoje". Os dois liam quase
 * o mesmo número num dia comum e o par se lia como repetido — e, entre os dois,
 * a sessão é a janela que MENOS mostra: fora do horário de caixa ficam 11,5%
 * das visitas (25 antes das 10h e 46 depois das 19h, nas 618 medidas). Quem
 * quer o número do turno tem o placar flutuante.
 */
function BarraDePeriodo({
  periodo,
  onMudar,
}: {
  periodo: PeriodoDaAudiencia;
  onMudar: (p: PeriodoDaAudiencia) => void;
}) {
  const hoje = new Date();
  const comoInput = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const explicacao: Partial<Record<PresetDaAudiencia, string>> = {
    hoje: 'Da meia-noite até agora — o dia inteiro, não só o horário de caixa.',
    ontem: 'O dia de ontem inteiro.',
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
      {PRESETS_DA_AUDIENCIA.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() =>
            onMudar(
              p.id === 'custom'
                ? { preset: 'custom', de: periodo.de || comoInput(hoje), ate: periodo.ate || comoInput(hoje) }
                : { preset: p.id },
            )
          }
          title={explicacao[p.id]}
          className={cn(
            'rounded-full px-3 py-1.5 text-xs font-bold transition-colors',
            periodo.preset === p.id
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
          )}
        >
          {p.label}
        </button>
      ))}
      {periodo.preset === 'custom' && (
        <div className="ml-1 flex items-center gap-1.5">
          <input
            type="date"
            value={periodo.de || ''}
            max={periodo.ate || comoInput(hoje)}
            onChange={(e) => onMudar({ ...periodo, preset: 'custom', de: e.target.value })}
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
            aria-label="Data inicial"
          />
          <span className="text-xs text-slate-400">até</span>
          <input
            type="date"
            value={periodo.ate || ''}
            min={periodo.de || undefined}
            max={comoInput(hoje)}
            onChange={(e) => onMudar({ ...periodo, preset: 'custom', ate: e.target.value })}
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
            aria-label="Data final"
          />
        </div>
      )}
    </div>
  );
}

function Moldura({
  children,
  onVoltar,
  descricao,
}: {
  children: React.ReactNode;
  onVoltar: () => void;
  descricao?: string;
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-4 py-5 md:px-6 md:py-7">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onVoltar}
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-100"
            title="Voltar"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="text-2xl font-black tracking-tight text-slate-800">Quem passou no cardápio</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {descricao ? `Movimento do cardápio — ${descricao}.` : 'Movimento do cardápio da loja.'}
            </p>
          </div>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function Aviso({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
      <Store className="mx-auto h-8 w-8 text-slate-300" />
      <p className="mt-3 font-bold text-slate-700">{titulo}</p>
      <p className="mt-1 text-sm text-slate-500">{texto}</p>
    </div>
  );
}

function Numero({
  titulo,
  valor,
  icone,
  detalhe,
  destaque,
  aoVivo,
}: {
  titulo: string;
  /** Texto quando o número não existe — "pessoas" antes da identificação por aparelho. */
  valor: number | string;
  icone: React.ReactNode;
  detalhe?: string;
  destaque?: boolean;
  aoVivo?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border bg-white p-3.5 shadow-sm',
        destaque ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200'
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        <span className={cn(destaque ? 'text-amber-600' : 'text-slate-400')}>{icone}</span>
        {titulo}
      </div>
      <p className={cn('mt-1.5 text-3xl font-black leading-none', destaque ? 'text-amber-700' : 'text-slate-800')}>
        {valor}
        {aoVivo && <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500 align-middle" />}
      </p>
      {detalhe && <p className="mt-1 text-[11px] font-medium text-slate-400">{detalhe}</p>}
    </div>
  );
}

/**
 * Cada etapa do funil na sua cor. `ponto` pinta a trilha do card, `texto` o
 * rótulo ao lado dela e `chip` o valor em destaque (sacola ou pedido).
 *
 * As cores são as mesmas de antes — o que mudou foi o formato: era uma etiqueta
 * chapada dizendo o que a pessoa É, virou uma trilha mostrando onde ela PAROU.
 */
const ETAPAS: Record<
  EstadoVisitante,
  { rotulo: string; ponto: string; halo: string; texto: string; chip: string }
> = {
  passou: {
    rotulo: 'Só entrou',
    ponto: 'bg-slate-400',
    halo: 'ring-slate-400/20',
    texto: 'text-slate-500',
    chip: 'bg-slate-100 text-slate-600',
  },
  olhou: {
    rotulo: 'Olhou produtos',
    ponto: 'bg-sky-500',
    halo: 'ring-sky-500/20',
    texto: 'text-sky-800',
    chip: 'bg-sky-100 text-sky-800',
  },
  abandonou: {
    rotulo: 'Parou no carrinho',
    ponto: 'bg-amber-500',
    halo: 'ring-amber-500/20',
    texto: 'text-amber-800',
    chip: 'bg-amber-100 text-amber-900',
  },
  comprou: {
    rotulo: 'Fechou pedido',
    ponto: 'bg-emerald-600',
    halo: 'ring-emerald-600/20',
    texto: 'text-emerald-800',
    chip: 'bg-emerald-100 text-emerald-800',
  },
};

type FiltroDaLista = 'todos' | EstadoVisitante;

/**
 * Os recortes que antes eram seções separadas da página.
 *
 * A ordem é a do FUNIL — entrou, olhou, carrinho, pedido — e não a da
 * prioridade de trabalho. Os botões ficam ao lado de cards que mostram a
 * mesma sequência pintada da esquerda para a direita, e duas ordens
 * diferentes para as mesmas quatro etapas na mesma tela se leem como erro.
 * Quem precisa do dinheiro primeiro continua achando: "Carrinho parado" é o
 * único âmbar, e a lista já vem ordenada por oportunidade.
 */
const FILTROS: { id: FiltroDaLista; rotulo: string; fundo: string; texto: string }[] = [
  { id: 'todos', rotulo: 'Todos', fundo: 'bg-slate-100', texto: 'text-slate-600' },
  { id: 'passou', rotulo: 'Só entrou', fundo: 'bg-slate-100', texto: 'text-slate-600' },
  { id: 'olhou', rotulo: 'Só olhou', fundo: 'bg-sky-100', texto: 'text-sky-800' },
  { id: 'abandonou', rotulo: 'Carrinho parado', fundo: 'bg-amber-100', texto: 'text-amber-900' },
  { id: 'comprou', rotulo: 'Fechou pedido', fundo: 'bg-emerald-100', texto: 'text-emerald-800' },
];

/**
 * A trilha: quatro pontos, pintados até onde a pessoa chegou.
 *
 * O ponto atual é maior e ganha um halo — sem isso, "olhou" e "carrinho" só se
 * diferenciam contando bolinhas. Os apagados ficam, porque é a distância até
 * eles que mostra o que ainda dá para fazer.
 */
function TrilhaDeEtapas({ estado }: { estado: EstadoVisitante }) {
  const nivel = NIVEL_DO_ESTADO[estado];
  const { ponto: cor, halo } = ETAPAS[estado];

  return (
    <div className="flex items-center" aria-hidden="true">
      {[1, 2, 3, 4].map((i) => (
        <React.Fragment key={i}>
          {i > 1 && <span className={cn('h-0.5 w-4', i <= nivel ? cor : 'bg-slate-200')} />}
          <span
            className={cn(
              'rounded-full',
              i === nivel ? cn('h-2.5 w-2.5 ring-4', cor, halo) : 'h-2 w-2',
              i < nivel ? cor : i > nivel ? 'bg-slate-200' : ''
            )}
          />
        </React.Fragment>
      ))}
    </div>
  );
}

function CartaoDeVisitante({
  visitante,
  cliente,
  inicioMs,
  loadPhoto,
  aberto,
  onAlternar,
}: {
  visitante: Visitante;
  cliente: any | null;
  inicioMs: number;
  loadPhoto: (phone: string) => Promise<string | null>;
  aberto: boolean;
  onAlternar: () => void;
}) {
  const estado = estadoDoVisitante(visitante, inicioMs);
  const etapa = ETAPAS[estado];
  const identificado = ehIdentificado(visitante);
  const nome = visitante.nome || cliente?.nome || '';
  const telefone = normalizeCreditPhone(visitante.telefone || cliente?.celular || '');
  const eventos = useMemo(() => eventosDaSessao(visitante, inicioMs), [visitante, inicioMs]);
  const carrinho = visitante.carrinho;
  const ultimaVez = paraMillis(visitante.ultimaVez);
  const jaChamou = chamouNoWhatsapp(visitante);

  /**
   * Quem a loja está vendo.
   *
   * "Visitante sem cadastro" aparecia em cima de um telefone: em 15 das 120
   * pessoas a loja tem o número (14 vieram pela marca do link que ela mesma
   * mandou) e nenhum nome, e a frase lia como "não sei quem é" bem ao lado do
   * jeito de falar com a pessoa. Sem nome, o telefone É a identidade — é por
   * ele que a dona reconhece e é ele que ela abre no WhatsApp.
   *
   * Sem nome E sem telefone continua sendo visitante sem cadastro, porque aí
   * realmente não há como chamar.
   */
  const semNome = !nome && !!telefone;
  const titulo = nome || (telefone ? formatarTelefone(telefone) : 'Visitante sem cadastro');

  // O valor em destaque é o que a etapa produziu: a sacola parada de quem não
  // fechou, o pedido de quem fechou.
  const valorDaEtapa =
    estado === 'abandonou' && carrinho?.valor
      ? brl(carrinho.valor)
      : estado === 'comprou' && visitante.ultimoPedidoValor
        ? brl(visitante.ultimoPedidoValor)
        : null;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border bg-white shadow-sm transition',
        estado === 'abandonou' ? 'border-amber-200' : 'border-slate-200'
      )}
    >
      {/* O card inteiro abre. O botão "Detalhes" virou a seta: a área de toque
          passou a ser a linha toda, que é o que a pessoa tenta tocar primeiro. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onAlternar}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onAlternar();
          }
        }}
        aria-expanded={aberto}
        className="flex w-full cursor-pointer items-start gap-3 p-3.5 text-left transition-colors hover:bg-slate-50/70"
      >
        <ContactAvatar
          phone={telefone}
          initials={iniciais(nome)}
          loadPhoto={loadPhoto}
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold text-white',
            identificado ? 'bg-gradient-to-br from-emerald-400 to-teal-500' : 'bg-slate-300'
          )}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="font-bold text-slate-800">{titulo}</p>
            {jaChamou && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800">
                <WhatsAppIcon className="h-2.5 w-2.5" /> Já te chamou
              </span>
            )}
          </div>

          <p className="mt-0.5 text-xs text-slate-500">
            {semNome ? 'Ainda não deixou o nome' : telefone ? formatarTelefone(telefone) : 'Sem telefone — não dá para chamar'}
            {ultimaVez !== null && <span> · {quandoFoi(ultimaVez)}</span>}
            {cliente && (
              <span>
                {' '}· {Number(cliente.totalPedidos) || 0} {Number(cliente.totalPedidos) === 1 ? 'pedido' : 'pedidos'} na loja
                {Number(cliente.ticketMedio) > 0 && ` · ticket ${brl(Number(cliente.ticketMedio))}`}
              </span>
            )}
          </p>

          {/* Link é encaminhável: se a cliente mandou o endereço para uma amiga,
              quem chegou foi a amiga. A loja precisa saber disso antes de ligar. */}
          {visitante.viaLink && (
            <p className="mt-0.5 text-[11px] font-medium text-slate-400">
              Reconhecido pelo link que a loja enviou — confirme o nome ao falar.
            </p>
          )}

          {/* Onde a pessoa parou, e o que a parada vale. */}
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <TrilhaDeEtapas estado={estado} />
            <span className={cn('text-[11px] font-extrabold', etapa.texto)}>{etapa.rotulo}</span>
            {valorDaEtapa && (
              <span className={cn('rounded-lg px-2 py-0.5 text-[11px] font-black', etapa.chip)}>{valorDaEtapa}</span>
            )}
          </div>

          {/* O que ficou na sacola, sem precisar abrir o card: é a frase que a
              dona copia para o WhatsApp. Só para quem parou no carrinho — são 9
              de 120 pessoas, então não é isto que adensa a lista. O total não
              se repete aqui: ele já está na linha da trilha, acima. */}
          {estado === 'abandonou' && carrinho && carrinho.itens.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {carrinho.itens.slice(0, 4).map((item, i) => (
                <span
                  key={`${item.id}-${i}`}
                  className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900"
                >
                  {item.qtd}× {item.nome}
                </span>
              ))}
              {carrinho.itens.length > 4 && (
                <span className="text-[11px] font-semibold text-slate-400">
                  +{carrinho.itens.length - 4}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {telefone && (
            <a
              href={linkDoWhatsApp(telefone, nome, estado, carrinho?.valor)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-2.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-600"
            >
              <WhatsAppIcon className="h-3.5 w-3.5" />
              {jaChamou ? 'Responder' : 'Chamar'}
            </a>
          )}
          <span className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400">
            <ChevronDown className={cn('h-4 w-4 transition-transform', aberto && 'rotate-180')} />
          </span>
        </div>
      </div>

      {aberto && (
        <div className="border-t border-slate-100 bg-slate-50/70 px-3.5 py-3">
          <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
            <div>
              <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">O que fez nesta visita</p>
              {eventos.length === 0 ? (
                <p className="mt-1.5 text-xs text-slate-500">Abriu o cardápio e não chegou a mexer em nada.</p>
              ) : (
                <ol className="mt-1.5 space-y-1.5">
                  {eventos.map((e, i) => (
                    <li key={`${e.at}-${i}`} className="flex items-start gap-2 text-xs">
                      <span className="mt-0.5 w-10 shrink-0 font-mono text-[10px] text-slate-400">
                        {new Date(e.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-slate-700">
                        {e.tipo === 'viu' && (
                          <>
                            abriu <span className="font-semibold">{e.produtoNome || 'um produto'}</span>
                            {e.valor ? <span className="text-slate-400"> · {brl(e.valor)}</span> : null}
                          </>
                        )}
                        {e.tipo === 'carrinho' && (
                          <>
                            montou o carrinho <span className="font-semibold">{brl(e.valor || 0)}</span>
                          </>
                        )}
                        {e.tipo === 'pedido' && (
                          <span className="font-bold text-emerald-700">enviou o pedido · {brl(e.valor || 0)}</span>
                        )}
                        {e.tipo === 'whatsapp' && (
                          <span className="font-bold text-emerald-700">chamou a loja no WhatsApp</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="space-y-1.5 text-xs text-slate-600">
              {/* A sacola item a item: saiu da linha do card e veio para cá, que
                  é onde a dona lê antes de escrever a mensagem. */}
              {estado === 'abandonou' && carrinho && carrinho.itens.length > 0 && (
                <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-[11px] font-black uppercase tracking-wide text-amber-700">Parado na sacola</p>
                  <div className="mt-2 space-y-1">
                    {carrinho.itens.map((item, i) => (
                      <p key={`${item.id}-${i}`} className="flex items-baseline justify-between gap-3 text-amber-900">
                        <span>
                          {item.qtd}× {item.nome}
                        </span>
                        <span className="shrink-0 font-bold">{brl(item.valor)}</span>
                      </p>
                    ))}
                  </div>
                  <p className="mt-2 flex items-baseline justify-between gap-3 border-t border-amber-200 pt-2 text-[13px]">
                    <span className="font-bold text-amber-800">Total</span>
                    <span className="font-black text-amber-700">{brl(carrinho.valor)}</span>
                  </p>
                </div>
              )}

              <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">Histórico</p>
              <Linha rotulo="Visitas ao cardápio" valor={String(visitante.sessoes ?? 1)} />
              <Linha rotulo="Pedidos pelo cardápio" valor={String(visitante.pedidos ?? 0)} />
              {paraMillis(visitante.primeiraVez) !== null && (
                <Linha
                  rotulo="Primeira visita"
                  valor={new Date(paraMillis(visitante.primeiraVez)!).toLocaleDateString('pt-BR')}
                />
              )}
              {cliente?.clienteDesde && <Linha rotulo="Cliente desde" valor={String(cliente.clienteDesde)} />}
              {!identificado && (
                <p className="pt-1 text-[11px] leading-relaxed text-slate-400">
                  Sem cadastro: só aparece com nome depois que a pessoa se identifica no carrinho.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <p className="flex items-baseline justify-between gap-3">
      <span className="text-slate-500">{rotulo}</span>
      <span className="font-bold text-slate-700">{valor}</span>
    </p>
  );
}

function formatarTelefone(digits: string) {
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return digits;
}

/** "há 4 min" é o que diz se ainda dá tempo de chamar a pessoa. */
function quandoFoi(ms: number) {
  const minutos = Math.round((Date.now() - ms) / 60_000);
  if (minutos < 1) return 'agora mesmo';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return `há ${horas}h${String(minutos % 60).padStart(2, '0')}`;
}

/**
 * Mensagem pronta, mas ainda editável: o WhatsApp abre com o texto no campo e
 * quem manda é a pessoa da loja. Nada é enviado por conta própria.
 */
function linkDoWhatsApp(telefone: string, nome: string, estado: EstadoVisitante, valor?: number) {
  const primeiro = primeiroNome(nome);
  const oi = primeiro ? `Oi, ${primeiro}!` : 'Oi!';
  const texto =
    estado === 'abandonou'
      ? `${oi} Vi que você montou um pedido no nosso cardápio${valor ? ` (${brl(valor)})` : ''} e não chegou a enviar. Quer que eu já separe pra você?`
      : `${oi} Tudo bem? Qualquer coisa que precisar do cardápio, é só chamar por aqui.`;
  return `https://wa.me/55${telefone}?text=${encodeURIComponent(texto)}`;
}
