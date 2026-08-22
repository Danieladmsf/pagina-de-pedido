'use client';

import React, { useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
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
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { usePdvAccess } from '@/contexts/PdvAccessContext';
import {
  canAccessRetaguarda,
  EMPTY_OPERATOR_RETAGUARDA_PERMISSIONS,
} from '@/lib/user-permissions';
import { useCaixaAbertoEm } from '@/hooks/useCaixaAbertoEm';
import { useMovimentoDoCardapio } from '@/hooks/useMovimentoDoCardapio';
import { usePublicAudience } from '@/hooks/usePublicAudience';
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
  chamouNoWhatsapp,
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
import { brl, cn } from '@/lib/utils';

/**
 * Quem passou no cardápio — a tela que a seta do placar abre.
 *
 * O placar responde QUANTAS visitas. Aqui a pergunta é outra: o que dá para
 * FAZER com elas ainda hoje. Por isso a ordem da tela é a ordem do trabalho:
 * primeiro quem montou carrinho e não fechou (é ligar e vender), depois quem
 * está olhando agora, e só no fim o histórico de quem passou.
 *
 * O período é escolhido em cima. Ele nasce na sessão de caixa aberta, que é o
 * turno de trabalho, mas a tela não morre quando o caixa fecha: `store_visits` é
 * append-only e guarda o movimento de todos os dias. Antes disso a loja passava
 * a maior parte do tempo com a tela em branco — 618 visitas em 11 dias que
 * ninguém nunca viu.
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
  // Enquanto a dona não escolhe, o período segue o estado da loja: com o caixa
  // aberto o que interessa é o turno; com ele fechado, "hoje" quase sempre tem
  // duas visitas e nada para ler — a semana é que mostra o movimento.
  const [escolha, setEscolha] = useState<PeriodoDaAudiencia | null>(null);
  const periodo: PeriodoDaAudiencia = escolha ?? (caixaAbertoEm ? { preset: 'sessao' } : { preset: '7d' });
  const [aberto, setAberto] = useState<string | null>(null);

  const janela = useMemo(
    () => janelaDaAudiencia(periodo, { caixaAbertoEm }),
    [periodo.preset, periodo.de, periodo.ate, caixaAbertoEm?.getTime()], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const { visitantes, carregando, semAcesso } = useVisitantesDaLoja(ownerId, janela.inicio, 200, janela.fim);
  // `online` é sempre agora, independente do período — por isso a audiência
  // entra sem janela: passar uma faria o hook contar visitas de novo, em
  // paralelo com `useMovimentoDoCardapio`.
  const { online } = usePublicAudience(ownerId, null);
  const { visitas } = useMovimentoDoCardapio(ownerId, janela);
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
  const olhandoOPassado = periodo.preset !== 'sessao' && periodo.preset !== 'hoje';

  // Cadastro da loja: serve só para enriquecer quem já é cliente (quantos
  // pedidos, ticket médio). O vínculo de verdade é o `clienteId` gravado na
  // visita; o telefone só resolve quem ainda não tem o id — e mesmo assim
  // apenas quando há UM cliente possível.
  const clientesQuery = useMemoFirebase(() => {
    if (!db || !ownerId) return null;
    return query(collection(db, 'clientes'), where('ownerId', '==', ownerId));
  }, [db, ownerId]);
  const { data: clientes } = useCollection<any>(clientesQuery);

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
  const produtos = useMemo(() => rankingDeProdutos(visitantes), [visitantes]);
  const oportunidades = useMemo(
    () => fila.filter((v) => estadoDoVisitante(v, inicioMs) === 'abandonou'),
    [fila, inicioMs]
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
      <BarraDePeriodo periodo={periodo} onMudar={setEscolha} temCaixaAberto={!!caixaAbertoEm} />

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
        <Numero
          titulo="Pessoas"
          valor={movimento.sabePessoas ? movimento.totalPessoas : '—'}
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

      {/* A parte que vira dinheiro hoje. */}
      <section className="mt-7">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-black text-slate-800">Para chamar agora</h2>
          {oportunidades.length > 0 && (
            <p className="text-xs font-bold text-amber-700">
              {brl(resumo.valorAbandonado)} escolhidos e não fechados
            </p>
          )}
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          Montaram o pedido no cardápio e pararam antes de enviar.
          {/* Numa janela larga entra carrinho de dias atrás. Ele continua sendo
              uma venda a resgatar, mas "agora" precisa dizer de quando é. */}
          {olhandoOPassado && ' Alguns são de dias atrás — cada card mostra há quanto tempo.'}
        </p>

        {oportunidades.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
            Ninguém deixou carrinho parado neste período.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {oportunidades.map((v) => (
              <CartaoDeVisitante
                key={v.id}
                visitante={v}
                cliente={acharCliente(v)}
                inicioMs={inicioMs}
                loadPhoto={loadPhoto}
                aberto={aberto === v.id}
                onAlternar={() => setAberto(aberto === v.id ? null : v.id)}
                emDestaque
              />
            ))}
          </div>
        )}
      </section>

      {/* Todo mundo, na ordem de quem vale mais atenção. */}
      <section className="mt-8">
        <h2 className="text-lg font-black text-slate-800">Quem passou</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          {resumo.pessoas === 0
            ? `Ninguém abriu o cardápio em ${janela.descricao}.`
            : `${resumo.pessoas} ${resumo.pessoas === 1 ? 'pessoa' : 'pessoas'} em ${janela.descricao}.`}
          {olhandoOPassado && resumo.pessoas > 0 && (
            <span className="block text-[11px] text-slate-400">
              O carrinho mostrado é o de agora, não um retrato daquele dia.
            </span>
          )}
        </p>
        <div className="mt-3 space-y-2">
          {fila.map((v) => (
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
      </section>

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
 * Escolha do período. "Sessão de caixa" só existe quando há caixa aberto — sem
 * isso o botão seria uma promessa vazia, que é o que a tela fazia antes.
 */
function BarraDePeriodo({
  periodo,
  onMudar,
  temCaixaAberto,
}: {
  periodo: PeriodoDaAudiencia;
  onMudar: (p: PeriodoDaAudiencia) => void;
  temCaixaAberto: boolean;
}) {
  const hoje = new Date();
  const comoInput = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const opcoes = PRESETS_DA_AUDIENCIA.filter((p) => p.id !== 'sessao' || temCaixaAberto);
  // Caixa fechado com "sessão" guardada no estado: o botão sumiu, então destaca
  // o período que a janela realmente está usando.
  const ativo: PresetDaAudiencia =
    periodo.preset === 'sessao' && !temCaixaAberto ? 'hoje' : periodo.preset;

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
      {opcoes.map((p) => (
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
          className={cn(
            'rounded-full px-3 py-1.5 text-xs font-bold transition-colors',
            ativo === p.id ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
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

const ROTULOS: Record<EstadoVisitante, { texto: string; classe: string }> = {
  abandonou: { texto: 'Carrinho parado', classe: 'bg-amber-100 text-amber-800' },
  comprou: { texto: 'Fechou pedido', classe: 'bg-emerald-100 text-emerald-800' },
  olhou: { texto: 'Olhou produtos', classe: 'bg-sky-100 text-sky-800' },
  passou: { texto: 'Só passou', classe: 'bg-slate-100 text-slate-600' },
};

function CartaoDeVisitante({
  visitante,
  cliente,
  inicioMs,
  loadPhoto,
  aberto,
  onAlternar,
  emDestaque,
}: {
  visitante: Visitante;
  cliente: any | null;
  inicioMs: number;
  loadPhoto: (phone: string) => Promise<string | null>;
  aberto: boolean;
  onAlternar: () => void;
  emDestaque?: boolean;
}) {
  const estado = estadoDoVisitante(visitante, inicioMs);
  const rotulo = ROTULOS[estado];
  const identificado = ehIdentificado(visitante);
  const nome = visitante.nome || cliente?.nome || '';
  const telefone = normalizeCreditPhone(visitante.telefone || cliente?.celular || '');
  const eventos = useMemo(() => eventosDaSessao(visitante, inicioMs), [visitante, inicioMs]);
  const carrinho = visitante.carrinho;
  const ultimaVez = paraMillis(visitante.ultimaVez);
  const jaChamou = chamouNoWhatsapp(visitante);

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border bg-white shadow-sm transition',
        emDestaque ? 'border-amber-200' : 'border-slate-200'
      )}
    >
      <div className="flex items-start gap-3 p-3.5">
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
            <p className="font-bold text-slate-800">{nome || 'Visitante sem cadastro'}</p>
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-black', rotulo.classe)}>{rotulo.texto}</span>
            {jaChamou && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800">
                <WhatsAppIcon className="h-2.5 w-2.5" /> Já te chamou
              </span>
            )}
          </div>

          <p className="mt-0.5 text-xs text-slate-500">
            {telefone ? formatarTelefone(telefone) : 'Sem telefone — não dá para chamar'}
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

          {/* O que ficou na sacola: é a frase que a dona usa no WhatsApp. */}
          {estado === 'abandonou' && carrinho && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {carrinho.itens.slice(0, 4).map((item, i) => (
                <span
                  key={`${item.id}-${i}`}
                  className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900"
                >
                  {item.qtd}× {item.nome}
                </span>
              ))}
              {carrinho.itens.length > 4 && (
                <span className="text-[11px] font-semibold text-slate-400">+{carrinho.itens.length - 4}</span>
              )}
              <span className="text-[11px] font-black text-amber-700">{brl(carrinho.valor)}</span>
            </div>
          )}

          {estado === 'comprou' && (
            <p className="mt-1.5 text-xs font-bold text-emerald-700">
              Pedido fechado{visitante.ultimoPedidoValor ? ` · ${brl(visitante.ultimoPedidoValor)}` : ''}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {telefone && (
            <a
              href={linkDoWhatsApp(telefone, nome, estado, carrinho?.valor)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-2.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-600"
            >
              <WhatsAppIcon className="h-3.5 w-3.5" />
              {jaChamou ? 'Responder' : 'Chamar'}
            </a>
          )}
          <button
            type="button"
            onClick={onAlternar}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-500 transition hover:bg-slate-100"
          >
            Detalhes
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', aberto && 'rotate-180')} />
          </button>
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
