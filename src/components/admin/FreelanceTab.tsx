import React, { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bike, Loader2, AlertCircle } from 'lucide-react';
import { useCaixa } from '@/hooks/useCaixa';

interface FreelanceTabProps {
  orders: any[];
  storeProfile: any;
}

export function FreelanceTab({ orders, storeProfile }: FreelanceTabProps) {
  const { caixaAtual, lancamentos, loading } = useCaixa();

  // Pedidos da sessão atual
  const pedidosDaSessao = useMemo(() => {
    if (!orders || !caixaAtual) return [];
    const abertura = caixaAtual.dataAbertura?.toDate?.() || new Date(0);
    const fechamento = caixaAtual.dataFechamento?.toDate?.() || new Date();
    return orders.filter((o: any) => {
      const dt = new Date(o.orderDateTime);
      return dt >= abertura && (caixaAtual.status === 'fechado' ? dt <= fechamento : true) && o.status !== 'canceled';
    });
  }, [orders, caixaAtual]);

  // Cálculo dos motoboys: Diária fixa + Soma do Frete de cada entrega
  const motoboysSessao = useMemo(() => {
    const motoboys = storeProfile?.motoboys || [];
    const map: Record<string, any> = {};
    pedidosDaSessao.forEach((o: any) => {
      if (!o.motoboyId) return;
      const mb = motoboys.find((m: any) => m.id === o.motoboyId);
      if (!map[o.motoboyId]) {
        map[o.motoboyId] = { 
          id: o.motoboyId,
          name: mb?.name || 'Desconhecido', 
          entregas: 0, 
          taxa: Number(mb?.fee || 0), // Diária Fixa
          somaFretes: 0,
          total: 0,
          jaPago: 0,
          saldo: 0
        };
      }
      map[o.motoboyId].entregas++;
      map[o.motoboyId].somaFretes += Number(o.deliveryFee || 0); // Soma os fretes cobrados dos clientes
    });
    
    return Object.values(map).map(m => {
      m.total = m.taxa + m.somaFretes; // Total = Diária + Fretes
      const adiantamentos = lancamentos
        .filter(l => l.tipo === 'sangria' && l.destinatarioTipo === 'motoboy' && l.destinatarioId === m.id)
        .reduce((s, l) => s + Math.abs(l.valor), 0);
      m.jaPago = adiantamentos;
      m.saldo = Math.max(0, m.total - m.jaPago);
      return m;
    });
  }, [storeProfile, pedidosDaSessao, lancamentos]);

  if (loading) {
    return <div className="py-20 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!caixaAtual) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
        <AlertCircle className="h-12 w-12 text-slate-300" />
        <p className="text-slate-500 font-medium">Não há caixa aberto no momento.</p>
        <p className="text-xs text-slate-400">Abra o caixa para iniciar o acompanhamento de entregadores.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h2 className="text-xl font-bold text-slate-700 flex items-center gap-2">
          <Bike className="h-5 w-5" /> Gestão de Entregas (Freelance)
        </h2>
        <p className="text-sm text-muted-foreground">Acompanhe as entregas da sessão atual, vales e o que ainda deve pagar.</p>
      </div>

      {motoboysSessao.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="py-12 flex flex-col items-center text-center">
            <Bike className="h-10 w-10 text-slate-200 mb-3" />
            <p className="text-slate-500 font-medium">Nenhum motoboy fez entregas nesta sessão ainda.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {motoboysSessao.map(m => (
            <Card key={m.id} className="shadow-sm">
              <CardContent className="p-4 flex flex-col gap-2">
                <div className="flex justify-between items-start mb-2">
                  <span className="font-bold text-lg text-slate-800 leading-none truncate">{m.name}</span>
                  <Badge variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200 text-xs font-bold shrink-0">
                    {m.entregas} ped.
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground flex justify-between py-1 border-b">
                  <span>Total ganho:</span>
                  <span className="font-semibold text-slate-700">R$ {m.total.toFixed(2)}</span>
                </div>
                <div className="text-sm text-muted-foreground flex justify-between py-1 border-b">
                  <span>Vales (Sangria):</span>
                  <span className="text-rose-600 font-semibold">-R$ {m.jaPago.toFixed(2)}</span>
                </div>
                <div className="text-lg font-black flex justify-between pt-2">
                  <span>A Pagar:</span>
                  <span className="text-emerald-600">R$ {m.saldo.toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
