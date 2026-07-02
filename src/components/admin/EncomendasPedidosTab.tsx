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
import { CalendarDays, Store, Bike, MessageCircle, Printer, Pencil, Package, Loader2, MapPin, Paperclip, ImageIcon, Banknote } from 'lucide-react';

const money = (n: number) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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

export function EncomendasPedidosTab({ db, user, storeProfile, registrarLancamento, caixaAberto = false }: {
  db: any; user: any; storeProfile: any;
  registrarLancamento?: (params: { tipo: 'venda'; titulo: string; valor: number; formaPagamento: string }) => Promise<void>;
  caixaAberto?: boolean;
}) {
  const { toast } = useToast();
  const [filter, setFilter] = useState<'todas' | EncomendaStatus>('todas');
  const [editing, setEditing] = useState<(Encomenda & { id: string }) | null>(null);
  const [lancandoId, setLancandoId] = useState<string | null>(null);

  const encomendasQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(collection(db, 'encomendas'), where('ownerId', '==', user.uid));
  }, [db, user?.uid]);
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
      await updateDoc(doc(db, 'encomendas', enc.id), { sinalLancado: true });
      toast({ title: 'Sinal lançado no caixa', description: `${money(enc.sinal)} (PIX) — Encomenda ${enc.id.substring(0, 5)}.` });
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
    try {
      await updateDoc(doc(db, 'encomendas', enc.id), { status });
      // Confirmar = sinal pago → registra no caixa (se ainda não registrado).
      if (status === 'confirmada') await lancarSinal(enc);
    } catch (err) {
      console.error('[encomendas] erro ao atualizar status:', err);
      toast({ variant: 'destructive', title: 'Erro ao atualizar status' });
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-xl font-bold"><Package className="h-6 w-6 text-primary" /> Pedidos de encomenda</h2>
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
                onEdit={() => setEditing(e)}
                onPrint={() => printEncomendaReceipt({ enc: e, storeInfo: storeProfile })}
                canLancarSinal={!!registrarLancamento}
                lancando={lancandoId === e.id}
                onLancarSinal={() => lancarSinal(e)}
              />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <EditEncomendaDialog
          db={db}
          enc={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function PedidoCard({ enc, onStatus, onEdit, onPrint, canLancarSinal, lancando, onLancarSinal }: {
  enc: Encomenda & { id: string };
  onStatus: (s: EncomendaStatus) => void;
  onEdit: () => void;
  onPrint: () => void;
  canLancarSinal: boolean;
  lancando: boolean;
  onLancarSinal: () => void;
}) {
  const status = (enc.status || 'orcamento') as EncomendaStatus;
  const items = itemsSummary(enc);
  // Sinal pendente de lançar no caixa: encomenda já confirmada (ou adiante),
  // tem sinal e ainda não foi registrado (ex.: caixa estava fechado na hora).
  const sinalPendente = canLancarSinal && !enc.sinalLancado && enc.sinal > 0 &&
    !['orcamento', 'cancelada'].includes(status);
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
          <p className="text-lg font-bold text-primary">{money(enc.total)}</p>
          <p className="text-xs text-muted-foreground">Sinal {money(enc.sinal)} · saldo {money(enc.saldo)}</p>
          {enc.sinalLancado && <p className="text-[11px] font-semibold text-emerald-600">Sinal lançado no caixa ✓</p>}
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
          <select
            value={status}
            onChange={(ev) => onStatus(ev.target.value as EncomendaStatus)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            title="Status"
          >
            {ALL_STATUS.map((s) => <option key={s} value={s}>{ENCOMENDA_STATUS_LABEL[s]}</option>)}
          </select>
          {sinalPendente && (
            <Button size="sm" onClick={onLancarSinal} disabled={lancando} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {lancando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Banknote className="mr-1 h-3.5 w-3.5" />}
              Lançar sinal no caixa
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="mr-1 h-3.5 w-3.5" /> Editar</Button>
          <Button size="sm" variant="outline" onClick={onPrint}><Printer className="mr-1 h-3.5 w-3.5" /> Reimprimir</Button>
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
function EditEncomendaDialog({ db, enc, onClose, onSaved }: {
  db: any; enc: Encomenda & { id: string }; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<EncomendaStatus>((enc.status || 'orcamento') as EncomendaStatus);
  const [date, setDate] = useState(enc.delivery?.date || '');
  const [time, setTime] = useState(enc.delivery?.time || '');
  const [type, setType] = useState<'retirada' | 'delivery' | ''>(enc.delivery?.type || '');
  const [notes, setNotes] = useState(enc.orderNotes || '');
  const [name, setName] = useState(enc.customerName || '');
  const [phone, setPhone] = useState(enc.customerPhone || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'encomendas', enc.id), {
        status,
        // Espalha o delivery existente para não clobberar endereço/bairro/taxa
        // gravados pelo wizard (street/neighborhood/feeStatus...).
        delivery: { ...(enc.delivery || {}), date, time, type },
        orderNotes: notes,
        customerName: name,
        customerPhone: phone.replace(/\D/g, ''),
      });
      toast({ title: 'Encomenda atualizada' });
      onSaved();
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
            <div className="space-y-1.5">
              <Label className="text-sm">Status</Label>
              <select value={status} onChange={(e) => setStatus(e.target.value as EncomendaStatus)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {ALL_STATUS.map((s) => <option key={s} value={s}>{ENCOMENDA_STATUS_LABEL[s]}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Forma</Label>
              <select value={type} onChange={(e) => setType(e.target.value as any)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="retirada">Retirada no local</option>
                <option value="delivery">Entrega</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Data de entrega</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Horário</Label>
              <Input value={time} onChange={(e) => setTime(e.target.value)} placeholder="14:00" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Cliente</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">WhatsApp</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Observação</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
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
