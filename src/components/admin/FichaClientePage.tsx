'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft, Pencil, Search, ShoppingBag, Wallet, TrendingUp, CalendarDays, Receipt, ChevronDown, Loader2, Ban,
} from 'lucide-react';
import { brl, normalizeSearch } from '@/lib/utils';
import { getPhoneVariants, isCreditEnabled, normalizeCreditPhone } from '@/lib/customer-credit';
import { encomendaComoPedido } from '@/lib/encomendas/pedido';
import { getOrderCode } from '@/lib/order-code';
import {
  foiCancelada, ordenarCompras, resumoDeCompras, rotuloDaForma, rotuloDoCanal,
  type CompraDoCliente,
} from '@/lib/clientes/resumo-compras';
import { PrazoPage } from '@/components/admin/PrazoPage';
import { ContactAvatar } from '@/components/shared/ContactAvatar';
import { makeProfilePhotoLoader } from '@/lib/wapi/profile-photo';
import type { RegistrarLancamento } from '@/hooks/useCaixa';

type PeriodoId = '30' | '90' | 'ano' | 'tudo';
const PERIODOS: { id: PeriodoId; label: string; dias: number | null }[] = [
  { id: '30', label: '30 dias', dias: 30 },
  { id: '90', label: '90 dias', dias: 90 },
  { id: 'ano', label: '12 meses', dias: 365 },
  { id: 'tudo', label: 'Tudo', dias: null },
];

const KpiCard = ({ icon: Icon, label, value, hint, tone = 'slate' }: {
  icon: typeof Wallet; label: string; value: string; hint?: React.ReactNode;
  tone?: 'slate' | 'emerald' | 'indigo' | 'amber';
}) => {
  const tones: Record<string, string> = {
    slate: 'text-slate-700 bg-slate-100',
    emerald: 'text-emerald-600 bg-emerald-100',
    indigo: 'text-indigo-600 bg-indigo-100',
    amber: 'text-amber-600 bg-amber-100',
  };
  return (
    <div className="rounded-2xl border bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      </div>
      <p className="mt-1.5 text-xl font-black tabular-nums text-slate-800">{value}</p>
      {hint && <div className="mt-0.5 text-[11px] font-medium text-slate-500">{hint}</div>}
    </div>
  );
};

/**
 * Ficha do cliente: o prontuário que só existia para quem compra fiado.
 *
 * Duas abas — Compras (todas as formas de pagamento) e Prazo (a `PrazoPage`
 * inteira, sem reescrever nada). Ver docs/PLANO_FICHA_DO_CLIENTE.md.
 */
