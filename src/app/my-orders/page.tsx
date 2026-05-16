
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFirestore, useCollection, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, where, doc, setDoc, getDoc, getDocs, onSnapshot, orderBy } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronLeft, ShoppingBag, Clock, Loader2, User as UserIcon, Phone, MapPin, Pencil, Save, RotateCcw, Receipt, QrCode, Wallet, CalendarDays, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Toaster } from '@/components/ui/toaster';
import { useCart } from '@/components/providers/CartProvider';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Aguardando Confirmação',
  received: 'Pedido Recebido',
  ready: 'Pedido Pronto',
  out_for_delivery: 'Saiu para Entrega',
  delivered: 'Concluído',
};

const DELIVERY_STEPS = [
  { key: 'pending', label: 'Enviado' },
  { key: 'received', label: 'Recebido' },
  { key: 'ready', label: 'Preparado' },
  { key: 'out_for_delivery', label: 'Em Entrega' },
  { key: 'delivered', label: 'Entregue' },
];
const PICKUP_STEPS = [
  { key: 'pending', label: 'Enviado' },
  { key: 'received', label: 'Recebido' },
  { key: 'ready', label: 'Pronto p/ Retirar' },
  { key: 'delivered', label: 'Retirado' },
];

const statusMessage = (status: string, orderType: string) => {
  if (status === 'received') return { title: 'Pedido Recebido!', description: 'A loja confirmou o recebimento do seu pedido.' };
  if (status === 'ready') return orderType === 'pickup'
    ? { title: 'Pedido Pronto para Retirar!', description: 'Você já pode buscar seu pedido na loja.' }
    : { title: 'Pedido Pronto!', description: 'Seu pedido está sendo preparado para sair.' };
  if (status === 'out_for_delivery') return { title: 'Saiu para Entrega!', description: 'Seu pedido está a caminho.' };
  if (status === 'delivered') return orderType === 'pickup'
    ? { title: 'Pedido Retirado', description: 'Obrigado pela preferência!' }
    : { title: 'Pedido Entregue', description: 'Aproveite!' };
  return null;
};

