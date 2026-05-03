'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { AddressAutocomplete } from '@/components/ui/address-autocomplete';
import { collection, doc, getDoc, setDoc } from 'firebase/firestore';
import { Loader2, Plus, Trash2, Store, Clock, Settings, Truck, Wallet, CalendarOff, ChevronLeft, ChevronRight } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { CurrencyInput } from '@/components/ui/currency-input';

interface StoreProfileTabProps {
  db: any;
  user: any;
}

const DAYS_OF_WEEK = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

export function StoreProfileTab({ db, user }: StoreProfileTabProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'geral' | 'taxas' | 'horarios' | 'motoboys' | 'pagamentos'>('geral');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Estados dos formulários
  const [formData, setFormData] = useState({
    name: '',
    cnpj: '',
    phone: '',
    whatsapp: '',
    address: '',
    addressNumber: '',
    addressComplement: '',
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
  });

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

  const [paymentMethods, setPaymentMethods] = useState<{ id: string, label: string, icon: string, active: boolean }[]>([
    { id: 'dinheiro', label: 'Dinheiro', icon: '💵', active: true },
    { id: 'pix', label: 'Pix', icon: '📱', active: true },
    { id: 'debito', label: 'Débito', icon: '💳', active: true },
    { id: 'credito', label: 'Crédito', icon: '💳', active: true },
  ]);

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
          if (data.paymentMethods) setPaymentMethods(data.paymentMethods);
          if (data.plannedClosures) setPlannedClosures(data.plannedClosures);
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
          phone: formData.phone,
          whatsapp: formData.whatsapp,
          address: formData.address,
          addressNumber: formData.addressNumber,
          addressComplement: formData.addressComplement,
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
        paymentMethods,
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

  if (isLoading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-3">
      <div className="flex flex-col md:flex-row gap-2 border-b pb-3 overflow-x-auto whitespace-nowrap hide-scrollbar">
        <button onClick={() => setActiveTab('geral')} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${activeTab === 'geral' ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:bg-slate-100'}`}><Store className="w-3.5 h-3.5"/> Dados e Contato</button>
        <button onClick={() => setActiveTab('taxas')} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${activeTab === 'taxas' ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:bg-slate-100'}`}><Settings className="w-3.5 h-3.5"/> Taxas, Prazos e KM</button>
        <button onClick={() => setActiveTab('horarios')} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${activeTab === 'horarios' ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:bg-slate-100'}`}><Clock className="w-3.5 h-3.5"/> Horários</button>
        <button onClick={() => setActiveTab('motoboys')} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${activeTab === 'motoboys' ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:bg-slate-100'}`}><Truck className="w-3.5 h-3.5"/> Motoboys / Freelancers</button>
        <button onClick={() => setActiveTab('pagamentos')} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${activeTab === 'pagamentos' ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:bg-slate-100'}`}><Wallet className="w-3.5 h-3.5"/> Formas de Pagamento</button>
      </div>

      <div className="bg-white p-3 rounded-xl shadow-sm border">
        {activeTab === 'geral' && (
          <div className="space-y-1">
            <h2 className="text-sm font-bold">Dados da Empresa</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-2 gap-y-1">
              <div className="space-y-0.5">
                <Label>Nome da Empresa</Label>
                <Input name="name" value={formData.name} onChange={handleChange} placeholder="Ex: Minha Lanchonete" />
              </div>
              <div className="space-y-0.5">
                <Label>CNPJ</Label>
                <Input name="cnpj" value={formData.cnpj} onChange={(e) => setFormData({...formData, cnpj: formatCNPJ(e.target.value)})} placeholder="00.000.000/0000-00" maxLength={18} />
              </div>
              <div className="space-y-0.5">
                <Label>Telefone (Opcional)</Label>
                <Input name="phone" value={formData.phone} onChange={(e) => setFormData({...formData, phone: formatPhone(e.target.value)})} placeholder="(00) 0000-0000" maxLength={15} />
              </div>
              <div className="space-y-0.5">
                <Label>WhatsApp</Label>
                <Input name="whatsapp" value={formData.whatsapp} onChange={(e) => setFormData({...formData, whatsapp: formatPhone(e.target.value)})} placeholder="(00) 90000-0000" maxLength={15} />
              </div>
            </div>
            <div className="space-y-0.5">
              <Label>Endereço Completo</Label>
              <AddressAutocomplete 
                value={formData.address} 
                onChange={(val) => setFormData({...formData, address: val})} 
                placeholder="Busque o endereço do estabelecimento..."
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-2 gap-y-1 pt-1">
              <div className="space-y-0.5">
                <Label>Número</Label>
                <Input name="addressNumber" value={formData.addressNumber} onChange={handleChange} placeholder="Ex: 123" />
              </div>
              <div className="space-y-0.5">
                <Label>Complemento (Opcional)</Label>
                <Input name="addressComplement" value={formData.addressComplement} onChange={handleChange} placeholder="Ex: Sala 2, Loja B" />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'taxas' && (
          <div className="space-y-2">
            <h2 className="text-sm font-bold">Taxas, Prazos e Área de Entrega</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-2">
              {/* Coluna Esquerda */}
              <div className="space-y-2">
                <div className="space-y-0.5">
                  <Label>Área de Atuação (Cidades atendidas)</Label>
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
                    <Button onClick={addCity} type="button" className="h-9">Adicionar</Button>
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

                <div className="space-y-1">
                  <Label className="flex items-center gap-2">
                    Taxa de Entrega Padrão (R$)
                    {formData.deliveryFee > 0 && <Badge className="bg-emerald-500 hover:bg-emerald-600 text-[10px] h-4 px-1.5 uppercase tracking-wider">Regra Aplicada</Badge>}
                  </Label>
                  <CurrencyInput name="deliveryFee" value={formData.deliveryFee} onChange={(val) => setFormData({...formData, deliveryFee: val})} />
                </div>
                
                <div className="space-y-1">
                  <Label className="flex items-center gap-2">
                    Frete Grátis em pedidos acima de (R$)
                    {formData.freeDeliveryOver > 0 && <Badge className="bg-emerald-500 hover:bg-emerald-600 text-[10px] h-4 px-1.5 uppercase tracking-wider">Regra Aplicada</Badge>}
                  </Label>
                  <CurrencyInput name="freeDeliveryOver" value={formData.freeDeliveryOver} onChange={(val) => setFormData({...formData, freeDeliveryOver: val})} />
                </div>
                


                <div className="space-y-1 pt-2 border-t">
                  <div className="flex justify-between items-center">
                    <Label>Taxa do Garçom / Serviço de Mesa</Label>
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
                      <Input type="number" step="0.1" name="tableServiceFee" value={formData.tableServiceFee} onChange={handleNumberChange} className="pr-10" />
                      <span className="absolute right-4 text-muted-foreground text-sm font-bold">%</span>
                    </div>
                  ) : (
                    <CurrencyInput name="tableServiceFee" value={formData.tableServiceFee} onChange={(val) => setFormData({...formData, tableServiceFee: val})} />
                  )}
                </div>
              </div>

              {/* Coluna Direita */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Valor Mínimo do Pedido (R$)</Label>
                  <CurrencyInput name="minOrderValue" value={formData.minOrderValue} onChange={(val) => setFormData({...formData, minOrderValue: val})} />
                </div>
                
                <div className="space-y-1">
                  <Label>Tempo Médio de Entrega (Motoboy)</Label>
                  <Input type="time" name="deliveryTime" value={formData.deliveryTime} onChange={handleChange} />
                </div>
                
                <div className="space-y-1">
                  <Label>Tempo Médio para Retirar no Local</Label>
                  <Input type="time" name="pickupTime" value={formData.pickupTime} onChange={handleChange} />
                </div>
                
                <div className="space-y-1">
                  <Label>Limitar Entregas pelo Mapa (Raio em KM)</Label>
                  <div className="flex relative items-center">
                    <Input type="number" name="maxDeliveryRadius" value={formData.maxDeliveryRadius} onChange={handleNumberChange} className="pr-12" />
                    <span className="absolute right-4 text-muted-foreground text-sm font-bold">KM</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Deixe 0 ou vazio para desabilitar a restrição de distância.</p>
                </div>
              </div>
            </div>
          </div>
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
            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
              {/* Left: Compact Weekly Schedule */}
              <div className="space-y-2">
                <h2 className="text-sm font-bold">Horário Semanal</h2>
                <div className="space-y-0.5">
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
                <p className="text-[10px] text-muted-foreground leading-tight pt-1">
                  Use o calendário ao lado para desligar dias específicos (feriados, folgas). Dias cinza já estão fechados pelo horário semanal.
                </p>
              </div>

              {/* Right: Interactive Calendar */}
              <div className="space-y-2">
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
            </div>
          );
        })()}

        {activeTab === 'motoboys' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <h2 className="text-sm font-bold">Motoboys</h2>
                <Button onClick={addMotoboy} size="sm" className="h-7 text-xs"><Plus className="w-3 h-3 mr-1"/> Adicionar</Button>
              </div>
              
              {motoboys.length === 0 ? (
                <div className="text-center py-4 text-sm text-muted-foreground border-2 border-dashed rounded-lg">Nenhum motoboy cadastrado.</div>
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

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <h2 className="text-sm font-bold">Freelancers</h2>
                <Button onClick={addFreelancer} size="sm" className="h-7 text-xs"><Plus className="w-3 h-3 mr-1"/> Adicionar</Button>
              </div>
              
              {freelancers.length === 0 ? (
                <div className="text-center py-4 text-sm text-muted-foreground border-2 border-dashed rounded-lg">Nenhum freelancer cadastrado.</div>
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
          </div>
        )}

        {activeTab === 'pagamentos' && (
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-sm font-bold">Formas de Pagamento</h2>
                <p className="text-xs text-muted-foreground">Escolha quais métodos estarão disponíveis para seus clientes e no PDV.</p>
              </div>
              <Button onClick={() => setPaymentMethods([...paymentMethods, { id: 'novo_'+Date.now(), label: 'Nova Forma', icon: '💳', active: true }])} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 h-8 text-xs">
                <Plus className="w-3 h-3" /> Novo Método
              </Button>
            </div>
            
            <div className="space-y-1.5">
              {paymentMethods.map((method, index) => (
                <div key={method.id} className="flex items-center gap-2 py-1 px-3 border rounded-md bg-white hover:bg-slate-50 transition-colors">
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
                <p className="text-center text-muted-foreground py-4 text-sm">Nenhuma forma de pagamento configurada.</p>
              )}
            </div>
          </div>
        )}

        <div className="pt-3 mt-3 border-t flex justify-end">
          <Button size="default" className="w-full md:w-auto bg-green-600 hover:bg-green-700 h-8 text-xs px-4" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Salvar Configurações
          </Button>
        </div>
      </div>
    </div>
  );
}
