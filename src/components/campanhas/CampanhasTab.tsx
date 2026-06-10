'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { uploadImage } from '@/lib/upload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { buildStoreLink } from '@/lib/whatsapp-messages';
import { normalizeSearch } from '@/lib/utils';
import {
  Megaphone, Send, ImagePlus, Users, Info, X, Search, ArrowDownWideNarrow,
  Rocket, ChevronRight, Loader2, CheckCircle2, AlertTriangle, Ban, Phone, Wand2, Check, Plus,
  ListPlus, Trash2, Bookmark, MoreVertical, Repeat,
} from 'lucide-react';
import {
  AUDIENCE_PRESETS, MESSAGE_TOKENS, EMPTY_DRAFT, renderMessage, estimateMinutes, resolveAudience, hasValidWhatsapp, parseDateBR, ordersPerMonth,
  DELAY_MIN_SECONDS, DELAY_MAX_SECONDS, DELAY_AVG_SECONDS,
  type ClientLike,
} from '@/lib/campanhas/audience';
import type { AudienceId, CampaignDraft, ScheduledCampaign } from '@/lib/campanhas/types';
import { ContactAvatar } from '@/components/shared/ContactAvatar';
import { makeProfilePhotoLoader } from '@/lib/wapi/profile-photo';

interface CampanhasTabProps {
  db?: any;
  user?: any;
  storeProfile?: any;
}

