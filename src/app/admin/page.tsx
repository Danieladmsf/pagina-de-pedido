
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
    <div className="min-h-screen bg-[#FAFAF7] relative">
      <section
        className="relative w-full bg-no-repeat bg-center bg-cover md:bg-[length:100%_100%] min-h-[340px] md:min-h-0 md:aspect-[1832/560]"
        style={{ backgroundImage: "url('/lima-limao-bg.png')" }}
      >
        <div className="absolute inset-0 bg-white/30" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-[#FAFAF7] pointer-events-none" />
        <div className="relative h-full max-w-6xl mx-auto px-4 md:px-8 flex flex-col justify-between py-4 md:py-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="flex items-center gap-4 bg-white/80 backdrop-blur rounded-2xl px-5 py-3 shadow-md border border-white">
              <div className="bg-gradient-to-br from-primary to-primary/70 p-3 rounded-xl shadow-md">
                <LayoutDashboard className="h-7 w-7 text-white" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-black tracking-tight text-primary uppercase">{adminRole?.storeName || 'Meu Painel'}</h1>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a href={storeLink} target="_blank" className="bg-white/90 backdrop-blur px-4 py-2 rounded-xl text-sm font-bold text-primary border border-primary/20 shadow-sm hover:bg-primary hover:text-white transition-all flex items-center gap-2">
                <ExternalLink className="h-4 w-4" /> Ver minha Loja
              </a>
              <Button variant="secondary" size="sm" className="bg-white/90 backdrop-blur text-destructive font-bold shadow-sm h-10" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" /> Sair
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            <div className="bg-white/90 backdrop-blur rounded-2xl p-4 border border-yellow-200 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-bold text-yellow-600">Pendentes</p>
                  <p className="text-2xl font-black text-yellow-700">{orders?.filter((o: any) => o.status === 'pending').length || 0}</p>
                </div>
                <div className="bg-yellow-100 p-2 rounded-xl"><Clock className="h-5 w-5 text-yellow-600" /></div>
              </div>
            </div>
            <div className="bg-white/90 backdrop-blur rounded-2xl p-4 border border-blue-200 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-bold text-blue-600">Recebidos</p>
                  <p className="text-2xl font-black text-blue-700">{orders?.filter((o: any) => o.status === 'received').length || 0}</p>
                </div>
                <div className="bg-blue-100 p-2 rounded-xl"><ShoppingBag className="h-5 w-5 text-blue-600" /></div>
              </div>
            </div>
            <div className="bg-white/90 backdrop-blur rounded-2xl p-4 border border-green-200 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-bold text-green-600">Prontos</p>
                  <p className="text-2xl font-black text-green-700">{orders?.filter((o: any) => o.status === 'ready').length || 0}</p>
                </div>
                <div className="bg-green-100 p-2 rounded-xl"><CheckCircle2 className="h-5 w-5 text-green-600" /></div>
              </div>
            </div>
            <div className="bg-white/90 backdrop-blur rounded-2xl p-4 border border-purple-200 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-bold text-purple-600">Em Entrega</p>
                  <p className="text-2xl font-black text-purple-700">{orders?.filter((o: any) => o.status === 'out_for_delivery').length || 0}</p>
                </div>
                <div className="bg-purple-100 p-2 rounded-xl"><ShoppingBag className="h-5 w-5 text-purple-600" /></div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <div className="max-w-6xl mx-auto px-4 md:px-8 space-y-8 relative pb-12">

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

          <TabsContent value="orders" className="mt-6 space-y-4">
            {loadingOrders ? (
              <div className="py-20 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></div>
            ) : !orders || orders.length === 0 ? (
              <Card className="border-dashed border-2 rounded-2xl py-20">
                <div className="text-center space-y-3">
                  <ShoppingBag className="h-16 w-16 text-muted-foreground/30 mx-auto" />
                  <p className="text-muted-foreground font-medium">Nenhum pedido ainda. Divulgue seu link!</p>
                </div>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {orders.map((order: any) => {
                  const borderColor =
                    order.status === 'pending' ? 'border-l-yellow-500' :
                    order.status === 'received' ? 'border-l-blue-500' :
                    order.status === 'ready' ? 'border-l-green-500' :
                    order.status === 'out_for_delivery' ? 'border-l-purple-500' :
                    order.status === 'delivered' ? 'border-l-gray-500' :
                    'border-l-gray-400';
                  const statusLabel =
                    order.status === 'pending' ? 'Pendente' :
                    order.status === 'received' ? 'Recebido' :
                    order.status === 'ready' ? 'Pronto' :
                    order.status === 'out_for_delivery' ? 'Saiu p/ entrega' :
                    order.status === 'delivered' ? 'Concluído' : order.status;
                  const statusColor =
                    order.status === 'pending' ? 'bg-yellow-100 text-yellow-700 border-yellow-300' :
                    order.status === 'received' ? 'bg-blue-100 text-blue-700 border-blue-300' :
                    order.status === 'ready' ? 'bg-green-100 text-green-700 border-green-300' :
                    order.status === 'out_for_delivery' ? 'bg-purple-100 text-purple-700 border-purple-300' :
                    order.status === 'delivered' ? 'bg-gray-200 text-gray-700 border-gray-400' :
                    'bg-gray-100 text-gray-700 border-gray-300';
                  return (
                    <Card key={order.id} className={`rounded-2xl shadow-sm border-l-4 ${borderColor} bg-white hover:shadow-lg transition-shadow`}>
                      <CardContent className="p-5 space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-mono font-bold text-muted-foreground">#{order.id}</span>
                              <Badge className={`${statusColor} border font-bold text-[10px] uppercase`}>{statusLabel}</Badge>
                              <Badge className="bg-slate-100 text-slate-700 border-slate-300 border font-bold text-[10px] uppercase">
                                {order.orderType === 'pickup' ? '🏪 Retirada' : '🛵 Entrega'}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                              <Clock className="h-3 w-3" /> {new Date(order.orderDateTime).toLocaleString('pt-BR')}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Total</p>
                            <p className="text-xl font-black text-primary">R$ {order.totalAmount.toFixed(2)}</p>
                          </div>
                        </div>

                        <div className="bg-muted/40 rounded-xl p-3 space-y-1">
                          <div className="flex items-center gap-2 text-sm font-bold">
                            <User className="h-3 w-3" /> {order.customerName}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Phone className="h-3 w-3" /> {order.customerPhone}
                          </div>
                          {order.deliveryAddress && (
                            <div className="flex items-start gap-2 text-xs text-muted-foreground">
                              <MapPin className="h-3 w-3 mt-0.5 shrink-0" /> <span className="leading-snug">{order.deliveryAddress}</span>
                            </div>
                          )}
                        </div>

                        <div className="space-y-1">
                          {order.items?.map((it: any, i: number) => (
                            <div key={i} className="text-sm flex justify-between gap-2">
                              <span><span className="font-bold text-primary">{it.quantity}x</span> {it.name}</span>
                              <span className="text-muted-foreground whitespace-nowrap">R$ {(it.unitPrice * it.quantity).toFixed(2)}</span>
                            </div>
                          ))}
                        </div>

                        <div className="pt-3 border-t border-dashed flex flex-wrap gap-2">
                          {order.status === 'pending' && (
                            <Button size="sm" onClick={() => updateOrderStatus(order.id, 'received')} className="bg-blue-600 hover:bg-blue-700 w-full">
                              <CheckCircle2 className="h-4 w-4 mr-2" /> Confirmar Recebimento
                            </Button>
                          )}
                          {order.status === 'received' && (
                            <Button size="sm" onClick={() => updateOrderStatus(order.id, 'ready')} className="bg-green-600 hover:bg-green-700 w-full">
                              <CheckCircle2 className="h-4 w-4 mr-2" /> {order.orderType === 'pickup' ? 'Pronto p/ Retirada' : 'Marcar como Pronto'}
                            </Button>
                          )}
                          {order.status === 'ready' && order.orderType === 'delivery' && (
                            <Button size="sm" onClick={() => updateOrderStatus(order.id, 'out_for_delivery')} className="bg-purple-600 hover:bg-purple-700 w-full">
                              Saiu para Entrega
                            </Button>
                          )}
                          {order.status === 'ready' && order.orderType === 'pickup' && (
                            <Button size="sm" onClick={() => updateOrderStatus(order.id, 'delivered')} className="bg-gray-700 hover:bg-gray-800 w-full">
                              <CheckCircle2 className="h-4 w-4 mr-2" /> Cliente Retirou
                            </Button>
                          )}
                          {order.status === 'out_for_delivery' && (
                            <Button size="sm" onClick={() => updateOrderStatus(order.id, 'delivered')} className="bg-gray-700 hover:bg-gray-800 w-full">
                              <CheckCircle2 className="h-4 w-4 mr-2" /> Marcar como Entregue
                            </Button>
                          )}
                          {order.status === 'delivered' && (
                            <div className="w-full text-center text-xs text-muted-foreground italic py-1">Pedido concluído</div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
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
