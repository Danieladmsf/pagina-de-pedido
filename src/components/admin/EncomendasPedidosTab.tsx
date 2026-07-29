'use client';

import React, { useMemo, useState } from 'react';
import { collection, query, where, doc, updateDoc } from 'firebase/firestore';
import { useCollection, useMemoFirebase } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Encomenda, EncomendaStatus, ENCOMENDA_STATUS_LABEL } from '@/lib/encomendas/types';
import { printEncomendaReceipt } from '@/lib/encomendas/receipt';
import { saldoAReceber, valorRecebido } from '@/lib/encomendas/pagamento';
import { buildEncomendaConfig } from '@/lib/encomendas/config';
import { EncomendaBalcaoPage, type EncomendaBalcaoResult } from '@/components/admin/EncomendaBalcaoPage';
import { FechamentoModal } from '@/components/admin/fechamento/FechamentoModal';
import { useFechamento } from '@/components/admin/fechamento/useFechamento';
import { resolveFormasPagamento } from '@/components/admin/fechamento/payment-methods';
import { registrarPagamentoSplits, resolveContaCasa } from '@/lib/payments';
import { CalendarDays, Store, Bike, MessageCircle, Printer, Pencil, Package, Loader2, MapPin, Paperclip, ImageIcon, Banknote, Plus } from 'lucide-react';
import { can, type PdvPermissions } from '@/lib/pdv-permissions';
import { usePdvAccess } from '@/contexts/PdvAccessContext';
import { brl } from '@/lib/utils';

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
function itemsSummary(enc: Encomenda): string[] {
  const out: string[] = [];
  if (enc.bolo) out.push(`Bolo ${enc.bolo.size} · ${enc.bolo.filling}${enc.bolo.cover ? ` · ${enc.bolo.cover}` : ''}${enc.bolo.plate?.on ? ' · c/ plaquinha' : ''}`);
  for (const l of enc.especialItems || []) out.push(`${l.qty}× ${l.name}`);
  for (const l of enc.tortasItems || []) out.push(`${l.qty}× ${l.name}`);
  for (const l of enc.docinhosItems || []) out.push(`${l.qty}× ${l.name}`);
  return out;
}

