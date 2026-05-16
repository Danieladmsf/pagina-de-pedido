'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { AddressAutocomplete } from '@/components/ui/address-autocomplete';
import { collection, doc, getDoc, setDoc } from 'firebase/firestore';
import { Loader2, Plus, Trash2, Store, Clock, Settings, Truck, Wallet, CalendarOff, ChevronLeft, ChevronRight, Camera, X, Building2, Phone, MessageCircle, MapPin, Hash, ImageIcon, Info, CheckCircle2, Bike, Users, ShoppingBag, Box, RefreshCw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { uploadImage } from '@/lib/upload';

interface StoreProfileTabProps {
  db: any;
  user: any;
  activeSection?: 'geral' | 'taxas' | 'horarios' | 'motoboys' | 'pagamentos';
}

const DAYS_OF_WEEK = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

export function StoreProfileTab({ db, user, activeSection }: StoreProfileTabProps) {
  const { toast } = useToast();
  const activeTab = activeSection || 'geral';
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Estados dos formulários
  const [formData, setFormData] = useState({
    name: '',
    cnpj: '',
    foundedYear: '',
    phone: '',
    whatsapp: '',
    address: '',
    addressNumber: '',
    addressComplement: '',
    logoUrl: '',
    deliveryCities: [] as string[],
    cityInput: '', // temporário
    deliveryFee: 0,
    freeDeliveryOver: 0,
    tableServiceFee: 0,
    tableServiceFeeType: 'percentage' as 'percentage' | 'fixed',
    minOrderValue: 0,
    deliveryTime: '00:50',
    pickupTime: '00:30',
    maxDeliveryRadius: 0,
    enableInventory: false,
  });
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  const [workingHours, setWorkingHours] = useState(
    DAYS_OF_WEEK.map(day => ({ day, open: '09:00', close: '16:00', isClosed: false }))
  );

  const [plannedClosures, setPlannedClosures] = useState<{ id: string, date: string, reason: string }[]>([]);
  const [newClosureDate, setNewClosureDate] = useState('');
  const [newClosureReason, setNewClosureReason] = useState('');
  const [calMonth, setCalMonth] = useState(() => ({ year: new Date().getFullYear(), month: new Date().getMonth() }));

  const [motoboys, setMotoboys] = useState<{ id: string, name: string, phone: string, licensePlate: string, fee: number }[]>([]);
  const [freelancers, setFreelancers] = useState<{ id: string, name: string, whatsapp: string, dailyRate: number, workDays: string[], active: boolean }[]>([]);
  const [feeRules, setFeeRules] = useState<{ maxKm: number, fee: number }[]>([
    { maxKm: 3, fee: 5 },
    { maxKm: 6, fee: 8 },
    { maxKm: 10, fee: 12 }
  ]);
  const [customAddressRules, setCustomAddressRules] = useState<{ keyword: string, fee: number, type: 'neighborhood' | 'address', addressNumber?: string }[]>([]);

  const [paymentMethods, setPaymentMethods] = useState<{ id: string, label: string, icon: string, active: boolean }[]>([
    { id: 'dinheiro', label: 'Dinheiro', icon: '💵', active: true },
    { id: 'pix', label: 'Pix', icon: '📱', active: true },
    { id: 'debito', label: 'Débito', icon: '💳', active: true },
    { id: 'credito', label: 'Crédito', icon: '💳', active: true },
  ]);

  const [creditPixKey, setCreditPixKey] = useState('');
  const [creditPixName, setCreditPixName] = useState('');

  // Bairros disponíveis (carregados da API)
  const [availableNeighborhoods, setAvailableNeighborhoods] = useState<{ name: string, id: string }[]>([]);
  const [loadingNeighborhoods, setLoadingNeighborhoods] = useState(false);
  const [neighborhoodSearch, setNeighborhoodSearch] = useState('');

  useEffect(() => {
    if (!db || !user?.uid) return;
    const fetchProfile = async () => {
      try {
        const snap = await getDoc(doc(db as any, 'store_profiles', user.uid));
        if (snap.exists()) {
          const data = snap.data();
          setFormData(prev => ({ 
            ...prev, 
            ...data.general, 
            ...data.fees,
            tableServiceFeeType: data.fees?.tableServiceFeeType || 'percentage'
          }));
          if (data.workingHours) setWorkingHours(data.workingHours);
          if (data.motoboys) {
            setMotoboys(data.motoboys.map((m: any) => ({ ...m, fee: Number(m.fee) || 0 })));
          }
          if (data.freelancers) {
            setFreelancers(data.freelancers.map((f: any) => ({ 
              ...f, 
              whatsapp: f.whatsapp || '',
              dailyRate: Number(f.dailyRate) || 0, 
              workDays: f.workDays || [],
              active: f.active !== false // true por padrão
            })));
          }
          if (data.feeRules) setFeeRules(data.feeRules);
          if (data.customAddressRules) setCustomAddressRules(data.customAddressRules);
          if (data.paymentMethods) setPaymentMethods(data.paymentMethods);
          if (data.plannedClosures) setPlannedClosures(data.plannedClosures);
          if (data.creditPixKey) setCreditPixKey(data.creditPixKey);
          if (data.creditPixName) setCreditPixName(data.creditPixName);
          
          // Auto-carregar bairros se já tem cidades cadastradas
          const cities = data.general?.deliveryCities || data.fees?.deliveryCities || [];
          if (cities.length > 0) {
            // Carregar em background sem bloquear a UI
            setTimeout(() => fetchNeighborhoodsFromCities(cities), 500);
          }
        }
      } catch (err) {
        console.error('Erro ao buscar perfil da loja', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchProfile();
  }, [db, user?.uid]);

  const handleSave = async () => {
    if (!db || !user?.uid) return;
    setIsSaving(true);
    try {
      await setDoc(doc(db as any, 'store_profiles', user.uid), {
        general: {
          name: formData.name,
          cnpj: formData.cnpj,
          foundedYear: formData.foundedYear,
          phone: formData.phone,
          whatsapp: formData.whatsapp,
          address: formData.address,
          addressNumber: formData.addressNumber,
          addressComplement: formData.addressComplement,
          logoUrl: formData.logoUrl,
          enableInventory: formData.enableInventory,
        },
        fees: {
          deliveryCities: formData.deliveryCities,
          deliveryFee: formData.deliveryFee,
          freeDeliveryOver: formData.freeDeliveryOver,
          tableServiceFee: formData.tableServiceFee,
          tableServiceFeeType: formData.tableServiceFeeType,
          minOrderValue: formData.minOrderValue,
          deliveryTime: formData.deliveryTime,
          pickupTime: formData.pickupTime,
          maxDeliveryRadius: formData.maxDeliveryRadius,
        },
        workingHours,
        motoboys,
        freelancers,
        feeRules: feeRules.sort((a, b) => a.maxKm - b.maxKm),
        customAddressRules,
        paymentMethods,
        creditPixKey,
        creditPixName,
        plannedClosures: plannedClosures.filter(c => c.date >= new Date().toISOString().split('T')[0]),
        updatedAt: new Date().toISOString()
      }, { merge: true });

      toast({ title: 'Configurações salvas com sucesso!' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro ao salvar', description: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: parseFloat(value) || 0 }));
  };

  // Funções de formatação simples (máscaras)
  const formatCNPJ = (val: string) => {
    return val.replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2}).*/, '$1.$2.$3/$4-$5');
  };
  const formatPhone = (val: string) => {
    return val.replace(/\D/g, '').replace(/^(\d{2})(\d{4,5})(\d{4}).*/, '($1) $2-$3');
  };

  // Cidades
  const addCity = () => {
    if (formData.cityInput.trim()) {
      setFormData(prev => ({
        ...prev,
        deliveryCities: [...prev.deliveryCities, prev.cityInput.trim()],
        cityInput: ''
      }));
    }
  };
  const removeCity = (idx: number) => {
    setFormData(prev => ({
      ...prev,
      deliveryCities: prev.deliveryCities.filter((_, i) => i !== idx)
    }));
  };

  // Motoboys
  const addMotoboy = () => {
    setMotoboys([...motoboys, { id: Math.random().toString(), name: '', phone: '', licensePlate: '', fee: 0 }]);
  };
  const updateMotoboy = (id: string, field: string, value: any) => {
    setMotoboys(motoboys.map(m => m.id === id ? { ...m, [field]: value } : m));
  };
  const removeMotoboy = (id: string) => {
    setMotoboys(motoboys.filter(m => m.id !== id));
  };

  // Freelancers
  const addFreelancer = () => {
    setFreelancers([...freelancers, { id: Math.random().toString(), name: '', whatsapp: '', dailyRate: 0, workDays: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'], active: true }]);
  };
  const updateFreelancer = (id: string, field: string, value: any) => {
    setFreelancers(freelancers.map(f => f.id === id ? { ...f, [field]: value } : f));
  };
  const toggleFreelancerDay = (id: string, day: string) => {
    setFreelancers(freelancers.map(f => {
      if (f.id !== id) return f;
      const newDays = f.workDays.includes(day) 
        ? f.workDays.filter(d => d !== day) 
        : [...f.workDays, day];
      return { ...f, workDays: newDays };
    }));
  };
  const removeFreelancer = (id: string) => {
    setFreelancers(freelancers.filter(f => f.id !== id));
  };

  // Regras por KM
  const addFeeRule = () => {
    const lastRule = feeRules[feeRules.length - 1];
    setFeeRules([...feeRules, { maxKm: (lastRule?.maxKm || 0) + 5, fee: (lastRule?.fee || 0) + 3 }]);
  };
  const removeFeeRule = (index: number) => {
    setFeeRules(feeRules.filter((_, i) => i !== index));
  };
  const updateFeeRule = (index: number, field: 'maxKm' | 'fee', value: number) => {
    setFeeRules(feeRules.map((rule, i) => i === index ? { ...rule, [field]: value } : rule));
  };

  const addCustomRule = (type: 'neighborhood' | 'address') => {
    setCustomAddressRules([...customAddressRules, { keyword: '', fee: 0, type, addressNumber: '' }]);
  };
  const removeCustomRule = (index: number) => {
    setCustomAddressRules(customAddressRules.filter((_, i) => i !== index));
  };
  const updateCustomRule = (index: number, field: 'keyword' | 'fee' | 'addressNumber', value: string | number) => {
    setCustomAddressRules(customAddressRules.map((rule, i) => i === index ? { ...rule, [field]: value } : rule));
  };
  const neighborhoodRules = customAddressRules.map((r, i) => ({ ...r, _idx: i })).filter(r => r.type === 'neighborhood');
  const addressRules = customAddressRules.map((r, i) => ({ ...r, _idx: i })).filter(r => r.type === 'address');

  // Função reutilizável para carregar bairros (aceita cidades como parâmetro)
  const fetchNeighborhoodsFromCities = async (cities: string[]) => {
    if (cities.length === 0) { setAvailableNeighborhoods([]); return; }
    setLoadingNeighborhoods(true);
    try {
      const allResults: { name: string, id: string }[] = [];
      for (const city of cities) {
        const res = await fetch(`/api/list-neighborhoods?city=${encodeURIComponent(city)}&_t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          if (data.neighborhoods) allResults.push(...data.neighborhoods);
        }
      }
      // Deduplicar por nome
      const unique = new Map<string, { name: string, id: string }>();
      for (const n of allResults) { if (!unique.has(n.name)) unique.set(n.name, n); }
      setAvailableNeighborhoods(Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
    } catch { /* silently fail */ }
    setLoadingNeighborhoods(false);
  };

  // Wrapper que usa formData.deliveryCities (para o botão)
  const fetchNeighborhoods = (cities: string[]) => fetchNeighborhoodsFromCities(cities);

  // Toggle bairro no/off
  const toggleNeighborhood = (name: string) => {
    const existing = customAddressRules.findIndex(r => r.type === 'neighborhood' && r.keyword === name);
    if (existing >= 0) {
      setCustomAddressRules(customAddressRules.filter((_, i) => i !== existing));
    } else {
      setCustomAddressRules([...customAddressRules, { keyword: name, fee: 0, type: 'neighborhood' }]);
    }
  };

  const isNeighborhoodSelected = (name: string) => {
    return customAddressRules.some(r => r.type === 'neighborhood' && r.keyword === name);
  };

  if (isLoading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-6 pt-4 pb-12">
      
      <div className="mb-6 px-2">
        <h1 className="text-3xl font-black tracking-tight text-slate-800">
          {activeTab === 'geral' && 'Dados e Contato'}
          {activeTab === 'taxas' && 'Taxas, Prazos e KM'}
          {activeTab === 'horarios' && 'Horários de Funcionamento'}
          {activeTab === 'motoboys' && 'Motoboys e Freelancers'}
          {activeTab === 'pagamentos' && 'Formas de Pagamento'}
        </h1>
        <p className="text-muted-foreground mt-1 font-medium">
          {activeTab === 'geral' && 'Gerencie as informações básicas de contato e endereço do seu negócio.'}
          {activeTab === 'taxas' && 'Configure taxas de entrega por KM, tempo de preparo e cidades atendidas.'}
          {activeTab === 'horarios' && 'Defina os horários em que seu estabelecimento aceita pedidos.'}
          {activeTab === 'motoboys' && 'Gerencie sua frota de entregadores, taxas pagas e escalas.'}
          {activeTab === 'pagamentos' && 'Configure as formas de pagamento aceitas no seu Delivery, Retirada e Salão.'}
        </p>
      </div>

      <div className="space-y-5">
        {activeTab === 'geral' && (
          <>
            {/* SEÇÃO 1 — Identidade Visual */}
            <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500/15 to-cyan-500/15 border border-emerald-500/20 flex items-center justify-center">
                  <ImageIcon className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-bold text-slate-800">Identidade visual</h2>
                  <p className="text-xs text-muted-foreground">Logo que aparece no cardápio digital, painel e cupons.</p>
                </div>
                {formData.logoUrl && (
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Configurado
                  </Badge>
                )}
              </header>
              <div className="p-6">
                <div className="flex flex-col md:flex-row items-start gap-6">
                  <div className="relative group shrink-0">
                    {formData.logoUrl ? (
                      <div className="relative">
                        <img src={formData.logoUrl} alt="Logo" className="w-28 h-28 rounded-2xl object-cover ring-2 ring-emerald-500/30 shadow-md" />
                        <button
                          type="button"
                          onClick={() => setFormData({ ...formData, logoUrl: '' })}
                          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-7 h-7 flex items-center justify-center shadow-md hover:bg-red-600 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => logoInputRef.current?.click()}
                        disabled={isUploadingLogo}
                        className="w-28 h-28 rounded-2xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center gap-1.5 text-slate-400 hover:border-emerald-400 hover:text-emerald-500 hover:bg-emerald-50/30 transition-all cursor-pointer bg-slate-50/50"
                      >
                        {isUploadingLogo ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6" />}
                        <span className="text-[11px] font-semibold">{isUploadingLogo ? 'Enviando...' : 'Enviar logo'}</span>
                      </button>
                    )}
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setIsUploadingLogo(true);
                        try {
                          const url = await uploadImage(file);
                          setFormData(prev => ({ ...prev, logoUrl: url }));
                          toast({ title: 'Logo enviada com sucesso!' });
                        } catch (err: any) {
                          toast({ variant: 'destructive', title: 'Erro ao enviar logo', description: err.message });
                        } finally {
                          setIsUploadingLogo(false);
                          e.target.value = '';
                        }
                      }}
                    />
                  </div>

                  <div className="flex-1 space-y-3 min-w-0">
                    <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 space-y-2">
                      <div className="flex items-start gap-2 text-xs text-slate-600">
                        <Info className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-slate-700 mb-1">Recomendações para a logo</p>
                          <ul className="space-y-0.5 text-[11px] leading-relaxed text-slate-500">
                            <li>• Formato quadrado (proporção 1:1)</li>
                            <li>• Mínimo 512×512 pixels</li>
                            <li>• Fundo transparente ou branco em PNG</li>
                            <li>• Tamanho máximo: 2 MB</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                    {formData.logoUrl && (
                      <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => logoInputRef.current?.click()}>
                        <Camera className="w-3.5 h-3.5 mr-1.5" /> Trocar imagem
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* SEÇÃO 2 — Dados da empresa */}
            <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500/15 to-cyan-500/15 border border-blue-500/20 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-bold text-slate-800">Dados da empresa</h2>
                  <p className="text-xs text-muted-foreground">Informações cadastrais que serão exibidas em cupons e notas.</p>
                </div>
              </header>
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    <Store className="h-3.5 w-3.5 text-slate-400" /> Nome da empresa
                    <span className="text-rose-500">*</span>
                  </Label>
                  <Input name="name" value={formData.name} onChange={handleChange} placeholder="Ex: Restaurante Sabor & Arte" className="h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    <CalendarOff className="h-3.5 w-3.5 text-slate-400" /> Ano de fundação
                  </Label>
                  <Input
                    type="number"
                    name="foundedYear"
                    value={formData.foundedYear}
                    onChange={handleChange}
                    placeholder="Ex: 2020"
                    min={1800}
                    max={new Date().getFullYear()}
                    className="h-11"
                    inputMode="numeric"
                  />
                  <p className="text-[10px] text-slate-400">Usado no rodapé do cardápio público.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    <Hash className="h-3.5 w-3.5 text-slate-400" /> CNPJ
                  </Label>
                  <Input
                    name="cnpj"
                    value={formData.cnpj}
                    onChange={(e) => setFormData({ ...formData, cnpj: formatCNPJ(e.target.value) })}
                    placeholder="00.000.000/0000-00"
                    maxLength={18}
                    className="h-11 font-mono"
                    inputMode="numeric"
                  />
                  <p className="text-[10px] text-slate-400">Opcional. Aparece no cupom não-fiscal.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 text-slate-400" /> Telefone fixo
                  </Label>
                  <Input
                    name="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: formatPhone(e.target.value) })}
                    placeholder="(00) 0000-0000"
                    maxLength={15}
                    className="h-11"
                    inputMode="tel"
                  />
                  <p className="text-[10px] text-slate-400">Opcional.</p>
                </div>
              </div>
            </section>

            {/* SEÇÃO 3 — Contato com o cliente */}
            <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-green-500/15 to-emerald-500/15 border border-green-500/20 flex items-center justify-center">
                  <MessageCircle className="h-5 w-5 text-green-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-bold text-slate-800">Canal de atendimento</h2>
                  <p className="text-xs text-muted-foreground">WhatsApp usado para confirmação de pedidos e suporte ao cliente.</p>
                </div>
                {formData.whatsapp && (
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Conectado
                  </Badge>
                )}
              </header>
              <div className="p-6">
                <div className="space-y-1.5 max-w-md">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    <MessageCircle className="h-3.5 w-3.5 text-green-500" /> WhatsApp
                    <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    name="whatsapp"
                    value={formData.whatsapp}
                    onChange={(e) => setFormData({ ...formData, whatsapp: formatPhone(e.target.value) })}
                    placeholder="(00) 90000-0000"
                    maxLength={15}
                    className="h-11"
                    inputMode="tel"
                  />
                  <p className="text-[10px] text-slate-400">Inclua o DDD. Esse número recebe novos pedidos e é mostrado ao cliente.</p>
                </div>
              </div>
            </section>

            {/* SEÇÃO EXTRA — Controle de Estoque */}
            <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500/15 to-blue-500/15 border border-indigo-500/20 flex items-center justify-center">
                    <ShoppingBag className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-800">Controle de Estoque</h2>
                    <p className="text-xs text-muted-foreground">Exibir quantidade disponível e bloquear vendas de produtos esgotados.</p>
                  </div>
                </div>
                <Switch
                  checked={formData.enableInventory}
                  onCheckedChange={(checked) => setFormData({ ...formData, enableInventory: checked })}
                />
              </header>
            </section>

            {/* SEÇÃO 4 — Endereço */}
            <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-rose-500/15 to-orange-500/15 border border-rose-500/20 flex items-center justify-center">
                  <MapPin className="h-5 w-5 text-rose-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-bold text-slate-800">Endereço do estabelecimento</h2>
                  <p className="text-xs text-muted-foreground">Usado como ponto de partida para o cálculo da taxa de entrega.</p>
                </div>
                {formData.address && (
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Localizado
                  </Badge>
                )}
              </header>
              <div className="p-6 space-y-5">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-slate-400" /> Logradouro
                    <span className="text-rose-500">*</span>
                  </Label>
                  <AddressAutocomplete
                    value={formData.address}
                    onChange={(val) => setFormData({ ...formData, address: val })}
                    placeholder="Comece a digitar a rua, avenida..."
                  />
                  <p className="text-[10px] text-slate-400">Selecione um endereço da lista para que o cálculo de distância funcione corretamente.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                      <Hash className="h-3.5 w-3.5 text-slate-400" /> Número
                      <span className="text-rose-500">*</span>
                    </Label>
                    <Input name="addressNumber" value={formData.addressNumber} onChange={handleChange} placeholder="123" className="h-11" />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                      Complemento
                    </Label>
                    <Input name="addressComplement" value={formData.addressComplement} onChange={handleChange} placeholder="Sala 2, Bloco B, em frente à praça..." className="h-11" />
                    <p className="text-[10px] text-slate-400">Opcional.</p>
                  </div>
                </div>
              </div>
            </section>

            {/* SEÇÃO 5 — Configurações de Vendas & Estoque */}
            <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500/15 to-fuchsia-500/15 border border-violet-500/20 flex items-center justify-center">
                  <Box className="h-5 w-5 text-violet-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-bold text-slate-800">Vendas & Estoque</h2>
                  <p className="text-xs text-muted-foreground">Configurações globais sobre como o cardápio opera.</p>
                </div>
              </header>
              <div className="p-6 space-y-5">
                <div className="flex items-center justify-between p-4 bg-slate-50 border rounded-xl">
                  <div className="space-y-1">
                    <Label className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      Controle de Estoque
                      {formData.enableInventory && <Badge className="bg-emerald-500 hover:bg-emerald-600 text-[10px] h-4 px-1.5 uppercase tracking-wider">Ativo</Badge>}
                    </Label>
                    <p className="text-[11px] text-slate-500 max-w-md">
                      Ao ligar, os produtos exibirão a quantidade disponível no App do Cliente. O sistema impedirá vendas se o estoque zerar e fará o abatimento automático.
                    </p>
                  </div>
                  <Switch 
                    checked={formData.enableInventory}
                    onCheckedChange={(checked) => setFormData({ ...formData, enableInventory: checked })}
                    className="data-[state=checked]:bg-violet-600"
                  />
                </div>
              </div>
            </section>
          </>
        )}

        {activeTab === 'taxas' && (
          <Tabs defaultValue="area" className="w-full">
            <TabsList className="w-full flex mb-6 p-1 bg-slate-100/50 rounded-lg">
              <TabsTrigger value="area" className="flex-1 rounded-md text-sm">Área de Atuação e Regras</TabsTrigger>
              <TabsTrigger value="valores" className="flex-1 rounded-md text-sm">Taxas e Prazos</TabsTrigger>
            </TabsList>
            
            <TabsContent value="area" className="mt-0 space-y-5">
            {/* SEÇÃO 1 — Área de Atuação */}
            <section className="bg-white rounded-2xl shadow-sm border">
              <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500/15 to-blue-500/15 border border-indigo-500/20 flex items-center justify-center">
                  <MapPin className="h-5 w-5 text-indigo-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-bold text-slate-800">Área de atuação</h2>
                  <p className="text-xs text-muted-foreground">Cidades atendidas e regras de taxa por distância.</p>
                </div>
                {formData.deliveryCities.length > 0 && (
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] gap-1">
                    <CheckCircle2 className="h-3 w-3" /> {formData.deliveryCities.length} cidade{formData.deliveryCities.length > 1 ? 's' : ''}
                  </Badge>
                )}
              </header>
              <div className="p-6 space-y-5">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-slate-400" /> Cidades atendidas
                  </Label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <AddressAutocomplete 
                        value={formData.cityInput} 
                        onChange={(val) => setFormData({...formData, cityInput: val})} 
                        onSelect={(val) => {
                          setFormData({...formData, cityInput: val});
                        }}
                        placeholder="Ex: Ribeirão Preto" 
                        types="(cities)"
                      />
                    </div>
                    <Button onClick={addCity} type="button" className="h-11">Adicionar</Button>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {formData.deliveryCities.map((c, i) => (
                      <Badge key={i} variant="secondary" className="px-2 py-0.5 text-xs flex gap-2 items-center">
                        {c} <Trash2 className="w-3 h-3 cursor-pointer text-red-500 hover:text-red-700" onClick={() => removeCity(i)} />
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="pt-1 pb-3 space-y-2 bg-slate-50 p-3 rounded-lg border">
                  <div className="flex justify-between items-center">
                    <Label className="font-bold text-sm flex items-center gap-2">
                      🛵 Taxas por Distância (KM)
                      {feeRules.length > 0 && formData.deliveryFee === 0 && <Badge className="bg-emerald-500 hover:bg-emerald-600 text-[10px] h-4 px-1.5 uppercase tracking-wider">Regra Aplicada</Badge>}
                    </Label>
                    <Button onClick={addFeeRule} type="button" size="sm" variant="outline" className="h-7 text-xs"><Plus className="w-3 h-3 mr-1" /> Adicionar Regra</Button>
                  </div>
                  
                  <div className="space-y-2">
                    {feeRules.map((rule, index) => (
                      <div key={index} className="flex items-center gap-3">
                        <div className="flex-1">
                          <Label>Até (KM)</Label>
                          <Input type="number" step="0.5" min="0" value={rule.maxKm} onChange={(e) => updateFeeRule(index, 'maxKm', parseFloat(e.target.value) || 0)} />
                        </div>
                        <div className="flex-1">
                          <Label>Taxa (R$)</Label>
                          <CurrencyInput value={rule.fee} onChange={(val) => updateFeeRule(index, 'fee', val)} />
                        </div>
                        <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-600 mt-5" onClick={() => removeFeeRule(index)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                    {feeRules.length === 0 && (
                      <div className="text-center py-4 text-sm text-muted-foreground border-2 border-dashed rounded-lg">
                        Nenhuma regra cadastrada. Será usada a taxa padrão ou entrega grátis.
                      </div>
                    )}
                  </div>
                </div>

                {/* Taxas Personalizadas por Bairro */}
                <div className="pt-1 pb-3 space-y-2 bg-violet-50/50 p-3 rounded-lg border border-violet-100">
                  <div className="flex justify-between items-center">
                    <div className="flex flex-col">
                      <Label className="font-bold text-sm flex items-center gap-2 text-violet-900">
                        🏘️ Taxas por Bairro
                      </Label>
                      <span className="text-[10px] text-violet-600 font-medium">Selecione os bairros e defina a taxa. Têm prioridade sobre a taxa por KM.</span>
                    </div>
                    {formData.deliveryCities.length > 0 && !loadingNeighborhoods && (
                      <Button onClick={() => fetchNeighborhoods(formData.deliveryCities)} type="button" size="sm" variant="outline" className="h-7 text-xs border-violet-200 text-violet-700 hover:bg-violet-50">
                        <RefreshCw className="w-3 h-3 mr-1" /> {availableNeighborhoods.length > 0 ? 'Recarregar' : 'Carregar Bairros'}
                      </Button>
                    )}
                    {loadingNeighborhoods && <Loader2 className="w-4 h-4 animate-spin text-violet-500" />}
                  </div>

                  {formData.deliveryCities.length === 0 && (
                    <div className="text-center py-3 text-xs text-violet-400 border-2 border-dashed border-violet-200 rounded-lg bg-white/50">
                      Cadastre uma cidade acima para carregar os bairros disponíveis.
                    </div>
                  )}

                  {availableNeighborhoods.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                      {/* LADO ESQUERDO: Lista de bairros com checkbox */}
                      <div className="bg-white rounded-lg border border-violet-100 overflow-hidden">
                        <div className="p-2 border-b border-violet-100 bg-violet-50/30">
                          <Input
                            placeholder="Filtrar bairros..."
                            value={neighborhoodSearch}
                            onChange={(e) => setNeighborhoodSearch(e.target.value)}
                            className="h-7 text-xs"
                          />
                        </div>
                        <div className="max-h-56 overflow-y-auto">
                          {availableNeighborhoods
                            .filter(n => n.name.toLowerCase().includes(neighborhoodSearch.toLowerCase()))
                            .map((n) => {
                              const selected = isNeighborhoodSelected(n.name);
                              return (
                                <button
                                  key={n.id}
                                  type="button"
                                  onClick={() => toggleNeighborhood(n.name)}
                                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left border-b border-violet-50 last:border-0 transition-colors ${
                                    selected ? 'bg-violet-100 text-violet-900 font-medium' : 'hover:bg-violet-50/50 text-slate-600'
                                  }`}
                                >
                                  <Checkbox checked={selected} className="data-[state=checked]:bg-violet-600 data-[state=checked]:border-violet-600 h-3.5 w-3.5" />
                                  <span>{n.name}</span>
                                </button>
                              );
                            })}
                          {availableNeighborhoods.filter(n => n.name.toLowerCase().includes(neighborhoodSearch.toLowerCase())).length === 0 && (
                            <div className="p-3 text-center text-xs text-violet-400">Nenhum bairro encontrado.</div>
                          )}
                        </div>
                        <div className="px-3 py-1.5 border-t border-violet-100 bg-violet-50/30 text-[10px] text-violet-500">
                          {availableNeighborhoods.length} bairros encontrados
                        </div>
                      </div>

                      {/* LADO DIREITO: Bairros selecionados com taxa */}
                      <div className="space-y-2">
                        <div className="text-xs font-bold text-violet-800 flex items-center gap-1.5 mb-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Selecionados ({neighborhoodRules.length})
                        </div>
                        <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                          {neighborhoodRules.map((rule) => (
                            <div key={rule._idx} className="flex items-center gap-2 bg-white p-2 rounded border border-violet-100 shadow-sm">
                              <span className="flex-1 text-xs font-medium text-violet-900 truncate" title={rule.keyword}>{rule.keyword}</span>
                              <div className="w-24 shrink-0">
                                <CurrencyInput value={rule.fee} onChange={(val) => updateCustomRule(rule._idx, 'fee', val)} />
                              </div>
                              <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-600 h-7 w-7 shrink-0" onClick={() => removeCustomRule(rule._idx)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          ))}
                          {neighborhoodRules.length === 0 && (
                            <div className="text-center py-4 text-xs text-violet-400 border-2 border-dashed border-violet-200 rounded-lg bg-white/50">
                              Selecione bairros na lista ao lado.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Adicionar bairro manual (caso não apareça na lista) */}
                  {availableNeighborhoods.length > 0 && (
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-violet-100">
                      <span className="text-[10px] text-violet-500">Bairro não apareceu?</span>
                      <Button onClick={() => addCustomRule('neighborhood')} type="button" size="sm" variant="ghost" className="h-6 text-[10px] text-violet-600 hover:text-violet-800 px-2">
                        <Plus className="w-3 h-3 mr-1" /> Adicionar manualmente
                      </Button>
                    </div>
                  )}

                  {/* Bairros adicionados manualmente (sem estar na lista) */}
                  {neighborhoodRules.filter(r => r.keyword === '').length > 0 && (
                    <div className="space-y-2 mt-2">
                      {neighborhoodRules.filter(r => r.keyword === '').map((rule) => (
                        <div key={rule._idx} className="flex items-center gap-3 bg-white p-2 rounded border border-violet-50 shadow-sm">
                          <div className="flex-[2]">
                            <Label className="text-xs text-violet-800">Bairro</Label>
                            <AddressAutocomplete
                              value={rule.keyword}
                              onChange={(val) => updateCustomRule(rule._idx, 'keyword', val)}
                              onSelect={(val) => updateCustomRule(rule._idx, 'keyword', val)}
                              placeholder="Digite o nome do bairro..."
                              className="h-8 text-sm"
                              types="sublocality"
                              locationContext={formData.deliveryCities.join(', ')}
                            />
                          </div>
                          <div className="flex-1">
                            <Label className="text-xs text-violet-800">Taxa (R$)</Label>
                            <CurrencyInput value={rule.fee} onChange={(val) => updateCustomRule(rule._idx, 'fee', val)} />
                          </div>
                          <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-600 mt-5 h-8 w-8" onClick={() => removeCustomRule(rule._idx)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Taxas Personalizadas por Rua/Endereço */}
                <div className="pt-1 pb-3 space-y-2 bg-indigo-50/50 p-3 rounded-lg border border-indigo-100">
                  <div className="flex justify-between items-center">
                    <div className="flex flex-col">
                      <Label className="font-bold text-sm flex items-center gap-2 text-indigo-900">
                        📍 Taxas por Rua / Endereço
                      </Label>
                      <span className="text-[10px] text-indigo-600 font-medium">Para condomínios ou ruas específicas. Têm prioridade sobre bairro e KM.</span>
                    </div>
                    <Button onClick={() => addCustomRule('address')} type="button" size="sm" variant="outline" className="h-7 text-xs border-indigo-200 text-indigo-700 hover:bg-indigo-50"><Plus className="w-3 h-3 mr-1" /> Adicionar Rua</Button>
                  </div>
                  
                  <div className="space-y-2 mt-2">
                    {addressRules.map((rule) => (
                      <div key={rule._idx} className="flex items-center gap-3 bg-white p-2 rounded border border-indigo-50 shadow-sm">
                        <div className="flex-[2]">
                          <Label className="text-xs text-indigo-800">Rua / Endereço</Label>
                          <AddressAutocomplete
                            value={rule.keyword}
                            onChange={(val) => updateCustomRule(rule._idx, 'keyword', val)}
                            onSelect={(val) => updateCustomRule(rule._idx, 'keyword', val)}
                            placeholder="Ex: Rua das Palmeiras, Condomínio..."
                            className="h-8 text-sm"
                            types="route"
                            locationContext={formData.deliveryCities.join(', ')}
                          />
                        </div>
                        <div className="w-20 shrink-0">
                          <Label className="text-xs text-indigo-800">Nº (Opcional)</Label>
                          <Input 
                            value={rule.addressNumber || ''} 
                            onChange={(e) => updateCustomRule(rule._idx, 'addressNumber', e.target.value)} 
                            placeholder="Nº"
                            className="h-8 text-sm"
                          />
                        </div>
                        <div className="flex-1">
                          <Label className="text-xs text-indigo-800">Taxa (R$)</Label>
                          <CurrencyInput value={rule.fee} onChange={(val) => updateCustomRule(rule._idx, 'fee', val)} />
                        </div>
                        <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-600 mt-5 h-8 w-8" onClick={() => removeCustomRule(rule._idx)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                    {addressRules.length === 0 && (
                      <div className="text-center py-3 text-xs text-indigo-400 border-2 border-dashed border-indigo-200 rounded-lg bg-white/50">
                        Nenhuma rua cadastrada.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
            </TabsContent>

            <TabsContent value="valores" className="mt-0 space-y-5">

            {/* SEÇÃO 2 — Taxas e Valores */}
            <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500/15 to-orange-500/15 border border-amber-500/20 flex items-center justify-center">
                  <Wallet className="h-5 w-5 text-amber-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-bold text-slate-800">Taxas e valores</h2>
                  <p className="text-xs text-muted-foreground">Taxa padrão de entrega, frete grátis e taxa de serviço de mesa.</p>
                </div>
              </header>
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    <Truck className="h-3.5 w-3.5 text-slate-400" /> Taxa de Entrega Padrão (R$)
                    {formData.deliveryFee > 0 && <Badge className="bg-emerald-500 hover:bg-emerald-600 text-[10px] h-4 px-1.5 uppercase tracking-wider">Ativa</Badge>}
                  </Label>
                  <CurrencyInput name="deliveryFee" value={formData.deliveryFee} onChange={(val) => setFormData({...formData, deliveryFee: val})} />
                </div>
                
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    Frete Grátis acima de (R$)
                    {formData.freeDeliveryOver > 0 && <Badge className="bg-emerald-500 hover:bg-emerald-600 text-[10px] h-4 px-1.5 uppercase tracking-wider">Ativa</Badge>}
                  </Label>
                  <CurrencyInput name="freeDeliveryOver" value={formData.freeDeliveryOver} onChange={(val) => setFormData({...formData, freeDeliveryOver: val})} />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    Valor Mínimo do Pedido (R$)
                  </Label>
                  <CurrencyInput name="minOrderValue" value={formData.minOrderValue} onChange={(val) => setFormData({...formData, minOrderValue: val})} />
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <Label className="text-xs font-bold uppercase tracking-wider text-slate-600">Taxa do Garçom / Serviço de Mesa</Label>
                    <div className="flex bg-slate-100 rounded-md p-1 border">
                      <button 
                        type="button"
                        onClick={() => setFormData({...formData, tableServiceFeeType: 'percentage'})}
                        className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${formData.tableServiceFeeType === 'percentage' ? 'bg-white shadow-sm text-primary' : 'text-muted-foreground hover:bg-slate-200'}`}
                      >
                        %
                      </button>
                      <button 
                        type="button"
                        onClick={() => setFormData({...formData, tableServiceFeeType: 'fixed'})}
                        className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${formData.tableServiceFeeType === 'fixed' ? 'bg-white shadow-sm text-primary' : 'text-muted-foreground hover:bg-slate-200'}`}
                      >
                        R$
                      </button>
                    </div>
                  </div>
                  {formData.tableServiceFeeType === 'percentage' ? (
                    <div className="flex relative items-center">
                      <Input type="number" step="0.1" name="tableServiceFee" value={formData.tableServiceFee} onChange={handleNumberChange} className="pr-10 h-11" />
                      <span className="absolute right-4 text-muted-foreground text-sm font-bold">%</span>
                    </div>
                  ) : (
                    <CurrencyInput name="tableServiceFee" value={formData.tableServiceFee} onChange={(val) => setFormData({...formData, tableServiceFee: val})} />
                  )}
                </div>
              </div>
            </section>

            {/* SEÇÃO 3 — Tempos e Limites */}
            <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-cyan-500/15 to-teal-500/15 border border-cyan-500/20 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-cyan-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-bold text-slate-800">Tempos e limites</h2>
                  <p className="text-xs text-muted-foreground">Estimativas de preparo, entrega e raio máximo de atuação.</p>
                </div>
              </header>
              <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-5">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    <Truck className="h-3.5 w-3.5 text-slate-400" /> Tempo de Entrega
                  </Label>
                  <Input type="time" name="deliveryTime" value={formData.deliveryTime} onChange={handleChange} className="h-11" />
                  <p className="text-[10px] text-slate-400">Estimativa exibida ao cliente.</p>
                </div>
                
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-slate-400" /> Tempo de Retirada
                  </Label>
                  <Input type="time" name="pickupTime" value={formData.pickupTime} onChange={handleChange} className="h-11" />
                  <p className="text-[10px] text-slate-400">Para pedidos "Retirar no Local".</p>
                </div>
                
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-slate-400" /> Raio Máximo (KM)
                  </Label>
                  <div className="flex relative items-center">
                    <Input type="number" name="maxDeliveryRadius" value={formData.maxDeliveryRadius} onChange={handleNumberChange} className="pr-12 h-11" />
                    <span className="absolute right-4 text-muted-foreground text-sm font-bold">KM</span>
                  </div>
                  <p className="text-[10px] text-slate-400">0 = sem limite de distância.</p>
                </div>
              </div>
            </section>
            </TabsContent>
          </Tabs>
        )}

        {activeTab === 'horarios' && (() => {
          // Calendar state helpers
          const today = new Date();
          const todayStr = today.toISOString().split('T')[0];
          
          // Map day index (0=Sun) to workingHours day name
          const daysMap = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
          
          const goToPrevMonth = () => {
            setCalMonth(prev => {
              const d = new Date(prev.year, prev.month - 1, 1);
              return { year: d.getFullYear(), month: d.getMonth() };
            });
          };
          const goToNextMonth = () => {
            setCalMonth(prev => {
              const d = new Date(prev.year, prev.month + 1, 1);
              return { year: d.getFullYear(), month: d.getMonth() };
            });
          };

          const isDayOpenBySchedule = (dateStr: string) => {
            const d = new Date(dateStr + 'T12:00:00');
            const dayName = daysMap[d.getDay()];
            const wh = workingHours.find(w => w.day === dayName);
            return wh ? !wh.isClosed : true;
          };

          const isPlannedClosure = (dateStr: string) => {
            return plannedClosures.some(c => c.date === dateStr);
          };

          const isDayOpen = (dateStr: string) => {
            if (isPlannedClosure(dateStr)) return false;
            return isDayOpenBySchedule(dateStr);
          };

          const toggleDay = (dateStr: string) => {
            if (isPlannedClosure(dateStr)) {
              // Remove closure (re-enable day)
              setPlannedClosures(plannedClosures.filter(c => c.date !== dateStr));
            } else if (isDayOpenBySchedule(dateStr)) {
              // Add closure (disable a normally-open day)
              setPlannedClosures([...plannedClosures, { id: Date.now().toString(), date: dateStr, reason: '' }].sort((a, b) => a.date.localeCompare(b.date)));
            }
            // If day is already closed by schedule, do nothing (can't override to open)
          };

          const getCalendarDays = (year: number, month: number) => {
            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const days: (number | null)[] = [];
            for (let i = 0; i < firstDay; i++) days.push(null);
            for (let i = 1; i <= daysInMonth; i++) days.push(i);
            return days;
          };

          const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

          return (
            <>
              {/* SEÇÃO 1 — Horário Semanal */}
              <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500/15 to-purple-500/15 border border-violet-500/20 flex items-center justify-center">
                    <Clock className="h-5 w-5 text-violet-600" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-base font-bold text-slate-800">Horário fixo da semana</h2>
                    <p className="text-xs text-muted-foreground">Defina os horários de abertura e fechamento para cada dia da semana.</p>
                  </div>
                  {workingHours.some(wh => !wh.isClosed) && (
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Configurado
                    </Badge>
                  )}
                </header>
                <div className="p-6">
                  <div className="space-y-1">
                    {workingHours.map((wh, idx) => (
                      <div key={wh.day} className={`flex items-center gap-2 py-1.5 px-2 rounded border text-xs ${wh.isClosed ? 'bg-red-50/50 border-red-100' : 'bg-slate-50/50'}`}>
                        <div className="w-14 font-semibold truncate">{wh.day.substring(0, 3)}</div>
                        <Switch 
                          id={`closed-${idx}`} 
                          checked={wh.isClosed} 
                          onCheckedChange={(checked) => {
                            const newWH = [...workingHours];
                            newWH[idx].isClosed = checked;
                            setWorkingHours(newWH);
                          }} 
                          className="data-[state=checked]:bg-red-500 data-[state=unchecked]:bg-green-500 scale-75"
                        />
                        {!wh.isClosed ? (
                          <div className="flex items-center gap-1 flex-1 justify-end">
                            <Input type="time" value={wh.open} onChange={(e) => {
                              const newWH = [...workingHours];
                              newWH[idx].open = e.target.value;
                              setWorkingHours(newWH);
                            }} className="w-20 h-6 text-[11px] px-1" />
                            <span className="text-muted-foreground">-</span>
                            <Input type="time" value={wh.close} onChange={(e) => {
                              const newWH = [...workingHours];
                              newWH[idx].close = e.target.value;
                              setWorkingHours(newWH);
                            }} className="w-20 h-6 text-[11px] px-1" />
                          </div>
                        ) : (
                          <span className="flex-1 text-right text-muted-foreground italic">Fechado</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 leading-tight pt-2">
                    Use o calendário abaixo para desligar dias específicos (feriados, folgas). Dias cinza já estão fechados pelo horário semanal.
                  </p>
                </div>
              </section>

              {/* SEÇÃO 2 — Calendário de Folgas */}
              <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-rose-500/15 to-pink-500/15 border border-rose-500/20 flex items-center justify-center">
                    <CalendarOff className="h-5 w-5 text-rose-600" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-base font-bold text-slate-800">Calendário de folgas e feriados</h2>
                    <p className="text-xs text-muted-foreground">Clique nos dias para marcar ou desmarcar fechamentos pontuais.</p>
                  </div>
                  {plannedClosures.length > 0 && (
                    <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-[10px] gap-1">
                      {plannedClosures.length} folga{plannedClosures.length > 1 ? 's' : ''}
                    </Badge>
                  )}
                </header>
                <div className="p-6 space-y-3">
                  {(() => {
                    const { year, month } = calMonth;
                    const days = getCalendarDays(year, month);
                    const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();
                    return (
                      <div className="border rounded-xl overflow-hidden">
                        <div className="bg-slate-100 px-4 py-2 flex items-center justify-between">
                          <button type="button" onClick={goToPrevMonth} disabled={isCurrentMonth} className={`p-1 rounded hover:bg-slate-200 transition-colors ${isCurrentMonth ? 'opacity-30 cursor-not-allowed' : ''}`}>
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <span className="font-bold text-sm capitalize">{monthNames[month]} {year}</span>
                          <button type="button" onClick={goToNextMonth} className="p-1 rounded hover:bg-slate-200 transition-colors">
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="p-3">
                          {/* Header */}
                          <div className="grid grid-cols-7 gap-1 mb-1">
                            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => (
                              <div key={d} className="text-center text-[10px] font-bold text-muted-foreground uppercase py-1">{d}</div>
                            ))}
                          </div>
                          {/* Days grid */}
                          <div className="grid grid-cols-7 gap-1">
                            {days.map((day, i) => {
                              if (day === null) return <div key={`empty-${i}`} />;
                              
                              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                              const isPast = dateStr < todayStr;
                              const isToday = dateStr === todayStr;
                              const openBySchedule = isDayOpenBySchedule(dateStr);
                              const closedByPlan = isPlannedClosure(dateStr);
                              const isOpen = isDayOpen(dateStr);

                              return (
                                <div 
                                  key={dateStr}
                                  className={`relative flex flex-col items-center justify-center py-1.5 rounded-lg border transition-all
                                    ${isPast ? 'opacity-40 pointer-events-none' : 'cursor-pointer hover:shadow-sm'}
                                    ${isToday ? 'ring-2 ring-primary/50' : ''}
                                    ${!openBySchedule && !closedByPlan ? 'bg-slate-100 border-slate-200' : ''}
                                    ${closedByPlan ? 'bg-red-50 border-red-200' : ''}
                                    ${isOpen && !isToday ? 'bg-green-50/50 border-green-200/50' : ''}
                                  `}
                                  onClick={() => !isPast && toggleDay(dateStr)}
                                >
                                  <span className={`text-xs font-semibold ${isToday ? 'text-primary' : isOpen ? 'text-slate-700' : 'text-red-400'}`}>
                                    {day}
                                  </span>
                                  <Switch
                                    checked={isOpen}
                                    onCheckedChange={() => !isPast && toggleDay(dateStr)}
                                    disabled={isPast || !openBySchedule}
                                    className="scale-[0.45] mt-0.5 data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-red-400 disabled:opacity-50"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Legend */}
                  <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground px-1">
                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-green-50 border border-green-200" /> Aberto</div>
                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-red-50 border border-red-200" /> Fechado (feriado/folga)</div>
                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-slate-100 border border-slate-200" /> Fechado (horário semanal)</div>
                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded ring-2 ring-primary/50" /> Hoje</div>
                  </div>
                </div>
              </section>
            </>
          );
        })()}

        {activeTab === 'motoboys' && (
          <>
            {/* SEÇÃO 1 — Frota Própria */}
            <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500/15 to-teal-500/15 border border-emerald-500/20 flex items-center justify-center">
                  <Bike className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-bold text-slate-800">Frota própria</h2>
                  <p className="text-xs text-muted-foreground">Motoboys fixos da sua equipe com taxa e dados de contato.</p>
                </div>
                {motoboys.length > 0 && (
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] gap-1">
                    <CheckCircle2 className="h-3 w-3" /> {motoboys.length} motoboy{motoboys.length > 1 ? 's' : ''}
                  </Badge>
                )}
                <Button onClick={addMotoboy} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"><Plus className="w-4 h-4 mr-1"/> Adicionar</Button>
              </header>
              <div className="p-6">
                {motoboys.length === 0 ? (
                  <div className="text-center py-6 text-sm text-muted-foreground border-2 border-dashed rounded-lg">Nenhum motoboy cadastrado. Clique em "Adicionar" para começar.</div>
                ) : (
                  <div className="space-y-1.5">
                    {motoboys.map((m, idx) => (
                      <div key={m.id} className="flex items-center gap-2 py-1.5 px-3 rounded-md border bg-slate-50/50">
                        <div className="grid grid-cols-4 gap-2 flex-1">
                          <div className="space-y-0.5">
                            <Label>Nome</Label>
                            <Input value={m.name} onChange={(e) => updateMotoboy(m.id, 'name', e.target.value)} placeholder="João" className="h-7 text-xs" />
                          </div>
                          <div className="space-y-0.5">
                            <Label>WhatsApp</Label>
                            <Input value={m.phone} onChange={(e) => updateMotoboy(m.id, 'phone', formatPhone(e.target.value))} placeholder="(00) 90000-0000" className="h-7 text-xs" />
                          </div>
                          <div className="space-y-0.5">
                            <Label>Placa</Label>
                            <Input value={m.licensePlate} onChange={(e) => updateMotoboy(m.id, 'licensePlate', e.target.value.toUpperCase())} placeholder="ABC-1234" maxLength={8} className="h-7 text-xs" />
                          </div>
                          <div className="space-y-0.5">
                            <Label>Taxa (R$)</Label>
                            <CurrencyInput value={m.fee} onChange={(val) => updateMotoboy(m.id, 'fee', val)} />
                          </div>
                        </div>
                        <Button variant="ghost" onClick={() => removeMotoboy(m.id)} className="text-red-500 hover:bg-red-50 h-7 w-7 p-0 shrink-0"><Trash2 className="w-3 h-3"/></Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* SEÇÃO 2 — Freelancers */}
            <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500/15 to-fuchsia-500/15 border border-purple-500/20 flex items-center justify-center">
                  <Users className="h-5 w-5 text-purple-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-bold text-slate-800">Freelancers diaristas</h2>
                  <p className="text-xs text-muted-foreground">Entregadores avulsos com diária fixa e escala de dias da semana.</p>
                </div>
                {freelancers.length > 0 && (
                  <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 text-[10px] gap-1">
                    {freelancers.filter(f => f.active).length} ativo{freelancers.filter(f => f.active).length !== 1 ? 's' : ''}
                  </Badge>
                )}
                <Button onClick={addFreelancer} size="sm" className="h-8 text-xs bg-purple-600 hover:bg-purple-700"><Plus className="w-4 h-4 mr-1"/> Adicionar</Button>
              </header>
              <div className="p-6">
                {freelancers.length === 0 ? (
                  <div className="text-center py-6 text-sm text-muted-foreground border-2 border-dashed rounded-lg">Nenhum freelancer cadastrado. Clique em "Adicionar" para começar.</div>
                ) : (
                  <div className="space-y-1.5">
                    {freelancers.map((f, idx) => (
                      <div key={f.id} className="py-2 px-3 rounded-md border bg-purple-50/50 space-y-2">
                        <div className="flex items-center gap-2">
                          <Switch checked={f.active} onCheckedChange={(checked) => updateFreelancer(f.id, 'active', checked)} className="data-[state=checked]:bg-green-500 scale-90" />
                          <Label className="text-[10px] font-bold text-slate-700 flex-1">{f.active ? 'Ativo' : 'Inativo'}</Label>
                          <Button variant="ghost" onClick={() => removeFreelancer(f.id)} className="text-red-500 hover:bg-red-50 h-7 w-7 p-0 shrink-0"><Trash2 className="w-3 h-3"/></Button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="space-y-0.5">
                            <Label>Nome</Label>
                            <Input value={f.name} onChange={(e) => updateFreelancer(f.id, 'name', e.target.value)} placeholder="Pedro" className="h-7 text-xs" />
                          </div>
                          <div className="space-y-0.5">
                            <Label>WhatsApp</Label>
                            <Input value={f.whatsapp} onChange={(e) => updateFreelancer(f.id, 'whatsapp', formatPhone(e.target.value))} placeholder="(00) 90000-0000" className="h-7 text-xs" />
                          </div>
                          <div className="space-y-0.5">
                            <Label>Valor (R$)</Label>
                            <CurrencyInput value={f.dailyRate} onChange={(val) => updateFreelancer(f.id, 'dailyRate', val)} />
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 pt-1 border-t border-purple-200/30">
                          <Label className="text-[10px] uppercase font-bold text-slate-500 shrink-0">Dias:</Label>
                          {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'].map(day => (
                            <div key={day} className="flex items-center space-x-0.5 bg-white px-1.5 py-0.5 rounded border text-[10px]">
                              <Checkbox id={`day-${f.id}-${day}`} checked={f.workDays?.includes(day)} onCheckedChange={() => toggleFreelancerDay(f.id, day)} className="h-3 w-3" />
                              <Label htmlFor={`day-${f.id}-${day}`} className="text-[10px] cursor-pointer">{day}</Label>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </>
        )}

        {activeTab === 'pagamentos' && (
          <>
          <section className="bg-white rounded-2xl shadow-sm border overflow-hidden">
            <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-teal-500/15 to-emerald-500/15 border border-teal-500/20 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-teal-600" />
              </div>
              <div className="flex-1">
                <h2 className="text-base font-bold text-slate-800">Métodos aceitos</h2>
                <p className="text-xs text-muted-foreground">Escolha quais formas de pagamento estarão disponíveis no Delivery, Retirada e Salão.</p>
              </div>
              {paymentMethods.filter(m => m.active).length > 0 && (
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] gap-1">
                  <CheckCircle2 className="h-3 w-3" /> {paymentMethods.filter(m => m.active).length} ativo{paymentMethods.filter(m => m.active).length !== 1 ? 's' : ''}
                </Badge>
              )}
              <Button onClick={() => setPaymentMethods([...paymentMethods, { id: 'novo_'+Date.now(), label: 'Nova Forma', icon: '💳', active: true }])} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 h-8 text-xs">
                <Plus className="w-3 h-3" /> Novo Método
              </Button>
            </header>
            <div className="p-6">
              <div className="space-y-1.5">
                {paymentMethods.map((method, index) => (
                  <div key={method.id} className="flex items-center gap-2 py-1 px-3 border rounded-md bg-slate-50/50 hover:bg-slate-50 transition-colors">
                    <Input 
                      value={method.icon} 
                      onChange={(e) => {
                        const newMethods = [...paymentMethods];
                        newMethods[index].icon = e.target.value;
                        setPaymentMethods(newMethods);
                      }}
                      className="w-12 h-8 text-center text-sm border-0 bg-transparent shadow-none focus-visible:ring-1 focus-visible:ring-primary/20"
                      placeholder="🔷"
                    />
                    <Input 
                      value={method.label} 
                      onChange={(e) => {
                        const newMethods = [...paymentMethods];
                        newMethods[index].label = e.target.value;
                        if (!['dinheiro', 'pix', 'debito', 'credito'].includes(newMethods[index].id)) {
                           newMethods[index].id = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '_');
                        }
                        setPaymentMethods(newMethods);
                      }}
                      className="font-semibold flex-1 h-8 text-sm border-0 bg-transparent shadow-none focus-visible:ring-1 focus-visible:ring-primary/20 px-1"
                      placeholder="Nome do método"
                    />
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Switch 
                        checked={method.active} 
                        onCheckedChange={(checked) => {
                          const newMethods = [...paymentMethods];
                          newMethods[index].active = checked;
                          setPaymentMethods(newMethods);
                        }}
                        className="scale-90"
                      />
                      <Label className="w-12 text-xs font-semibold">{method.active ? 'Ativo' : 'Inativo'}</Label>
                    </div>
                    <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600 hover:bg-red-50 h-7 w-7 shrink-0" onClick={() => setPaymentMethods(paymentMethods.filter((_, i) => i !== index))}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
                {paymentMethods.length === 0 && (
                  <div className="text-center py-6 text-sm text-muted-foreground border-2 border-dashed rounded-lg">
                    Nenhuma forma de pagamento configurada. Clique em "Novo Método" para começar.
                  </div>
                )}
              </div>
            </div>
          </section>
          
          {/* Nova Configuração: Conta da Casa */}
          <section className="bg-white rounded-2xl shadow-sm border overflow-hidden mt-6">
            <header className="px-6 py-4 border-b bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500/15 to-purple-500/15 border border-indigo-500/20 flex items-center justify-center">
                <span className="text-xl">📝</span>
              </div>
              <div className="flex-1">
                <h2 className="text-base font-bold text-slate-800">Sua conta (Prazo)</h2>
                <p className="text-xs text-muted-foreground">Configure os dados de recebimento (PIX) que aparecerão no extrato de cobrança do cliente.</p>
              </div>
            </header>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="credit_pix">Chave PIX para Pagamento da Conta</Label>
                  <Input 
                    id="credit_pix" 
                    placeholder="CNPJ, Celular ou E-mail" 
                    value={creditPixKey} 
                    onChange={e => setCreditPixKey(e.target.value)} 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="credit_name">Nome do Titular da Conta</Label>
                  <Input 
                    id="credit_name" 
                    placeholder="Nome que aparece ao transferir" 
                    value={creditPixName} 
                    onChange={e => setCreditPixName(e.target.value)} 
                  />
                </div>
              </div>
              <div className="mt-4 p-4 bg-indigo-50 border border-indigo-100 rounded-lg flex items-start gap-3">
                <Info className="h-5 w-5 text-indigo-500 shrink-0 mt-0.5" />
                <div className="text-sm text-indigo-800">
                  <p className="font-bold mb-1">Como funciona a Conta da Casa?</p>
                  <p>1. Ative o crédito individualmente para os clientes VIP na aba <strong>Clientes</strong>.</p>
                  <p>2. Quando esse cliente inserir o celular no carrinho, a opção de pagamento <strong>"Conta da Casa"</strong> aparecerá para ele.</p>
                  <p>3. A chave PIX acima será exibida no painel dele e no extrato de cobrança gerado para ele realizar o acerto da dívida.</p>
                </div>
              </div>
            </div>
          </section>
          </>
        )}

        <div className="bg-white rounded-2xl shadow-sm border p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 sticky bottom-2 z-10">
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Info className="h-3.5 w-3.5 text-slate-400" />
            Lembre-se de salvar as alterações antes de sair desta página.
          </p>
          <Button size="lg" className="w-full md:w-auto bg-emerald-600 hover:bg-emerald-700 h-11 px-8 font-bold shadow-lg shadow-emerald-500/20" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
            {isSaving ? 'Salvando...' : 'Salvar configurações'}
          </Button>
        </div>
      </div>
    </div>
  );
}
