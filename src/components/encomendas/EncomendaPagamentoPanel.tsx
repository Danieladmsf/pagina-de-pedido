'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Truck, Wallet } from 'lucide-react';
import { brl } from '@/lib/utils';
import type { RascunhoEncomendas } from '@/lib/encomendas/rascunho';

// Aba "Pagamento e entrega": sinal por PIX e se a loja entrega ou só tem retirada.
export function EncomendaPagamentoPanel({ r, onChange }: {
  r: RascunhoEncomendas;
  onChange: (patch: Partial<RascunhoEncomendas>) => void;
}) {
  // Exemplo vivo com uma encomenda de R$ 200: a dona vê o que o percentual significa.
  const pct = Math.min(100, Math.max(0, Number(r.sinalPercent) || 0));
  const exemploTotal = 200;
  const sinal = Math.round(exemploTotal * pct) / 100;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <Card className="border shadow-sm rounded-2xl">
        <CardContent className="space-y-4 p-4">
          <div>
            <p className="flex items-center gap-2 font-bold text-slate-800"><Wallet className="h-4 w-4 text-emerald-600" /> Sinal por PIX</p>
            <p className="text-xs text-muted-foreground">Parte do valor que o cliente paga na hora de fazer o pedido.</p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-semibold text-slate-600">Percentual do sinal</Label>
            <div className="flex items-center gap-2">
              <Input type="number" min={0} max={100} className="h-9 w-24 text-sm" value={r.sinalPercent} onChange={(e) => onChange({ sinalPercent: Number(e.target.value) })} />
              <span className="text-sm text-slate-600">%</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {pct === 0
                ? 'Sem sinal: o cliente paga tudo depois.'
                : `Numa encomenda de ${brl(exemploTotal)}, o cliente paga ${brl(sinal)} no pedido e ${brl(exemploTotal - sinal)} depois.`}
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-semibold text-slate-600">Chave PIX</Label>
            <Input className="h-9 text-sm" value={r.pixKey} onChange={(e) => onChange({ pixKey: e.target.value })} placeholder="CPF/CNPJ, telefone, e-mail ou chave aleatória" />
            <p className="text-xs text-muted-foreground">É para esta chave que o cliente envia o sinal.</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border shadow-sm rounded-2xl">
        <CardContent className="space-y-3 p-4">
          <div>
            <p className="flex items-center gap-2 font-bold text-slate-800"><Truck className="h-4 w-4 text-emerald-600" /> Retirada e entrega</p>
            <p className="text-xs text-muted-foreground">Como o cliente recebe a encomenda.</p>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">Somente retirada (sem entrega)</p>
              <p className="text-xs text-muted-foreground">Quando ligada, o cliente só escolhe &quot;Retirar no local&quot;, sem opção de entrega. (Bolo recheado é sempre só retirada.)</p>
            </div>
            <Switch checked={r.pickupOnly} onCheckedChange={(v) => onChange({ pickupOnly: v })} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
