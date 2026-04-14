
'use client';

import React, { useState, useEffect } from 'react';
import { useFirestore, useCollection, useMemoFirebase, useUser, useDoc, useAuth } from '@/firebase';
import { collection, doc, deleteDoc, setDoc, updateDoc, orderBy, query, serverTimestamp } from 'firebase/firestore';
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
import { Pencil, Trash2, Plus, LayoutDashboard, Utensils, Tag, LogOut, Loader2, ShieldAlert, ShoppingBag, Clock, CheckCircle2, User, MapPin, Phone } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';

export default function AdminPage() {
  const db = useFirestore();
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { user, isUserLoading } = useUser();
  
  const adminRoleRef = useMemoFirebase(() => user ? doc(db, 'roles_admin', user.uid) : null, [db, user]);
  const { data: adminRole, isLoading: loadingRole } = useDoc(adminRoleRef);

  // Só tentamos buscar os dados se o adminRole já foi carregado e existe
  const categoriesQuery = useMemoFirebase(() => adminRole ? collection(db, 'categories') : null, [db, adminRole]);
  const itemsQuery = useMemoFirebase(() => adminRole ? collection(db, 'menuItems') : null, [db, adminRole]);
  const ordersQuery = useMemoFirebase(() => adminRole ? query(collection(db, 'orders'), orderBy('createdAt', 'desc')) : null, [db, adminRole]);
  
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
    await signOut(auth);
    router.push('/login');
  };

  const updateOrderStatus = async (orderId: string, status: string) => {
    await updateDoc(doc(db, 'orders', orderId), { status });
    toast({ title: "Status Atualizado", description: `Pedido marcado como ${status}.` });
  };

  const handleSaveItem = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const itemData = {
      name: formData.get('name') as string,
      description: formData.get('description') as string,
      price: parseFloat(formData.get('price') as string),
      categoryId: formData.get('categoryId') as string,
      imageUrl: formData.get('imageUrl') as string,
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
      toast({ variant: "destructive", title: "Erro ao salvar", description: "Ocorreu um erro." });
    }
  };

  if (isUserLoading || loadingRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || !adminRole) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4 text-center">
        <ShieldAlert className="h-16 w-16 text-destructive mb-4" />
        <h1 className="text-2xl font-bold mb-2">Acesso Negado</h1>
        <p className="text-muted-foreground mb-2">Você não tem permissões administrativas.</p>
        <p className="text-xs text-muted-foreground bg-white p-2 rounded border mb-6 font-mono">
          Seu UID: {user?.uid}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push('/')}>Voltar ao Cardápio</Button>
          <Button onClick={() => router.push('/login')}>Trocar de Conta</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex items-center justify-between bg-white p-6 rounded-2xl shadow-sm border">
          <div className="flex items-center gap-4">
            <div className="bg-primary/10 p-3 rounded-full">
              <LayoutDashboard className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Painel Administrativo</h1>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => window.open('/', '_blank')}>Ver Site</Button>
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
                <CardTitle className="text-lg">Pedidos Recentes</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="pl-6">ID / Data</TableHead>
                      <TableHead>Cliente / Endereço</TableHead>
                      <TableHead>Itens</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right pr-6">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingOrders ? (
                       <TableRow><TableCell colSpan={6} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" /></TableCell></TableRow>
                    ) : orders?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                          Nenhum pedido recebido ainda.
                        </TableCell>
                      </TableRow>
                    ) : (
                      orders?.map((order) => (
                        <TableRow key={order.id} className="align-top">
                          <TableCell className="pl-6">
                            <div className="font-bold">#{order.id}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" /> {new Date(order.orderDateTime).toLocaleString('pt-BR')}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[200px]">
                            <div className="flex items-center gap-1 font-bold text-sm">
                              <User className="h-3 w-3" /> {order.customerName}
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                              <Phone className="h-3 w-3" /> {order.customerPhone}
                            </div>
                            <div className="flex items-start gap-1 text-xs text-muted-foreground mt-1">
                              <MapPin className="h-3 w-3 mt-0.5 shrink-0" /> {order.deliveryAddress}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {order.items?.map((it: any, i: number) => (
                                <div key={i} className="whitespace-nowrap">{it.quantity}x {it.name}</div>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="font-bold text-primary whitespace-nowrap">R$ {order.totalAmount.toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge variant={order.status === 'pending' ? 'outline' : 'default'} className={order.status === 'ready' ? 'bg-green-500 text-white' : ''}>
                              {order.status === 'pending' ? 'Pendente' : order.status === 'ready' ? 'Pronto' : order.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right pr-6 space-x-1">
                            {order.status === 'pending' && (
                              <Button size="sm" onClick={() => updateOrderStatus(order.id, 'ready')} className="bg-green-600 hover:bg-green-700 h-8">
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
                    <Button onClick={() => setEditingItem({})} className="bg-primary rounded-lg">
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
                        <Input id="imageUrl" name="imageUrl" defaultValue={editingItem?.imageUrl} placeholder="https://..." required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="description">Descrição Curta</Label>
                        <Textarea id="description" name="description" defaultValue={editingItem?.description} required />
                      </div>
                      <DialogFooter>
                        <Button type="submit" className="w-full h-12 font-bold">Salvar Alterações</Button>
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
                          <div className="relative h-12 w-12 rounded-lg overflow-hidden border shadow-sm">
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
                  const name = prompt("Nome da Categoria:");
                  if (name) {
                    const newDoc = doc(collection(db, 'categories'));
                    await setDoc(newDoc, { id: newDoc.id, name, displayOrder: 0, description: "" });
                  }
                }}>
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
