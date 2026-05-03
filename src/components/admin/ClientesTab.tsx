'use client';

import React, { useState, useMemo, useRef } from 'react';
import { collection, doc, setDoc, deleteDoc, updateDoc, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { useCollection, useMemoFirebase } from '@/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Search, Plus, Pencil, Trash2, Upload, Users, Phone, MapPin, CalendarDays, ChevronLeft, ChevronRight, Loader2, Eye, X, Gift, TrendingUp, ShoppingBag } from 'lucide-react';

interface ClientesTabProps {
  db: any;
  user: any;
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

export function ClientesTab({ db, user }: ClientesTabProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [isImporting, setIsImporting] = useState(false);
  const [editingCliente, setEditingCliente] = useState<any>(null);
  const [viewingCliente, setViewingCliente] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form fields
  const [formNome, setFormNome] = useState('');
  const [formCelular, setFormCelular] = useState('');
  const [formNascimento, setFormNascimento] = useState('');
  const [formLogradouro, setFormLogradouro] = useState('');
  const [formNumero, setFormNumero] = useState('');
  const [formComplemento, setFormComplemento] = useState('');
  const [formBairro, setFormBairro] = useState('');
  const [formCidade, setFormCidade] = useState('');

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
    setEditingCliente(c);
  };

  const handleSave = async () => {
    if (!db || !user || !formNome.trim()) return;
    setIsSubmitting(true);
    try {
      const data = {
        nome: formNome.trim(),
        celular: formCelular.trim(),
        dataNascimento: formNascimento.trim(),
        logradouro: formLogradouro.trim(),
        logradouroNumero: formNumero.trim(),
        complemento: formComplemento.trim(),
        bairro: formBairro.trim(),
        cidade: formCidade.trim(),
        ownerId: user.uid,
      };

      if (editingCliente?.id) {
        await updateDoc(doc(db, 'clientes', editingCliente.id), data);
        toast({ title: 'Cliente atualizado!' });
      } else {
        const newDoc = doc(collection(db, 'clientes'));
        await setDoc(newDoc, {
          ...data,
          id: newDoc.id,
          totalPedidos: 0,
          totalPontos: 0,
          ticketMedio: 0,
          clienteDesde: new Date().toLocaleDateString('pt-BR'),
          ultimoPedido: '',
        });
        toast({ title: 'Cliente cadastrado!' });
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

        const ref = doc(collection(db, 'clientes'));
        batch.set(ref, {
          id: ref.id,
          nome,
          celular: (cols[phoneIdx] || '').trim(),
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
    <div className="space-y-6">
      <div className="mb-6 px-2">
        <h1 className="text-3xl font-black tracking-tight text-slate-800">Base de Clientes</h1>
        <p className="text-muted-foreground mt-1 font-medium">Cadastre, gerencie e acompanhe o histórico de pedidos da sua carteira de clientes.</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="rounded-2xl border shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 bg-blue-100 rounded-xl">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-black text-slate-800">{stats.total}</p>
              <p className="text-xs text-muted-foreground font-medium">Total de Clientes</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 bg-emerald-100 rounded-xl">
              <Phone className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-black text-slate-800">{stats.comTelefone}</p>
              <p className="text-xs text-muted-foreground font-medium">Com Telefone</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 bg-amber-100 rounded-xl">
              <Gift className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-black text-slate-800">{stats.aniversariantes}</p>
              <p className="text-xs text-muted-foreground font-medium">Aniversariantes do Mês</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <Card className="border shadow-md rounded-2xl overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-end border-b bg-white py-3">
          <div className="flex gap-2">
            <input
              type="file"
              accept=".csv"
              ref={fileInputRef}
              onChange={handleImportCSV}
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            >
              {isImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Importar CSV
            </Button>
            <Button onClick={openNewForm} className="bg-primary text-white">
              <Plus className="h-4 w-4 mr-2" /> Novo Cliente
            </Button>
          </div>
        </CardHeader>

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

        <CardContent className="p-0">
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
                      <TableCell className="pl-4 font-semibold text-slate-700">{c.nome}</TableCell>
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
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewingCliente(c)}>
                            <Eye className="h-3.5 w-3.5 text-blue-500" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditForm(c)}>
                            <Pencil className="h-3.5 w-3.5 text-amber-500" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(c.id)}>
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
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between bg-white p-3 rounded-2xl shadow-sm border text-sm text-muted-foreground">
        <span>Página {currentPage} de {totalPages}, mostrando {filtered.length} resultado(s)</span>
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
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingCliente?.id ? 'Editar Cliente' : 'Novo Cliente'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Nome *</Label>
              <Input value={formNome} onChange={(e) => setFormNome(e.target.value)} placeholder="Nome completo" autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Celular</Label>
                <Input value={formCelular} onChange={(e) => setFormCelular(e.target.value)} placeholder="(00) 00000-0000" />
              </div>
              <div className="space-y-1">
                <Label>Data de Nascimento</Label>
                <Input value={formNascimento} onChange={(e) => setFormNascimento(e.target.value)} placeholder="DD/MM/AAAA" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1">
                <Label>Logradouro</Label>
                <Input value={formLogradouro} onChange={(e) => setFormLogradouro(e.target.value)} placeholder="Rua, Av..." />
              </div>
              <div className="space-y-1">
                <Label>Nº</Label>
                <Input value={formNumero} onChange={(e) => setFormNumero(e.target.value)} placeholder="123" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>Complemento</Label>
                <Input value={formComplemento} onChange={(e) => setFormComplemento(e.target.value)} placeholder="Apto, Casa..." />
              </div>
              <div className="space-y-1">
                <Label>Bairro</Label>
                <Input value={formBairro} onChange={(e) => setFormBairro(e.target.value)} placeholder="Bairro" />
              </div>
              <div className="space-y-1">
                <Label>Cidade</Label>
                <Input value={formCidade} onChange={(e) => setFormCidade(e.target.value)} placeholder="Cidade" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCliente(null)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={isSubmitting || !formNome.trim()} className="bg-primary text-white">
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Salvar
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
