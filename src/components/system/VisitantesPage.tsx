'use client';

import React, { useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ChevronDown,
  Eye,
  Loader2,
  MousePointerClick,
  Receipt,
  ShoppingBag,
  Store,
  Users,
} from 'lucide-react';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { usePdvAccess } from '@/contexts/PdvAccessContext';
import {
  canAccessRetaguarda,
  EMPTY_OPERATOR_RETAGUARDA_PERMISSIONS,
} from '@/lib/user-permissions';
import { useCaixaAbertoEm } from '@/hooks/useCaixaAbertoEm';
import { usePublicAudience } from '@/hooks/usePublicAudience';
import { useVisitantesDaLoja } from '@/hooks/useVisitantesDaLoja';
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
 * Tudo é da sessão de caixa aberta: fora dela não existe "hoje" para comparar.
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
  const { visitantes, carregando, semAcesso } = useVisitantesDaLoja(ownerId, caixaAbertoEm);
  const { online, visitasNaSessao } = usePublicAudience(ownerId, caixaAbertoEm);
  const [aberto, setAberto] = useState<string | null>(null);

  const loadPhoto = useMemo(() => makeProfilePhotoLoader(user, ownerId || ''), [user, ownerId]);
  const inicioMs = caixaAbertoEm?.getTime() ?? 0;

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

  const desde = useMemo(() => {
    if (!caixaAbertoEm) return '';
    const hoje = new Date().toDateString() === caixaAbertoEm.toDateString();
    const hora = caixaAbertoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    // Caixa que passou da meia-noite: sem a data, a dona lê a noite inteira
    // como se fosse só o movimento de hoje.
    if (hoje) return `hoje às ${hora}`;
    return `${caixaAbertoEm.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hora}`;
  }, [caixaAbertoEm]);

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

  if (!caixaAbertoEm) {
    return (
      <Moldura onVoltar={() => router.back()}>
        <Aviso
          titulo="Abra o caixa para acompanhar"
          texto="Quem passou no cardápio é contado a partir da abertura do caixa. Com o caixa fechado não há período para comparar."
        />
      </Moldura>
    );
  }

  return (
    <Moldura onVoltar={() => router.back()} desde={desde}>
      {/* Números do período. "Visitas" e "pessoas" são coisas diferentes de
          propósito: a mesma pessoa abrindo o link duas vezes conta duas visitas
          e uma pessoa só. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Numero titulo="Visitas" valor={visitasNaSessao ?? 0} icone={<MousePointerClick className="h-4 w-4" />} />
        <Numero titulo="Pessoas" valor={resumo.pessoas} icone={<Users className="h-4 w-4" />} detalhe={`${resumo.identificadas} com cadastro`} />
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
        </p>

        {oportunidades.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
            Ninguém deixou carrinho parado até agora.
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
            ? 'Ninguém abriu o cardápio nesta sessão de caixa.'
            : `${resumo.pessoas} ${resumo.pessoas === 1 ? 'pessoa' : 'pessoas'} desde ${desde}.`}
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

function Moldura({
  children,
  onVoltar,
  desde,
}: {
  children: React.ReactNode;
  onVoltar: () => void;
  desde?: string;
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
              {desde ? `Desde a abertura do caixa, ${desde}.` : 'Movimento do cardápio da loja.'}
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
  valor: number;
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