function OrderTimeline({ status, orderType }: { status: string; orderType: string }) {
  const steps = orderType === 'pickup' ? PICKUP_STEPS : DELIVERY_STEPS;
  const currentIdx = steps.findIndex(s => s.key === status);
  return (
    <div className="flex items-center justify-between gap-0 py-1">
      {steps.map((step, i) => {
        const done = i <= currentIdx && currentIdx >= 0;
        const current = i === currentIdx;
        return (
          <React.Fragment key={step.key}>
            <div className="flex flex-col items-center flex-shrink-0" style={{width: '3rem'}}>
              <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center text-[9px] font-bold ${
                current ? 'bg-primary border-primary text-white scale-110' :
                done ? 'bg-green-500 border-green-500 text-white' :
                'bg-white border-slate-300 text-slate-400'
              }`}>
                {done && !current ? '✓' : i + 1}
              </div>
              <span className={`text-[8px] font-semibold mt-0.5 text-center leading-tight ${current ? 'text-primary' : done ? 'text-green-600' : 'text-slate-400'}`}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-[2px] mb-3 ${i < currentIdx ? 'bg-green-500' : 'bg-slate-200'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function MyOrdersPage() {
  const { user, isUserLoading } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  const { addToCart } = useCart();

  // Telefone como identificador principal
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneSearched, setPhoneSearched] = useState(false);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [backHref, setBackHref] = useState('/');

  // Carrega o telefone e storeId salvo no localStorage / URL
  useEffect(() => {
    try {
      const saved = localStorage.getItem('customer_phone');
      if (saved) {
        setCustomerPhone(saved);
        setPhoneInput(saved);
        setPhoneSearched(true);
      }
      
      const urlParams = new URLSearchParams(window.location.search);
      const sId = urlParams.get('storeId');
      const returnTo = urlParams.get('returnTo');
      const safeReturnTo = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '';

      if (sId) {
        setStoreId(sId);
        localStorage.setItem('last_store_id', sId);
      } else {
        const lastStore = localStorage.getItem('last_store_id');
        if (lastStore) setStoreId(lastStore);
      }

      if (safeReturnTo) {
        setBackHref(safeReturnTo);
        localStorage.setItem('last_store_path', safeReturnTo);
      } else {
        const lastStorePath = localStorage.getItem('last_store_path');
        if (lastStorePath && lastStorePath.startsWith('/') && !lastStorePath.startsWith('//')) {
          setBackHref(lastStorePath);
        }
      }
    } catch {}
  }, []);

  // Buscar pedidos pelo telefone e ownerId (storeId)
  const ordersQuery = useMemoFirebase(() => {
    if (!db || !customerPhone || !storeId) return null;
    const normalizedPhone = customerPhone.replace(/[\s\-\(\)\+]/g, '').replace(/^55/, '');
    const possiblePhones = Array.from(new Set([customerPhone, normalizedPhone, '+55' + normalizedPhone, '55' + normalizedPhone]));
    return query(
      collection(db, 'orders'), 
      where('customerIdentifier', 'in', possiblePhones)
    );
  }, [db, customerPhone, storeId]);

  const profileRef = useMemoFirebase(() => {
    if (!db || !user) return null;
    return doc(db, 'customers', user.uid);
  }, [db, user]);

  const menuItemsQuery = useMemoFirebase(() => (db ? collection(db, 'menuItems') : null), [db]);

  const { data: ordersRaw, isLoading: loadingOrders } = useCollection(ordersQuery);
  const { data: profile } = useDoc(profileRef);
  const { data: menuItems } = useCollection(menuItemsQuery);

  const [editingProfile, setEditingProfile] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (profile) {
      setName((profile as any).name || '');
      setPhone((profile as any).phone || '');
      setAddress((profile as any).address || '');
    }
  }, [profile]);

  // Conta da Casa logic
  const [contaCasaInfo, setContaCasaInfo] = useState<any>(null);
  const [contaCasaStore, setContaCasaStore] = useState<any>(null);
  const [contaCasaTransactions, setContaCasaTransactions] = useState<any[]>([]);
  const [showExtrato, setShowExtrato] = useState(false);
  const [activeTab, setActiveTab] = useState<'pedidos' | 'prazo'>('pedidos');

  useEffect(() => {
    if (!storeId || !db || !customerPhone) return;

    // Buscar loja
    getDoc(doc(db, 'store_profiles', storeId)).then(snap => {
      if (snap.exists()) setContaCasaStore(snap.data());
    });

    // Buscar cliente com listener em tempo real
    const normalizedPhone = customerPhone.replace(/[\s\-\(\)\+]/g, '').replace(/^55/, '');
    const possiblePhones = Array.from(new Set([customerPhone, normalizedPhone, '+55' + normalizedPhone, '55' + normalizedPhone]));
    const q = query(collection(db, 'clientes'), where('ownerId', '==', storeId), where('celular', 'in', possiblePhones));
    const unsubClient = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const cData = { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
        if (cData.creditEnabled) {
          setContaCasaInfo(cData);
        }
      }
    });

    // Buscar transações
    getDocs(q).then(snap => {
      if (!snap.empty) {
        const cId = snap.docs[0].id;
        const tq = query(collection(db, 'clientes', cId, 'credit_transactions'), orderBy('date', 'desc'));
        onSnapshot(tq, (tsnap) => {
          setContaCasaTransactions(tsnap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
      }
    });

    return () => unsubClient();
  }, [storeId, db, customerPhone]);



  const orders = useMemo(() => {
    if (!ordersRaw || !storeId) return [];
    return [...ordersRaw]
      .filter((o: any) => o.ownerId === storeId)
      .sort((a: any, b: any) => (b.orderDateTime || '').localeCompare(a.orderDateTime || ''));
  }, [ordersRaw, storeId]);

  const lastStatusRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!orders) return;
    orders.forEach((order: any) => {
      const prev = lastStatusRef.current[order.id];
      if (prev && prev !== order.status) {
        const msg = statusMessage(order.status, order.orderType || 'delivery');
        if (msg) {
          toast({ title: `${msg.title} #${order.id}`, description: msg.description });
          try {
            if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
              new Notification(msg.title, { body: `Pedido #${order.id} — ${msg.description}` });
            }
          } catch {}
        }
      }
      lastStatusRef.current[order.id] = order.status;
    });
  }, [orders, toast]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const handleSaveProfile = async () => {
    if (!db || !user) return;
    setSavingProfile(true);
    try {
      await setDoc(doc(db, 'customers', user.uid), {
        uid: user.uid,
        name, phone, address,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      toast({ title: 'Perfil atualizado' });
      setEditingProfile(false);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err?.message || 'Falha ao salvar.' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleRepeatOrder = (order: any) => {
    if (!menuItems || !Array.isArray(order.items)) return;
    let added = 0, missing = 0;
    order.items.forEach((it: any) => {
      const match = (menuItems as any[]).find(m => m.name === it.name);
      if (match) {
        addToCart(match, it.quantity || 1, {
          addons: (it.addons || []).map((a: any) => ({ id: a.name, name: a.name, price: a.price })),
          notes: it.notes || '',
        });
        added++;
      } else {
        missing++;
      }
    });
    if (added > 0) {
      toast({ title: 'Itens adicionados ao carrinho', description: `${added} item(ns) pronto(s) para refazer.${missing > 0 ? ` ${missing} não estão mais disponíveis.` : ''}` });
    } else {
      toast({ variant: 'destructive', title: 'Nada foi adicionado', description: 'Os itens desse pedido não estão mais disponíveis no cardápio.' });
    }
  };

  const handlePhoneLookup = () => {
    const cleaned = phoneInput.replace(/\D/g, '');
    if (cleaned.length < 10) {
      toast({ variant: 'destructive', title: 'Telefone inválido', description: 'Digite um número com DDD (mínimo 10 dígitos).' });
      return;
    }
    setCustomerPhone(cleaned);
    setPhoneSearched(true);
    try { localStorage.setItem('customer_phone', cleaned); } catch {}
  };

  if (isUserLoading || !db) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF7]">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  // Se não tem telefone salvo, mostra tela para digitar
  if (!customerPhone || !phoneSearched) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] p-4 flex items-center justify-center">
        <Card className="max-w-md w-full p-8 space-y-4">
          <div className="text-center space-y-2">
            <Phone className="h-12 w-12 text-primary mx-auto" />
            <h1 className="text-2xl font-bold">Acompanhe seus pedidos</h1>
            <p className="text-sm text-muted-foreground">Digite o telefone usado no pedido para ver o histórico e acompanhar a entrega.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone_lookup">Seu telefone (com DDD)</Label>
            <Input 
              id="phone_lookup" 
              type="tel" 
              placeholder="Ex: 16991017726" 
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePhoneLookup()}
            />
          </div>
          <Button className="w-full" onClick={handlePhoneLookup}>
            <ShoppingBag className="h-4 w-4 mr-2" /> Buscar Meus Pedidos
          </Button>
          <Link href={backHref}>
            <Button variant="ghost" className="w-full text-muted-foreground">
              <ChevronLeft className="h-4 w-4 mr-2" /> Voltar ao Cardápio
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  const statusClass = (s: string) =>
    s === 'pending' ? 'bg-yellow-500 text-white' :
    s === 'received' ? 'bg-blue-500 text-white' :
    s === 'ready' ? 'bg-green-500 text-white' :
    s === 'out_for_delivery' ? 'bg-purple-500 text-white' :
    'bg-gray-500 text-white';


  return (
    <div className="min-h-screen bg-[#F5F5F0] p-3 md:p-6">
      <div className="max-w-2xl mx-auto space-y-3">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href={backHref}>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ChevronLeft className="h-5 w-5" />
              </Button>
            </Link>
            <h1 className="text-lg font-bold">Meus Pedidos</h1>
          </div>
          {contaCasaInfo && (
            <div className="flex bg-slate-200 rounded-lg p-0.5 text-xs font-semibold">
              <button onClick={() => setActiveTab('pedidos')} className={`px-3 py-1.5 rounded-md transition-all ${activeTab === 'pedidos' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>📋 Pedidos</button>
              <button onClick={() => setActiveTab('prazo')} className={`px-3 py-1.5 rounded-md transition-all ${activeTab === 'prazo' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>📝 Prazo</button>
            </div>
          )}
        </header>

        <div className="bg-white rounded-xl shadow-sm p-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">{(name || '?')[0]?.toUpperCase()}</div>
            <div className="min-w-0">
              <p className="text-sm font-bold truncate">{name || 'Sem nome'}</p>
              <p className="text-[11px] text-slate-500 truncate">{phone || customerPhone} · {address || 'Sem endereço'}</p>
            </div>
          </div>
          <Button size="sm" variant="ghost" className="h-7 text-xs flex-shrink-0" onClick={() => setEditingProfile(!editingProfile)}>
            <Pencil className="h-3 w-3 mr-1" />{editingProfile ? 'Fechar' : 'Editar'}
          </Button>
        </div>
        {editingProfile && (
          <div className="bg-white rounded-xl shadow-sm p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-[10px] font-semibold text-slate-500">Nome</Label><Input className="h-8 text-sm" value={name} onChange={e => setName(e.target.value)} /></div>
              <div><Label className="text-[10px] font-semibold text-slate-500">Telefone</Label><Input className="h-8 text-sm" value={phone} onChange={e => setPhone(e.target.value)} /></div>
            </div>
            <div><Label className="text-[10px] font-semibold text-slate-500">Endereço</Label><Input className="h-8 text-sm" value={address} onChange={e => setAddress(e.target.value)} /></div>
            <Button size="sm" className="w-full h-8 text-xs" onClick={handleSaveProfile} disabled={savingProfile}>
              {savingProfile ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Save className="h-3 w-3 mr-1" /> Salvar</>}
            </Button>
          </div>
        )}

        {activeTab === 'prazo' && contaCasaInfo ? (
          <div className="space-y-3">
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-xl p-4 shadow-md">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-sm font-bold"><Receipt className="h-4 w-4" /> Minha Conta (Prazo)</div>
                <Badge className="bg-white/20 hover:bg-white/30 text-white border-0 text-[10px]">Cliente VIP</Badge>
              </div>
              <div className="text-center py-2">
                <p className="text-indigo-100 text-[11px]">Saldo Devedor</p>
                <p className="text-3xl font-black">R$ {(contaCasaInfo.creditBalance || 0).toFixed(2)}</p>
              </div>
              {(contaCasaStore?.creditPixKey || contaCasaStore?.creditPixName) && (
                <div className="bg-white/10 p-2.5 rounded-lg border border-white/20 space-y-1.5 mt-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-100"><QrCode className="h-3 w-3" /> Pague via PIX</div>
                  {contaCasaStore.creditPixKey && (
                    <div className="flex justify-between items-center bg-black/20 px-2 py-1.5 rounded text-[11px]">
                      <span className="text-indigo-200">Chave:</span>
                      <span className="font-mono font-bold truncate max-w-[160px]">{contaCasaStore.creditPixKey}</span>
                    </div>
                  )}
                  {contaCasaStore.creditPixName && (
                    <div className="flex justify-between items-center bg-black/20 px-2 py-1.5 rounded text-[11px]">
                      <span className="text-indigo-200">Titular:</span>
                      <span className="font-bold truncate">{contaCasaStore.creditPixName}</span>
                    </div>
                  )}
                  <p className="text-[9px] text-center text-indigo-200 mt-1">Envie o comprovante no WhatsApp da loja.</p>
                </div>
              )}
            </div>
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="px-3 py-2 border-b">
                <span className="text-xs font-bold text-slate-700">Dados da Conta</span>
              </div>
              <div className="px-3 py-2 space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">Titular</span>
                  <span className="font-semibold text-slate-700">{contaCasaInfo.nome || name || 'N/A'}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">Telefone</span>
                  <span className="font-semibold text-slate-700">{contaCasaInfo.celular || customerPhone}</span>
                </div>
                {(contaCasaInfo.logradouro || contaCasaInfo.bairro) && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">Endereço</span>
                    <span className="font-semibold text-slate-700 text-right max-w-[60%] truncate">{[contaCasaInfo.logradouro, contaCasaInfo.numero, contaCasaInfo.bairro, contaCasaInfo.cidade].filter(Boolean).join(', ')}</span>
                  </div>
                )}
                {contaCasaInfo.createdAt && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">Cliente desde</span>
                    <span className="font-semibold text-slate-700">{new Date(contaCasaInfo.createdAt).toLocaleDateString('pt-BR')}</span>
                  </div>
                )}
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">Status</span>
                  <span className="font-semibold text-emerald-600">✅ Prazo Ativo</span>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="px-3 py-2 border-b flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">Extrato</span>
                <span className="text-[10px] text-slate-400">{contaCasaTransactions.length} lançamento(s)</span>
              </div>
              {contaCasaTransactions.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400">Nenhuma transação.</div>
              ) : (
                <div className="divide-y max-h-[400px] overflow-y-auto custom-scrollbar">
                  {contaCasaTransactions.map(t => {
                    const descId = (t.description || '').replace(/^.*#/, '').trim();
                    const matchedOrder = descId && orders ? (orders as any[]).find((o: any) => o.id?.startsWith(descId)) : null;
                    return (
                      <div key={t.id} className="px-3 py-2.5 hover:bg-slate-50">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-[11px] font-semibold text-slate-700">{t.description || (t.type === 'debit' ? 'Compra' : 'Pagamento')}</p>
                            <p className="text-[9px] text-slate-400">{new Date(t.date).toLocaleString('pt-BR')}</p>
                          </div>
                          <div className={`text-xs font-black ${t.type === 'debit' ? 'text-red-500' : 'text-emerald-600'}`}>
                            {t.type === 'debit' ? '+' : '-'} R$ {(t.amount || 0).toFixed(2)}
                          </div>
                        </div>
                        {matchedOrder && matchedOrder.items && (
                          <div className="mt-1.5 bg-slate-50 rounded-md px-2 py-1.5 space-y-0.5">
                            {matchedOrder.items.map((it: any, i: number) => (
                              <div key={i} className="flex justify-between text-[10px] text-slate-600">
                                <span>{it.quantity}x {it.name}{it.addons?.length > 0 ? ` (${it.addons.map((a:any) => a.name).join(', ')})` : ''}</span>
                                <span className="text-slate-400">R$ {(it.unitPrice * it.quantity).toFixed(2)}</span>
                              </div>
                            ))}
                            {matchedOrder.deliveryFee > 0 && (
                              <div className="flex justify-between text-[10px] text-slate-400 border-t border-dashed border-slate-200 pt-0.5 mt-0.5">
                                <span>Frete</span>
                                <span>R$ {matchedOrder.deliveryFee.toFixed(2)}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {loadingOrders ? (
              <div className="py-10 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" /></div>
            ) : !orders || orders.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <ShoppingBag className="h-12 w-12 text-slate-300 mx-auto" />
                <p className="text-sm text-slate-400">Nenhum pedido encontrado.</p>
                <Link href={backHref}><Button size="sm">Ir para o Cardápio</Button></Link>
              </div>
            ) : (
              <div className="space-y-2">
                {orders.map((order: any) => (
                  <div key={order.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                    <div className="px-3 py-2 border-b flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-800">#{order.id?.substring(0,8)}</span>
                        <span className="text-[10px] text-slate-400">{new Date(order.orderDateTime).toLocaleDateString('pt-BR')}</span>
                      </div>
                      <Badge className={`${statusClass(order.status)} text-[9px] px-1.5 py-0.5`}>
                        {STATUS_LABELS[order.status] || order.status}
                      </Badge>
                    </div>
                    <div className="px-3 py-2 space-y-1.5">
                      <OrderTimeline status={order.status} orderType={order.orderType || 'delivery'} />
                      <div className="space-y-0.5">
                        {order.items?.map((it: any, i: number) => (
                          <div key={i} className="flex justify-between text-[11px]">
                            <span className="text-slate-700"><span className="font-bold">{it.quantity}x</span> {it.name}
                              {it.addons?.length > 0 && <span className="text-slate-400"> ({it.addons.map((a:any) => a.name).join(', ')})</span>}
                            </span>
                            <span className="text-slate-500 flex-shrink-0">R$ {(it.unitPrice * it.quantity).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-dashed">
                        <div className="text-[10px] text-slate-400">
                          {order.deliveryFee > 0 && <span>Frete: R$ {order.deliveryFee.toFixed(2)}</span>}
                        </div>
                        <span className="text-sm font-black text-primary">R$ {order.totalAmount.toFixed(2)}</span>
                      </div>
                      <button onClick={() => handleRepeatOrder(order)} className="w-full text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 flex items-center justify-center gap-1 py-1">
                        <RotateCcw className="h-3 w-3" /> Repetir Pedido
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <Toaster />
    </div>
  );
}
