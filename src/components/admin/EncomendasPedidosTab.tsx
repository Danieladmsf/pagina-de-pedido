'use client';

import React, { useMemo, useState } from 'react';
import type { RegistrarLancamento } from '@/hooks/useCaixa';
import { collection, query, where, doc, updateDoc } from 'firebase/firestore';
import { useCollection, useMemoFirebase } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Encomenda, EncomendaStatus, ENCOMENDA_STATUS_LABEL } from '@/lib/encomendas/types';
import { printEncomendaReceipt } from '@/lib/encomendas/receipt';
import { saldoAReceber, valorRecebido } from '@/lib/encomendas/pagamento';
import { idDoLancamentoDeEncomenda } from '@/lib/encomendas/lancamento-id';
import { buildEncomendaConfig } from '@/lib/encomendas/config';
import { EncomendaBalcaoPage, type EncomendaBalcaoResult } from '@/components/admin/EncomendaBalcaoPage';
import { FechamentoModal } from '@/components/admin/fechamento/FechamentoModal';
import { useFechamento } from '@/components/admin/fechamento/useFechamento';
import { resolveFormasPagamento } from '@/components/admin/fechamento/payment-methods';
import { registrarPagamentoSplits, resolveContaCasa } from '@/lib/payments';
import { CalendarDays, Store, Bike, MessageCircle, Printer, Pencil, Package, Loader2, MapPin, Paperclip, ImageIcon, Banknote, Plus } from 'lucide-react';
import { can, type PdvPermissions } from '@/lib/pdv-permissions';
import { usePdvAccess } from '@/contexts/PdvAccessContext';
import { brl, normalizeSearch } from '@/lib/utils';
import { ContactAvatar } from '@/components/shared/ContactAvatar';
import { makeProfilePhotoLoader } from '@/lib/wapi/profile-photo';
import { syncCustomerFromOrder } from '@/lib/customers/customer-sync';

