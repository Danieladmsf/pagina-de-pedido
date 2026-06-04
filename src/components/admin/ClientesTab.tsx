'use client';

import React, { useState, useMemo, useRef } from 'react';
import { collection, doc, setDoc, deleteDoc, updateDoc, query, where, getDoc, getDocs, writeBatch, onSnapshot, orderBy, increment } from 'firebase/firestore';
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
import { Search, Plus, Pencil, Trash2, Upload, Users, Phone, MapPin, CalendarDays, ChevronLeft, ChevronRight, Loader2, Eye, X, Gift, TrendingUp, ShoppingBag, CheckCircle2, Info, Receipt, User } from 'lucide-react';
import { normalizeCreditPhone, getPhoneVariants } from '@/lib/customer-credit';
import { AddressAutocomplete } from '@/components/ui/address-autocomplete';

interface ClientesTabProps {
  db: any;
  user: any;
  registrarLancamento?: (params: { tipo: 'venda' | 'sangria' | 'suprimento'; titulo: string; valor: number; formaPagamento: string }) => Promise<void>;
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
}

const ITEMS_PER_PAGE = 20;

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
  const [currentPage, setCurrentPage] = useState(1);
  const [isImporting, setIsImporting] = useState(false);
  const [editingCliente, setEditingCliente] = useState<any>(null);
  const [viewingCliente, setViewingCliente] = useState<any>(null);
  const [contaCasaCliente, setContaCasaCliente] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [contaCasaTransactions, setContaCasaTransactions] = useState<any[]>([]);
  const [contaCasaLoading, setContaCasaLoading] = useState(false);
  const [contaCasaPaymentAmount, setContaCasaPaymentAmount] = useState('');
  const [contaCasaPaymentMethod, setContaCasaPaymentMethod] = useState('pix');

  React.useEffect(() => {
    if (!contaCasaCliente || !db) return;
    setContaCasaLoading(true);
    const q = query(
      collection(db, 'clientes', contaCasaCliente.id, 'credit_transactions'),
      orderBy('date', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      setContaCasaTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setContaCasaLoading(false);
    });
    return () => unsub();
  }, [contaCasaCliente, db]);

  // Form fields
  const [formNome, setFormNome] = useState('');
  const [formCelular, setFormCelular] = useState('');
  const [formNascimento, setFormNascimento] = useState('');
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

  // Filter + Sort
  const filtered = useMemo(() => {
    let result = [...clientes];
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(c =>
        c.nome?.toLowerCase().includes(term) ||
        c.celular?.toLowerCase().includes(term) ||
        c.bairro?.toLowerCase().includes(term) ||
        c.cidade?.toLowerCase().includes(term)
      );
    }
    result.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    return result;
  }, [clientes, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated = filtered.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // ─── Handlers ───

  const openNewForm = () => {
    setFormNome(''); setFormCelular(''); setFormNascimento('');
    setFormLogradouro(''); setFormNumero(''); setFormComplemento('');
    setFormBairro(''); setFormCidade('');
    setFormCreditEnabled(false); setFormCreditLimit(''); setFormCreditPayDay('');
    setEditingCliente({});
  };

  const openEditForm = (c: Cliente) => {
    setFormNome(c.nome || '');
    setFormCelular(c.celular || '');
    setFormNascimento(c.dataNascimento || '');
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

  const handleSave = async () => {
    if (!db || !user || !formNome.trim()) return;
    setIsSubmitting(true);
    try {
      const data = {
        nome: formNome.trim(),
        celular: normalizeCreditPhone(formCelular),
        dataNascimento: formNascimento.trim(),
        logradouro: formLogradouro.trim(),
        logradouroNumero: formNumero.trim(),
        complemento: formComplemento.trim(),
        bairro: formBairro.trim(),
        cidade: formCidade.trim(),
        ownerId: user.uid,
        creditEnabled: formCreditEnabled,
        creditLimit: Number(formCreditLimit) || 0,
        creditPayDay: Number(formCreditPayDay) || 0,
      };

      if (editingCliente?.id) {
        await updateDoc(doc(db, 'clientes', editingCliente.id), data);
        toast({ title: 'Cliente atualizado!' });
      } else {
        // Busca híbrida para novos registros para evitar duplicados se o celular já existir
        let docId = doc(collection(db, 'clientes')).id;
        let isExisting = false;

        if (data.celular) {
          const variants = getPhoneVariants(data.celular);
          const q = query(collection(db, 'clientes'), where('ownerId', '==', user.uid), where('celular', 'in', variants));
          const snap = await getDocs(q);
          if (!snap.empty) {
            docId = snap.docs[0].id;
            isExisting = true;
          } else {
            docId = `${user.uid}_${data.celular}`;
          }
        }

        const newDoc = doc(db, 'clientes', docId);
        await setDoc(newDoc, {
          ...data,
          id: docId,
          totalPedidos: 0,
          totalPontos: 0,
          ticketMedio: 0,
          creditBalance: 0,
          clienteDesde: new Date().toLocaleDateString('pt-BR'),
          ultimoPedido: '',
        }, { merge: true });
        toast({ title: isExisting ? 'Cliente atualizado (já cadastrado)!' : 'Cliente cadastrado!' });
      }
      setEditingCliente(null);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este cliente?')) return;
    try {
      await deleteDoc(doc(db, 'clientes', id));
      toast({ title: 'Cliente excluído.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err.message });
    }
  };

  const handleReceivePayment = async () => {
    if (!contaCasaCliente || !db || !user) return;
    const amount = Number(contaCasaPaymentAmount.replace(',', '.'));
    if (isNaN(amount) || amount <= 0) {
      toast({ variant: 'destructive', title: 'Valor inválido' });
      return;
    }
    
    if (caixaAberto === false) {
       toast({ variant: 'destructive', title: 'Erro', description: 'Caixa fechado. Não é possível registrar o recebimento no sistema financeiro.' });
       return;
    }

    setIsSubmitting(true);
    try {
      const transRef = doc(collection(db, 'clientes', contaCasaCliente.id, 'credit_transactions'));
      await setDoc(transRef, {
        id: transRef.id,
        type: 'credit',
        amount: amount,
        date: new Date().toISOString(),
        description: 'Pagamento de Dívida / Acerto'
      });
      
      await updateDoc(doc(db, 'clientes', contaCasaCliente.id), {
        creditBalance: increment(-amount)
      });
      
      if (registrarLancamento) {
        await registrarLancamento({
          tipo: 'venda',
          titulo: `Acerto Conta da Casa - ${contaCasaCliente.nome}`,
          valor: amount,
          formaPagamento: contaCasaPaymentMethod
        });
      }
      
      toast({ title: 'Pagamento registrado com sucesso!' });
      setContaCasaPaymentAmount('');
      setContaCasaCliente((prev: any) => ({ ...prev, creditBalance: Math.max(0, (prev.creditBalance || 0) - amount) }));
    } catch (err: any) {
       toast({ variant: 'destructive', title: 'Erro', description: err.message });
    } finally {
       setIsSubmitting(false);
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

        const normalizedPhone = normalizeCreditPhone(cols[phoneIdx] || '');
        const docId = normalizedPhone ? `${user.uid}_${normalizedPhone}` : doc(collection(db, 'clientes')).id;
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
  const stats = useMemo(() => {
    const total = clientes.length;
    const comTelefone = clientes.filter(c => c.celular?.trim()).length;
    const aniversariantes = clientes.filter(c => {
      if (!c.dataNascimento) return false;
      const parts = c.dataNascimento.split('/');
      if (parts.length < 3) return false;
      const month = parseInt(parts[1]);
      return month === new Date().getMonth() + 1;
    }).length;
    return { total, comTelefone, aniversariantes };
  }, [clientes]);

  if (isLoading) {
    return <div className="py-20 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-5 pt-4 pb-12">
      <div className="mb-6 px-2">
        <h1 className="text-3xl font-black tracking-tight text-slate-800">Base de Clientes</h1>
        <p className="text-muted-foreground mt-1 font-medium">Cadastre, gerencie e acompanhe o histórico de pedidos da sua carteira de clientes.</p>
      </div>

      {/* SEÇÃO 1 — Resumo */}
      <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
        <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500/15 to-indigo-500/15 border border-blue-500/20 flex items-center justify-center">
            <TrendingUp className="h-5 w-5 text-blue-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-slate-800">Resumo da carteira</h2>
            <p className="text-xs text-muted-foreground">Indicadores gerais da sua base de clientes.</p>
          </div>
          {stats.total > 0 && (
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] gap-1">
              <CheckCircle2 className="h-3 w-3" /> {stats.total} cliente{stats.total !== 1 ? 's' : ''}
            </Badge>
          )}
        </header>
        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-50/60 border border-blue-100">
            <div className="p-2.5 bg-blue-100 rounded-xl"><Users className="h-5 w-5 text-blue-600" /></div>
            <div>
              <p className="text-2xl font-black text-blue-700">{stats.total}</p>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Total de Clientes</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50/60 border border-emerald-100">
            <div className="p-2.5 bg-emerald-100 rounded-xl"><Phone className="h-5 w-5 text-emerald-600" /></div>
            <div>
              <p className="text-2xl font-black text-emerald-700">{stats.comTelefone}</p>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Com Telefone</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50/60 border border-amber-100">
            <div className="p-2.5 bg-amber-100 rounded-xl"><Gift className="h-5 w-5 text-amber-600" /></div>
            <div>
              <p className="text-2xl font-black text-amber-700">{stats.aniversariantes}</p>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Aniversariantes do Mês</p>
            </div>
          </div>
        </div>
      </section>

      {/* SEÇÃO 2 — Tabela de Clientes */}
      <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
        <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
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

        {/* Search */}
        <div className="p-3 border-b bg-muted/20">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, telefone, bairro..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="pl-9 h-9"
            />
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto custom-scrollbar">
          <Table>
            <TableHeader className="bg-muted/30 sticky top-0 z-10 backdrop-blur-sm">
              <TableRow>
                <TableHead className="pl-4">Nome</TableHead>
                <TableHead>Celular</TableHead>
                <TableHead>Bairro</TableHead>
                <TableHead>Cidade</TableHead>
                <TableHead className="text-center">Pedidos</TableHead>
                <TableHead className="text-center">Ticket Médio</TableHead>
                <TableHead>Último Pedido</TableHead>
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
                      {c.nome}
                      {c.creditEnabled && <Badge variant="secondary" className="ml-2 text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200">Conta da Casa</Badge>}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{c.celular || '-'}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{c.bairro || '-'}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{c.cidade || '-'}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="font-bold">{c.totalPedidos || 0}</Badge>
                    </TableCell>
                    <TableCell className="text-center font-bold text-emerald-600 text-sm">
                      {c.ticketMedio ? `R$ ${c.ticketMedio.toFixed(2)}` : '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{c.ultimoPedido || '-'}</TableCell>
                    <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setContaCasaCliente(c); }} title="Conta da Casa (Fiado)">
                          <Receipt className="h-3.5 w-3.5 text-indigo-500" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewingCliente(c)} title="Ver Detalhes">
                          <Eye className="h-3.5 w-3.5 text-blue-500" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditForm(c)} title="Editar Cliente">
                          <Pencil className="h-3.5 w-3.5 text-amber-500" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(c.id)} title="Excluir">
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
      <div className="bg-white rounded-2xl shadow-sm border p-4 flex items-center justify-between sticky bottom-2 z-10">
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
            {/* Informações Pessoais */}
            <div className="space-y-1.5">
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 border-b pb-1">
                <User className="h-3 w-3 text-slate-500" /> Informações Pessoais
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <div className="space-y-0.5 md:col-span-2">
                  <Label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Nome Completo *</Label>
                  <Input value={formNome} onChange={(e) => setFormNome(e.target.value)} placeholder="Ex: João da Silva" className="bg-slate-50/50 h-7 text-xs px-2" autoFocus />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Celular</Label>
                  <Input value={formCelular} onChange={(e) => setFormCelular(e.target.value)} placeholder="(00) 00000-0000" className="bg-slate-50/50 h-7 text-xs px-2" />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Nascimento</Label>
                  <Input value={formNascimento} onChange={(e) => setFormNascimento(e.target.value)} placeholder="DD/MM/AAAA" className="bg-slate-50/50 h-7 text-xs px-2" />
                </div>
              </div>
            </div>

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
                      const term = formBairro.trim().toLowerCase();
                      const filtered = term.length > 0
                        ? registeredNeighborhoods.filter((b) => b.toLowerCase().includes(term))
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
                    <p className="text-[9px] text-indigo-700/80 leading-tight mt-0.5">Permite compras a prazo no app/painel.</p>
                  </div>
                </div>
                <Switch 
                  id="toggle-conta-casa"
                  checked={formCreditEnabled} 
                  onCheckedChange={setFormCreditEnabled}
                  className="data-[state=checked]:bg-indigo-600 scale-90 shrink-0"
                />
              </div>

              {formCreditEnabled && (
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
            <Button size="sm" onClick={handleSave} disabled={isSubmitting || !formNome.trim()} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-7 text-xs px-5 shadow-sm">
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
                    <p className="font-semibold text-sm">{viewingCliente.celular || '-'}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CalendarDays className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground">Nascimento</p>
                    <p className="font-semibold text-sm">{viewingCliente.dataNascimento || '-'}</p>
                  </div>
                </div>
              </div>

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
                      setContaCasaCliente(viewingCliente);
                      setViewingCliente(null);
                    }}
                  >
                    <Receipt className="w-4 h-4 mr-2" /> Gerenciar Conta da Casa
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

      {/* ─── Modal: Conta da Casa (Gerenciamento) ─── */}
      <Dialog open={contaCasaCliente !== null} onOpenChange={(open) => { if (!open) setContaCasaCliente(null); }}>
        <DialogContent className="sm:max-w-[420px] max-h-[85vh] flex flex-col p-0 gap-0 rounded-2xl overflow-hidden">
          <DialogHeader className="px-4 py-2.5 border-b bg-slate-50">
            <DialogTitle className="flex items-center gap-2 text-sm text-indigo-700">
              <Receipt className="h-4 w-4" /> Prazo — {contaCasaCliente?.nome}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 px-4 py-3 rounded-lg text-center shadow-sm">
              <p className="text-[10px] text-indigo-200 font-medium">Saldo Devedor</p>
              <p className="text-2xl font-black text-white">R$ {(contaCasaCliente?.creditBalance || 0).toFixed(2)}</p>
            </div>
            
            <div className="border rounded-lg p-2.5 space-y-2 bg-white">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Registrar Pagamento</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] text-slate-500">Valor (R$)</Label>
                  <CurrencyInput 
                    className="h-8 text-sm bg-white"
                    placeholder="0,00" 
                    value={Number(contaCasaPaymentAmount.replace(',', '.')) || 0}
                    onChange={(val) => setContaCasaPaymentAmount(val.toString())}
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-slate-500">Forma</Label>
                  <select 
                    className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={contaCasaPaymentMethod}
                    onChange={(e) => setContaCasaPaymentMethod(e.target.value)}
                  >
                    <option value="pix">PIX</option>
                    <option value="dinheiro">Dinheiro</option>
                    <option value="debito">Débito</option>
                    <option value="credito">Crédito</option>
                  </select>
                </div>
              </div>
              <Button 
                size="sm"
                className="w-full h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" 
                onClick={handleReceivePayment}
                disabled={isSubmitting || !contaCasaPaymentAmount}
              >
                {isSubmitting ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1.5" />}
                Dar Baixa
              </Button>
            </div>

            <div className="border rounded-lg overflow-hidden bg-white">
              <div className="px-2.5 py-1.5 border-b bg-slate-50 flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Extrato</span>
                <span className="text-[9px] text-slate-400">{contaCasaTransactions.length} registro(s)</span>
              </div>
              {contaCasaLoading ? (
                <div className="p-4 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-indigo-500" /></div>
              ) : contaCasaTransactions.length === 0 ? (
                <div className="p-4 text-center text-[11px] text-slate-400">Nenhuma transa\u00e7\u00e3o.</div>
              ) : (
                <div className="divide-y max-h-48 overflow-y-auto custom-scrollbar">
                  {contaCasaTransactions.map(t => (
                    <div key={t.id} className="px-2.5 py-1.5 flex items-center justify-between hover:bg-slate-50">
                      <div>
                        <p className="text-[10px] font-semibold text-slate-700">{t.description || (t.type === 'debit' ? 'Compra' : 'Pagamento')}</p>
                        <p className="text-[9px] text-slate-400">{new Date(t.date).toLocaleString('pt-BR')}</p>
                      </div>
                      <div className={`text-[11px] font-black ${t.type === 'debit' ? 'text-red-500' : 'text-emerald-600'}`}>
                        {t.type === 'debit' ? '+' : '-'} R$ {(t.amount || 0).toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="px-4 py-2 border-t flex justify-end">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setContaCasaCliente(null)}>Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
