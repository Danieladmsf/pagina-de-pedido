
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
import { Pencil, Trash2, Plus, LayoutDashboard, Utensils, Tag, LogOut, Loader2, ShieldAlert, ShoppingBag, Clock, CheckCircle2, User, MapPin, Phone, ExternalLink, Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';

export default function AdminPage() {
  const db = useFirestore();
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { user, isUserLoading } = useUser();
  
  const isRealUser = !!(user && !user.isAnonymous);

  const adminRoleRef = useMemoFirebase(() => (db && isRealUser) ? doc(db, 'roles_admin', user!.uid) : null, [db, isRealUser]);
  const { data: adminRole, isLoading: loadingRole } = useDoc(adminRoleRef);

  // Consultas filtradas pelo UID do dono (Multi-tenancy) com checagem de DB
  const categoriesQuery = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return query(collection(db, 'categories'), where('ownerId', '==', user!.uid));
  }, [db, isRealUser]);

  const itemsQuery = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return query(collection(db, 'menuItems'), where('ownerId', '==', user!.uid));
  }, [db, isRealUser]);

  const ordersQuery = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    console.log('[admin] building ordersQuery for uid:', user!.uid);
    return query(collection(db, 'orders'), where('ownerId', '==', user!.uid));
  }, [db, isRealUser]);

  const addonsQuery = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return query(collection(db, 'addons'), where('ownerId', '==', user!.uid));
  }, [db, isRealUser]);

  const { data: categories, isLoading: loadingCats } = useCollection(categoriesQuery);
  const { data: items, isLoading: loadingItems } = useCollection(itemsQuery);
  const { data: ordersRaw, isLoading: loadingOrders, error: ordersError } = useCollection(ordersQuery);
  const orders = React.useMemo(() => {
    if (!ordersRaw) return ordersRaw;
    return [...ordersRaw].sort((a: any, b: any) => (b.orderDateTime || '').localeCompare(a.orderDateTime || ''));
  }, [ordersRaw]);

  useEffect(() => {
    console.log('[admin] user:', user?.uid, 'isRealUser:', isRealUser);
    console.log('[admin] orders loading:', loadingOrders, 'count:', ordersRaw?.length, 'error:', ordersError);
    if (ordersRaw) console.log('[admin] orders data:', ordersRaw);
  }, [user, isRealUser, loadingOrders, ordersRaw, ordersError]);
  const { data: addons } = useCollection(addonsQuery);

  const [editingItem, setEditingItem] = useState<any>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);
  const [editingAddon, setEditingAddon] = useState<any>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const uploadImage = async (): Promise<string> => {
    if (!imageFile) return editingItem?.imageUrl || '';
    setUploadingImage(true);
    try {
      const response = await fetch(`/api/upload?filename=${encodeURIComponent(imageFile.name)}`, {
        method: 'POST',
        body: imageFile,
      });
      if (!response.ok) {
        const text = await response.text();
        let errorMsg = 'Falha no upload da imagem';
        try { errorMsg = JSON.parse(text).error || errorMsg; } catch {}
        throw new Error(errorMsg);
      }
      const blob = await response.json();
      if (!blob.url) throw new Error('Upload não retornou URL válida');
      return blob.url;
    } finally {
      setUploadingImage(false);
    }
  };

  useEffect(() => {
    if (!isUserLoading && (!user || user.isAnonymous)) {
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

    try {
      const imageUrl = await uploadImage();
      const itemData = {
        name: formData.get('name') as string,
        description: formData.get('description') as string,
        price: parseFloat(formData.get('price') as string),
        categoryId: formData.get('categoryId') as string,
        imageUrl,
        addonIds: selectedAddonIds,
        ownerId: user.uid,
        isAvailable: true,
        isRecommended: false,
      };

      if (editingItem?.id) {
        await updateDoc(doc(db, 'menuItems', editingItem.id), itemData);
      } else {
        const newDoc = doc(collection(db, 'menuItems'));
        await setDoc(newDoc, { ...itemData, id: newDoc.id });
      }
      setEditingItem(null);
      setImageFile(null);
      setImagePreview('');
      setSelectedAddonIds([]);
      toast({ title: "Sucesso", description: "Produto salvo com sucesso." });
    } catch (err: any) {
      console.error('Erro ao salvar produto:', err);
      toast({ variant: "destructive", title: "Erro ao salvar", description: err?.message || "Verifique sua conexão e tente novamente." });
    }
  };

  const handleSaveAddon = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !db) return;
    const formData = new FormData(e.currentTarget);
    const addonData = {
      name: formData.get('addonName') as string,
      price: parseFloat(formData.get('addonPrice') as string),
      ownerId: user.uid,
    };
    try {
      if (editingAddon?.id) {
        await updateDoc(doc(db, 'addons', editingAddon.id), addonData);
      } else {
        const newDoc = doc(collection(db, 'addons'));
        await setDoc(newDoc, { ...addonData, id: newDoc.id });
      }
      setEditingAddon(null);
      toast({ title: "Sucesso", description: "Adicional salvo." });
    } catch (err: any) {
      console.error('Erro ao salvar adicional:', err);
      toast({ variant: "destructive", title: "Erro", description: err?.message || "Falha ao salvar adicional." });
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
    <div className="min-h-screen bg-muted/30 p-4 md:p-8 relative">
      <div
        aria-hidden
        className="fixed inset-0 -z-10 pointer-events-none bg-no-repeat bg-center bg-cover opacity-[0.08]"
        style={{ backgroundImage: "url('/lima-limao-bg.png')" }}
      />
      <div className="max-w-6xl mx-auto space-y-8 relative">
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
            <TabsTrigger value="addons" className="rounded-lg px-6 flex gap-2">
              <Plus className="h-4 w-4" /> Adicionais
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
                            <Badge className={
                              order.status === 'pending' ? 'bg-yellow-500 text-white' :
                              order.status === 'received' ? 'bg-blue-500 text-white' :
                              order.status === 'ready' ? 'bg-green-500 text-white' :
                              order.status === 'out_for_delivery' ? 'bg-purple-500 text-white' :
                              'bg-gray-500 text-white'
                            }>
                              {order.status === 'pending' ? 'Pendente' :
                               order.status === 'received' ? 'Recebido' :
                               order.status === 'ready' ? 'Pronto' :
                               order.status === 'out_for_delivery' ? 'Saiu p/ entrega' :
                               order.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            <div className="flex flex-col gap-1 items-end">
                              {order.status === 'pending' && (
                                <Button size="sm" onClick={() => updateOrderStatus(order.id, 'received')} className="bg-blue-600 h-8">
                                  Confirmar Recebimento
                                </Button>
                              )}
                              {order.status === 'received' && (
                                <Button size="sm" onClick={() => updateOrderStatus(order.id, 'ready')} className="bg-green-600 h-8">
                                  <CheckCircle2 className="h-4 w-4 mr-1" /> Pronto
                                </Button>
                              )}
                              {order.status === 'ready' && order.orderType === 'delivery' && (
                                <Button size="sm" onClick={() => updateOrderStatus(order.id, 'out_for_delivery')} className="bg-purple-600 h-8">
                                  Saiu para Entrega
                                </Button>
                              )}
                            </div>
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
                <Dialog open={editingItem !== null} onOpenChange={(open) => { if (!open) { setEditingItem(null); setImageFile(null); setImagePreview(''); setSelectedAddonIds([]); } }}>
                  <DialogTrigger asChild>
                    <Button onClick={() => { setEditingItem({}); setImageFile(null); setImagePreview(''); setSelectedAddonIds([]); }} className="bg-primary text-white">
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
                        <Label>Foto do Prato</Label>
                        <div className="flex items-center gap-3">
                          {(imagePreview || editingItem?.imageUrl) && (
                            <div className="relative h-16 w-16 rounded-lg overflow-hidden border flex-shrink-0">
                              <Image src={imagePreview || editingItem?.imageUrl} alt="preview" fill className="object-cover" />
                            </div>
                          )}
                          <label className="flex-1 cursor-pointer">
                            <div className="flex items-center justify-center gap-2 border-2 border-dashed border-muted-foreground/30 rounded-lg p-3 hover:border-primary transition-colors">
                              <Upload className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm text-muted-foreground">
                                {imageFile ? imageFile.name : 'Clique para escolher uma foto'}
                              </span>
                            </div>
                            <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                          </label>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="description">Descrição</Label>
                        <Textarea id="description" name="description" defaultValue={editingItem?.description} required />
                      </div>
                      {addons && addons.length > 0 && (
                        <div className="space-y-2">
                          <Label>Adicionais Disponíveis</Label>
                          <div className="space-y-2 border rounded-md p-3 max-h-48 overflow-y-auto">
                            {addons.map(addon => {
                              const checked = selectedAddonIds.includes(addon.id);
                              return (
                                <label key={addon.id} className="flex items-center justify-between cursor-pointer hover:bg-muted/50 p-2 rounded">
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        if (e.target.checked) setSelectedAddonIds([...selectedAddonIds, addon.id]);
                                        else setSelectedAddonIds(selectedAddonIds.filter(id => id !== addon.id));
                                      }}
                                      className="h-4 w-4"
                                    />
                                    <span className="text-sm">{addon.name}</span>
                                  </div>
                                  <span className="text-xs font-semibold text-primary">+ R$ {addon.price.toFixed(2)}</span>
                                </label>
                              );
                            })}
                          </div>
                          <p className="text-xs text-muted-foreground">Marque os adicionais que este produto pode receber. Deixe vazio se não aplicável.</p>
                        </div>
                      )}
                      <DialogFooter>
                        <Button type="submit" className="w-full h-12 font-bold" disabled={uploadingImage}>
                          {uploadingImage ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Enviando foto...</> : 'Salvar'}
                        </Button>
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
                          <Button variant="ghost" size="icon" onClick={() => { setEditingItem(item); setSelectedAddonIds(item.addonIds || []); setImageFile(null); setImagePreview(''); }}>
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

          <TabsContent value="addons" className="mt-6">
            <Card className="border shadow-md rounded-2xl overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between border-b bg-white">
                <CardTitle className="text-lg">Adicionais Disponíveis</CardTitle>
                <Dialog open={editingAddon !== null} onOpenChange={(open) => { if (!open) setEditingAddon(null); }}>
                  <DialogTrigger asChild>
                    <Button onClick={() => setEditingAddon({})} className="bg-primary text-white">
                      <Plus className="mr-2 h-4 w-4" /> Novo Adicional
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                      <DialogTitle>{editingAddon?.id ? 'Editar Adicional' : 'Novo Adicional'}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSaveAddon} className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label htmlFor="addonName">Nome</Label>
                        <Input id="addonName" name="addonName" defaultValue={editingAddon?.name} placeholder="Ex: Bacon, Queijo Extra, Gelo..." required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="addonPrice">Preço (R$)</Label>
                        <Input id="addonPrice" name="addonPrice" type="number" step="0.01" defaultValue={editingAddon?.price} placeholder="0.00" required />
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
                      <TableHead className="pl-6">Nome</TableHead>
                      <TableHead>Preço</TableHead>
                      <TableHead className="text-right pr-6">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!addons || addons.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center py-10 text-muted-foreground">
                          Nenhum adicional cadastrado. Crie opções como "Bacon", "Queijo", "Molho Picante" para usar nos produtos.
                        </TableCell>
                      </TableRow>
                    ) : (
                      addons.map((addon) => (
                        <TableRow key={addon.id}>
                          <TableCell className="font-bold pl-6">{addon.name}</TableCell>
                          <TableCell className="text-primary font-semibold">R$ {addon.price.toFixed(2)}</TableCell>
                          <TableCell className="text-right pr-6 space-x-1">
                            <Button variant="ghost" size="icon" onClick={() => setEditingAddon(addon)}>
                              <Pencil className="h-4 w-4 text-blue-500" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={async () => {
                              if (!db) return;
                              if (confirm("Excluir adicional?")) await deleteDoc(doc(db, 'addons', addon.id));
                            }}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
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