export function EncomendasPedidosTab({ db, user, storeProfile, registrarLancamento, caixaAberto = false, permissions }: {
  db: any; user: any; storeProfile: any;
  registrarLancamento?: (params: { tipo: 'venda'; titulo: string; valor: number; formaPagamento: string }) => Promise<void>;
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
  const [editing, setEditing] = useState<(Encomenda & { id: string }) | null>(null);
  const [lancandoId, setLancandoId] = useState<string | null>(null);
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
    const list = (encomendasRaw || []).slice().sort((a, b) => (b.orderDateTime || '').localeCompare(a.orderDateTime || ''));
    return filter === 'todas' ? list : list.filter((e) => (e.status || 'orcamento') === filter);
  }, [encomendasRaw, filter]);

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
    setLancandoId(enc.id);
    try {
      await registrarLancamento({
        tipo: 'venda',
        titulo: `Encomenda ${enc.id.substring(0, 5)} - Sinal (${enc.customerName})`,
        valor: enc.sinal,
        formaPagamento: 'pix',
      });
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
    toast({ title: 'Encomenda registrada!', description: `${enc.customerName} · ${brl(enc.total)} · retirada ${formatDateBR(enc.delivery?.date)}.` });

    // O formulário só deixa receber com o caixa aberto, então aqui é lançar.
    if (pago.valor > 0 && registrarLancamento) {
      try {
        await registrarLancamento({
          tipo: 'venda',
          titulo: `Encomenda ${id.substring(0, 5)} - Entrada (${enc.customerName})`,
          valor: pago.valor,
          formaPagamento: pago.forma,
        });
      } catch (err) {
        console.error('[encomendas] erro ao lançar a entrada no caixa:', err);
        toast({ variant: 'destructive', title: 'Erro ao lançar no caixa', description: 'A encomenda foi salva; lance a entrada pelo card.' });
      }
    }

    if (can(permissionsRef.current, 'actions.encomendas_pedidos.reimprimir')) {
      printEncomendaReceipt({ enc: { ...enc, id }, storeInfo: storeProfile });
    }
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

  // Nova encomenda ocupa a aba inteira (é uma TELA da Retaguarda, não um modal
  // com o formulário do cliente espremido dentro).
  if (novaAberta) {
    return (
      <div className="flex-1 overflow-hidden px-4 md:px-6">
        <EncomendaBalcaoPage
          db={db}
          user={user}
          ownerId={ownerId}
          config={config}
          caixaAberto={caixaAberto && !!registrarLancamento}
          formasPagamento={formasBalcao}
          onCancel={() => setNovaAberta(false)}
          onSaved={encomendaCriadaNoBalcao}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-xl font-bold"><Package className="h-6 w-6 text-primary" /> Pedidos de encomenda</h2>
          {allowEdit && (
            <Button
              onClick={() => setNovaAberta(true)}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" /> Nova encomenda
            </Button>
          )}
        </div>

        {/* Filtro por status */}
        <div className="flex flex-wrap gap-1.5">
          {(['todas', ...ALL_STATUS] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${filter === s ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:border-primary/40'}`}
            >
              {s === 'todas' ? 'Todas' : ENCOMENDA_STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Carregando…</div>
        ) : encomendas.length === 0 ? (
          <div className="rounded-xl border bg-card py-12 text-center text-muted-foreground">
            <Package className="mx-auto mb-2 h-8 w-8 opacity-40" />
            <p>Nenhuma encomenda {filter === 'todas' ? 'ainda' : `com status "${ENCOMENDA_STATUS_LABEL[filter as EncomendaStatus]}"`}.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {encomendas.map((e) => (
              <PedidoCard
                key={e.id}
                enc={e}
                onStatus={(s) => changeStatus(e, s)}
                onEdit={() => openEdit(e)}
                onPrint={() => reprint(e)}
                allowStatus={allowStatus}
                allowEdit={allowEdit}
                canLancarSinal={allowSignal && !!registrarLancamento && caixaAberto}
                allowReprint={allowReprint}
                lancando={lancandoId === e.id}
                onLancarSinal={() => lancarSinal(e)}
                onReceber={() => { fechamento.reset(); setEntregando(e); }}
              />
            ))}
          </div>
        )}
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

      {editing && (
        <EditEncomendaDialog
          db={db}
          enc={editing}
          permissions={permissions}
          onClose={() => setEditing(null)}
          onSaved={(status) => {
            const edited = editing;
            setEditing(null);
            if (status === 'confirmada' && (edited.status || 'orcamento') !== 'confirmada' && can(permissionsRef.current, 'actions.encomendas_pedidos.lancarSinal')) {
              void lancarSinal(edited);
              return;
            }
            // Marcar "Entregue" pela tela de edição é a mesma entrega do card:
            // se ainda falta receber, o fechamento tem que abrir igual.
            if (status === 'entregue' && saldoAReceber(edited) > 0
              && can(permissionsRef.current, 'actions.encomendas_pedidos.lancarSinal')) {
              fechamento.reset();
              setEntregando({ ...edited, status });
            }
          }}
        />
      )}
    </div>
  );
}

function PedidoCard({ enc, onStatus, onEdit, onPrint, allowStatus, allowEdit, canLancarSinal, allowReprint, lancando, onLancarSinal, onReceber }: {
  enc: Encomenda & { id: string };
  onStatus: (s: EncomendaStatus) => void;
  onEdit: () => void;
  onPrint: () => void;
  allowStatus: boolean;
  allowEdit: boolean;
  canLancarSinal: boolean;
  allowReprint: boolean;
  lancando: boolean;
  onLancarSinal: () => void;
  onReceber: () => void;
}) {
  const status = (enc.status || 'orcamento') as EncomendaStatus;
  const items = itemsSummary(enc);
  // Sinal pendente de lançar no caixa: encomenda já confirmada (ou adiante),
  // tem sinal e ainda não foi registrado (ex.: caixa estava fechado na hora).
  const sinalPendente = canLancarSinal && !enc.sinalLancado && enc.sinal > 0 &&
    !['orcamento', 'cancelada'].includes(status);
  const recebido = valorRecebido(enc);
  const falta = saldoAReceber(enc);
  const receberPendente = canLancarSinal && falta > 0 && ['pronta', 'entregue'].includes(status);
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">#{enc.id}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[status]}`}>{ENCOMENDA_STATUS_LABEL[status]}</span>
            {enc.isEmpresa && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">NF-e</span>}
          </div>
          <p className="mt-1 font-semibold text-foreground">{enc.customerName}</p>
          <a href={waLink(enc.customerPhone)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-emerald-600 hover:underline">
            <MessageCircle className="h-3.5 w-3.5" /> {enc.customerPhone}
          </a>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-primary">{brl(enc.total)}</p>
          {/* O que interessa no dia a dia é quanto já entrou e quanto falta —
              não a metade combinada no orçamento. */}
          <p className="text-xs text-muted-foreground">
            Recebido {brl(recebido)}
            {falta > 0 ? <> · falta <span className="font-semibold text-amber-600">{brl(falta)}</span></> : null}
          </p>
          {falta === 0
            ? <p className="text-[11px] font-semibold text-emerald-600">Pago por inteiro ✓</p>
            : recebido > 0 ? <p className="text-[11px] font-semibold text-emerald-600">Entrada no caixa ✓</p> : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {items.map((it, i) => <span key={i} className="rounded-md bg-secondary/60 px-2 py-1 text-xs text-secondary-foreground">{it}</span>)}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
        <span className="flex items-center gap-3 text-muted-foreground">
          <span className="flex items-center gap-1"><CalendarDays className="h-4 w-4" /> {formatDateBR(enc.delivery?.date)} {enc.delivery?.time}</span>
          <span className="flex items-center gap-1">
            {enc.delivery?.type === 'delivery' ? <><Bike className="h-4 w-4" /> Entrega</> : <><Store className="h-4 w-4" /> Retirada</>}
          </span>
        </span>
        <div className="flex items-center gap-2">
          {allowStatus && (
            <select
              value={status}
              onChange={(ev) => onStatus(ev.target.value as EncomendaStatus)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              title="Status"
            >
              {ALL_STATUS.map((s) => <option key={s} value={s}>{ENCOMENDA_STATUS_LABEL[s]}</option>)}
            </select>
          )}
          {sinalPendente && (
            <Button size="sm" onClick={onLancarSinal} disabled={lancando} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {lancando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Banknote className="mr-1 h-3.5 w-3.5" />}
              Lançar sinal no caixa
            </Button>
          )}
          {/* O resto do dinheiro: aparece da hora que a encomenda fica pronta
              até ela estar paga — inclusive depois de entregue com o caixa
              fechado, que é quando o saldo costumava se perder. */}
          {receberPendente && (
            <Button size="sm" onClick={onReceber} className="bg-emerald-600 text-white hover:bg-emerald-700">
              <Banknote className="mr-1 h-3.5 w-3.5" /> Receber {brl(falta)}
            </Button>
          )}
          {allowEdit && <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="mr-1 h-3.5 w-3.5" /> Editar</Button>}
          {allowReprint && <Button size="sm" variant="outline" onClick={onPrint}><Printer className="mr-1 h-3.5 w-3.5" /> Reimprimir</Button>}
        </div>
      </div>

      {(enc.comprovanteUrl || enc.bolo?.plate?.imageUrl || (enc.delivery?.type === 'delivery' && (enc.delivery?.street || enc.delivery?.neighborhood))) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {enc.delivery?.type === 'delivery' && (enc.delivery?.street || enc.delivery?.neighborhood) && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {[[enc.delivery.street, enc.delivery.number].filter(Boolean).join(', '), enc.delivery.neighborhood].filter(Boolean).join(' · ')}
              {enc.delivery.feeStatus === 'a_combinar' && <span className="font-semibold text-amber-600">(taxa a combinar)</span>}
            </span>
          )}
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
      )}

      {enc.orderNotes && <p className="mt-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground"><b>Obs.:</b> {enc.orderNotes}</p>}
    </div>
  );
}

// Edição LEVE: status, entrega (data/hora/forma), observação e contato.
// Itens e valores permanecem como o cliente enviou.
function EditEncomendaDialog({ db, enc, permissions, onClose, onSaved }: {
  db: any; enc: Encomenda & { id: string }; permissions: PdvPermissions; onClose: () => void; onSaved: (status: EncomendaStatus) => void;
}) {
  const { toast } = useToast();
  const allowEdit = can(permissions, 'actions.encomendas_pedidos.editarEncomenda');
  const allowStatus = can(permissions, 'actions.encomendas_pedidos.mudarStatus');
  const [status, setStatus] = useState<EncomendaStatus>((enc.status || 'orcamento') as EncomendaStatus);
  const [date, setDate] = useState(enc.delivery?.date || '');
  const [time, setTime] = useState(enc.delivery?.time || '');
  const [type, setType] = useState<'retirada' | 'delivery' | ''>(enc.delivery?.type || '');
  const [notes, setNotes] = useState(enc.orderNotes || '');
  const [name, setName] = useState(enc.customerName || '');
  const [phone, setPhone] = useState(enc.customerPhone || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!can(permissions, 'actions.encomendas_pedidos.editarEncomenda')) {
      toast({ variant: 'destructive', title: 'Permissão removida pelo administrador' });
      return;
    }
    const statusChanged = status !== (enc.status || 'orcamento');
    if (statusChanged && !can(permissions, 'actions.encomendas_pedidos.mudarStatus')) {
      toast({ variant: 'destructive', title: 'Permissão removida pelo administrador' });
      return;
    }
    setSaving(true);
    try {
      const patch: any = {
        // Espalha o delivery existente para não clobberar endereço/bairro/taxa
        // gravados pelo wizard (street/neighborhood/feeStatus...).
        delivery: { ...(enc.delivery || {}), date, time, type },
        orderNotes: notes,
        customerName: name,
        customerPhone: phone.replace(/\D/g, ''),
      };
      if (statusChanged) patch.status = status;
      await updateDoc(doc(db, 'encomendas', enc.id), patch);
      toast({ title: 'Encomenda atualizada' });
      onSaved(status);
    } catch (err) {
      console.error('[encomendas] erro ao editar:', err);
      toast({ variant: 'destructive', title: 'Erro ao salvar', description: 'Tente novamente.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar encomenda #{enc.id}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {allowStatus && <div className="space-y-1.5">
              <Label className="text-sm">Status</Label>
              <select disabled={!allowEdit} value={status} onChange={(e) => setStatus(e.target.value as EncomendaStatus)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {ALL_STATUS.map((s) => <option key={s} value={s}>{ENCOMENDA_STATUS_LABEL[s]}</option>)}
              </select>
            </div>}
            <div className="space-y-1.5">
              <Label className="text-sm">Forma</Label>
              <select disabled={!allowEdit} value={type} onChange={(e) => setType(e.target.value as any)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="retirada">Retirada no local</option>
                <option value="delivery">Entrega</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Data de entrega</Label>
              <Input disabled={!allowEdit} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Horário</Label>
              <Input disabled={!allowEdit} value={time} onChange={(e) => setTime(e.target.value)} placeholder="14:00" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Cliente</Label>
              <Input disabled={!allowEdit} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">WhatsApp</Label>
              <Input disabled={!allowEdit} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Observação</Label>
            <Textarea disabled={!allowEdit} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <p className="text-xs text-muted-foreground">Itens e valores não são alterados aqui — apenas dados do pedido/entrega.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
