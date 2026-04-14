
'use client';

import React, { useState, useEffect } from 'react';
import { useFirestore, useCollection, useMemoFirebase, useUser, useDoc, useAuth } from '@/firebase';
import { collection, doc, deleteDoc, setDoc, updateDoc } from 'firebase/firestore';
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
import { Pencil, Trash2, Plus, LayoutDashboard, Utensils, Tag, LogOut, Loader2, ShieldAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';

export default function AdminPage() {
  const db = useFirestore();
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { user, isUserLoading } = useUser();
  
  // Verifica se o usuário logado tem permissão de admin no banco
  const adminRoleRef = useMemoFirebase(() => user ? doc(db, 'roles_admin', user.uid) : null, [db, user]);
  const { data: adminRole, isLoading: loadingRole } = useDoc(adminRoleRef);

  const categoriesQuery = useMemoFirebase(() => collection(db, 'categories'), [db]);
  const itemsQuery = useMemoFirebase(() => collection(db, 'menuItems'), [db]);
  
  const { data: categories, isLoading: loadingCats } = useCollection(categoriesQuery);
  const { data: items, isLoading: loadingItems } = useCollection(itemsQuery);

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

  const handleDeleteItem = async (id: string) => {
    if (confirm("Deseja excluir este item?")) {
      await deleteDoc(doc(db, 'menuItems', id));
      toast({ title: "Removido", description: "Produto excluído com sucesso." });
    }
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
      toast({ variant: "destructive", title: "Erro ao salvar", description: "Você não tem permissão para esta ação." });
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
        <p className="text-muted-foreground mb-6">Você não tem permissões administrativas.</p>
        <Button onClick={() => router.push('/login')}>Ir para Login</Button>
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
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Painel Admin
              </h1>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => window.location.href = '/'}>Ver Site</Button>
            <Button variant="ghost" size="sm" className="text-destructive" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" /> Sair
            </Button>
          </div>
        </div>

        <Tabs defaultValue="products" className="w-full">
          <TabsList className="bg-white border shadow-sm p-1 rounded-xl h-12">
            <TabsTrigger value="products" className="rounded-lg px-6 flex gap-2">
              <Utensils className="h-4 w-4" /> Produtos
            </TabsTrigger>
            <TabsTrigger value="categories" className="rounded-lg px-6 flex gap-2">
              <Tag className="h-4 w-4" /> Categorias
            </TabsTrigger>
          </TabsList>

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
                          <select name="categoryId" className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary" defaultValue={editingItem?.categoryId}>
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
                      <TableHead className="w-[100px] pl-6">Foto</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Preço</TableHead>
                      <TableHead className="text-right pr-6">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                          Nenhum produto cadastrado ainda.
                        </TableCell>
                      </TableRow>
                    )}
                    {items?.map((item) => (
                      <TableRow key={item.id} className="hover:bg-muted/10 transition-colors">
                        <TableCell className="pl-6">
                          <div className="relative h-14 w-14 rounded-xl overflow-hidden shadow-sm border">
                            <Image src={item.imageUrl} alt={item.name} fill className="object-cover" />
                          </div>
                        </TableCell>
                        <TableCell className="font-bold">{item.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-medium">
                            {categories?.find(c => c.id === item.categoryId)?.name || 'Sem Categoria'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-semibold text-primary">R$ {item.price.toFixed(2)}</TableCell>
                        <TableCell className="text-right pr-6 space-x-1">
                          <Button variant="ghost" size="icon" className="hover:bg-blue-50" onClick={() => setEditingItem(item)}>
                            <Pencil className="h-4 w-4 text-blue-500" />
                          </Button>
                          <Button variant="ghost" size="icon" className="hover:bg-destructive/5" onClick={() => handleDeleteItem(item.id)}>
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
                <Button className="bg-primary rounded-lg" onClick={async () => {
                  const name = prompt("Nome da Categoria:");
                  if (name) {
                    const newDoc = doc(collection(db, 'categories'));
                    await setDoc(newDoc, { id: newDoc.id, name, description: "", displayOrder: 0 });
                    toast({ title: "Sucesso", description: "Categoria criada." });
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
                      <TableRow key={cat.id} className="hover:bg-muted/10">
                        <TableCell className="font-bold pl-6">{cat.name}</TableCell>
                        <TableCell className="text-right pr-6 space-x-1">
                          <Button variant="ghost" size="icon" onClick={async () => {
                             const name = prompt("Novo Nome:", cat.name);
                             if (name && name !== cat.name) {
                               await updateDoc(doc(db, 'categories', cat.id), { name });
                               toast({ title: "Sucesso", description: "Categoria atualizada." });
                             }
                          }}>
                            <Pencil className="h-4 w-4 text-blue-500" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={async () => {
                            if (confirm("Deseja excluir esta categoria?")) {
                              await deleteDoc(doc(db, 'categories', cat.id));
                              toast({ title: "Removido", description: "Categoria excluída." });
                            }
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