// Ordenações analíticas da lista de contatos: o lojista usa para "ler" a base
// (quem compra mais, quem gasta mais, quem some) e montar a seleção do disparo.
type SortKey = 'nome' | 'pedidos' | 'valor' | 'ticket' | 'recencia' | 'frequencia';
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'nome', label: 'Nome' },
  { key: 'pedidos', label: 'Nº de compras' },
  { key: 'valor', label: 'Valor gasto' },
  { key: 'ticket', label: 'Ticket médio' },
  { key: 'frequencia', label: 'Frequência' },
  { key: 'recencia', label: 'Compra recente' },
];
const spentOf = (c: ClientLike) => (c.totalPedidos || 0) * (c.ticketMedio || 0);
const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function CampanhasTab({ db, user, storeProfile }: CampanhasTabProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<CampaignDraft>(EMPTY_DRAFT);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchContacts, setSearchContacts] = useState('');
  const [activePreset, setActivePreset] = useState<AudienceId | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('nome');

  const [aiLoading, setAiLoading] = useState(false);
  // Variáveis que a IA pode usar (toggles). Default: primeiro nome + nome da loja.
  const [enabledTokens, setEnabledTokens] = useState<Set<string>>(new Set(['{primeiro_nome}', '{loja}']));
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Dialog para salvar a seleção atual como uma lista de transmissão reutilizável.
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [listName, setListName] = useState('');
  const [savingList, setSavingList] = useState(false);
  // Lista carregada por último: habilita "Atualizar lista" depois de mexer na seleção
  const [activeListId, setActiveListId] = useState<string | null>(null);
  // Lista marcada para exclusão (confirmação) — a lixeira fica perto do clique de carregar.
  const [listToDelete, setListToDelete] = useState<any | null>(null);

  const [submitting, setSubmitting] = useState(false);   // criando/enfileirando a campanha
  const [dismissedId, setDismissedId] = useState<string | null>(null); // resumo já dispensado

  const storeName = storeProfile?.general?.name || storeProfile?.storeName || 'Minha Loja';
  const link = buildStoreLink(storeProfile, user?.uid, typeof window !== 'undefined' ? window.location.origin : undefined);

  const clientesQuery = useMemoFirebase(
    () => (db && user ? query(collection(db, 'clientes'), where('ownerId', '==', user.uid)) : null),
    [db, user],
  );
  const { data: clientesRaw } = useCollection(clientesQuery);
  const clients = (clientesRaw || []) as ClientLike[];


  // Listas de transmissão salvas (seleções de contatos reutilizáveis).
  const listsQuery = useMemoFirebase(
    () => (db && user ? query(collection(db, 'broadcast_lists'), where('ownerId', '==', user.uid)) : null),
    [db, user],
  );
  const { data: listsRaw } = useCollection(listsQuery);
  const broadcastLists = useMemo(
    () => [...((listsRaw || []) as any[])].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR')),
    [listsRaw],
  );

  // Disparos agendados/em andamento (server-side). A UI lê em realtime — o
  // progresso aparece mesmo com a aba fechada e para qualquer admin.
  const scheduledQuery = useMemoFirebase(
    () => (db && user ? query(collection(db, 'scheduled_campaigns'), where('ownerId', '==', user.uid)) : null),
    [db, user],
  );
  const { data: scheduledRaw } = useCollection(scheduledQuery);
  // Campanha "ao vivo": a ativa (running/scheduled) ou, na falta, a mais recente.
  const live = useMemo(() => {
    const arr = (scheduledRaw || []) as ScheduledCampaign[];
    if (arr.length === 0) return null;
    const active = arr.find((c) => c.status === 'running' || c.status === 'scheduled');
    if (active) return active;
    return [...arr].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
  }, [scheduledRaw]);
  const liveActive = live?.status === 'running' || live?.status === 'scheduled';
  // Painel some quando dispensado (Concluir) ou quando não há campanha relevante.
  const showLivePanel = !!live && live.id !== dismissedId;
  // Mapa id→status p/ animar cada linha da lista.
  const liveDone = useMemo(() => {
    const m: Record<string, 'sent' | 'failed'> = {};
    (live?.results || []).forEach((r) => { m[r.id] = r.status; });
    return m;
  }, [live]);
  const liveTotal = live?.recipients?.length || 0;
  const livePct = liveTotal > 0 ? Math.round((((live?.sent || 0) + (live?.failed || 0)) / liveTotal) * 100) : 0;

  // Histórico = campanhas já finalizadas (a ativa fica no painel do topo).
  const history = useMemo(
    () => ((scheduledRaw || []) as ScheduledCampaign[])
      .filter((c) => c.status === 'done' || c.status === 'canceled' || c.status === 'error')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [scheduledRaw],
  );

  // Rola a lista até o contato que está sendo enviado agora.
  const currentRowRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    currentRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [live?.currentId]);

  const set = (patch: Partial<CampaignDraft>) => setDraft((d) => ({ ...d, ...patch }));

  // Foto de perfil sob demanda (loader compartilhado, cache de módulo).
  const loadPhoto = useMemo(() => makeProfilePhotoLoader(user), [user]);

  // Lista base: filtrada pelo preset ativo (se houver), senão todos — e ordenada
  // pelo critério analítico escolhido (nome, nº de compras, valor, ticket, recência).
  const baseList = useMemo(() => {
    const arr = activePreset ? resolveAudience(clients, activePreset) : [...clients];
    switch (sortKey) {
      case 'pedidos': arr.sort((a, b) => (b.totalPedidos || 0) - (a.totalPedidos || 0)); break;
      case 'valor': arr.sort((a, b) => spentOf(b) - spentOf(a)); break;
      case 'ticket': arr.sort((a, b) => (b.ticketMedio || 0) - (a.ticketMedio || 0)); break;
      case 'frequencia': arr.sort((a, b) => ordersPerMonth(b) - ordersPerMonth(a)); break;
      case 'recencia': arr.sort((a, b) => parseDateBR(b.ultimoPedido) - parseDateBR(a.ultimoPedido)); break;
      default: arr.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
    }
    return arr;
  }, [clients, activePreset, sortKey]);

  const visibleClients = useMemo(() => {
    const term = normalizeSearch(searchContacts);
    if (!term) return baseList;
    return baseList.filter(c =>
      normalizeSearch(c.nome || '').includes(term) || (c.celular || '').replace(/\D/g, '').includes(term.replace(/\D/g, '')),
    );
  }, [baseList, searchContacts]);

  const selectableVisible = useMemo(() => visibleClients.filter(hasValidWhatsapp), [visibleClients]);
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every(c => selectedIds.has(c.id));

  // Selecionados primeiro, depois os não selecionados — preservando a ordenação
  // ativa dentro de cada grupo (alfabética por padrão).
  const orderedVisible = useMemo(() => {
    const sel: ClientLike[] = [];
    const rest: ClientLike[] = [];
    for (const c of visibleClients) (selectedIds.has(c.id) ? sel : rest).push(c);
    return [...sel, ...rest];
  }, [visibleClients, selectedIds]);

  // Conjunto de ids existentes — para saber qual lista salva bate com a seleção atual.
  const clientIdSet = useMemo(() => new Set(clients.map(c => c.id)), [clients]);

  const toggle = (id: string) => setSelectedIds(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const toggleAllVisible = () => setSelectedIds(prev => {
    const n = new Set(prev);
    if (allVisibleSelected) selectableVisible.forEach(c => n.delete(c.id));
    else selectableVisible.forEach(c => n.add(c.id));
    return n;
  });
  // Chip de preset: FILTRA a lista para o grupo (e já seleciona). Clicar de novo
  // no mesmo chip volta a mostrar todos (mantendo a seleção).
  const applyPreset = (id: AudienceId) => {
    const turningOff = activePreset === id;
    setActivePreset(turningOff ? null : id);
    if (!turningOff) {
      setSelectedIds(new Set(resolveAudience(clients, id).map(c => c.id)));
      setActiveListId(null);
    }
  };
  const clearSelection = () => { setSelectedIds(new Set()); setActiveListId(null); };

  // ── Listas de transmissão ──────────────────────────────────────────────
  // Salva os contatos selecionados como uma lista nomeada para reusar depois.
  const saveCurrentAsList = async () => {
    if (!db || !user) return;
    const name = listName.trim();
    if (!name || selectedIds.size === 0) return;
    setSavingList(true);
    try {
      const id = doc(collection(db, 'broadcast_lists')).id;
      await setDoc(doc(db, 'broadcast_lists', id), {
        id, ownerId: user.uid, name,
        contactIds: Array.from(selectedIds),
        createdAt: new Date().toISOString(),
      });
      toast({ title: 'Lista salva', description: `"${name}" com ${selectedIds.size} contato(s).` });
      setListDialogOpen(false);
      setListName('');
      // A lista recém-criada vira a ativa: dá para seguir marcando contatos e "Atualizar lista"
      setActiveListId(id);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Não foi possível salvar', description: e?.message || 'Verifique as regras do Firestore.' });
    } finally {
      setSavingList(false);
    }
  };
  // Carrega uma lista salva: aplica a seleção (só contatos que ainda existem).
  const loadList = (list: any) => {
    const valid = new Set((clients || []).map(c => c.id));
    const ids = ((list.contactIds || []) as string[]).filter(id => valid.has(id));
    setActivePreset(null);
    setSearchContacts('');
    setSelectedIds(new Set(ids));
    setActiveListId(list.id);
    toast({ title: `Lista "${list.name}" carregada`, description: `${ids.length} contato(s) selecionado(s). Marque/desmarque contatos e use "Atualizar lista" para salvar.` });
  };
  // Regrava a lista carregada com a seleção atual (adicionar/remover contatos).
  const updateActiveList = async () => {
    if (!db || !user || !activeListId || selectedIds.size === 0) return;
    const list = broadcastLists.find((l: any) => l.id === activeListId);
    setSavingList(true);
    try {
      await setDoc(doc(db, 'broadcast_lists', activeListId), {
        contactIds: Array.from(selectedIds),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      toast({ title: 'Lista atualizada', description: `"${list?.name || 'Lista'}" agora tem ${selectedIds.size} contato(s).` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Não foi possível atualizar', description: e?.message || 'Verifique as regras do Firestore.' });
    } finally {
      setSavingList(false);
    }
  };
  const deleteList = async (list: any) => {
    if (!db || !user) return;
    try {
      await deleteDoc(doc(db, 'broadcast_lists', list.id));
      if (activeListId === list.id) setActiveListId(null);
      toast({ title: 'Lista removida' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Não foi possível remover', description: e?.message });
    } finally {
      setListToDelete(null);
    }
  };

  // Reusar uma campanha do histórico: recarrega nome, texto e imagem no compositor.
  const reuseCampaign = (c: any) => {
    setDraft({ ...EMPTY_DRAFT, name: c.name || '', message: c.message || '', imageUrl: c.imageUrl || null });
    setImageFile(null);
    toast({ title: 'Campanha carregada', description: 'Ajuste se quiser, escolha os contatos e dispare.' });
  };
  const deleteCampaign = async (c: any) => {
    if (!db || !user) return;
    try {
      await deleteDoc(doc(db, 'scheduled_campaigns', c.id));
      toast({ title: 'Campanha excluída' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Não foi possível excluir', description: e?.message });
    }
  };

  const targets = useMemo(() => clients.filter(c => selectedIds.has(c.id) && hasValidWhatsapp(c)), [clients, selectedIds]);
  const audienceCount = targets.length;
  const minutes = estimateMinutes(audienceCount, DELAY_AVG_SECONDS);

  const canSend = (draft.message.trim().length > 0 || !!imageFile) && audienceCount > 0;

  const toggleToken = (token: string) => setEnabledTokens(prev => {
    const n = new Set(prev);
    n.has(token) ? n.delete(token) : n.add(token);
    return n;
  });

  // Gera/ajusta o texto da mensagem com IA (Claude) a partir do rascunho do lojista.
  const improveWithAI = async () => {
    if (!user) return;
    setAiLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/ai/campaign-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt: draft.message, loja: storeName, tokens: Array.from(enabledTokens) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.message) {
        toast({ variant: 'destructive', title: 'IA indisponível', description: data?.error || 'Não foi possível gerar o texto.' });
        return;
      }
      set({ message: data.message });
      toast({ title: 'Texto gerado pela IA ✨' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erro', description: e?.message || 'Falha ao gerar texto.' });
    } finally {
      setAiLoading(false);
    }
  };

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setImageFile(file); set({ imageUrl: URL.createObjectURL(file) }); }
    e.target.value = '';
  };
  const removeImage = () => { setImageFile(null); set({ imageUrl: null }); };

  // Cria a campanha no servidor (Firestore + QStash). O envio roda no servidor —
  // a tela fica livre e o progresso vem do doc em realtime.
  const startDispatch = async () => {
    if (!db || !user || submitting || liveActive) return;
    setSubmitting(true);
    try {
      // Imagem: sobe o arquivo novo, ou reusa a URL já hospedada (repetição).
      let imageUrl: string | null = null;
      if (imageFile) imageUrl = await uploadImage(imageFile);
      else if (draft.imageUrl && /^https?:/i.test(draft.imageUrl)) imageUrl = draft.imageUrl;

      const recipients = targets.map((t) => ({ id: t.id, nome: t.nome || '', celular: t.celular || '' }));
      const token = await user.getIdToken();
      const res = await fetch('/api/campaigns/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: draft.name?.trim() || 'Campanha',
          message: draft.message,
          imageUrl,
          loja: storeName,
          link,
          recipients,
          scheduleAt: new Date().toISOString(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.id) {
        toast({ variant: 'destructive', title: 'Não foi possível disparar', description: data?.error || 'Tente novamente.' });
        return;
      }
      setDismissedId(null);
      setConfirmOpen(false);
      toast({ title: 'Disparo iniciado', description: 'Roda no servidor — pode fechar a aba.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erro ao disparar', description: e?.message || 'Falha ao iniciar.' });
    } finally {
      setSubmitting(false);
    }
  };

  // Interromper: marca a campanha como cancelada — o servidor para no próximo chunk.
  const stopDispatch = async () => {
    if (!db || !live) return;
    try {
      await updateDoc(doc(db, 'scheduled_campaigns', live.id), { status: 'canceled' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Não foi possível interromper', description: e?.message });
    }
  };

  // Dispensa o resumo do disparo e limpa o rascunho/seleção.
  const finishDispatch = () => {
    if (live) setDismissedId(live.id);
    setDraft(EMPTY_DRAFT);
    setImageFile(null);
    setSelectedIds(new Set());
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">

      {/* Cabeçalho fino */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600"><Megaphone className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-bold leading-tight text-slate-800">Campanhas</h1>
            <p className="text-[11px] text-slate-400">Escolha os contatos e dispare pelo WhatsApp</p>
          </div>
        </div>
        <Badge variant="outline" className="gap-1.5 text-[11px] text-slate-500">
          <Users className="h-3 w-3" /> {clients.length} clientes
        </Badge>
      </div>

      {/* Corpo: ESQUERDA contatos (altura total) | DIREITA composição (rola) */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[420px_1fr]">

        {/* ── Lista de contatos (full height, estilo WhatsApp Web) ── */}
        <div className="flex min-h-0 flex-col border-b border-slate-200 bg-white lg:border-b-0 lg:border-r">

          {/* Painel de disparo em andamento / resultado — lido do doc em realtime */}
          {showLivePanel && live && (
            <div className="shrink-0 border-b border-slate-100 bg-slate-50 p-3">
              {live.status === 'error' ? (
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-[12px] font-medium text-rose-600">
                    <AlertTriangle className="h-4 w-4" /> {live.error || 'Falha no disparo.'}
                  </p>
                  <button type="button" onClick={finishDispatch} className="text-[11px] text-slate-400 hover:text-slate-600">Fechar</button>
                </div>
              ) : (
                <>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="flex min-w-0 items-center gap-2 text-[12px] font-bold text-slate-700">
                      {liveActive
                        ? <><Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-500" /> <span className="truncate">Enviando “{live.name}”…</span></>
                        : live.status === 'canceled'
                          ? <><Ban className="h-4 w-4 shrink-0 text-amber-500" /> <span className="truncate">Disparo interrompido</span></>
                          : <><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> <span className="truncate">Campanha concluída</span></>}
                    </p>
                    <span className="shrink-0 text-[11px] font-semibold text-slate-500">{livePct}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${livePct}%` }} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">
                      <strong className="text-emerald-600">{live.sent}</strong> enviadas
                      {live.failed > 0 && <> · <strong className="text-rose-500">{live.failed}</strong> falhas</>}
                      {' '}de {liveTotal}
                    </span>
                    {liveActive ? (
                      <button type="button" onClick={stopDispatch} className="flex items-center gap-1 font-medium text-rose-500 hover:text-rose-600">
                        <Ban className="h-3 w-3" /> Interromper
                      </button>
                    ) : (
                      <button type="button" onClick={finishDispatch} className="font-medium text-emerald-600 hover:text-emerald-700">Concluir</button>
                    )}
                  </div>
                  {liveActive && (
                    <p className="mt-1 text-[10px] text-slate-400">Roda no servidor — pode fechar a aba que continua enviando.</p>
                  )}
                </>
              )}
            </div>
          )}

          <div className="shrink-0 border-b border-slate-100 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">Contatos</h3>
              <span className="text-[11px] font-semibold text-emerald-600">{selectedIds.size} selecionado(s)</span>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input value={searchContacts} onChange={(e) => setSearchContacts(e.target.value)}
                placeholder="Pesquisar pelo nome ou telefone..." className="h-10 pl-9" />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <button type="button" onClick={toggleAllVisible} disabled={selectableVisible.length === 0}
                className="flex items-center gap-2 text-[12px] font-medium text-slate-600 hover:text-emerald-600 disabled:opacity-40">
                <Checkbox checked={allVisibleSelected} className="pointer-events-none" />
                Selecionar todos {(searchContacts || activePreset) ? '(filtrados)' : ''} ({selectableVisible.length})
              </button>
              {selectedIds.size > 0 && (
                <button type="button" onClick={clearSelection} className="text-[11px] text-slate-400 hover:text-rose-500">Limpar</button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
            {visibleClients.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center text-center text-slate-400">
                <Users className="mb-2 h-6 w-6" />
                <p className="text-sm">{clients.length === 0 ? 'Nenhum cliente na base.' : 'Nenhum contato encontrado.'}</p>
              </div>
            ) : (
              orderedVisible.map((c) => {
                const valid = hasValidWhatsapp(c);
                const checked = selectedIds.has(c.id);
                const initials = (c.nome || '?').split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
                const totalGasto = spentOf(c);
                const pedidos = c.totalPedidos || 0;
                // O número em destaque acompanha a ordenação ativa — sempre com um
                // rótulo dizendo o que é (evita confundir total gasto com valor de uma compra).
                const metric =
                  sortKey === 'pedidos' ? { label: 'compras', primary: `${pedidos}`, secondary: `${brl(totalGasto)} no total` }
                  : sortKey === 'ticket' ? { label: 'ticket médio', primary: brl(c.ticketMedio || 0), secondary: `${pedidos} compra(s)` }
                  : sortKey === 'frequencia' ? { label: 'frequência', primary: `${ordersPerMonth(c).toFixed(1)}/mês`, secondary: c.clienteDesde ? `cliente desde ${c.clienteDesde}` : `${pedidos} compra(s)` }
                  : sortKey === 'recencia' ? { label: 'último pedido', primary: c.ultimoPedido || '—', secondary: `${pedidos} compra(s)` }
                  : { label: 'total gasto', primary: brl(totalGasto), secondary: `${pedidos} compra(s)` };
                // Status do disparo neste contato (anima a linha durante o envio).
                const dStatus = showLivePanel
                  ? (live?.currentId === c.id ? 'sending' : liveDone[c.id])
                  : undefined;
                return (
                  <button key={c.id} type="button" disabled={!valid} onClick={() => valid && toggle(c.id)}
                    ref={dStatus === 'sending' ? currentRowRef : undefined}
                    className={`flex w-full items-center gap-3 border-b border-slate-50 px-3 py-2.5 text-left transition-colors ${
                      dStatus === 'sending' ? 'animate-pulse bg-emerald-100 ring-1 ring-inset ring-emerald-300'
                      : dStatus === 'failed' ? 'bg-rose-50'
                      : dStatus === 'sent' ? 'bg-emerald-50/60'
                      : !valid ? 'cursor-not-allowed opacity-50' : checked ? 'bg-emerald-50' : 'hover:bg-slate-50'
                    }`}>
                    <Checkbox checked={checked} disabled={!valid} className="pointer-events-none shrink-0" />
                    <ContactAvatar phone={valid ? (c.celular || '') : ''} initials={initials} loadPhoto={loadPhoto} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">{c.nome || 'Sem nome'}</p>
                      <p className="flex items-center gap-1 truncate text-[11px] text-slate-400">
                        <Phone className="h-3 w-3" /> {c.celular || 'sem WhatsApp'}
                      </p>
                    </div>
                    {dStatus ? (
                      <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold">
                        {dStatus === 'sending' && <><Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" /> <span className="text-emerald-600">enviando…</span></>}
                        {dStatus === 'sent' && <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> <span className="text-emerald-600">enviado</span></>}
                        {dStatus === 'failed' && <><Ban className="h-3.5 w-3.5 text-rose-500" /> <span className="text-rose-500">falhou</span></>}
                      </span>
                    ) : valid ? (
                      <div className="shrink-0 text-right">
                        <p className="text-[9px] font-medium uppercase tracking-wide text-slate-400">{metric.label}</p>
                        <p className="text-[12px] font-bold text-emerald-600">{metric.primary}</p>
                        <p className="text-[10px] text-slate-400">{metric.secondary}</p>
                      </div>
                    ) : (
                      <span className="shrink-0 text-[10px] font-medium text-amber-500">sem WhatsApp</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── Composição (rola independente) ── */}
        <div className="min-h-0 overflow-y-auto custom-scrollbar">
          <div className="mx-auto w-full max-w-[1100px] space-y-5 p-4 sm:p-6 lg:px-8">

            {/* Listas de transmissão salvas — seleções de contatos reutilizáveis */}
            <Section title="Listas de transmissão" subtitle="Salve uma seleção de contatos para reusar em campanhas futuras">
              <div className="flex flex-wrap items-center gap-2">
                {broadcastLists.length === 0 ? (
                  <p className="text-[12px] text-slate-400">
                    Nenhuma lista salva. Selecione contatos na lista ao lado e clique em “Salvar seleção”.
                  </p>
                ) : (
                  broadcastLists.map((l) => {
                    const count = (l.contactIds || []).length;
                    // Lista "ativa" = a seleção atual bate exatamente com os contatos dela.
                    const validIds = ((l.contactIds || []) as string[]).filter(id => clientIdSet.has(id));
                    const active = selectedIds.size > 0 && validIds.length === selectedIds.size && validIds.every(id => selectedIds.has(id));
                    return (
                      <div key={l.id}
                        className={`group flex items-center gap-1.5 rounded-full border py-1 pl-3 pr-1.5 transition-colors ${
                          active
                            ? 'border-emerald-500 bg-emerald-500 shadow-sm'
                            : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50'
                        }`}>
                        <button type="button" onClick={() => active ? clearSelection() : loadList(l)}
                          title={active ? 'Clique para desmarcar' : 'Carregar esta lista'}
                          className={`flex items-center gap-1.5 text-[12px] font-medium ${active ? 'text-white' : 'text-slate-700'}`}>
                          {active ? <Check className="h-3.5 w-3.5 text-white" /> : <Bookmark className="h-3.5 w-3.5 text-emerald-500" />}
                          {l.name}
                          <span className={`text-[11px] ${active ? 'text-emerald-50' : 'text-slate-400'}`}>({count})</span>
                        </button>
                        <button type="button" onClick={() => setListToDelete(l)} title="Remover lista"
                          className={`flex h-5 w-5 items-center justify-center rounded-full ${
                            active ? 'text-emerald-100 hover:bg-emerald-600 hover:text-white' : 'text-slate-300 hover:bg-rose-100 hover:text-rose-500'
                          }`}>
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" disabled={selectedIds.size === 0}
                  onClick={() => { setListName(''); setListDialogOpen(true); }}
                  className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                  <ListPlus className="h-4 w-4" /> Salvar como nova lista ({selectedIds.size})
                </Button>
                {activeListId && (() => {
                  const activeList = broadcastLists.find((l: any) => l.id === activeListId);
                  if (!activeList) return null;
                  return (
                    <Button type="button" size="sm" disabled={selectedIds.size === 0 || savingList}
                      onClick={updateActiveList}
                      className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50">
                      {savingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Atualizar “{activeList.name}” ({selectedIds.size})
                    </Button>
                  );
                })()}
              </div>
            </Section>

            <Section title="Público e análise" subtitle="Filtre por grupo e ordene a base para montar o disparo">
              {/* Filtros de público — aqui há espaço para uma linha só */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {AUDIENCE_PRESETS.map((a) => {
                  const active = activePreset === a.id;
                  const count = resolveAudience(clients, a.id as AudienceId).length;
                  return (
                    <button key={a.id} type="button" onClick={() => applyPreset(a.id as AudienceId)} title={a.description}
                      className={`flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors ${
                        active
                          ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:bg-emerald-50'
                      }`}>
                      <span className="text-[12px] font-semibold leading-tight">{a.label}</span>
                      <span className={`text-[11px] ${active ? 'text-emerald-50' : 'text-slate-400'}`}>{count} contatos</span>
                    </button>
                  );
                })}
              </div>

              {/* Ordenar a lista para analisar a base e montar o disparo */}
              <div className="mt-4">
                <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <ArrowDownWideNarrow className="h-3.5 w-3.5" /> Ordenar por
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SORT_OPTIONS.map((o) => {
                    const active = sortKey === o.key;
                    return (
                      <button key={o.key} type="button" onClick={() => setSortKey(o.key)}
                        className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                          active
                            ? 'border-slate-700 bg-slate-700 text-white'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-400'
                        }`}>
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </Section>

            <Section title="Nome da campanha" subtitle="Só para identificar no histórico">
              <Input value={draft.name} onChange={(e) => set({ name: e.target.value })}
                placeholder="Ex.: Promoção de Sexta — Pizza em dobro" className="h-11" />
            </Section>

            <Section title="Mensagem" subtitle="Escreva um rascunho e deixe a IA ajustar, ou personalize com as variáveis">
              <div className="mb-2 flex justify-end">
                <Button type="button" variant="outline" size="sm" onClick={improveWithAI} disabled={aiLoading}
                  className="gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-50">
                  {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                  {aiLoading ? 'Gerando…' : 'Melhorar com IA'}
                </Button>
              </div>
              <Textarea value={draft.message} onChange={(e) => set({ message: e.target.value })}
                placeholder={'Olá {primeiro_nome}! 🍕 Hoje na {loja} tem oferta especial...'}
                className="min-h-[150px] resize-none text-sm leading-relaxed" />
              <div className="mt-2.5">
                <p className="mb-1.5 text-[11px] text-slate-400">Variáveis que a IA pode usar (clique para ligar/desligar):</p>
                <div className="flex flex-wrap gap-1.5">
                  {MESSAGE_TOKENS.map((t) => {
                    const on = enabledTokens.has(t.token);
                    return (
                      <button key={t.token} type="button" onClick={() => toggleToken(t.token)}
                        className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          on ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-emerald-300'
                        }`}
                        title={on ? `A IA pode usar ${t.label}` : `${t.label} desligado — a IA não vai usar`}>
                        {on ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-4">
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
                {draft.imageUrl ? (
                  <div className="relative inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={draft.imageUrl} alt="anexo" className="h-28 w-28 rounded-2xl object-cover ring-1 ring-slate-200" />
                    <button type="button" onClick={removeImage}
                      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-white shadow ring-2 ring-white">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white py-5 text-sm font-medium text-slate-500 transition-colors hover:border-emerald-400 hover:bg-emerald-50/40 hover:text-emerald-600">
                    <ImagePlus className="h-5 w-5" /> Anexar imagem (opcional)
                  </button>
                )}
              </div>
            </Section>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
              {!canSend && (
                <p className="flex-1 text-[12px] text-slate-400">
                  {audienceCount === 0 ? 'Selecione ao menos um contato na lista.' : 'Escreva uma mensagem ou anexe uma imagem.'}
                </p>
              )}
              <Button className="gap-2 bg-emerald-600 px-6 hover:bg-emerald-700 disabled:opacity-60"
                disabled={!canSend || liveActive} onClick={() => setConfirmOpen(true)}>
                {liveActive ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</> : <><Rocket className="h-4 w-4" /> Disparar para {audienceCount}<ChevronRight className="h-4 w-4" /></>}
              </Button>
            </div>

            {/* Histórico */}
            <div className="pt-2">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Histórico de campanhas</h2>
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Send className="h-5 w-5" /></div>
                  <p className="mt-3 text-sm font-medium text-slate-600">Nenhuma campanha enviada ainda</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {history.map((c) => {
                    const total = (c.recipients || []).length;
                    return (
                      <div key={c.id} role="button" tabIndex={0} onClick={() => reuseCampaign(c)}
                        title="Clique para usar esta campanha de novo"
                        className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 transition-colors hover:border-emerald-300 hover:bg-emerald-50/40">
                        {c.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-slate-200" />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600"><Megaphone className="h-5 w-5" /></div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-800">{c.name}</p>
                          <p className="truncate text-[11px] text-slate-400">{c.message || `${total} contatos`} · {new Date(c.createdAt).toLocaleString('pt-BR')}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 text-[11px]">
                          {c.status === 'canceled' && <span className="rounded-full bg-amber-50 px-2 py-1 font-bold text-amber-700">interrompida</span>}
                          {c.status === 'error' && <span className="rounded-full bg-rose-50 px-2 py-1 font-bold text-rose-600">erro</span>}
                          <span className="rounded-full bg-emerald-50 px-2 py-1 font-bold text-emerald-700">{c.sent} enviadas</span>
                          {c.failed > 0 && <span className="rounded-full bg-rose-50 px-2 py-1 font-bold text-rose-600">{c.failed} falhas</span>}
                          <span className="hidden items-center gap-1 text-slate-400 sm:flex"><Repeat className="h-3 w-3" /> usar de novo</span>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" title="Opções" onClick={(e) => e.stopPropagation()}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => reuseCampaign(c)} className="gap-2">
                              <Repeat className="h-4 w-4" /> Usar de novo
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => deleteCampaign(c)} className="gap-2 text-rose-600 focus:text-rose-600">
                              <Trash2 className="h-4 w-4" /> Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Dialog: confirmar disparo (depois roda em segundo plano) */}
      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!o) setConfirmOpen(false); }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Rocket className="h-5 w-5 text-emerald-500" /> Confirmar disparo</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2 text-sm">
            <Row label="Contatos" value={`${audienceCount}`} />
            <Row label="Imagem" value={(imageFile || draft.imageUrl) ? 'Sim' : 'Não'} />
            <Row label="Intervalo" value={`aleatório (${DELAY_MIN_SECONDS}–${DELAY_MAX_SECONDS}s)`} />
            <Row label="Tempo estimado" value={minutes > 0 ? `~${minutes} min` : '—'} />
          </div>
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-800">
            <Info className="h-4 w-4 shrink-0" /> Serão enviadas <strong>{audienceCount}</strong> mensagens reais. O envio roda no servidor — você pode fechar a aba que continua.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="ghost" disabled={submitting} onClick={() => setConfirmOpen(false)}>Cancelar</Button>
            <Button onClick={startDispatch} disabled={submitting} className="gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60">
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Iniciando…</> : <><Send className="h-4 w-4" /> Enviar agora</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: salvar seleção atual como lista de transmissão */}
      <Dialog open={listDialogOpen} onOpenChange={(o) => { if (!o) setListDialogOpen(false); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ListPlus className="h-5 w-5 text-emerald-500" /> Salvar lista de transmissão</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <p className="text-[12px] text-slate-500">Guardando <strong>{selectedIds.size}</strong> contato(s) selecionado(s).</p>
            <Input value={listName} onChange={(e) => setListName(e.target.value)} autoFocus
              placeholder="Ex.: Clientes VIP, Bairro Centro..." className="h-11"
              onKeyDown={(e) => { if (e.key === 'Enter' && listName.trim() && !savingList) saveCurrentAsList(); }} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setListDialogOpen(false)}>Cancelar</Button>
            <Button onClick={saveCurrentAsList} disabled={!listName.trim() || savingList}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60">
              {savingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: confirmar exclusão de lista de transmissão */}
      <Dialog open={!!listToDelete} onOpenChange={(o) => { if (!o) setListToDelete(null); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Trash2 className="h-5 w-5 text-rose-500" /> Excluir lista</DialogTitle>
          </DialogHeader>
          <p className="py-1 text-sm text-slate-600">
            Excluir a lista <strong>{listToDelete?.name}</strong>? Isso remove só a lista salva — os contatos continuam na sua base.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setListToDelete(null)}>Cancelar</Button>
            <Button onClick={() => deleteList(listToDelete)} className="gap-2 bg-rose-600 hover:bg-rose-700">
              <Trash2 className="h-4 w-4" /> Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* Subcomponentes locais */
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        {subtitle && <p className="text-[11px] text-slate-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
    </div>
  );
}