export function FichaClientePage({ db, user, cliente, onBack, onEditCliente, registrarLancamento, caixaAberto }: {
  db: any;
  user: any;
  cliente: any;
  onBack: () => void;
  onEditCliente?: (cliente: any) => void;
  registrarLancamento?: RegistrarLancamento;
  caixaAberto?: boolean;
}) {
  const ownerId = user?.uid;
  const [aba, setAba] = useState<'compras' | 'prazo'>('compras');
  const [compras, setCompras] = useState<CompraDoCliente[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [periodo, setPeriodo] = useState<PeriodoId>('tudo');
  const [forma, setForma] = useState<string>('todas');
  const [canal, setCanal] = useState<string>('todos');
  const [busca, setBusca] = useState('');
  const [abertaId, setAbertaId] = useState<string | null>(null);

  const loadPhoto = useMemo(() => makeProfilePhotoLoader(user, ownerId), [user, ownerId]);
  const storeProfileRef = useMemoFirebase(
    () => (db && ownerId ? doc(db, 'store_profiles', ownerId) : null), [db, ownerId],
  );
  const { data: storeProfile } = useDoc<any>(storeProfileRef);

  // As compras do cliente por DUAS chaves: o `clienteId` gravado no pedido (o
  // vínculo firme, só nos novos) e o telefone (o legado). A tela conta quantas
  // vieram de cada uma — prometer histórico completo seria mentira enquanto o
  // vínculo antigo for texto. Ver §4 do plano.
  useEffect(() => {
    if (!db || !ownerId || !cliente?.id) { setCompras([]); setCarregando(false); return; }
    let cancelado = false;
    setCarregando(true);

    (async () => {
      const encontrados = new Map<string, CompraDoCliente>();

      const guardar = (id: string, dados: any, vinculo: 'clienteId' | 'telefone') => {
        // O id manda: se a mesma compra veio pelas duas chaves, fica a firme.
        const anterior = encontrados.get(id);
        if (anterior && anterior.vinculo === 'clienteId') return;
        encontrados.set(id, { ...dados, id, vinculo });
      };

      try {
        // 1) Pelo id do cliente — o vínculo firme.
        //
        // O `ownerId` PRECISA estar na consulta, mesmo o clienteId já
        // carregando o dono no próprio id: as regras do Firestore não filtram
        // resultado, elas exigem que a consulta seja provadamente restrita ao
        // que o usuário pode ler. Sem esse filtro a busca volta 403, e a ficha
        // ficava sem nenhuma compra ligada pelo cadastro.
        const porId = await getDocs(query(
          collection(db, 'orders'),
          where('ownerId', '==', ownerId),
          where('clienteId', '==', cliente.id),
        ));
        porId.docs.forEach((d) => guardar(d.id, d.data(), 'clienteId'));
      } catch (err) {
        console.error('[ficha] compras por clienteId:', err);
      }

      try {
        // 2) Pelo telefone (histórico).
        const variantes = getPhoneVariants(cliente?.celular || '').slice(0, 30);
        if (variantes.length > 0) {
          const porTelefone = await getDocs(query(
            collection(db, 'orders'),
            where('ownerId', '==', ownerId),
            where('customerPhone', 'in', variantes),
          ));
          porTelefone.docs.forEach((d) => guardar(d.id, d.data(), 'telefone'));
        }
      } catch (err) {
        console.error('[ficha] compras por telefone:', err);
      }

      // 3) Encomendas (só na confeitaria), lidas como pedido.
      if (storeProfile?.theme === 'confeitaria') {
        try {
          const variantes = getPhoneVariants(cliente?.celular || '').slice(0, 30);
          if (variantes.length > 0) {
            const encs = await getDocs(query(
              collection(db, 'encomendas'),
              where('ownerId', '==', ownerId),
              where('customerPhone', 'in', variantes),
            ));
            encs.docs.forEach((d) => {
              const comoPedido = encomendaComoPedido({ id: d.id, ...d.data() });
              if (comoPedido) {
                guardar(d.id, { ...comoPedido, status: (d.data() as any)?.status }, 'telefone');
              }
            });
          }
        } catch (err) {
          console.error('[ficha] encomendas do cliente:', err);
        }
      }

      if (!cancelado) {
        setCompras(ordenarCompras([...encontrados.values()]));
        setCarregando(false);
      }
    })();

    return () => { cancelado = true; };
  }, [db, ownerId, cliente?.id, cliente?.celular, storeProfile?.theme]);

  const filtradas = useMemo(() => {
    const dias = PERIODOS.find((p) => p.id === periodo)?.dias ?? null;
    const limite = dias ? Date.now() - dias * 24 * 60 * 60 * 1000 : null;
    const termo = normalizeSearch(busca.trim());

    return compras.filter((c) => {
      if (limite) {
        const t = Date.parse(c.orderDateTime || '');
        if (Number.isNaN(t) || t < limite) return false;
      }
      if (forma !== 'todas' && rotuloDaForma(c.paymentMethod) !== forma) return false;
      if (canal !== 'todos' && rotuloDoCanal(c) !== canal) return false;
      if (termo) {
        const itens = (c.items || []).map((i: any) => i?.name).join(' ');
        const alvo = normalizeSearch(`${getOrderCode(c)} ${itens} ${c.paymentMethod || ''}`);
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });
  }, [compras, periodo, forma, canal, busca]);

  const resumo = useMemo(() => resumoDeCompras(filtradas), [filtradas]);
  const resumoGeral = useMemo(() => resumoDeCompras(compras), [compras]);
  const prazoAtivo = isCreditEnabled(cliente);
  const iniciais = (cliente?.nome || '?').split(' ').map((w: string) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  const formasDisponiveis = useMemo(
    () => ['todas', ...resumoGeral.porForma.map((f) => f.chave)], [resumoGeral],
  );
  const canaisDisponiveis = useMemo(
    () => ['todos', ...resumoGeral.porCanal.map((c) => c.chave)], [resumoGeral],
  );

  return (
    <div className="flex h-full min-h-0 w-full max-w-[1400px] mx-auto flex-col gap-4 pt-4 pb-2">
      <header className="shrink-0 px-2">
        <button
          type="button"
          onClick={onBack}
          className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-500 transition-colors hover:text-slate-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar para clientes
        </button>
        <div className="flex flex-wrap items-center gap-3">
          <ContactAvatar
            phone={cliente?.celular || ''}
            initials={iniciais}
            loadPhoto={loadPhoto}
            className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-bold text-white"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-black tracking-tight text-slate-800">{cliente?.nome || 'Cliente'}</h1>
              {prazoAtivo && (
                <Badge variant="secondary" className="border-indigo-200 bg-indigo-50 text-[10px] text-indigo-700">
                  Prazo ativo
                </Badge>
              )}
            </div>
            <p className="text-xs font-medium text-slate-500">
              {cliente?.celular ? normalizeCreditPhone(cliente.celular).replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') : 'Sem celular'}
              {[cliente?.bairro, cliente?.cidade].filter(Boolean).length > 0 && ` · ${[cliente?.bairro, cliente?.cidade].filter(Boolean).join(' - ')}`}
            </p>
          </div>
          {onEditCliente && (
            <button
              type="button"
              onClick={() => onEditCliente(cliente)}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-bold text-amber-700 transition-colors hover:bg-amber-50"
            >
              <Pencil className="h-3.5 w-3.5" /> Cadastro
            </button>
          )}
        </div>

        <div className="mt-3 flex gap-1 border-b">
          {([['compras', 'Compras'], ['prazo', 'Prazo']] as const)
            .filter(([id]) => id === 'compras' || prazoAtivo || resumoGeral.porForma.some((f) => f.chave === 'Prazo'))
            .map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setAba(id)}
                className={`-mb-px border-b-2 px-4 py-2 text-xs font-bold transition-colors ${
                  aba === id
                    ? 'border-indigo-500 text-indigo-700'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                {label}
              </button>
            ))}
        </div>
      </header>

      {aba === 'prazo' ? (
        <PrazoPage
          db={db}
          user={user}
          cliente={cliente}
          onBack={onBack}
          onEditCliente={onEditCliente}
          registrarLancamento={registrarLancamento}
          caixaAberto={caixaAberto}
          semCabecalho
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pb-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              icon={Wallet} tone="emerald" label="Total comprado" value={brl(resumo.total)}
              hint={`${resumo.quantidade} compra${resumo.quantidade === 1 ? '' : 's'}`}
            />
            <KpiCard icon={TrendingUp} tone="indigo" label="Ticket médio" value={brl(resumo.ticketMedio)} />
            <KpiCard
              icon={CalendarDays} label="Última compra"
              value={resumo.ultima ? resumo.ultima.toLocaleDateString('pt-BR') : '—'}
              hint={resumo.primeira ? `Cliente desde ${resumo.primeira.toLocaleDateString('pt-BR')}` : undefined}
            />
            <KpiCard
              icon={ShoppingBag} tone="amber" label="Como costuma pagar"
              value={resumo.porForma[0]?.chave || '—'}
              hint={resumo.porCanal[0] ? `Mais compra em: ${resumo.porCanal[0].chave}` : undefined}
            />
          </div>

          {(resumo.porForma.length > 0 || resumo.topItens.length > 0) && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border bg-white p-3 shadow-sm">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Por forma de pagamento</p>
                <div className="space-y-1">
                  {resumo.porForma.map((f) => (
                    <div key={f.chave} className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700">{f.chave} <span className="text-slate-400">({f.quantidade})</span></span>
                      <span className="font-bold tabular-nums text-slate-600">{brl(f.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border bg-white p-3 shadow-sm">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">O que mais compra</p>
                <div className="space-y-1">
                  {resumo.topItens.length === 0 && <p className="text-xs text-slate-400">Sem itens registrados.</p>}
                  {resumo.topItens.map((i) => (
                    <div key={i.nome} className="flex items-center justify-between text-xs">
                      <span className="truncate font-semibold text-slate-700">{i.quantidade}× {i.nome}</span>
                      <span className="font-bold tabular-nums text-slate-600">{brl(i.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar item, nº do pedido..."
                className="h-8 pl-8 text-xs"
              />
            </div>
            <div className="flex gap-1">
              {PERIODOS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPeriodo(p.id)}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                    periodo === p.id ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <select
              value={forma}
              onChange={(e) => setForma(e.target.value)}
              className="h-8 rounded-lg border bg-white px-2 text-[11px] font-bold text-slate-600"
            >
              {formasDisponiveis.map((f) => (
                <option key={f} value={f}>{f === 'todas' ? 'Todas as formas' : f}</option>
              ))}
            </select>
            <select
              value={canal}
              onChange={(e) => setCanal(e.target.value)}
              className="h-8 rounded-lg border bg-white px-2 text-[11px] font-bold text-slate-600"
            >
              {canaisDisponiveis.map((c) => (
                <option key={c} value={c}>{c === 'todos' ? 'Todos os canais' : c}</option>
              ))}
            </select>
          </div>

          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <span className="text-xs font-bold text-slate-700">
                {carregando ? 'Carregando…' : `${filtradas.length} compra${filtradas.length === 1 ? '' : 's'}`}
              </span>
              {/* A tela diz o que sabe: prometer histórico completo seria mentira
                  enquanto o vínculo antigo for telefone. */}
              {!carregando && resumoGeral.vinculoPorTelefone > 0 && (
                <span className="text-[10px] font-medium text-slate-400">
                  {resumoGeral.vinculoPorId} pelo cadastro · {resumoGeral.vinculoPorTelefone} pelo telefone
                </span>
              )}
            </div>

            {carregando ? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Buscando compras deste cliente…
              </div>
            ) : filtradas.length === 0 ? (
              <p className="py-10 text-center text-xs text-slate-400">
                Nenhuma compra encontrada com estes filtros.
              </p>
            ) : (
              <div className="divide-y">
                {filtradas.map((c) => {
                  const cancelada = foiCancelada(c);
                  const aberta = abertaId === c.id;
                  const itens = c.items || [];
                  const data = c.orderDateTime ? new Date(c.orderDateTime) : null;
                  return (
                    <div key={c.id}>
                      <button
                        type="button"
                        onClick={() => setAbertaId(aberta ? null : c.id)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-50"
                      >
                        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${aberta ? 'rotate-180' : ''}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={`text-xs font-bold ${cancelada ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                              #{getOrderCode(c).substring(0, 8)}
                            </span>
                            <Badge variant="outline" className="h-4 px-1 text-[9px] font-bold uppercase text-slate-500">
                              {rotuloDoCanal(c)}
                            </Badge>
                            <Badge variant="outline" className="h-4 px-1 text-[9px] font-bold uppercase text-slate-500">
                              {rotuloDaForma(c.paymentMethod)}
                            </Badge>
                            {cancelada && (
                              <Badge className="h-4 border border-rose-300 bg-rose-100 px-1 text-[9px] font-bold uppercase text-rose-700">
                                <Ban className="mr-0.5 h-2.5 w-2.5" /> Cancelada
                              </Badge>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400">
                            {data && !Number.isNaN(data.getTime())
                              ? `${data.toLocaleDateString('pt-BR')} ${data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                              : 'sem data'}
                            {itens.length > 0 && ` · ${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`}
                          </p>
                        </div>
                        <span className={`shrink-0 text-sm font-black tabular-nums ${cancelada ? 'text-slate-300 line-through' : 'text-slate-700'}`}>
                          {brl(Number(c.totalAmount) || 0)}
                        </span>
                      </button>

                      {aberta && (
                        <div className="bg-slate-50/70 px-4 pb-3">
                          <div className="space-y-0.5 rounded-lg border bg-white px-3 py-2">
                            {itens.length === 0 && <p className="text-[11px] text-slate-400">Sem itens registrados nesta compra.</p>}
                            {itens.map((item: any, i: number) => (
                              <div key={i}>
                                <div className="flex justify-between text-[11px]">
                                  <span className="text-slate-700">
                                    <span className="font-bold">{Number(item?.quantity) || 0}×</span> {item?.name}
                                  </span>
                                  <span className="tabular-nums text-slate-500">
                                    {brl((Number(item?.unitPrice ?? item?.price) || 0) * (Number(item?.quantity) || 0))}
                                  </span>
                                </div>
                                {(item?.addons || []).map((addon: any, j: number) => (
                                  <p key={j} className="pl-4 text-[10px] text-slate-400">› {addon?.name}</p>
                                ))}
                                {item?.notes && <p className="pl-4 text-[10px] italic text-amber-600">obs: {item.notes}</p>}
                              </div>
                            ))}
                            <div className="mt-1 flex justify-between border-t pt-1 text-[11px] font-bold">
                              <span className="text-slate-600 flex items-center gap-1"><Receipt className="h-3 w-3" /> Total</span>
                              <span className="tabular-nums text-slate-800">{brl(Number(c.totalAmount) || 0)}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