const formatDateBR = (iso?: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
};
const ALL_STATUS: EncomendaStatus[] = ['orcamento', 'confirmada', 'producao', 'pronta', 'entregue', 'cancelada'];
const STATUS_STYLE: Record<EncomendaStatus, string> = {
  orcamento: 'bg-amber-100 text-amber-800 border-amber-200',
  confirmada: 'bg-blue-100 text-blue-800 border-blue-200',
  producao: 'bg-purple-100 text-purple-800 border-purple-200',
  pronta: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  entregue: 'bg-slate-100 text-slate-600 border-slate-200',
  cancelada: 'bg-red-100 text-red-700 border-red-200',
};
function waLink(phoneDigits: string) {
  const d = (phoneDigits || '').replace(/\D/g, '');
  return `https://wa.me/${d.startsWith('55') ? d : `55${d}`}`;
}
export function EncomendasPedidosTab({ db, user, storeProfile, registrarLancamento, caixaAberto = false, permissions }: {
  db: any; user: any; storeProfile: any;
  registrarLancamento?: RegistrarLancamento;
  caixaAberto?: boolean;
  permissions: PdvPermissions;
}) {
  const { ownerId } = usePdvAccess();
  const { toast } = useToast();
  const permissionsRef = React.useRef(permissions);
  permissionsRef.current = permissions;
  const allowStatus = can(permissions, 'actions.encomendas_pedidos.mudarStatus');
  const allowEdit = can(permissions, 'actions.encomendas_pedidos.editarEncomenda');
  const allowSignal = can(permissions, 'actions.encomendas_pedidos.lancarSinal');
  const allowReprint = can(permissions, 'actions.encomendas_pedidos.reimprimir');
  const notifyPermissionRemoved = () => toast({
    variant: 'destructive',
    title: 'Permissão removida pelo administrador',
  });
  const [filter, setFilter] = useState<'todas' | EncomendaStatus>('todas');
  const [busca, setBusca] = useState('');
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null);
  const [editing, setEditing] = useState<(Encomenda & { id: string }) | null>(null);
  const [lancandoId, setLancandoId] = useState<string | null>(null);
  // Encomendas com lançamento em voo. É um ref, e não estado, porque a trava
  // precisa valer no MESMO clique: o React só reflete o estado no próximo
  // render, e o segundo clique acontece antes disso.
  const lancandoRef = React.useRef<Set<string>>(new Set());
  const loadPhoto = useMemo(() => makeProfilePhotoLoader(user, ownerId), [ownerId, user]);
  const [novaAberta, setNovaAberta] = useState(false);
  // Encomenda que está sendo entregue: abre o mesmo fechamento dos pedidos.
  const [entregando, setEntregando] = useState<(Encomenda & { id: string }) | null>(null);
  const [finalizandoEntrega, setFinalizandoEntrega] = useState(false);

  const config = useMemo(() => buildEncomendaConfig(storeProfile), [storeProfile]);
  // Prazo fica de fora da criação (lá é dinheiro entrando na hora); na entrega
  // ele vale, e o fechamento centralizado já sabe lançar a dívida.
  const formasBalcao = useMemo(
    () => resolveFormasPagamento(storeProfile).filter((f) => f.id !== 'conta_casa'),
    [storeProfile],
  );

  const saldoEntrega = entregando ? saldoAReceber(entregando) : 0;
  const fechamento = useFechamento({
    subtotal: saldoEntrega,
    formasPagamento: resolveFormasPagamento(storeProfile),
    allowAdjustments: false,
    allowPrazo: allowSignal,
  });

  const encomendasQuery = useMemoFirebase(() => {
    if (!db || !ownerId) return null;
    return query(collection(db, 'encomendas'), where('ownerId', '==', ownerId));
  }, [db, ownerId]);
  const { data: encomendasRaw, isLoading } = useCollection<Encomenda>(encomendasQuery);

  const encomendas = useMemo(() => {
    let list = (encomendasRaw || []).slice().sort((a, b) => (b.orderDateTime || '').localeCompare(a.orderDateTime || ''));
    if (filter !== 'todas') list = list.filter((e) => (e.status || 'orcamento') === filter);
    const termo = normalizeSearch(busca.trim());
    if (termo) {
      const digitos = busca.replace(/\D/g, '');
      list = list.filter((e) =>
        normalizeSearch(e.customerName || '').includes(termo)
        || normalizeSearch(e.id || '').includes(termo)
        || (!!digitos && (e.customerPhone || '').replace(/\D/g, '').includes(digitos)));
    }
    return list;
  }, [encomendasRaw, filter, busca]);

  const selecionada = useMemo(
    () => encomendas.find((e) => e.id === selecionadaId) || null,
    [encomendas, selecionadaId],
  );

  async function ensureEncomendaClienteId(enc: Encomenda & { id: string }) {
    // Operadores não escrevem no cadastro de clientes. O dono resolve a
    // identidade na primeira ação administrativa sobre a encomenda; o helper
    // também grava o vínculo no documento sem remover o fallback textual.
    if (!db || !ownerId || user?.uid !== ownerId) return enc.clienteId || null;
    try {
      const result = await syncCustomerFromOrder(db, enc, {
        ownerId,
        countOrder: false,
        linkCollection: 'encomendas',
        allowArchivedCustomer: false,
      });
      return result.customerId;
    } catch (error) {
      console.warn('[encomendas] não foi possível vincular clienteId:', error);
      return null;
    }
  }

  // Quanto a loja ainda tem para receber no que está na lista — é o número que
  // some quando encomenda fica pela metade.
  const totalAReceber = useMemo(
    () => encomendas
      .filter((e) => (e.status || 'orcamento') !== 'cancelada')
      .reduce((soma, e) => soma + saldoAReceber(e), 0),
    [encomendas],
  );

  // Lança o sinal (PIX) como venda no caixa aberto. Idempotente: marca
  // sinalLancado no doc e nunca lança duas vezes. Título SEM "#" de propósito —
  // o card de venda do caixa casa "#XXXXX" com a coleção orders (prefixo de 5
  // chars), e o id da encomenda não está lá; sem # não há falso vínculo.
  async function lancarSinal(enc: Encomenda & { id: string }): Promise<boolean> {
    if (!can(permissionsRef.current, 'actions.encomendas_pedidos.lancarSinal')) {
      notifyPermissionRemoved();
      return false;
    }
    if (!registrarLancamento || enc.sinalLancado || !(enc.sinal > 0)) return false;
    if (!caixaAberto) {
      toast({ variant: 'destructive', title: 'Caixa fechado', description: 'Abra o caixa e use "Lançar sinal no caixa" no card da encomenda.' });
      return false;
    }
    // Trava síncrona: `sinalLancado` só fica true depois da gravação, e dois
    // cliques seguidos entravam os dois antes disso (ver `lancamento-id`).
    if (lancandoRef.current.has(enc.id)) return false;
    lancandoRef.current.add(enc.id);
    setLancandoId(enc.id);
    try {
      await registrarLancamento(
        {
          tipo: 'venda',
          titulo: `Encomenda ${enc.id.substring(0, 5)} - Sinal (${enc.customerName})`,
          valor: enc.sinal,
          formaPagamento: 'pix',
          encomendaId: enc.id,
        },
        // Id fixo: se dois cliques (ou dois aparelhos) escaparem da trava acima,
        // o segundo reescreve o mesmo lançamento em vez de criar outro.
        { transactionId: idDoLancamentoDeEncomenda(enc.id, 'sinal') },
      );
      await updateDoc(doc(db, 'encomendas', enc.id), {
        sinalLancado: true,
        // `valorPago` é o que diz quanto ainda falta na entrega.
        valorPago: valorRecebido(enc) + enc.sinal,
      });
      toast({ title: 'Sinal lançado no caixa', description: `${brl(enc.sinal)} (PIX) — Encomenda ${enc.id.substring(0, 5)}.` });
      return true;
    } catch (err) {
      console.error('[encomendas] erro ao lançar sinal no caixa:', err);
      toast({ variant: 'destructive', title: 'Erro ao lançar o sinal', description: 'O status foi mantido; tente pelo botão no card.' });
      return false;
    } finally {
      lancandoRef.current.delete(enc.id);
      setLancandoId(null);
    }
  }

  async function changeStatus(enc: Encomenda & { id: string }, status: EncomendaStatus) {
    if (!can(permissionsRef.current, 'actions.encomendas_pedidos.mudarStatus')) {
      notifyPermissionRemoved();
      return;
    }
    // Entregar com dinheiro a receber abre o fechamento (igual ao Delivery). É
    // o que faltava: antes o saldo da encomenda simplesmente nunca entrava.
    // Com o caixa fechado a entrega acontece do mesmo jeito (a cliente está lá
    // na porta), mas o recebimento fica pendente no card — inventar que o
    // dinheiro entrou seria pior do que a pendência.
    const falta = saldoAReceber(enc);
    const podeReceber = can(permissionsRef.current, 'actions.encomendas_pedidos.lancarSinal');
    if (status === 'entregue' && falta > 0 && podeReceber && caixaAberto && registrarLancamento) {
      fechamento.reset();
      setEntregando(enc);
      return;
    }
    try {
      await ensureEncomendaClienteId(enc);
      await updateDoc(doc(db, 'encomendas', enc.id), { status });
      if (status === 'entregue' && falta > 0) {
        toast({
          variant: 'destructive',
          title: `Falta receber ${brl(falta)}`,
          description: caixaAberto
            ? 'Use o botão "Receber" no card da encomenda.'
            : 'O caixa está fechado. Abra o caixa e use "Receber" no card da encomenda.',
        });
      }
      // Confirmar = sinal pago → registra no caixa (se ainda não registrado).
      if (status === 'confirmada' && can(permissionsRef.current, 'actions.encomendas_pedidos.lancarSinal')) {
        await lancarSinal(enc);
      }
    } catch (err) {
      console.error('[encomendas] erro ao atualizar status:', err);
      toast({ variant: 'destructive', title: 'Erro ao atualizar status' });
    }
  }

  /**
   * Encomenda nova tirada no balcão: o formulário já gravou o documento, aqui
   * entra o dinheiro no caixa e sai o cupom para a cliente.
   */
  async function encomendaCriadaNoBalcao({ id, enc, pago }: EncomendaBalcaoResult) {
    setNovaAberta(false);
    // Volta para a lista já com a encomenda nova aberta no detalhe.
    setSelecionadaId(id);
    toast({ title: 'Encomenda registrada!', description: `${enc.customerName} · ${brl(enc.total)} · retirada ${formatDateBR(enc.delivery?.date)}.` });

    // O formulário só deixa receber com o caixa aberto, então aqui é lançar.
    if (pago.valor > 0 && registrarLancamento) {
      try {
        await registrarLancamento(
          {
            tipo: 'venda',
            titulo: `Encomenda ${id.substring(0, 5)} - Entrada (${enc.customerName})`,
            valor: pago.valor,
            formaPagamento: pago.forma,
            encomendaId: id,
          },
          // Mesma trava do sinal: a entrada acontece uma vez por encomenda, e
          // com id fixo um clique repetido reescreve em vez de duplicar.
          { transactionId: idDoLancamentoDeEncomenda(id, 'entrada') },
        );
      } catch (err) {
        console.error('[encomendas] erro ao lançar a entrada no caixa:', err);
        toast({ variant: 'destructive', title: 'Erro ao lançar no caixa', description: 'A encomenda foi salva; lance a entrada pelo card.' });
      }
    }

    if (can(permissionsRef.current, 'actions.encomendas_pedidos.reimprimir')) {
      printEncomendaReceipt({ enc: { ...enc, id }, storeInfo: storeProfile });
    }
  }

  /** Voltou da edição: só avisa. Dinheiro não se mexe aqui. */
  async function encomendaEditada({ id, enc }: EncomendaBalcaoResult) {
    setEditing(null);
    setSelecionadaId(id);
    const falta = Math.max(0, enc.total - valorRecebido(enc));
    toast({
      title: 'Encomenda atualizada!',
      description: falta > 0
        ? `Novo total ${brl(enc.total)} · falta receber ${brl(falta)}. Reimprima o cupom se já tinha entregue um.`
        : `Novo total ${brl(enc.total)} · já está paga. Reimprima o cupom se já tinha entregue um.`,
    });
  }

  /** Fechamento da entrega: recebe o que falta e marca como entregue. */
  async function confirmarEntrega() {
    if (!entregando) return;
    if (!can(permissionsRef.current, 'actions.encomendas_pedidos.lancarSinal')) {
      notifyPermissionRemoved();
      return;
    }
    if (!caixaAberto || !registrarLancamento) {
      toast({ variant: 'destructive', title: 'Caixa fechado', description: 'Abra o caixa para receber o valor da entrega.' });
      return;
    }
    setFinalizandoEntrega(true);
    try {
      const { splitsToProcess, finalTotal } = fechamento.buildCheckout();

      const contaCasa = await resolveContaCasa(db, {
        splits: splitsToProcess,
        ownerId,
        phone: entregando.customerPhone || '',
        includePending: false,
      });
      if (contaCasa.kind === 'register') {
        toast({
          variant: 'destructive',
          title: 'Cliente sem cadastro no Prazo',
          description: 'Cadastre a cliente na aba Clientes (com telefone) para fechar esta encomenda no Prazo.',
        });
        return;
      }
      if (contaCasa.kind === 'blocked') {
        toast({ variant: 'destructive', title: 'Prazo bloqueado', description: contaCasa.message });
        return;
      }

      // Dinheiro primeiro, status depois: se a gravação do caixa falhar, a
      // encomenda continua "pronta" e a operadora tenta de novo.
      await registrarPagamentoSplits(db, {
        splits: splitsToProcess,
        contaCasaCustomerId: contaCasa.kind === 'ok' ? contaCasa.customerId : null,
        registrarLancamento,
        caixaAberto,
        tituloVenda: `Encomenda ${entregando.id.substring(0, 5)} - Entrega (${entregando.customerName})`,
        tituloPrazo: `Encomenda ${entregando.id.substring(0, 5)} - Entrega (${entregando.customerName}) (Prazo)`,
        creditDescription: `Encomenda ${entregando.id.substring(0, 5)}`,
        // Sem isto a compra a prazo de uma encomenda nunca abriria no extrato: a
        // descrição não tem "#" e a encomenda nem mora em `orders`.
        encomendaId: entregando.id,
        channel: 'encomenda',
        onContaCasaSemCliente: () => toast({ variant: 'destructive', title: 'Aviso', description: 'Prazo: cliente não encontrado para lançar a dívida.' }),
      });

      await updateDoc(doc(db, 'encomendas', entregando.id), {
        status: 'entregue',
        valorPago: valorRecebido(entregando) + finalTotal,
      });

      toast({ title: 'Encomenda entregue!', description: `${brl(finalTotal)} recebidos na entrega.` });
      setEntregando(null);
      fechamento.reset();
    } catch (err: any) {
      console.error('[encomendas] erro ao fechar a entrega:', err);
      toast({ variant: 'destructive', title: 'Erro ao fechar a entrega', description: err?.message || 'Tente novamente.' });
    } finally {
      setFinalizandoEntrega(false);
    }
  }

  function openEdit(enc: Encomenda & { id: string }) {
    if (!can(permissionsRef.current, 'actions.encomendas_pedidos.editarEncomenda')) {
      notifyPermissionRemoved();
      return;
    }
    setEditing(enc);
  }

  function reprint(enc: Encomenda & { id: string }) {
    if (!can(permissionsRef.current, 'actions.encomendas_pedidos.reimprimir')) {
      notifyPermissionRemoved();
      return;
    }
    printEncomendaReceipt({ enc, storeInfo: storeProfile });
  }

  // Criar e EDITAR usam a mesma tela cheia: no balcão, "editar" quase sempre é
  // a cliente pedindo para incluir ou tirar item — coisa que o antigo modal de
  // edição leve não fazia.
  if (novaAberta || editing) {
    return (
      <div className="flex-1 overflow-hidden px-4 md:px-6">
        <EncomendaBalcaoPage
          key={editing?.id || 'nova'}
          db={db}
          user={user}
          ownerId={ownerId}
          config={config}
          caixaAberto={caixaAberto && !!registrarLancamento}
          formasPagamento={formasBalcao}
          encomenda={editing}
          onCancel={() => { setNovaAberta(false); setEditing(null); }}
          onSaved={editing ? encomendaEditada : encomendaCriadaNoBalcao}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-6">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-bold"><Package className="h-6 w-6 text-primary" /> Pedidos de encomenda</h2>
        {allowEdit && (
          <Button onClick={() => setNovaAberta(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Nova encomenda
          </Button>
        )}
      </div>

      {/* Lista à esquerda, encomenda aberta à direita — mesma divisão do Delivery. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden md:flex-row">
        <div className="flex h-full w-full flex-col gap-2 rounded-xl border bg-muted/30 p-2 md:w-1/3">
          <Input
            placeholder="Cliente, telefone ou nº"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-9 bg-white text-sm"
          />

          <div className="flex flex-wrap gap-1">
            {(['todas', ...ALL_STATUS] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold transition-colors ${filter === s ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:border-primary/40'}`}
              >
                {s === 'todas' ? 'Todas' : ENCOMENDA_STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          <div className="custom-scrollbar flex-1 space-y-1.5 overflow-y-auto pr-1">
            {isLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
            ) : encomendas.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <Package className="mx-auto mb-2 h-7 w-7 opacity-40" />
                Nenhuma encomenda {filter === 'todas' && !busca.trim() ? 'ainda' : 'com esse filtro'}.
              </div>
            ) : (
              encomendas.map((e) => (
                <EncomendaLinha
                  key={e.id}
                  enc={e}
                  selecionada={selecionadaId === e.id}
                  loadPhoto={loadPhoto}
                  onSelecionar={() => setSelecionadaId(e.id)}
                />
              ))
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-white px-3 py-2 text-xs font-bold shrink-0">
            <span className="text-slate-500">{encomendas.length} na lista</span>
            {totalAReceber > 0 && (
              <span className="rounded-md bg-amber-500 px-2.5 py-1 text-white">A receber {brl(totalAReceber)}</span>
            )}
          </div>
        </div>

        <div className="custom-scrollbar h-full w-full overflow-y-auto rounded-xl border bg-white p-4 shadow-sm md:w-2/3">
          {!selecionada ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Package className="h-10 w-10 text-slate-300" />
              <p className="text-sm">Selecione uma encomenda para ver os detalhes</p>
            </div>
          ) : (
            <EncomendaDetalhe
              enc={selecionada}
              allowStatus={allowStatus}
              allowEdit={allowEdit}
              allowReprint={allowReprint}
              canLancarSinal={allowSignal && !!registrarLancamento && caixaAberto}
              lancando={lancandoId === selecionada.id}
              onStatus={(s) => changeStatus(selecionada, s)}
              onEdit={() => openEdit(selecionada)}
              onPrint={() => reprint(selecionada)}
              onLancarSinal={() => lancarSinal(selecionada)}
              onReceber={() => { fechamento.reset(); setEntregando(selecionada); }}
            />
          )}
        </div>
      </div>

      {/* Entrega: mesmo modal de pagamento dos pedidos, já com o que falta. */}
      <FechamentoModal
        open={!!entregando}
        onOpenChange={(open) => { if (!open) { setEntregando(null); fechamento.reset(); } }}
        fechamento={fechamento}
        title="Receber na entrega"
        subtitle={entregando ? `Encomenda ${entregando.id.substring(0, 5)} · ${entregando.customerName}` : undefined}
        confirmLabel="✅ Receber e entregar"
        caixaAberto={caixaAberto}
        isSubmitting={finalizandoEntrega}
        prazoCustomer={{ name: entregando?.customerName, phone: entregando?.customerPhone }}
        warnings={entregando && valorRecebido(entregando) > 0 ? (
          <span className="mt-1 block text-emerald-600">
            Já recebido nesta encomenda: {brl(valorRecebido(entregando))} de {brl(entregando.total)}.
          </span>
        ) : undefined}
        onConfirm={confirmarEntrega}
      />
    </div>
  );
}

/** Linha da lista: o essencial para achar a encomenda e ver se falta dinheiro. */
function EncomendaLinha({ enc, selecionada, loadPhoto, onSelecionar }: {
  enc: Encomenda & { id: string };
  selecionada: boolean;
  loadPhoto: (phone: string) => Promise<string | null>;
  onSelecionar: () => void;
}) {
  const status = (enc.status || 'orcamento') as EncomendaStatus;
  const falta = saldoAReceber(enc);
  const borda = status === 'cancelada' ? 'border-l-red-500'
    : status === 'entregue' ? 'border-l-slate-300'
    : status === 'pronta' ? 'border-l-emerald-500'
    : status === 'producao' ? 'border-l-purple-500'
    : status === 'confirmada' ? 'border-l-blue-500'
    : 'border-l-amber-500';

  return (
    <button
      type="button"
      onClick={onSelecionar}
      className={`w-full rounded-r border-l-4 bg-white px-2 py-1.5 text-left transition-colors hover:bg-slate-50 ${borda} ${selecionada ? 'bg-blue-50 ring-1 ring-primary/50' : ''}`}
    >
      <div className="flex items-center gap-2">
        <ContactAvatar
          phone={enc.customerPhone || ''}
          initials={(enc.customerName || '?').split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
          loadPhoto={loadPhoto}
          className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-fuchsia-400 to-purple-500 text-[10px] font-bold text-white"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="whitespace-nowrap font-mono text-[10px] text-muted-foreground">#{enc.id.substring(0, 5)}</span>
              <span className="truncate text-xs font-semibold text-slate-800">{enc.customerName}</span>
            </div>
            <span className="shrink-0 text-xs font-black text-slate-700">{brl(enc.total)}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className={`rounded-full border px-1.5 text-[9px] font-bold uppercase leading-4 ${STATUS_STYLE[status]}`}>
              {ENCOMENDA_STATUS_LABEL[status]}
            </span>
            <span className="text-[10px] text-slate-400">
              {enc.delivery?.type === 'delivery' ? 'entrega' : 'retirada'} {formatDateBR(enc.delivery?.date)} {enc.delivery?.time || ''}
            </span>
            {falta > 0 && status !== 'cancelada' && (
              <span className="ml-auto shrink-0 text-[10px] font-bold text-amber-600">falta {brl(falta)}</span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

/** Ordem das etapas — a trilha do detalhe segue esta sequência. */
const TRILHA: EncomendaStatus[] = ['orcamento', 'confirmada', 'producao', 'pronta', 'entregue'];

/** Encomenda aberta: etapas, dinheiro, itens e entrega. */
function EncomendaDetalhe({ enc, allowStatus, allowEdit, allowReprint, canLancarSinal, lancando, onStatus, onEdit, onPrint, onLancarSinal, onReceber }: {
  enc: Encomenda & { id: string };
  allowStatus: boolean;
  allowEdit: boolean;
  allowReprint: boolean;
  canLancarSinal: boolean;
  lancando: boolean;
  onStatus: (s: EncomendaStatus) => void;
  onEdit: () => void;
  onPrint: () => void;
  onLancarSinal: () => void;
  onReceber: () => void;
}) {
  const status = (enc.status || 'orcamento') as EncomendaStatus;
  const recebido = valorRecebido(enc);
  const falta = saldoAReceber(enc);
  const etapaAtual = TRILHA.indexOf(status);
  const cancelada = status === 'cancelada';
  const sinalPendente = canLancarSinal && !enc.sinalLancado && enc.sinal > 0 && !['orcamento', 'cancelada'].includes(status);
  const receberPendente = canLancarSinal && falta > 0 && ['pronta', 'entregue'].includes(status);
  const linhas = [...(enc.especialItems || []), ...(enc.tortasItems || []), ...(enc.docinhosItems || [])];

  return (
    <div className="flex flex-col gap-3">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-2">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-800">
            Encomenda #{enc.id.substring(0, 5)}
            <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">{enc.id}</span>
          </h2>
          <p className="text-sm font-semibold text-slate-700">{enc.customerName}</p>
          <a href={waLink(enc.customerPhone)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline">
            <MessageCircle className="h-3.5 w-3.5" /> {enc.customerPhone}
          </a>
        </div>
        <div className="flex items-center gap-2">
          {allowEdit && (
            <Button size="icon" variant="outline" className="h-8 w-8" title="Editar" onClick={onEdit}>
              <Pencil className="h-4 w-4 text-amber-500" />
            </Button>
          )}
          {allowReprint && (
            <Button size="icon" className="h-8 w-8 bg-blue-500 text-white hover:bg-blue-600" title="Reimprimir" onClick={onPrint}>
              <Printer className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Trilha das etapas (clicável, igual à do Delivery) */}
      {allowStatus && (
        <div className="flex items-center gap-1 rounded-lg bg-slate-50 px-1 py-1.5">
          {TRILHA.map((etapa, i) => {
            const cumprida = !cancelada && etapaAtual >= i;
            return (
              <button
                key={etapa}
                onClick={() => onStatus(etapa)}
                disabled={cancelada}
                className={`flex flex-1 items-center justify-center gap-1 rounded py-1 text-[10px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${cumprida ? 'bg-teal-500 text-white' : 'border bg-white text-slate-500 hover:bg-teal-50'}`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${cumprida ? 'bg-white' : 'bg-slate-300'}`} />
                {ENCOMENDA_STATUS_LABEL[etapa]}
              </button>
            );
          })}
          <button
            onClick={() => onStatus('cancelada')}
            disabled={cancelada}
            className={`flex items-center justify-center rounded px-2 py-1 text-[10px] font-bold transition-colors disabled:opacity-60 ${cancelada ? 'bg-red-500 text-white' : 'border border-red-200 bg-white text-red-500 hover:bg-red-50'}`}
            title="Cancelar encomenda"
          >
            ✕
          </button>
        </div>
      )}

      {/* Dinheiro */}
      <div className="rounded-xl border bg-slate-50/70 p-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex gap-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total</p>
              <p className="text-xl font-black leading-tight text-slate-800">{brl(enc.total)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Recebido</p>
              <p className="text-xl font-black leading-tight text-emerald-600">{brl(recebido)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Falta</p>
              <p className={`text-xl font-black leading-tight ${falta > 0 ? 'text-amber-600' : 'text-slate-300'}`}>{brl(falta)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {sinalPendente && (
              <Button size="sm" onClick={onLancarSinal} disabled={lancando} className="bg-emerald-600 text-white hover:bg-emerald-700">
                {lancando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Banknote className="mr-1 h-3.5 w-3.5" />}
                Lançar entrada {brl(enc.sinal)}
              </Button>
            )}
            {receberPendente && (
              <Button size="sm" onClick={onReceber} className="bg-emerald-600 text-white hover:bg-emerald-700">
                <Banknote className="mr-1 h-3.5 w-3.5" /> Receber {brl(falta)}
              </Button>
            )}
          </div>
        </div>
        {falta === 0 && !cancelada && <p className="mt-1 text-[11px] font-semibold text-emerald-600">Paga por inteiro ✓</p>}
      </div>

      {/* Itens */}
      <div className="rounded-xl border">
        <p className="border-b bg-slate-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Itens</p>
        <div className="space-y-1 p-3 text-sm">
          {enc.bolo && (
            <div className="flex justify-between gap-3">
              <span className="min-w-0 text-slate-700">
                Bolo {enc.bolo.weight || enc.bolo.size}{(enc.bolo.flavor || enc.bolo.filling) ? ` · ${enc.bolo.flavor || enc.bolo.filling}` : ''}
                <span className="block text-[11px] text-slate-400">
                  {[enc.bolo.shape, enc.bolo.dough, enc.bolo.cover, ...(enc.bolo.extras || []).map((x) => x.name)].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-slate-700">{brl(enc.bolo.total)}</span>
            </div>
          )}
          {linhas.map((l) => (
            <div key={l.id} className="flex justify-between gap-3">
              <span className="min-w-0 truncate text-slate-700">{l.qty}× {l.name}</span>
              <span className="shrink-0 font-semibold tabular-nums text-slate-700">{brl(l.total)}</span>
            </div>
          ))}
          {enc.deliveryFee > 0 && (
            <div className="flex justify-between gap-3 border-t border-dashed pt-1 text-slate-500">
              <span>Taxa de entrega</span>
              <span className="tabular-nums">{brl(enc.deliveryFee)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Entrega */}
      <div className="rounded-xl border">
        <p className="border-b bg-slate-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          {enc.delivery?.type === 'delivery' ? 'Entrega' : 'Retirada'}
        </p>
        <div className="space-y-1 p-3 text-sm text-slate-600">
          <p className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-slate-400" />
            <span className="font-semibold text-slate-800">{formatDateBR(enc.delivery?.date)}</span>
            {enc.delivery?.time && <span>às {enc.delivery.time}</span>}
            <span className="flex items-center gap-1 text-slate-400">
              {enc.delivery?.type === 'delivery' ? <><Bike className="h-3.5 w-3.5" /> Entrega</> : <><Store className="h-3.5 w-3.5" /> Retirada</>}
            </span>
          </p>
          {enc.delivery?.type === 'delivery' && (enc.delivery?.street || enc.delivery?.neighborhood) && (
            <p className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <span>
                {[[enc.delivery.street, enc.delivery.number].filter(Boolean).join(', '), enc.delivery.complement, enc.delivery.neighborhood, enc.delivery.city].filter(Boolean).join(' · ')}
                {enc.delivery.feeStatus === 'a_combinar' && <span className="ml-1 font-semibold text-amber-600">(taxa a combinar)</span>}
              </span>
            </p>
          )}
        </div>
      </div>

      {(enc.orderNotes || enc.comprovanteUrl || enc.bolo?.plate?.imageUrl) && (
        <div className="space-y-2">
          {enc.orderNotes && (
            <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900"><b>Obs.:</b> {enc.orderNotes}</p>
          )}
          <div className="flex flex-wrap gap-4 text-xs">
            {enc.comprovanteUrl && (
              <a href={enc.comprovanteUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-semibold text-primary hover:underline">
                <Paperclip className="h-3.5 w-3.5" /> Comprovante PIX
              </a>
            )}
            {enc.bolo?.plate?.imageUrl && (
              <a href={enc.bolo.plate.imageUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-semibold text-primary hover:underline">
                <ImageIcon className="h-3.5 w-3.5" /> Referência da plaquinha
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
