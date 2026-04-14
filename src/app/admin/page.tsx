
'use client';

import React, { useState, useEffect } from 'react';
import { useFirestore, useCollection, useMemoFirebase, useUser, useDoc, useAuth } from '@/firebase';
import { collection, doc, deleteDoc, setDoc, updateDoc, orderBy, query, where } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Pencil, Trash2, Plus, LayoutDashboard, Utensils, Tag, LogOut, Loader2, ShieldAlert, ShoppingBag, Clock, CheckCircle2, User, MapPin, Phone, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';

export default function AdminPage() {
  const db = useFirestore();
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { user, isUserLoading } = useUser();
  
  const adminRoleRef = useMemoFirebase(() => (db && user) ? doc(db, 'roles_admin', user.uid) : null, [db, user]);
  const { data: adminRole, isLoading: loadingRole } = useDoc(adminRoleRef);

  // Consultas filtradas pelo UID do dono (Multi-tenancy) com checagem de DB
  const categoriesQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collection(db, 'categories'), where('ownerId', '==', user.uid));
  }, [db, user]);

  const itemsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collection(db, 'menuItems'), where('ownerId', '==', user.uid));
  }, [db, user]);

  const ordersQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collection(db, 'orders'), where('ownerId', '==', user.uid), orderBy('orderDateTime', 'desc'));
  }, [db, user]);
  
  const { data: categories, isLoading: loadingCats } = useCollection(categoriesQuery);
  const { data: items, isLoading: loadingItems } = useCollection(itemsQuery);
  const { data: orders, isLoading: loadingOrders } = useCollection(ordersQuery);

  const [editingItem, setEditingItem] = useState<any>(null);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  const handleLogout = async () => {
    if (!auth) return;
    await signOut(auth);
    router.push('/login');
  };

  const updateOrderStatus = async (orderId: string, status: string) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'orders', orderId), { status });
      toast({ title: "Status Atualizado", description: `Pedido marcado como ${status}.` });
    } catch (err) {
      toast({ variant: "destructive", title: "Erro ao atualizar", description: "Falha na permissão." });
    }
  };

  const handleSaveItem = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !db) return;
    
    const formData = new FormData(e.currentTarget);
    const itemData = {
      name: formData.get('name') as string,
      description: formData.get('description') as string,
      price: parseFloat(formData.get('price') as string),
      categoryId: formData.get('categoryId') as string,
      imageUrl: formData.get('imageUrl') as string,
      ownerId: user.uid,
      isAvailable: true,
      isRecommended: false,
    };

    try {
      if (editingItem?.id) {
        await updateDoc(doc(db, 'menuItems', editingItem.id), itemData);
      } else {
        const newDoc = doc(collection(db, 'menuItems'));
        await setDoc(newDoc, { ...itemData, id: newDoc.id });
      }
      setEditingItem(null);
      toast({ title: "Sucesso", description: "Produto salvo com sucesso." });
    } catch (err) {
      toast({ variant: "destructive", title: "Erro ao salvar", description: "Erro de permissão no Firestore." });
    }
  };

  if (isUserLoading || loadingRole || !db) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (user && !adminRole && !loadingRole) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4 text-center">
        <ShieldAlert className="h-16 w-16 text-destructive mb-4" />
        <h1 className="text-2xl font-bold mb-2">Acesso Negado</h1>
        <p className="text-muted-foreground mb-1">Você não tem permissão de administrador.</p>
        <p className="text-xs font-mono bg-muted p-2 rounded mb-4">Seu UID: {user.uid}</p>
        <Button onClick={handleLogout}>Sair e Trocar Conta</Button>
      </div>
    );
  }

  const storeLink = typeof window !== 'undefined' ? `${window.location.origin}/?s=${user?.uid}` : '';

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between bg-white p-6 rounded-2xl shadow-sm border gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-primary/10 p-3 rounded-full">
              <LayoutDashboard className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{adminRole?.storeName || 'Meu Painel'}</h1>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="bg-muted px-4 py-2 rounded-lg text-xs font-mono border flex items-center gap-2">
              <span>Link do seu cardápio:</span>
              <a href={storeLink} target="_blank" className="text-primary font-bold hover:underline flex items-center gap-1">
                Ver Loja <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <Button variant="ghost" size="sm" className="text-destructive" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" /> Sair
            </Button>
          </div>
        </div>

        <Tabs defaultValue="orders" className="w-full">
          <TabsList className="bg-white border shadow-sm p-1 rounded-xl h-12">
            <TabsTrigger value="orders" className="rounded-lg px-6 flex gap-2">
              <ShoppingBag className="h-4 w-4" /> Pedidos
            </TabsTrigger>
            <TabsTrigger value="products" className="rounded-lg px-6 flex gap-2">
              <Utensils className="h-4 w-4" /> Produtos
            </TabsTrigger>
            <TabsTrigger value="categories" className="rounded-lg px-6 flex gap-2">
              <Tag className="h-4 w-4" /> Categorias
            </TabsTrigger>
          </TabsList>

          <TabsContent value="orders" className="mt-6">
            <Card className="border shadow-md rounded-2xl overflow-hidden">
              <CardHeader className="bg-white border-b">
                <CardTitle className="text-lg">Pedidos Recebidos</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="pl-6">Data</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Itens</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right pr-6">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingOrders ? (
                       <TableRow><TableCell colSpan={6} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" /></TableCell></TableRow>
                    ) : !orders || orders.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                          Nenhum pedido ainda. Divulgue seu link!
                        </TableCell>
                      </TableRow>
                    ) : (
                      orders.map((order) => (
                        <TableRow key={order.id} className="align-top">
                          <TableCell className="pl-6 whitespace-nowrap">
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" /> {new Date(order.orderDateTime).toLocaleString('pt-BR')}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[150px]">
                            <div className="font-bold text-sm">{order.customerName}</div>
                            <div className="text-xs text-muted-foreground">{order.customerPhone}</div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {order.items?.map((it: any, i: number) => (
                                <div key={i}>{it.quantity}x {it.name}</div>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="font-bold text-primary">R$ {order.totalAmount.toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge variant={order.status === 'pending' ? 'outline' : 'default'} className={order.status === 'ready' ? 'bg-green-500 text-white' : ''}>
                              {order.status === 'pending' ? 'Pendente' : 'Pronto'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            {order.status === 'pending' && (
                              <Button size="sm" onClick={() => updateOrderStatus(order.id, 'ready')} className="bg-green-600 h-8">
                                <CheckCircle2 className="h-4 w-4 mr-1" /> Pronto
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="products" className="mt-6">
            <Card className="border shadow-md rounded-2xl overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between border-b bg-white">
                <CardTitle className="text-lg">Gerenciar Cardápio</CardTitle>
                <Dialog open={editingItem !== null} onOpenChange={(open) => !open && setEditingItem(null)}>
                  <DialogTrigger asChild>
                    <Button onClick={() => setEditingItem({})} className="bg-primary text-white">
                      <Plus className="mr-2 h-4 w-4" /> Novo Prato
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                      <DialogTitle>{editingItem?.id ? 'Editar Prato' : 'Novo Prato'}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSaveItem} className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label htmlFor="name">Nome do Prato</Label>
                        <Input id="name" name="name" defaultValue={editingItem?.name} required />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="price">Preço (R$)</Label>
                          <Input id="price" name="price" type="number" step="0.01" defaultValue={editingItem?.price} required />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="categoryId">Categoria</Label>
                          <select name="categoryId" className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm" defaultValue={editingItem?.categoryId}>
                            <option value="">Selecione...</option>
                            {categories?.map(cat => (
                              <option key={cat.id} value={cat.id}>{cat.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="imageUrl">Link da Imagem (URL)</Label>
                        <Input id="imageUrl" name="imageUrl" defaultValue={editingItem?.imageUrl} required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="description">Descrição</Label>
                        <Textarea id="description" name="description" defaultValue={editingItem?.description} required />
                      </div>
                      <DialogFooter>
                        <Button type="submit" className="w-full h-12 font-bold">Salvar</Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="w-[80px] pl-6">Foto</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Preço</TableHead>
                      <TableHead className="text-right pr-6">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items?.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="pl-6">
                          <div className="relative h-12 w-12 rounded-lg overflow-hidden border">
                            <Image src={item.imageUrl} alt={item.name} fill className="object-cover" />
                          </div>
                        </TableCell>
                        <TableCell className="font-bold">{item.name}</TableCell>
                        <TableCell className="font-semibold text-primary">R$ {item.price.toFixed(2)}</TableCell>
                        <TableCell className="text-right pr-6 space-x-1">
                          <Button variant="ghost" size="icon" onClick={() => setEditingItem(item)}>
                            <Pencil className="h-4 w-4 text-blue-500" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={async () => {
                            if (!db) return;
                            if (confirm("Excluir item?")) await deleteDoc(doc(db, 'menuItems', item.id));
                          }}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="categories" className="mt-6">
            <Card className="border shadow-md rounded-2xl overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between border-b bg-white">
                <CardTitle className="text-lg">Categorias</CardTitle>
                <Button onClick={async () => {
                  if (!db || !user) return;
                  const name = prompt("Nome da Categoria:");
                  if (name) {
                    const newDoc = doc(collection(db, 'categories'));
                    await setDoc(newDoc, { id: newDoc.id, name, ownerId: user.uid, displayOrder: 0, description: "" });
                  }
                }} className="bg-primary text-white">
                  <Plus className="mr-2 h-4 w-4" /> Nova Categoria
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="pl-6">Nome</TableHead>
                      <TableHead className="text-right pr-6">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categories?.map((cat) => (
                      <TableRow key={cat.id}>
                        <TableCell className="font-bold pl-6">{cat.name}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" onClick={async () => {
                            if (!db) return;
                            if (confirm("Excluir categoria?")) await deleteDoc(doc(db, 'categories', cat.id));
                          }}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
