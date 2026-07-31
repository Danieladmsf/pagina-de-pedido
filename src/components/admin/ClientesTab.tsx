'use client';

import React, { useState, useMemo, useRef } from 'react';
import { collection, doc, setDoc, deleteDoc, updateDoc, query, where, getDoc, getDocs, writeBatch } from 'firebase/firestore';
import { useCollection, useMemoFirebase } from '@/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { Search, Plus, Pencil, Trash2, Upload, Users, Phone, MapPin, CalendarDays, ChevronLeft, ChevronRight, Loader2, Eye, X, TrendingUp, ShoppingBag, Info, Receipt, User, Filter, ChevronUp, ChevronDown, ChevronsUpDown, Building2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { normalizeCreditPhone, getPhoneVariants, formatBrazilPhone } from '@/lib/customer-credit';
import { nameDocId } from '@/lib/customers/customer-sync';
import { AddressAutocomplete } from '@/components/ui/address-autocomplete';
import { brl, normalizeSearch } from '@/lib/utils';
import { ContactAvatar } from '@/components/shared/ContactAvatar';
import { makeProfilePhotoLoader } from '@/lib/wapi/profile-photo';
import { PrazoPage } from '@/components/admin/PrazoPage';

interface ClientesTabProps {
  db: any;
  user: any;
  registrarLancamento?: (params: { tipo: 'venda' | 'sangria' | 'suprimento'; titulo: string; valor: number; formaPagamento: string; clienteId?: string; creditTxId?: string }) => Promise<void>;
  caixaAberto?: boolean;
}

interface Cliente {
  id: string;
  nome: string;
  celular: string;
  dataNascimento: string;
  logradouro: string;
  logradouroNumero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  totalPedidos: number;
  totalPontos: number;
  clienteDesde: string;
  ticketMedio: number;
  ultimoPedido: string;
  ownerId: string;
  creditEnabled?: boolean;
  creditBalance?: number;
  creditLimit?: number;
  creditPayDay?: number;
  tipoPessoa?: 'fisica' | 'juridica';
  cnpj?: string;
  razaoSocial?: string;
  nomeFantasia?: string;
  inscricaoEstadual?: string;
}

const ITEMS_PER_PAGE = 20;

type SortKey = 'nome' | 'celular' | 'bairro' | 'cidade' | 'pedidos' | 'ticket' | 'ultimo';

