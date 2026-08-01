'use client';

import React, { useState, useMemo, useRef } from 'react';
import type { RegistrarLancamento } from '@/hooks/useCaixa';
import {
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
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
import { Search, Plus, Pencil, Trash2, Upload, Users, Phone, MapPin, CalendarDays, ChevronLeft, ChevronRight, Loader2, Eye, X, TrendingUp, ShoppingBag, Info, Receipt, User, Filter, ChevronUp, ChevronDown, ChevronsUpDown, Building2, Archive, RotateCcw, ShieldAlert, GitMerge, RefreshCw, AlertTriangle } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { normalizeCreditPhone, getPhoneVariants, formatBrazilPhone, isCreditEnabled, isValidCreditPhone } from '@/lib/customer-credit';
import { nameDocId, unidentifiedCustomerDocId } from '@/lib/customers/customer-sync';
import {
  buildCustomerImportIndex,
  hasExactLegacyCustomerPhone,
  resolveCustomerImportPhone,
} from '@/lib/customers/customer-import';
import { AddressAutocomplete } from '@/components/ui/address-autocomplete';
import { brl, normalizeSearch } from '@/lib/utils';
import { ContactAvatar } from '@/components/shared/ContactAvatar';
import { makeProfilePhotoLoader } from '@/lib/wapi/profile-photo';
import { PrazoPage } from '@/components/admin/PrazoPage';
import { FichaClientePage } from '@/components/admin/FichaClientePage';
import {
  balanceDivergenceIssue,
  findCustomerIdentityIssues,
  findOrderIdentityIssues,
  isCustomerArchived,
  isIntegrityIssueIgnored,
  type CustomerIntegrityIssue,
} from '@/lib/customer-integrity';
import { mergeCustomers } from '@/lib/customers/customer-merge';

interface ClientesTabProps {
  db: any;
  user: any;
  registrarLancamento?: RegistrarLancamento;
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
  archived?: boolean;
  archivedAt?: unknown;
  archiveReason?: string;
  mergedInto?: string;
  integrityIgnoredIssues?: string[];
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
  const separator = line.includes(';') && !line.includes(',') ? ';' : ',';
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === separator && !inQuotes) {
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
  const [fichaClienteId, setFichaClienteId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [integrityIssues, setIntegrityIssues] = useState<CustomerIntegrityIssue[] | null>(null);
  const [checkingIntegrity, setCheckingIntegrity] = useState(false);
  const [resolvingIssueKey, setResolvingIssueKey] = useState<string | null>(null);

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

  const { data: clientesRaw, isLoading, error: clientesError } = useCollection(clientesQuery);
  const allClientes = (clientesRaw || []) as Cliente[];
  const clientes = useMemo(
    () => allClientes.filter((customer) => showArchived ? isCustomerArchived(customer) : !isCustomerArchived(customer)),
    [allClientes, showArchived],
  );

  // Foto de perfil do WhatsApp sob demanda (loader compartilhado, cache de módulo).
  const loadPhoto = useMemo(() => makeProfilePhotoLoader(user, user.uid), [user]);

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

  const prazoCliente = prazoClienteId ? allClientes.find(c => c.id === prazoClienteId) || null : null;
  const fichaCliente = fichaClienteId ? allClientes.find(c => c.id === fichaClienteId) || null : null;

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
    if (!phone) return { kind: 'none' as const };
    const normalized = normalizeCreditPhone(phone);
    const variants = getPhoneVariants(phone).slice(0, 30);
    const snap = await getDocs(query(
      collection(db, 'clientes'),
      where('ownerId', '==', user.uid),
      where('celular', 'in', variants),
    ));
    const exact = snap.docs.filter((candidate) =>
      normalizeCreditPhone(String(candidate.data()?.celular || '')) === normalized,
    );
    const active = exact.filter((candidate) => candidate.data()?.archived !== true);
    if (active.length > 1) return { kind: 'ambiguous' as const };
    if (active.length === 1) return { kind: 'unique' as const, doc: active[0] };
    if (exact.some((candidate) => candidate.data()?.archived === true)) {
      return { kind: 'archived' as const };
    }
    return { kind: 'none' as const };
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
      const phoneMatch = await findClienteByCelular(data.celular);
      if (phoneMatch.kind === 'ambiguous') {
        toast({
          variant: 'destructive',
          title: 'Telefone em conflito',
          description: 'Mais de um cadastro ativo usa esse telefone. Resolva o conflito antes de salvar.',
        });
        return;
      }
      if (phoneMatch.kind === 'archived') {
        toast({
          variant: 'destructive',
          title: 'Cliente arquivado',
          description: 'Restaure o cadastro arquivado antes de reutilizar este telefone.',
        });
        return;
      }
      const jaCadastrado = phoneMatch.kind === 'unique' ? phoneMatch.doc : null;

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
        let existingTarget = jaCadastrado;
        const proposedId = `${user.uid}_${data.celular}`;

        // A busca por telefone reutiliza ids legados. Se ela nao achou nada,
        // o id deterministico ainda precisa ser conferido: ele pode pertencer a
        // um cliente que trocou de telefone. Um set(merge) nesse caso partiria
        // silenciosamente o historico daquele cadastro.
        if (!existingTarget) {
          const proposedSnap = await getDoc(doc(db, 'clientes', proposedId));
          if (proposedSnap.exists()) {
            const current = proposedSnap.data() || {};
            const sameIdentity = current.ownerId === user.uid
              && current.archived !== true
              && normalizeCreditPhone(String(current.celular || '')) === data.celular;
            if (!sameIdentity) {
              toast({
                variant: 'destructive',
                title: 'Conflito no cadastro',
                description: 'O identificador desse telefone ja pertence a outro historico. Corrija o cadastro existente antes de continuar.',
              });
              return;
            }
            existingTarget = proposedSnap as any;
          }
        }

        const isExisting = !!existingTarget;
        const docId = existingTarget ? existingTarget.id : proposedId;

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

        const targetRef = doc(db, 'clientes', docId);
        await runTransaction(db, async (transaction) => {
          const currentSnap = await transaction.get(targetRef);
          if (isExisting) {
            if (!currentSnap.exists()) throw new Error('O cadastro mudou enquanto era salvo. Tente novamente.');
            const current: any = currentSnap.data() || {};
            const sameIdentity = current.ownerId === user.uid
              && current.archived !== true
              && normalizeCreditPhone(String(current.celular || '')) === data.celular;
            if (!sameIdentity) throw new Error('O identificador foi ocupado por outro histórico. Resolva o conflito antes de salvar.');
            transaction.set(targetRef, data, { merge: true });
            return;
          }
          if (currentSnap.exists()) throw new Error('O identificador foi ocupado enquanto o cadastro era salvo. Tente novamente.');
          transaction.set(targetRef, { ...data, id: docId, ...inicial });
        });
        toast({ title: isExisting ? 'Cliente atualizado (já cadastrado)!' : 'Cliente cadastrado!' });
      }
      setEditingCliente(null);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const archiveCustomer = async (id: string, reason: string) => {
    const customer = allClientes.find((item) => item.id === id);
    await updateDoc(doc(db, 'clientes', id), {
      archived: true,
      archivedAt: serverTimestamp(),
      archiveReason: reason,
      creditEnabledBeforeArchive: isCreditEnabled(customer),
      creditEnabled: false,
    });
  };

  const restoreCustomer = async (id: string) => {
    try {
      const customer = allClientes.find((item) => item.id === id) as any;
      if (customer?.mergedInto) {
        toast({
          variant: 'destructive',
          title: 'Cadastro unificado',
          description: `Este cadastro foi incorporado em ${customer.mergedInto}. Restaurá-lo isoladamente duplicaria o extrato.`,
        });
        return;
      }
      if (isValidCreditPhone(customer?.celular || '')) {
        const phoneMatch = await findClienteByCelular(customer.celular);
        if (phoneMatch.kind === 'ambiguous'
          || (phoneMatch.kind === 'unique' && phoneMatch.doc.id !== id)) {
          toast({
            variant: 'destructive',
            title: 'Telefone em uso',
            description: 'Outro cadastro ativo usa este telefone. Resolva o conflito antes de restaurar.',
          });
          return;
        }
      }
      await updateDoc(doc(db, 'clientes', id), {
        archived: false,
        archivedAt: deleteField(),
        archiveReason: deleteField(),
        mergedInto: deleteField(),
        creditEnabled: customer?.creditEnabledBeforeArchive === true,
        creditEnabledBeforeArchive: deleteField(),
      });
      toast({ title: 'Cliente restaurado.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Não foi possível restaurar', description: err?.message });
    }
  };

  /**
   * Histórico e referências vencem a vontade de apagar: nesses casos o cliente
   * é arquivado. Exclusão física só acontece com saldo zero, sem pedido novo
   * apontando por `clienteId`, e em um único batch atômico.
   */
  const handleDelete = async (id: string) => {
    if (!db || deletingClienteId) return;
    setDeletingClienteId(id);
    try {
      const customer = allClientes.find((item) => item.id === id);
      const transSnap = await getDocs(collection(db, 'clientes', id, 'credit_transactions'));
      const saldo = transSnap.docs.reduce((acc, d) => {
        const t: any = d.data();
        const valor = Number(t.amount) || 0;
        if (t.type === 'debit') return acc + valor;
        if (t.type === 'credit') return acc - valor;
        return acc;
      }, 0);

      const [ordersSnap, encomendasSnap, cashTransactionsSnap] = await Promise.all([
        getDocs(query(collection(db, 'orders'), where('ownerId', '==', user.uid))),
        getDocs(query(collection(db, 'encomendas'), where('ownerId', '==', user.uid))),
        getDocs(query(collection(db, 'cash_transactions'), where('ownerId', '==', user.uid))),
      ]);
      const references = [
        ...ordersSnap.docs.filter((orderDoc) => orderDoc.data()?.clienteId === id),
        ...encomendasSnap.docs.filter((orderDoc) => orderDoc.data()?.clienteId === id),
        ...cashTransactionsSnap.docs.filter((cashDoc) => cashDoc.data()?.clienteId === id),
      ];

      // Para legado sem clienteId, telefone so vale por igualdade normalizada
      // exata. Nao completamos nono digito e nunca vinculamos por nome.
      const customerPhone = normalizeCreditPhone(String(customer?.celular || ''));
      const legacyReferences = isValidCreditPhone(customerPhone) ? [
        ...ordersSnap.docs.filter((orderDoc) => {
          const data = orderDoc.data() || {};
          return hasExactLegacyCustomerPhone(data, customerPhone);
        }),
        ...encomendasSnap.docs.filter((orderDoc) => {
          const data = orderDoc.data() || {};
          return hasExactLegacyCustomerPhone(data, customerPhone);
        }),
      ] : [];

      const hasBalance = Math.abs(saldo) > 0.009;
      const hasStatementHistory = transSnap.size > 0;
      const hasCustomerMetrics = Number(customer?.totalPedidos || 0) > 0
        || Number(customer?.totalPontos || 0) !== 0
        || !!String(customer?.ultimoPedido || '').trim();
      const mustArchive = hasBalance
        || hasStatementHistory
        || references.length > 0
        || legacyReferences.length > 0
        || hasCustomerMetrics;
      if (mustArchive) {
        const motivos = [
          hasBalance ? `saldo de ${brl(saldo)}` : '',
          hasStatementHistory ? `${transSnap.size} lancamento(s) no extrato` : '',
          references.length ? `${references.length} registro(s) historico(s) vinculado(s)` : '',
          legacyReferences.length ? `${legacyReferences.length} pedido(s) legado(s) pelo telefone exato` : '',
          hasCustomerMetrics ? 'metricas/historico de compras no cadastro' : '',
          transSnap.size > 499 ? `${transSnap.size} lançamentos no extrato` : '',
        ].filter(Boolean).join(', ');
        if (!confirm(`Este cliente não pode ser apagado porque mantém ${motivos}.\n\nArquivar agora? Ele sairá da lista ativa, mas todo o histórico será preservado.`)) return;
        const archiveReason = hasBalance
          ? 'balance'
          : hasStatementHistory
            ? 'statement_history'
            : legacyReferences.length
              ? 'legacy_reference'
              : hasCustomerMetrics
                ? 'customer_history'
                : 'referenced';
        await archiveCustomer(id, archiveReason);
        toast({ title: 'Cliente arquivado', description: 'O cadastro saiu da lista ativa e o histórico foi preservado.' });
        return;
      }

      const aviso = transSnap.size > 0
        ? `\n\nO extrato do Prazo (${transSnap.size} ${transSnap.size === 1 ? 'lançamento' : 'lançamentos'}, saldo zerado) será apagado junto e não tem como recuperar.`
        : '';
      if (!confirm(`Excluir este cliente definitivamente? Ele tem saldo zero e nenhum registro historico vinculado.${aviso}`)) return;

      const batch = writeBatch(db);
      transSnap.docs.forEach((transactionDoc) => batch.delete(transactionDoc.ref));
      batch.delete(doc(db, 'clientes', id));
      await batch.commit();
      toast({ title: 'Cliente excluído.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err.message });
    } finally {
      setDeletingClienteId(null);
    }
  };

  const runIntegrityCheck = async () => {
    if (!db || checkingIntegrity) return;
    setCheckingIntegrity(true);
    try {
      const activeCustomers = allClientes.filter((customer) => !isCustomerArchived(customer));
      const issues = findCustomerIdentityIssues(activeCustomers);
      const [ordersSnap, balanceIssues] = await Promise.all([
        getDocs(query(collection(db, 'orders'), where('ownerId', '==', user.uid))),
        Promise.all(activeCustomers.map(async (customer) => {
        const transactionSnap = await getDocs(collection(db, 'clientes', customer.id, 'credit_transactions'));
        return balanceDivergenceIssue(customer, transactionSnap.docs.map((transactionDoc) => transactionDoc.data()));
        })),
      ]);
      const customerIssues = [...issues, ...balanceIssues.filter((issue): issue is CustomerIntegrityIssue => issue !== null)]
        .filter((issue) => !isIntegrityIssueIgnored(issue, activeCustomers));
      const orderIssues = findOrderIdentityIssues(
        ordersSnap.docs.map((orderDoc) => ({ id: orderDoc.id, ...orderDoc.data() })),
      );
      const visibleIssues = [...customerIssues, ...orderIssues];
      setIntegrityIssues(visibleIssues);
      toast({
        title: visibleIssues.length ? `${visibleIssues.length} conflito(s) para revisar` : 'Integridade dos clientes em dia',
        description: visibleIssues.length ? 'Nenhum cadastro foi alterado automaticamente.' : 'Não encontrei conflito ativo nesta leitura.',
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Falha na verificação', description: err?.message });
    } finally {
      setCheckingIntegrity(false);
    }
  };

  const ignoreIntegrityIssue = async (issue: CustomerIntegrityIssue) => {
    setResolvingIssueKey(issue.key);
    try {
      if (issue.type === 'order_invalid_phone' && issue.orderId) {
        await updateDoc(doc(db, 'orders', issue.orderId), { customerIdentityIssueIgnored: true });
        setIntegrityIssues((current) => current?.filter((item) => item.key !== issue.key) || []);
        toast({ title: 'Conflito do pedido ignorado', description: 'A decisão ficou registrada no próprio pedido.' });
        return;
      }
      const batch = writeBatch(db);
      issue.customerIds.forEach((customerId) => {
        batch.update(doc(db, 'clientes', customerId), { integrityIgnoredIssues: arrayUnion(issue.key) });
      });
      await batch.commit();
      setIntegrityIssues((current) => current?.filter((item) => item.key !== issue.key) || []);
      toast({ title: 'Conflito ignorado', description: 'A decisão ficou registrada nos cadastros envolvidos.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Não foi possível ignorar', description: err?.message });
    } finally {
      setResolvingIssueKey(null);
    }
  };

  const correctIntegrityIssue = async (issue: CustomerIntegrityIssue) => {
    if (issue.type === 'order_invalid_phone' && issue.orderId) {
      const answer = prompt('Digite o telefone correto com DDD:', issue.currentValue || '');
      if (answer === null) return;
      if (!isValidCreditPhone(answer)) {
        toast({ variant: 'destructive', title: 'Telefone inválido', description: 'Use um telefone brasileiro com DDD e 10 ou 11 dígitos.' });
        return;
      }
      setResolvingIssueKey(issue.key);
      try {
        const normalizedPhone = normalizeCreditPhone(answer);
        await updateDoc(doc(db, 'orders', issue.orderId), {
          customerPhone: normalizedPhone,
          customerIdentifier: normalizedPhone,
          customerIdentityPending: true,
          customerIdentityConflict: false,
          customerIdentityIssueIgnored: false,
        });
        setIntegrityIssues((current) => current?.filter((item) => item.key !== issue.key) || []);
        toast({ title: 'Pedido corrigido', description: 'A identidade será vinculada pelo telefone exato.' });
      } catch (err: any) {
        toast({ variant: 'destructive', title: 'Não foi possível corrigir o pedido', description: err?.message });
      } finally {
        setResolvingIssueKey(null);
      }
      return;
    }
    const customer = allClientes.find((item) => item.id === issue.customerIds[0]);
    if (!customer) return;
    if (issue.type !== 'balance_divergence') {
      openEditForm(customer);
      return;
    }
    setResolvingIssueKey(issue.key);
    try {
      await updateDoc(doc(db, 'clientes', customer.id), { creditBalance: issue.expectedBalance || 0 });
      setIntegrityIssues((current) => current?.filter((item) => item.key !== issue.key) || []);
      toast({ title: 'Saldo corrigido pelo extrato', description: `Novo saldo: ${brl(issue.expectedBalance || 0)}.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Não foi possível corrigir', description: err?.message });
    } finally {
      setResolvingIssueKey(null);
    }
  };

  const unifyIntegrityIssue = async (issue: CustomerIntegrityIssue) => {
    const candidates = issue.customerIds
      .map((id) => allClientes.find((customer) => customer.id === id))
      .filter((customer): customer is Cliente => !!customer);
    if (candidates.length < 2) return;
    const options = candidates.map((customer, index) => `${index + 1}. ${customer.nome || 'Sem nome'} — ${formatBrazilPhone(normalizeCreditPhone(customer.celular || '')) || customer.id}`).join('\n');
    const answer = prompt(`Qual cadastro deve ser o principal?\n\n${options}\n\nDigite o número:`);
    const targetIndex = Number(answer) - 1;
    if (!Number.isInteger(targetIndex) || !candidates[targetIndex]) return;
    const target = candidates[targetIndex];
    const sources = candidates.filter((customer) => customer.id !== target.id);
    if (!confirm(`Unificar ${sources.length} cadastro(s) em “${target.nome}”?\n\nExtratos serão copiados, pedidos com clienteId serão redirecionados e as origens ficarão arquivadas. Nada será apagado.`)) return;

    setResolvingIssueKey(issue.key);
    try {
      const result = await mergeCustomers(db, user.uid, target.id, sources.map((customer) => customer.id));
      setIntegrityIssues((current) => current?.filter((item) => item.key !== issue.key) || []);
      toast({
        title: 'Cadastros unificados',
        description: `${result.transactionsCopied} lançamento(s) copiado(s), ${result.referencesUpdated} vínculo(s) atualizado(s). Saldo final ${brl(result.finalBalance)}.`,
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Unificação interrompida', description: `${err?.message || 'Tente novamente.'} A operação é idempotente e pode ser repetida.` });
    } finally {
      setResolvingIssueKey(null);
    }
  };

  // ─── CSV Import ───
  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !db || !user) return;

    // Importacao por identidade exige a fotografia completa da loja. A lista
    // vazia e valida; lista ainda nao carregada/erro de leitura nao e.
    if (isLoading || clientesRaw === null || clientesError) {
      toast({
        variant: 'destructive',
        title: 'Base de clientes indisponivel',
        description: 'Aguarde a lista carregar e tente novamente. Nenhum cliente foi importado.',
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      let text = new TextDecoder('utf-8').decode(buffer);
      if (text.includes('\uFFFD')) text = new TextDecoder('windows-1252').decode(buffer);
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) {
        toast({ variant: 'destructive', title: 'CSV vazio ou inválido' });
        return;
      }

      const header = parseCSVLine(lines[0]).map((column) =>
        column.replace(/^\uFEFF/, '').trim().toLowerCase());
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
      let skippedInvalidPhones = 0;
      let skippedConflicts = 0;
      let skippedDuplicateRows = 0;
      const BATCH_SIZE = 400;
      const customerIndex = buildCustomerImportIndex(user.uid, allClientes);
      const seenPhones = new Set<string>();
      const seenIds = new Set<string>();
      const planned: Array<{
        id: string;
        existing: boolean;
        normalizedPhone: string;
        profile: Record<string, unknown>;
        initial?: Record<string, unknown>;
      }> = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        const nome = (cols[nameIdx] || '').trim();
        if (!nome) continue;

        // Id previsível também sem telefone: reimportar a mesma planilha
        // atualiza o cliente em vez de criar uma cópia dele.
        const rawPhone = (cols[phoneIdx] || '').trim();
        const normalizedPhone = normalizeCreditPhone(rawPhone);
        let docId = '';
        let existing = false;
        if (rawPhone) {
          const resolution = resolveCustomerImportPhone(customerIndex, rawPhone);
          if (resolution.status === 'invalid') {
            skippedInvalidPhones++;
            continue;
          }
          if (seenPhones.has(resolution.normalizedPhone)) {
            skippedDuplicateRows++;
            continue;
          }
          seenPhones.add(resolution.normalizedPhone);
          if (resolution.status !== 'new' && resolution.status !== 'existing') {
            skippedConflicts++;
            continue;
          }
          docId = resolution.id;
          existing = resolution.status === 'existing';
        }
        // Sem telefone, cada linha recebe uma identidade estavel dentro do CSV.
        // Assim dois homonimos da mesma planilha nao sao fundidos pelo nome.
        if (!rawPhone) {
          docId = unidentifiedCustomerDocId(user.uid, nome, `csv-${i}`) || nameDocId(user.uid, nome);
          const sameId = customerIndex.byId.get(docId);
          if (sameId?.archived === true || (sameId && isValidCreditPhone(sameId.celular || ''))) {
            skippedConflicts++;
            continue;
          }
          existing = !!sameId;
        }
        if (!docId || seenIds.has(docId)) {
          skippedDuplicateRows++;
          continue;
        }
        seenIds.add(docId);
        const profile: Record<string, unknown> = {
          nome,
          celular: normalizedPhone,
          naoIdentificado: !normalizedPhone,
        };
        const optionalProfile = {
          dataNascimento: (cols[birthIdx] || '').trim(),
          logradouro: (cols[streetIdx] || '').trim(),
          logradouroNumero: (cols[numIdx] || '').trim(),
          complemento: (cols[compIdx] || '').trim(),
          bairro: (cols[neighIdx] || '').trim(),
          cidade: (cols[cityIdx] || '').trim(),
        };
        for (const [field, value] of Object.entries(optionalProfile)) {
          if (value) profile[field] = value;
        }

        planned.push({
          id: docId,
          existing,
          normalizedPhone,
          profile,
          initial: existing ? undefined : {
            id: docId,
            ownerId: user.uid,
            totalPedidos: parseInt(cols[totalIdx] || '0', 10) || 0,
            totalPontos: parseInt(cols[pointsIdx] || '0', 10) || 0,
            clienteDesde: (cols[sinceIdx] || '').trim(),
            ticketMedio: parseFloat(cols[ticketIdx] || '0') || 0,
            ultimoPedido: (cols[lastIdx] || '').trim(),
          },
        });

      }

      for (let offset = 0; offset < planned.length; offset += BATCH_SIZE) {
        const chunk = planned.slice(offset, offset + BATCH_SIZE);
        await runTransaction(db, async (transaction) => {
          const refs = chunk.map((item) => doc(db, 'clientes', item.id));
          const currentDocs = await Promise.all(refs.map((ref) => transaction.get(ref)));

          chunk.forEach((item, index) => {
            const currentSnap = currentDocs[index];
            if (item.existing) {
              if (!currentSnap.exists()) throw new Error(`Cliente ${item.id} mudou durante a importacao.`);
              const current = currentSnap.data() || {};
              const currentPhone = normalizeCreditPhone(String(current.celular || ''));
              const sameIdentity = current.ownerId === user.uid
                && current.archived !== true
                && (item.normalizedPhone ? currentPhone === item.normalizedPhone : !currentPhone);
              if (!sameIdentity) throw new Error(`Conflito de identidade em ${item.id}.`);
              // Somente perfil nao vazio; metricas, saldo, historico e flags de
              // arquivamento permanecem intocados no cadastro existente.
              transaction.set(refs[index], item.profile, { merge: true });
              return;
            }

            // Create-only dentro da transacao evita sobrescrever um id que foi
            // ocupado depois do preload.
            if (currentSnap.exists()) throw new Error(`O identificador ${item.id} foi ocupado durante a importacao.`);
            transaction.set(refs[index], { ...item.profile, ...item.initial });
          });
        });
        imported += chunk.length;
      }

      toast({
        title: `${imported} clientes importados com sucesso!`,
        description: [
          skippedInvalidPhones > 0 ? `${skippedInvalidPhones} telefone(s) invalido(s)` : '',
          skippedConflicts > 0 ? `${skippedConflicts} conflito(s) de identidade/arquivamento` : '',
          skippedDuplicateRows > 0 ? `${skippedDuplicateRows} linha(s) repetida(s)` : '',
        ].filter(Boolean).join('; ') || undefined,
      });
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
  // A ficha do cliente e uma TELA, como o Prazo: o clique no card abre o
  // prontuario (compras + prazo), nao mais o modal de tres contadores.
  if (fichaCliente) {
    return (
      <FichaClientePage
        key={fichaCliente.id}
        db={db}
        user={user}
        cliente={fichaCliente}
        caixaAberto={caixaAberto}
        registrarLancamento={registrarLancamento}
        onBack={() => setFichaClienteId(null)}
        onEditCliente={(c) => { setFichaClienteId(null); openEditForm(c); }}
      />
    );
  }

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
      <div className="px-2 shrink-0 flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[260px]">
          <h1 className="text-3xl font-black tracking-tight text-slate-800">Base de Clientes</h1>
          <p className="text-muted-foreground mt-1 font-medium">Cadastre, gerencie e acompanhe o histórico de pedidos da sua carteira de clientes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => { setShowArchived((value) => !value); setCurrentPage(1); }} className="gap-1.5">
            {showArchived ? <Users className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            {showArchived ? 'Ver ativos' : `Arquivados (${allClientes.filter(isCustomerArchived).length})`}
          </Button>
          <Button variant="outline" size="sm" onClick={runIntegrityCheck} disabled={checkingIntegrity} className="gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-50">
            {checkingIntegrity ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
            Verificar conflitos
          </Button>
        </div>
      </div>

      {integrityIssues !== null && (
        <section className="mx-2 shrink-0 rounded-2xl border border-amber-200 bg-amber-50/70 overflow-hidden">
          <div className="px-4 py-2.5 flex items-center gap-2 border-b border-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            <p className="text-sm font-bold text-amber-900 flex-1">
              {integrityIssues.length ? `${integrityIssues.length} conflito(s) aguardando decisão` : 'Nenhum conflito ativo encontrado'}
            </p>
            <Button variant="ghost" size="sm" onClick={runIntegrityCheck} disabled={checkingIntegrity} className="h-7 text-xs text-amber-800">
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${checkingIntegrity ? 'animate-spin' : ''}`} /> Atualizar
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setIntegrityIssues(null)} className="h-7 w-7"><X className="h-3.5 w-3.5" /></Button>
          </div>
          {integrityIssues.length > 0 && (
            <div className="max-h-52 overflow-y-auto divide-y divide-amber-200/70">
              {integrityIssues.map((issue) => {
                const busy = resolvingIssueKey === issue.key;
                const canUnify = issue.type === 'duplicate_phone' || issue.type === 'homonym_without_phone';
                return (
                  <div key={issue.key} className="px-4 py-2.5 flex flex-wrap items-center gap-2 bg-white/60">
                    <div className="flex-1 min-w-[260px]">
                      <p className="text-xs font-black text-slate-800">{issue.title}</p>
                      <p className="text-xs text-slate-600">{issue.description}</p>
                    </div>
                    {canUnify && (
                      <Button size="sm" variant="outline" onClick={() => unifyIntegrityIssue(issue)} disabled={busy} className="h-7 text-xs gap-1">
                        <GitMerge className="h-3.5 w-3.5" /> Unificar
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => correctIntegrityIssue(issue)} disabled={busy} className="h-7 text-xs gap-1">
                        <Pencil className="h-3.5 w-3.5" /> {issue.type === 'balance_divergence' ? 'Corrigir saldo' : issue.type === 'order_invalid_phone' ? 'Corrigir pedido' : 'Corrigir'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => ignoreIntegrityIssue(issue)} disabled={busy} className="h-7 text-xs text-slate-500">
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Ignorar'}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

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
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isImporting || isLoading || !!clientesError} className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 h-8 text-xs">
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
                    {clientes.length === 0
                      ? (showArchived ? 'Nenhum cliente arquivado.' : 'Nenhum cliente cadastrado. Importe um CSV ou cadastre manualmente.')
                      : 'Nenhum resultado encontrado.'}
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map(c => (
                  <TableRow key={c.id} className={`hover:bg-muted/20 cursor-pointer ${c.archived ? 'opacity-70 bg-slate-50' : ''}`} onClick={() => setFichaClienteId(c.id)}>
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
                          {c.archived && <Badge variant="outline" className="ml-2 text-[10px]">Arquivado</Badge>}
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
                        {!c.archived && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setPrazoClienteId(c.id); }} title="Abrir o Prazo (conta do cliente)">
                            <Receipt className="h-3.5 w-3.5 text-indigo-500" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setFichaClienteId(c.id)} title="Abrir a ficha do cliente">
                          <Eye className="h-3.5 w-3.5 text-blue-500" />
                        </Button>
                        {c.archived ? (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => restoreCustomer(c.id)} disabled={!!c.mergedInto} title={c.mergedInto ? `Unificado em ${c.mergedInto}` : 'Restaurar cliente'}>
                            <RotateCcw className="h-3.5 w-3.5 text-emerald-600" />
                          </Button>
                        ) : (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditForm(c)} title="Editar Cliente">
                              <Pencil className="h-3.5 w-3.5 text-amber-500" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(c.id)} disabled={deletingClienteId === c.id} title="Excluir ou arquivar">
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </>
                        )}
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

              {viewingCliente.archived && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  <p className="font-bold text-slate-800">Cadastro arquivado</p>
                  <p>O histórico foi preservado e este cliente não participa de novas vendas ou campanhas.</p>
                  {viewingCliente.mergedInto && <p className="mt-1">Unificado em: {viewingCliente.mergedInto}</p>}
                </div>
              )}

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
            {viewingCliente?.archived && !viewingCliente?.mergedInto ? (
              <Button onClick={() => { restoreCustomer(viewingCliente.id); setViewingCliente(null); }} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <RotateCcw className="h-4 w-4 mr-2" /> Restaurar
              </Button>
            ) : !viewingCliente?.archived ? (
              <Button onClick={() => { openEditForm(viewingCliente); setViewingCliente(null); }} className="bg-amber-500 hover:bg-amber-600 text-white">
                <Pencil className="h-4 w-4 mr-2" /> Editar
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
