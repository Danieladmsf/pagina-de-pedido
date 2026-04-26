'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AddressAutocomplete } from '@/components/ui/address-autocomplete';
import { Plus, Trash2, MapPin, Save, Loader2 } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { CurrencyInput } from '@/components/ui/currency-input';

interface DeliveryZonesTabProps {
  db: any;
  user: any;
  adminRole: any;
}

interface FeeRule {
  maxKm: number;
  fee: number;
  perKmExtra?: number;
}

export function DeliveryZonesTab({ db, user, adminRole }: DeliveryZonesTabProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  // Endereço do Restaurante
  const [storeAddress, setStoreAddress] = useState('');

  // Regras de taxa por distância
  const [feeRules, setFeeRules] = useState<FeeRule[]>([
    { maxKm: 3, fee: 5.00 },
    { maxKm: 5, fee: 8.00 },
    { maxKm: 10, fee: 12.00 },
  ]);

  // Carregar dados salvos
  useEffect(() => {
    if (adminRole) {
      if (adminRole.storeAddress) setStoreAddress(adminRole.storeAddress);
      if (adminRole.deliveryFeeRules && Array.isArray(adminRole.deliveryFeeRules)) {
        setFeeRules(adminRole.deliveryFeeRules);
      }
    }
  }, [adminRole]);

  const addRule = () => {
    const lastRule = feeRules[feeRules.length - 1];
    setFeeRules([...feeRules, { maxKm: (lastRule?.maxKm || 0) + 5, fee: (lastRule?.fee || 0) + 3 }]);
  };

  const removeRule = (index: number) => {
    setFeeRules(feeRules.filter((_, i) => i !== index));
  };

  const updateRule = (index: number, field: keyof FeeRule, value: number) => {
    setFeeRules(feeRules.map((rule, i) => i === index ? { ...rule, [field]: value } : rule));
  };

  const handleSave = async () => {
    if (!db || !user) return;
    if (!storeAddress.trim()) {
      toast({ variant: 'destructive', title: 'Endereço obrigatório', description: 'Informe o endereço completo do restaurante.' });
      return;
    }

    setSaving(true);
    try {
      await setDoc(doc(db, 'roles_admin', user.uid), {
        storeAddress: storeAddress.trim(),
        deliveryFeeRules: feeRules.sort((a, b) => a.maxKm - b.maxKm),
      }, { merge: true });

      toast({ title: 'Zonas salvas!', description: 'As regras de taxa de entrega foram atualizadas.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err.message || 'Falha ao salvar.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Endereço do Restaurante */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MapPin className="h-5 w-5 text-primary" />
            Endereço do Restaurante
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Digite o endereço completo do seu restaurante. Ele será usado como ponto de origem para calcular a distância até o cliente.
          </p>
          <div className="space-y-2">
            <Label>Endereço completo (Rua, Número, Bairro, Cidade - UF)</Label>
            <AddressAutocomplete 
              value={storeAddress} 
              onChange={setStoreAddress} 
              placeholder="Ex: Rua das Flores, 123, Centro, Cravinhos - SP"
              className="h-12"
            />
          </div>
        </CardContent>
      </Card>

      {/* Regras de Taxa por Distância */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">🛵 Regras de Taxa por Distância (KM)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Configure as faixas de distância e o valor da taxa de entrega para cada faixa. 
            O sistema usa o Google Maps para calcular a distância real pelas ruas.
          </p>

          <div className="space-y-3">
            {feeRules.map((rule, index) => (
              <div key={index} className="flex items-center gap-3 bg-slate-50 p-3 rounded-lg border">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">Até (KM)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    value={rule.maxKm}
                    onChange={(e) => updateRule(index, 'maxKm', parseFloat(e.target.value) || 0)}
                    className="h-9"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">Taxa (R$)</Label>
                  <Input
                    type="number"
                    step="0.50"
                    min="0"
                    value={rule.fee}
                    onChange={(e) => updateRule(index, 'fee', parseFloat(e.target.value) || 0)}
                    className="h-9"
                  />
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="text-red-400 hover:text-red-600 mt-5"
                  onClick={() => removeRule(index)}
                  disabled={feeRules.length <= 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <Button variant="outline" size="sm" onClick={addRule} className="w-full border-dashed">
            <Plus className="h-4 w-4 mr-2" /> Adicionar Faixa
          </Button>

          {/* Preview das regras */}
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 text-sm space-y-1">
            <p className="font-bold text-blue-700 mb-2">📋 Resumo das Faixas:</p>
            {feeRules.sort((a, b) => a.maxKm - b.maxKm).map((rule, i) => (
              <p key={i} className="text-blue-600">
                • Até <strong>{rule.maxKm} km</strong> → <strong>R$ {rule.fee.toFixed(2)}</strong>
              </p>
            ))}
            <p className="text-blue-500 mt-2 italic">
              Acima de {feeRules[feeRules.length - 1]?.maxKm || 0} km, será cobrado R$ {feeRules[feeRules.length - 1]?.fee.toFixed(2) || '0.00'}.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Botão Salvar */}
      <Button 
        className="w-full h-14 bg-green-600 hover:bg-green-700 text-lg font-bold" 
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Save className="h-5 w-5 mr-2" />}
        Salvar Zonas de Entrega
      </Button>
    </div>
  );
}