/** Converte "DD/MM/AAAA"(+hora) ou ISO em timestamp; vazio/inválido = 0 (vai pro fim). */
function parseDateBR(value?: string): number {
  if (!value) return 0;
  const t = value.trim();
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
  const parsed = Date.parse(t);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function ClientesTab({ db, user, registrarLancamento, caixaAberto }: ClientesTabProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterBairro, setFilterBairro] = useState('');
  const [filterCidade, setFilterCidade] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('nome');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [isImporting, setIsImporting] = useState(false);
  const [editingCliente, setEditingCliente] = useState<any>(null);
  const [viewingCliente, setViewingCliente] = useState<any>(null);
  // Guarda só o id: o cliente em si vem sempre da lista viva, para a tela do
  // Prazo enxergar saldo/limite novos assim que uma baixa é lançada.
  const [prazoClienteId, setPrazoClienteId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Trava o botão enquanto lê o extrato e apaga, pra não disparar duas vezes.
  const [deletingClienteId, setDeletingClienteId] = useState<string | null>(null);

  // Form fields
  const [formTipoPessoa, setFormTipoPessoa] = useState<'fisica' | 'juridica'>('fisica');
  const [formNome, setFormNome] = useState('');
  const [formCelular, setFormCelular] = useState('');
  const [formNascimento, setFormNascimento] = useState('');
  // Pessoa Jurídica
  const [formCnpj, setFormCnpj] = useState('');
  const [formRazaoSocial, setFormRazaoSocial] = useState('');
  const [formNomeFantasia, setFormNomeFantasia] = useState('');
  const [formInscricaoEstadual, setFormInscricaoEstadual] = useState('');
  const [formLogradouro, setFormLogradouro] = useState('');
  const [formNumero, setFormNumero] = useState('');
  const [formComplemento, setFormComplemento] = useState('');
  const [formBairro, setFormBairro] = useState('');
  const [formCidade, setFormCidade] = useState('');
  const [formCreditEnabled, setFormCreditEnabled] = useState(false);
  const [formCreditLimit, setFormCreditLimit] = useState('');
  const [formCreditPayDay, setFormCreditPayDay] = useState('');
  // Bairros cadastrados em "Taxas por Bairro" (store_profiles), usados como sugestao no campo Bairro
  const [registeredNeighborhoods, setRegisteredNeighborhoods] = useState<string[]>([]);
  const [deliveryCities, setDeliveryCities] = useState<string[]>([]);
  const [showBairroSuggestions, setShowBairroSuggestions] = useState(false);

  React.useEffect(() => {
    if (!db || !user?.uid) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'store_profiles', user.uid));
        const data = snap.exists() ? snap.data() : {};

        // Bairros adicionados manualmente (com taxa) em "Taxas por Bairro"
        const manual: string[] = ((data?.customAddressRules || []) as any[])
          .filter((r) => r?.type === 'neighborhood' && r?.keyword?.trim())
          .map((r) => r.keyword.trim());

        // Lista completa de bairros das cidades de entrega (mesma fonte do StoreProfileTab)
        const cities: string[] = data?.general?.deliveryCities || data?.fees?.deliveryCities || [];
        setDeliveryCities(cities);
        const fetched: string[] = [];
        for (const city of cities) {
          try {
            const res = await fetch(`/api/list-neighborhoods?city=${encodeURIComponent(city)}`);
            if (res.ok) {
              const d = await res.json();
              for (const n of (d?.neighborhoods || [])) if (n?.name) fetched.push(n.name);
            }
          } catch { /* ignora cidade que falhar */ }
        }

        const all = Array.from(new Set<string>([...manual, ...fetched]))
          .sort((a, b) => a.localeCompare(b, 'pt-BR'));
        setRegisteredNeighborhoods(all);
      } catch (err) {
        console.error('[ClientesTab] Erro ao carregar bairros:', err);
      }
    })();
  }, [db, user?.uid]);

  // Query Firestore
  const clientesQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collection(db, 'clientes'), where('ownerId', '==', user.uid));
  }, [db, user]);

  const { data: clientesRaw, isLoading } = useCollection(clientesQuery);
  const clientes = (clientesRaw || []) as Cliente[];

  // Foto de perfil do WhatsApp sob demanda (loader compartilhado, cache de módulo).
  const loadPhoto = useMemo(() => makeProfilePhotoLoader(user), [user]);

  // Opções de filtro derivadas da própria base
  const bairroOptions = useMemo(
    () => Array.from(new Set(clientes.map(c => (c.bairro || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [clientes],
  );
  const cidadeOptions = useMemo(
    () => Array.from(new Set(clientes.map(c => (c.cidade || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [clientes],
  );

  const hasActiveFilters = !!(searchTerm.trim() || filterBairro || filterCidade);
  const clearFilters = () => {
    setSearchTerm(''); setFilterBairro(''); setFilterCidade(''); setCurrentPage(1);
  };

  // Clique no título da coluna: ordena por ela; clicar de novo inverte a direção.
  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      // Números/data começam em "maior primeiro"; texto em A-Z.
      setSortDir(['pedidos', 'ticket', 'ultimo'].includes(key) ? 'desc' : 'asc');
    }
    setCurrentPage(1);
  };

  // Filter + Sort
  const filtered = useMemo(() => {
    let result = [...clientes];
    if (searchTerm.trim()) {
      const term = normalizeSearch(searchTerm);
      // O celular é guardado só em dígitos, então procurar por "(16) 99999-9999"
      // também tem que achar. Compara os dois só pelos números.
      const termDigits = searchTerm.replace(/\D/g, '');
      result = result.filter(c =>
        normalizeSearch(c.nome).includes(term) ||
        normalizeSearch(c.celular).includes(term) ||
        (!!termDigits && (c.celular || '').replace(/\D/g, '').includes(termDigits)) ||
        normalizeSearch(c.bairro).includes(term) ||
        normalizeSearch(c.cidade).includes(term)
      );
    }
    if (filterBairro) result = result.filter(c => (c.bairro || '').trim() === filterBairro);
    if (filterCidade) result = result.filter(c => (c.cidade || '').trim() === filterCidade);

    const dir = sortDir === 'asc' ? 1 : -1;
    result.sort((a, b) => {
      switch (sortBy) {
        case 'pedidos': return ((a.totalPedidos || 0) - (b.totalPedidos || 0)) * dir;
        case 'ticket': return ((a.ticketMedio || 0) - (b.ticketMedio || 0)) * dir;
        case 'ultimo': return (parseDateBR(a.ultimoPedido) - parseDateBR(b.ultimoPedido)) * dir;
        case 'celular': return (a.celular || '').localeCompare(b.celular || '', 'pt-BR') * dir;
        case 'bairro': return (a.bairro || '').localeCompare(b.bairro || '', 'pt-BR') * dir;
        case 'cidade': return (a.cidade || '').localeCompare(b.cidade || '', 'pt-BR') * dir;
        default: return (a.nome || '').localeCompare(b.nome || '', 'pt-BR') * dir;
      }
    });
    return result;
  }, [clientes, searchTerm, filterBairro, filterCidade, sortBy, sortDir]);

  const prazoCliente = prazoClienteId ? clientes.find(c => c.id === prazoClienteId) || null : null;

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated = filtered.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // ─── Handlers ───

  const openNewForm = () => {
    setFormTipoPessoa('fisica');
    setFormNome(''); setFormCelular(''); setFormNascimento('');
    setFormCnpj(''); setFormRazaoSocial(''); setFormNomeFantasia(''); setFormInscricaoEstadual('');
    setFormLogradouro(''); setFormNumero(''); setFormComplemento('');
    setFormBairro(''); setFormCidade('');
    setFormCreditEnabled(false); setFormCreditLimit(''); setFormCreditPayDay('');
    setEditingCliente({});
  };

  const openEditForm = (c: Cliente) => {
    setFormTipoPessoa(c.tipoPessoa === 'juridica' ? 'juridica' : 'fisica');
    setFormNome(c.nome || '');
    setFormCelular(formatBrazilPhone(normalizeCreditPhone(c.celular || '')) || c.celular || '');
    setFormNascimento(c.dataNascimento || '');
    setFormCnpj(c.cnpj || '');
    setFormRazaoSocial(c.razaoSocial || '');
    setFormNomeFantasia(c.nomeFantasia || '');
    setFormInscricaoEstadual(c.inscricaoEstadual || '');
    setFormLogradouro(c.logradouro || '');
    setFormNumero(c.logradouroNumero || '');
    setFormComplemento(c.complemento || '');
    setFormBairro(c.bairro || '');
    setFormCidade(c.cidade || '');
    setFormCreditEnabled(c.creditEnabled || false);
    setFormCreditLimit(c.creditLimit ? c.creditLimit.toString() : '');
    setFormCreditPayDay(c.creditPayDay ? c.creditPayDay.toString() : '');
    setEditingCliente(c);
  };

  // Preenche logradouro/bairro/cidade automaticamente ao selecionar uma sugestão do Maps
  const handlePlaceSelected = async (placeId: string, description: string) => {
    try {
      const res = await fetch(`/api/place-details?placeId=${placeId}`);
      if (!res.ok) throw new Error('Falha ao buscar detalhes do endereço');
      const data = await res.json();
      setFormLogradouro(data.street || description.split(',')[0] || '');
      if (data.neighborhood) setFormBairro(data.neighborhood);
      if (data.city) setFormCidade(data.city);
    } catch (err) {
      console.error('[ClientesTab] Erro ao buscar detalhes do place:', err);
      setFormLogradouro(description.split(',')[0] || description);
    }
  };

  // Máscara do celular: o número é digitado com DDD e guardado só em dígitos,
  // igual ao cadastro rápido do PDV — é o que faz os dois cadastros baterem.
  const handleChangeCelular = (val: string) => {
    const raw = val.replace(/\D/g, '').slice(0, 11);
    let masked = raw;
    if (raw.length > 2) masked = `(${raw.substring(0, 2)}) ${raw.substring(2)}`;
    if (raw.length > 7) masked = `(${raw.substring(0, 2)}) ${raw.substring(2, 7)}-${raw.substring(7, 11)}`;
    setFormCelular(masked);
  };

  // O celular é a ÚNICA chave que liga este cadastro ao pedido do app, ao Prazo
  // e às Campanhas. Sem ele o cliente vira um cadastro solto: a venda a prazo no
  // PDV não acha ninguém e abre um cadastro rápido novo, partindo o histórico
  // em dois. Por isso ele é obrigatório aqui.
  const celularDigits = normalizeCreditPhone(formCelular);
  const isCelularValid = celularDigits.length === 10 || celularDigits.length === 11;
  const isFormValid = (formTipoPessoa === 'juridica'
    ? !!formRazaoSocial.trim()
    : !!formNome.trim()) && isCelularValid;

  /** Procura quem já usa esse número na loja (aceita as variações de formato). */
  const findClienteByCelular = async (phone: string) => {
    if (!phone) return null;
    const variants = getPhoneVariants(phone).slice(0, 30);
    const snap = await getDocs(query(
      collection(db, 'clientes'),
      where('ownerId', '==', user.uid),
      where('celular', 'in', variants),
    ));
    return snap.empty ? null : snap.docs[0];
  };

  const handleSave = async () => {
    if (!db || !user || !isFormValid) return;
    setIsSubmitting(true);
    try {
      const isPJ = formTipoPessoa === 'juridica';
      // Para PJ o "nome" exibido na lista é o nome fantasia (ou razão social).
      const nome = isPJ
        ? (formNomeFantasia.trim() || formRazaoSocial.trim())
        : formNome.trim();
      const data = {
        nome,
        celular: normalizeCreditPhone(formCelular),
        dataNascimento: isPJ ? '' : formNascimento.trim(),
        tipoPessoa: formTipoPessoa,
        cnpj: isPJ ? formCnpj.trim() : '',
        razaoSocial: isPJ ? formRazaoSocial.trim() : '',
        nomeFantasia: isPJ ? formNomeFantasia.trim() : '',
        inscricaoEstadual: isPJ ? formInscricaoEstadual.trim() : '',
        logradouro: formLogradouro.trim(),
        logradouroNumero: formNumero.trim(),
        complemento: formComplemento.trim(),
        bairro: formBairro.trim(),
        cidade: formCidade.trim(),
        ownerId: user.uid,
        // Prazo só existe com celular (ver o Switch no formulário): sem número a
        // venda a prazo não encontra esta ficha e a dívida cai em outro cadastro.
        creditEnabled: isCelularValid && formCreditEnabled,
        creditLimit: Number(formCreditLimit) || 0,
        creditPayDay: Number(formCreditPayDay) || 0,
      };

      // Quem já usa esse número: no cadastro novo vira atualização do mesmo
      // cliente; na edição impede partir o histórico em dois cadastros.
      const jaCadastrado = await findClienteByCelular(data.celular);

      if (editingCliente?.id) {
        if (jaCadastrado && jaCadastrado.id !== editingCliente.id) {
          toast({
            variant: 'destructive',
            title: 'Esse celular já é de outro cliente',
            description: `"${jaCadastrado.data().nome || 'Sem nome'}" já está cadastrado com esse número. Use o cadastro dele — senão as compras e o Prazo ficam divididos em dois clientes.`,
          });
          return;
        }
        await updateDoc(doc(db, 'clientes', editingCliente.id), data);
        toast({ title: 'Cliente atualizado!' });
      } else {
        const isExisting = !!jaCadastrado;
        const docId = jaCadastrado ? jaCadastrado.id : `${user.uid}_${data.celular}`;

        // Os zeros (saldo do Prazo, nº de pedidos, ticket) só valem para um
        // cadastro NOVO. Reaproveitando um cliente que já existe eles apagariam
        // a dívida em aberto e o histórico de compras dele.
        const inicial = isExisting ? {} : {
          totalPedidos: 0,
          totalPontos: 0,
          ticketMedio: 0,
          creditBalance: 0,
          clienteDesde: new Date().toLocaleDateString('pt-BR'),
          ultimoPedido: '',
        };

        await setDoc(doc(db, 'clientes', docId), { ...data, id: docId, ...inicial }, { merge: true });
        toast({ title: isExisting ? 'Cliente atualizado (já cadastrado)!' : 'Cliente cadastrado!' });
      }
      setEditingCliente(null);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Exclui o cliente E o extrato do Prazo dele.
   *
   * O Firestore NÃO apaga subcoleção junto com o documento, então antes o
   * extrato (`clientes/{id}/credit_transactions`) sobrevivia invisível. E como o
   * id do cliente vem do telefone (`{uid}_{celular}`), recadastrar o mesmo
   * número reatava o extrato antigo no cadastro novo — a dívida ressuscitava.
   *
   * Com saldo em aberto a exclusão é bloqueada: o extrato é a fonte de verdade
   * do saldo, e apagar dívida sem querer é perda de dinheiro real.
   */
  const handleDelete = async (id: string) => {
    if (!db || deletingClienteId) return;
    setDeletingClienteId(id);
    try {
      const transSnap = await getDocs(collection(db, 'clientes', id, 'credit_transactions'));
      const saldo = transSnap.docs.reduce((acc, d) => {
        const t: any = d.data();
        const valor = Number(t.amount) || 0;
        return acc + (t.type === 'debit' ? valor : -valor);
      }, 0);

      if (saldo > 0.009) {
        toast({
          variant: 'destructive',
          title: 'Cliente com conta em aberto',
          description: `Ele ainda deve ${brl(saldo)} no Prazo. Receba ou acerte o extrato antes de excluir.`,
        });
        return;
      }
      if (saldo < -0.009) {
        toast({
          variant: 'destructive',
          title: 'Cliente tem crédito a favor',
          description: `Há ${brl(Math.abs(saldo))} a favor dele. Acerte o extrato antes de excluir.`,
        });
        return;
      }

      const aviso = transSnap.size > 0
        ? `\n\nO extrato do Prazo (${transSnap.size} ${transSnap.size === 1 ? 'lançamento' : 'lançamentos'}, saldo zerado) será apagado junto e não tem como recuperar.`
        : '';
      if (!confirm(`Excluir este cliente?${aviso}`)) return;

      // Extrato primeiro: se falhar no meio, o cliente continua lá e nada fica
      // órfão. Lotes de 450 pro limite de 500 operações do Firestore.
      const LOTE = 450;
      for (let i = 0; i < transSnap.docs.length; i += LOTE) {
        const batch = writeBatch(db);
        transSnap.docs.slice(i, i + LOTE).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      await deleteDoc(doc(db, 'clientes', id));
      toast({ title: 'Cliente excluído.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err.message });
    } finally {
      setDeletingClienteId(null);
    }
  };

  // ─── CSV Import ───
  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !db || !user) return;

    setIsImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const decoder = new TextDecoder('windows-1252');
      const text = decoder.decode(buffer);
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) {
        toast({ variant: 'destructive', title: 'CSV vazio ou inválido' });
        return;
      }

      // Parse header
      const header = parseCSVLine(lines[0]);
      const nameIdx = header.indexOf('nome');
      const phoneIdx = header.indexOf('celular');
      const birthIdx = header.indexOf('data_nascimento');
      const streetIdx = header.indexOf('logradouro');
      const numIdx = header.indexOf('logradouro_numero');
      const compIdx = header.indexOf('complemento');
      const neighIdx = header.indexOf('bairro');
      const cityIdx = header.indexOf('cidade');
      const totalIdx = header.indexOf('total');
      const pointsIdx = header.indexOf('total_pontos');
      const sinceIdx = header.indexOf('cliente_desde');
      const ticketIdx = header.indexOf('ticket_medio');
      const lastIdx = header.indexOf('ultimo_pedido');

      let imported = 0;
      const BATCH_SIZE = 400;
      let batch = writeBatch(db);
      let batchCount = 0;

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        const nome = (cols[nameIdx] || '').trim();
        if (!nome) continue;

        // Id previsível também sem telefone: reimportar a mesma planilha
        // atualiza o cliente em vez de criar uma cópia dele.
        const normalizedPhone = normalizeCreditPhone(cols[phoneIdx] || '');
        const docId = normalizedPhone ? `${user.uid}_${normalizedPhone}` : nameDocId(user.uid, nome);
        const ref = doc(db, 'clientes', docId);
        batch.set(ref, {
          id: docId,
          nome,
          celular: normalizedPhone,
          dataNascimento: (cols[birthIdx] || '').trim(),
          logradouro: (cols[streetIdx] || '').trim(),
          logradouroNumero: (cols[numIdx] || '').trim(),
          complemento: (cols[compIdx] || '').trim(),
          bairro: (cols[neighIdx] || '').trim(),
          cidade: (cols[cityIdx] || '').trim(),
          totalPedidos: parseInt(cols[totalIdx] || '0') || 0,
          totalPontos: parseInt(cols[pointsIdx] || '0') || 0,
          clienteDesde: (cols[sinceIdx] || '').trim(),
          ticketMedio: parseFloat(cols[ticketIdx] || '0') || 0,
          ultimoPedido: (cols[lastIdx] || '').trim(),
          ownerId: user.uid,
        });

        batchCount++;
        imported++;

        if (batchCount >= BATCH_SIZE) {
          await batch.commit();
          batch = writeBatch(db);
          batchCount = 0;
        }
      }

      if (batchCount > 0) {
        await batch.commit();
      }

      toast({ title: `${imported} clientes importados com sucesso!` });
    } catch (err: any) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Erro na importação', description: err.message });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ─── Stats ───
  // Cabeçalho de coluna clicável (ordena ao clicar; inverte ao clicar de novo).
  const SortableHead = ({ k, label, className, justify = 'start' }: { k: SortKey; label: string; className?: string; justify?: 'start' | 'center' | 'end' }) => {
    const active = sortBy === k;
    const justifyCls = justify === 'center' ? 'justify-center' : justify === 'end' ? 'justify-end' : 'justify-start';
    return (
      <TableHead className={className}>
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className={`flex w-full items-center gap-1 select-none transition-colors hover:text-emerald-600 ${justifyCls} ${active ? 'text-emerald-600 font-bold' : ''}`}
        >
          {label}
          {active
            ? (sortDir === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />)
            : <ChevronsUpDown className="h-3.5 w-3.5 opacity-30" />}
        </button>
      </TableHead>
    );
  };

  if (isLoading) {
    return <div className="py-20 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  // A gestão do Prazo é uma TELA, não um modal: ocupa a aba inteira e volta
  // para a lista pelo botão do cabeçalho. O cliente vem da lista viva, então
  // saldo e limite se atualizam sozinhos depois de cada lançamento.
  if (prazoCliente) {
    return (
      <PrazoPage
        key={prazoCliente.id}
        db={db}
        user={user}
        cliente={prazoCliente}
        caixaAberto={caixaAberto}
        registrarLancamento={registrarLancamento}
        onBack={() => setPrazoClienteId(null)}
        onEditCliente={(c) => { setPrazoClienteId(null); openEditForm(c); }}
      />
    );
  }

  return (
    <div className="w-full max-w-[1400px] mx-auto flex flex-col h-full min-h-0 gap-4 pt-4 pb-2">
      <div className="px-2 shrink-0">
        <h1 className="text-3xl font-black tracking-tight text-slate-800">Base de Clientes</h1>
        <p className="text-muted-foreground mt-1 font-medium">Cadastre, gerencie e acompanhe o histórico de pedidos da sua carteira de clientes.</p>
      </div>

      {/* SEÇÃO — Tabela de Clientes */}
      <section className="bg-white rounded-2xl shadow-sm border overflow-hidden flex-1 min-h-0 flex flex-col">
        <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3 shrink-0">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500/15 to-teal-500/15 border border-emerald-500/20 flex items-center justify-center">
            <Users className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-slate-800">Cadastro de clientes</h2>
            <p className="text-xs text-muted-foreground">Consulte, edite ou importe sua base de clientes.</p>
          </div>
          <div className="flex gap-2">
            <input type="file" accept=".csv" ref={fileInputRef} onChange={handleImportCSV} className="hidden" />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isImporting} className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 h-8 text-xs">
              {isImporting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
              Importar CSV
            </Button>
            <Button onClick={openNewForm} className="bg-primary text-white h-8 text-xs">
              <Plus className="h-4 w-4 mr-1.5" /> Novo Cliente
            </Button>
          </div>
        </header>

        {/* Filtros */}
        <div className="p-3 border-b bg-muted/20 flex flex-wrap items-center gap-2 shrink-0">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, telefone, bairro..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="pl-9 h-9"
            />
          </div>

          {/* Bairro */}
          <div className="relative">
            <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <select
              value={filterBairro}
              onChange={(e) => { setFilterBairro(e.target.value); setCurrentPage(1); }}
              className="h-9 rounded-md border border-input bg-white pl-8 pr-7 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-w-[160px]"
            >
              <option value="">Todos os bairros</option>
              {bairroOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          {/* Cidade */}
          <div className="relative">
            <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <select
              value={filterCidade}
              onChange={(e) => { setFilterCidade(e.target.value); setCurrentPage(1); }}
              className="h-9 rounded-md border border-input bg-white pl-8 pr-7 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-w-[160px]"
            >
              <option value="">Todas as cidades</option>
              {cidadeOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 text-xs text-slate-500 hover:text-slate-700 gap-1">
              <X className="h-3.5 w-3.5" /> Limpar
            </Button>
          )}

          <Badge variant="outline" className="ml-auto h-9 flex items-center gap-1.5 text-[11px] text-slate-500">
            <Filter className="h-3 w-3" /> {filtered.length} de {clientes.length}
          </Badge>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <Table>
            <TableHeader className="bg-muted/30 sticky top-0 z-10 backdrop-blur-sm">
              <TableRow>
                <SortableHead k="nome" label="Nome" className="pl-4" />
                <SortableHead k="celular" label="Celular" />
                <SortableHead k="bairro" label="Bairro" />
                <SortableHead k="cidade" label="Cidade" />
                <SortableHead k="pedidos" label="Pedidos" className="text-center" justify="center" />
                <SortableHead k="ticket" label="Ticket Médio" className="text-center" justify="center" />
                <SortableHead k="ultimo" label="Último Pedido" />
                <TableHead className="text-right pr-4">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                    {clientes.length === 0 ? 'Nenhum cliente cadastrado. Importe um CSV ou cadastre manualmente.' : 'Nenhum resultado encontrado.'}
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map(c => (
                  <TableRow key={c.id} className="hover:bg-muted/20 cursor-pointer" onClick={() => setViewingCliente(c)}>
                    <TableCell className="pl-4 font-semibold text-slate-700">
                      <div className="flex items-center gap-2.5">
                        <ContactAvatar
                          phone={c.celular || ''}
                          initials={(c.nome || '?').split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                          loadPhoto={loadPhoto}
                        />
                        <span>
                          {c.nome}
                          {/* Prazo ativo sem celular é cadastro órfão vindo da base
                              antiga (hoje o formulário não deixa mais salvar assim).
                              Fica marcado para o dono achar e completar o número. */}
                          {c.creditEnabled && (
                            normalizeCreditPhone(c.celular || '').length >= 10 ? (
                              <Badge variant="secondary" className="ml-2 text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200">Conta da Casa</Badge>
                            ) : (
                              <Badge
                                variant="secondary"
                                title="Prazo ativo sem celular: a venda a prazo não vai achar este cadastro. Edite o cliente e inclua o número."
                                className="ml-2 text-[10px] bg-amber-50 text-amber-700 border-amber-300"
                              >
                                Prazo sem celular
                              </Badge>
                            )
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{formatBrazilPhone(normalizeCreditPhone(c.celular || '')) || c.celular || '-'}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{c.bairro || '-'}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{c.cidade || '-'}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="font-bold">{c.totalPedidos || 0}</Badge>
                    </TableCell>
                    <TableCell className="text-center font-bold text-emerald-600 text-sm">
                      {c.ticketMedio ? `${brl(c.ticketMedio)}` : '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{c.ultimoPedido || '-'}</TableCell>
                    <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setPrazoClienteId(c.id); }} title="Abrir o Prazo (conta do cliente)">
                          <Receipt className="h-3.5 w-3.5 text-indigo-500" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewingCliente(c)} title="Ver Detalhes">
                          <Eye className="h-3.5 w-3.5 text-blue-500" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditForm(c)} title="Editar Cliente">
                          <Pencil className="h-3.5 w-3.5 text-amber-500" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(c.id)} disabled={deletingClienteId === c.id} title="Excluir">
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* Pagination */}
      <div className="bg-white rounded-2xl shadow-sm border p-4 flex items-center justify-between shrink-0">
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Info className="h-3.5 w-3.5 text-slate-400" />
          Página {currentPage} de {totalPages} — {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
        </p>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ─── Modal: Novo/Editar Cliente ─── */}
      <Dialog open={editingCliente !== null} onOpenChange={(open) => { if (!open) setEditingCliente(null); }}>
        <DialogContent className="sm:max-w-[600px] p-0 overflow-hidden">
          <DialogHeader className="bg-gradient-to-r from-slate-50 to-white px-4 py-2 border-b">
            <DialogTitle className="text-base flex items-center gap-1.5 text-slate-800">
              <Users className="h-3.5 w-3.5 text-emerald-600" />
              {editingCliente?.id ? 'Editar Cliente' : 'Novo Cliente'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="max-h-[85vh] overflow-y-auto px-4 py-3 space-y-3 custom-scrollbar">
            {/* Tipo de cliente: Pessoa Física x Pessoa Jurídica */}
            <Tabs value={formTipoPessoa} onValueChange={(v) => setFormTipoPessoa(v as 'fisica' | 'juridica')}>
              <TabsList className="grid w-full grid-cols-2 h-8">
                <TabsTrigger value="fisica" className="text-xs gap-1.5">
                  <User className="h-3 w-3" /> Pessoa Física
                </TabsTrigger>
                <TabsTrigger value="juridica" className="text-xs gap-1.5">
                  <Building2 className="h-3 w-3" /> Pessoa Jurídica
                </TabsTrigger>
              </TabsList>

              {/* ── Pessoa Física ── */}
              <TabsContent value="fisica" className="mt-3">
                <div className="space-y-1.5">
                  <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 border-b pb-1">
                    <User className="h-3 w-3 text-slate-500" /> Informações Pessoais
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <div className="space-y-0.5 md:col-span-2">
                      <Label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Nome Completo *</Label>
                      <Input value={formNome} onChange={(e) => setFormNome(e.target.value)} placeholder="Ex: João da Silva" className="bg-slate-50/50 h-7 text-xs px-2" />
                    </div>
                    <div className="space-y-0.5">
                      <Label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Celular *</Label>
                      <Input value={formCelular} onChange={(e) => handleChangeCelular(e.target.value)} placeholder="(00) 00000-0000" className="bg-slate-50/50 h-7 text-xs px-2" />
                    </div>
                    <div className="space-y-0.5">
                      <Label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Nascimento</Label>
                      <Input value={formNascimento} onChange={(e) => setFormNascimento(e.target.value)} placeholder="DD/MM/AAAA" className="bg-slate-50/50 h-7 text-xs px-2" />
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* ── Pessoa Jurídica ── */}
              <TabsContent value="juridica" className="mt-3">
                <div className="space-y-1.5">
                  <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 border-b pb-1">
                    <Building2 className="h-3 w-3 text-slate-500" /> Dados da Empresa
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <div className="space-y-0.5 md:col-span-2">
                      <Label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Razão Social *</Label>
                      <Input value={formRazaoSocial} onChange={(e) => setFormRazaoSocial(e.target.value)} placeholder="Ex: Comércio de Alimentos LTDA" className="bg-slate-50/50 h-7 text-xs px-2" />
                    </div>
                    <div className="space-y-0.5 md:col-span-2">
                      <Label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Nome Fantasia</Label>
                      <Input value={formNomeFantasia} onChange={(e) => setFormNomeFantasia(e.target.value)} placeholder="Ex: Restaurante do Zé" className="bg-slate-50/50 h-7 text-xs px-2" />
                    </div>
                    <div className="space-y-0.5 md:col-span-2">
                      <Label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">CNPJ</Label>
                      <Input value={formCnpj} onChange={(e) => setFormCnpj(e.target.value)} placeholder="00.000.000/0000-00" className="bg-slate-50/50 h-7 text-xs px-2" />
                    </div>
                    <div className="space-y-0.5">
                      <Label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Insc. Estadual</Label>
                      <Input value={formInscricaoEstadual} onChange={(e) => setFormInscricaoEstadual(e.target.value)} placeholder="Isento / nº" className="bg-slate-50/50 h-7 text-xs px-2" />
                    </div>
                    <div className="space-y-0.5">
                      <Label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Celular *</Label>
                      <Input value={formCelular} onChange={(e) => handleChangeCelular(e.target.value)} placeholder="(00) 00000-0000" className="bg-slate-50/50 h-7 text-xs px-2" />
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            {formCelular.trim() && !isCelularValid && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                Celular incompleto — digite com o DDD, ex.: (16) 99999-9999.
              </p>
            )}
            <p className="text-[11px] text-slate-500 leading-snug">
              O celular é o que liga este cadastro ao cliente no app de pedidos e à conta do Prazo.
              Sem ele, uma compra a prazo no PDV não encontra o cliente e acaba criando um cadastro separado.
            </p>

            {/* Endereço */}
            <div className="space-y-1.5">
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 border-b pb-1">
                <MapPin className="h-3 w-3 text-slate-500" /> Endereço de Entrega
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <div className="space-y-0.5 md:col-span-2">
                  <Label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Logradouro</Label>
                  <AddressAutocomplete
                    value={formLogradouro}
                    onChange={setFormLogradouro}
                    onSelectPlace={handlePlaceSelected}
                    locationContext={(formCidade.trim() || deliveryCities.join(', ')) || undefined}
                    placeholder="Buscar endereço no Maps..."
                    className="bg-slate-50/50 h-7 text-xs"
                  />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Nº</Label>
                  <Input value={formNumero} onChange={(e) => setFormNumero(e.target.value)} placeholder="123" className="bg-slate-50/50 h-7 text-xs px-2" />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Complemento</Label>
                  <Input value={formComplemento} onChange={(e) => setFormComplemento(e.target.value)} placeholder="Apto..." className="bg-slate-50/50 h-7 text-xs px-2" />
                </div>
                <div className="space-y-0.5 md:col-span-2">
                  <Label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Bairro</Label>
                  <div className="relative">
                    <Input
                      value={formBairro}
                      onChange={(e) => { setFormBairro(e.target.value); setShowBairroSuggestions(true); }}
                      onFocus={() => setShowBairroSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowBairroSuggestions(false), 200)}
                      placeholder="Bairro"
                      autoComplete="off"
                      className="bg-slate-50/50 h-7 text-xs px-2"
                    />
                    {showBairroSuggestions && (() => {
                      const term = normalizeSearch(formBairro.trim());
                      const filtered = term.length > 0
                        ? registeredNeighborhoods.filter((b) => normalizeSearch(b).includes(term))
                        : registeredNeighborhoods;
                      if (filtered.length === 0) return null;
                      return (
                        <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                          {filtered.map((b) => (
                            <button
                              key={b}
                              type="button"
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-emerald-50 border-b last:border-0 transition-colors"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => { setFormBairro(b); setShowBairroSuggestions(false); }}
                            >
                              {b}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                <div className="space-y-0.5 md:col-span-2">
                  <Label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Cidade</Label>
                  <Input value={formCidade} onChange={(e) => setFormCidade(e.target.value)} placeholder="Cidade" className="bg-slate-50/50 h-7 text-xs px-2" />
                </div>
              </div>
            </div>
            
            {/* Conta da Casa */}
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded px-3 py-2 border border-indigo-100 shadow-inner space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Receipt className="h-3.5 w-3.5 text-indigo-600" />
                  <div>
                    <Label className="text-xs font-bold text-indigo-900 cursor-pointer mb-0 leading-none" htmlFor="toggle-conta-casa">Ativar Prazo</Label>
                    <p className="text-[9px] text-indigo-700/80 leading-tight mt-0.5">
                      {isCelularValid
                        ? 'Permite compras a prazo no app/painel.'
                        : 'Preencha o celular acima para poder ativar.'}
                    </p>
                  </div>
                </div>
                {/* Sem celular o Prazo não pode ser ligado: é o número que liga
                    a venda a prazo a esta ficha. Ligado sem telefone, o PDV não
                    acha o cliente, abre cadastro rápido e a dívida vai para uma
                    segunda conta — o limite fica aqui e o saldo, lá. */}
                <Switch
                  id="toggle-conta-casa"
                  checked={isCelularValid && formCreditEnabled}
                  onCheckedChange={setFormCreditEnabled}
                  disabled={!isCelularValid}
                  title={isCelularValid ? undefined : 'Cadastre o celular do cliente para liberar o Prazo'}
                  className="data-[state=checked]:bg-indigo-600 scale-90 shrink-0 disabled:opacity-40"
                />
              </div>

              {isCelularValid && formCreditEnabled && (
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-indigo-100/50">
                  <div className="space-y-0.5">
                    <Label className="text-[10px] text-indigo-900 font-bold uppercase">Limite de Gastos (R$)</Label>
                    <CurrencyInput 
                      value={Number(formCreditLimit) || 0} 
                      onChange={(val) => setFormCreditLimit(val.toString())} 
                      placeholder="0,00" 
                      className="bg-white h-7 text-xs px-2 border-indigo-100" 
                    />
                    <p className="text-[8px] text-indigo-600">0 = sem limite</p>
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-[10px] text-indigo-900 font-bold uppercase">Dia de Pagamento</Label>
                    <Input 
                      value={formCreditPayDay} 
                      onChange={(e) => setFormCreditPayDay(e.target.value.replace(/[^0-9]/g, ''))} 
                      placeholder="Ex: 10" 
                      className="bg-white h-7 text-xs px-2 border-indigo-100" 
                      maxLength={2} 
                    />
                    <p className="text-[8px] text-indigo-600">Bloqueia no dia seguinte se houver dívida</p>
                  </div>
                </div>
              )}
            </div>
          </div>
          
          <DialogFooter className="bg-slate-50 px-4 py-2 border-t flex sm:justify-between items-center w-full">
            <Button variant="ghost" size="sm" onClick={() => setEditingCliente(null)} className="text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 h-7 text-xs px-3">Cancelar</Button>
            <Button size="sm" onClick={handleSave} disabled={isSubmitting || !isFormValid} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-7 text-xs px-5 shadow-sm">
              {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : null}
              Salvar Cliente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Modal: Visualizar Cliente ─── */}
      <Dialog open={viewingCliente !== null} onOpenChange={(open) => { if (!open) setViewingCliente(null); }}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" /> {viewingCliente?.nome}
            </DialogTitle>
          </DialogHeader>
          {viewingCliente && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-start gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground">Celular</p>
                    <p className="font-semibold text-sm">{formatBrazilPhone(normalizeCreditPhone(viewingCliente.celular || '')) || viewingCliente.celular || '-'}</p>
                  </div>
                </div>
                {viewingCliente.tipoPessoa === 'juridica' ? (
                  <div className="flex items-start gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground">CNPJ</p>
                      <p className="font-semibold text-sm">{viewingCliente.cnpj || '-'}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <CalendarDays className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground">Nascimento</p>
                      <p className="font-semibold text-sm">{viewingCliente.dataNascimento || '-'}</p>
                    </div>
                  </div>
                )}
              </div>

              {viewingCliente.tipoPessoa === 'juridica' && (viewingCliente.razaoSocial || viewingCliente.inscricaoEstadual) && (
                <div className="flex items-start gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground">Razão Social</p>
                    <p className="font-semibold text-sm">{viewingCliente.razaoSocial || '-'}</p>
                    {viewingCliente.inscricaoEstadual && (
                      <p className="text-xs text-muted-foreground">IE: {viewingCliente.inscricaoEstadual}</p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground">Endereço</p>
                  <p className="font-semibold text-sm">
                    {[viewingCliente.logradouro, viewingCliente.logradouroNumero].filter(Boolean).join(', ') || '-'}
                    {viewingCliente.complemento ? ` (${viewingCliente.complemento})` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[viewingCliente.bairro, viewingCliente.cidade].filter(Boolean).join(' - ') || ''}
                  </p>
                </div>
              </div>

              <div className="border-t pt-3 grid grid-cols-3 gap-3">
                <div className="text-center p-2 bg-blue-50 rounded-xl">
                  <ShoppingBag className="h-4 w-4 text-blue-600 mx-auto mb-1" />
                  <p className="text-lg font-black text-blue-700">{viewingCliente.totalPedidos || 0}</p>
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">Pedidos</p>
                </div>
                <div className="text-center p-2 bg-emerald-50 rounded-xl">
                  <TrendingUp className="h-4 w-4 text-emerald-600 mx-auto mb-1" />
                  <p className="text-lg font-black text-emerald-700">
                    {viewingCliente.ticketMedio ? `R$ ${viewingCliente.ticketMedio.toFixed(0)}` : '-'}
                  </p>
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">Ticket Médio</p>
                </div>
                <div className="text-center p-2 bg-amber-50 rounded-xl">
                  <CalendarDays className="h-4 w-4 text-amber-600 mx-auto mb-1" />
                  <p className="text-xs font-black text-amber-700 mt-1">{viewingCliente.ultimoPedido || '-'}</p>
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">Último Pedido</p>
                </div>
              </div>

              <div className="text-xs text-muted-foreground text-center pt-1">
                Cliente desde: {viewingCliente.clienteDesde || '-'}
              </div>

              {viewingCliente.creditEnabled && (
                <div className="pt-2 border-t mt-2">
                  <Button 
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold" 
                    onClick={() => {
                      setPrazoClienteId(viewingCliente.id);
                      setViewingCliente(null);
                    }}
                  >
                    <Receipt className="w-4 h-4 mr-2" /> Abrir conta do Prazo
                  </Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingCliente(null)}>Fechar</Button>
            <Button onClick={() => { openEditForm(viewingCliente); setViewingCliente(null); }} className="bg-amber-500 hover:bg-amber-600 text-white">
              <Pencil className="h-4 w-4 mr-2" /> Editar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
