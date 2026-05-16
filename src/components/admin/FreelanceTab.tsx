import React, { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bike, Loader2, AlertCircle, ChevronDown, ChevronUp, Clock, MapPin, ReceiptText } from 'lucide-react';
import { useCaixa } from '@/hooks/useCaixa';

interface FreelanceTabProps {
  orders: any[];
  storeProfile: any;
}

export function FreelanceTab({ orders, storeProfile }: FreelanceTabProps) {
  const { caixaAtual, lancamentos, loading } = useCaixa();
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  // Cálculo dos motoboys com histórico
  const motoboysSessao = useMemo(() => {
    const motoboys = storeProfile?.motoboys || [];
    const map: Record<string, any> = {};

    // Inicializa todos os motoboys cadastrados
    motoboys.forEach((mb: any) => {
      map[mb.id] = {
        id: mb.id,
        name: mb.name,
        entregas: 0,
        taxa: Number(mb.fee || 0),
        somaFretes: 0,
        total: 0,
        jaPago: 0,
        saldo: 0,
        pedidosLista: [],
        sangriasLista: []
      };
    });

    // Soma entregas da sessão
    pedidosDaSessao.forEach((o: any) => {
      if (!o.motoboyId) return;
      if (!map[o.motoboyId]) {
        map[o.motoboyId] = { 
          id: o.motoboyId,
          name: 'Desconhecido', 
          entregas: 0, 
          taxa: 0,
          somaFretes: 0,
          total: 0,
          jaPago: 0,
          saldo: 0,
          pedidosLista: [],
          sangriasLista: []
        };
      }
      map[o.motoboyId].entregas++;
      map[o.motoboyId].somaFretes += Number(o.deliveryFee || 0);
      map[o.motoboyId].pedidosLista.push(o);
    });
    
    return Object.values(map).map(m => {
      const taxaAplicada = m.entregas > 0 ? m.taxa : 0;
      m.total = taxaAplicada + m.somaFretes;
      
      const adiantamentosLista = lancamentos.filter(l => l.tipo === 'sangria' && l.destinatarioTipo === 'motoboy' && l.destinatarioId === m.id);
      m.sangriasLista = adiantamentosLista;

      const adiantamentos = adiantamentosLista.reduce((s, l) => s + Math.abs(l.valor), 0);
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
    <div className="space-y-4 max-w-4xl pb-10">
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
            <p className="text-slate-500 font-medium">Nenhum motoboy configurado.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {motoboysSessao.map(m => {
            const isExpanded = expandedId === m.id;
            return (
              <Card key={m.id} className="shadow-sm overflow-hidden transition-all duration-200">
                <div 
                  className={`p-4 cursor-pointer hover:bg-slate-50/50 transition-colors ${isExpanded ? 'bg-slate-50 border-b border-slate-100' : ''}`}
                  onClick={() => setExpandedId(isExpanded ? null : m.id)}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                        <Bike className="h-5 w-5 text-slate-500" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-lg text-slate-800 leading-none">{m.name}</span>
                          <Badge variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200 text-xs font-bold">
                            {m.entregas} ped.
                          </Badge>
                        </div>
                        <div className="text-sm text-slate-500 mt-1 flex items-center gap-2">
                          <span>Ganho: <strong className="text-slate-700">R$ {m.total.toFixed(2)}</strong></span>
                          <span className="text-slate-300">•</span>
                          <span>Vales: <strong className="text-rose-600">-R$ {m.jaPago.toFixed(2)}</strong></span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between md:justify-end gap-6 pl-12 md:pl-0">
                      <div className="text-right">
                        <span className="text-xs uppercase tracking-wider font-bold text-slate-400 block mb-0.5">A Pagar</span>
                        <span className="text-xl font-black text-emerald-600 leading-none">R$ {m.saldo.toFixed(2)}</span>
                      </div>
                      <div className="text-slate-400">
                        {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Área Expandida com Histórico */}
                {isExpanded && (
                  <CardContent className="p-0 bg-white">
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
                      
                      {/* Coluna 1: Entregas */}
                      <div className="p-4 bg-slate-50/30">
                        <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
                          <MapPin className="h-4 w-4 text-blue-500" /> Histórico de Entregas
                        </h4>
                        {m.pedidosLista.length === 0 ? (
                          <p className="text-xs text-slate-400 italic">Nenhuma entrega nesta sessão.</p>
                        ) : (
                          <div className="space-y-3">
                            {m.pedidosLista.map((ped: any, idx: number) => (
                              <div key={idx} className="flex justify-between items-start gap-2 text-sm bg-white p-2.5 rounded-lg border border-slate-100 shadow-sm">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <span className="font-mono text-[10px] font-bold text-slate-400 bg-slate-100 px-1 rounded">#{ped.id?.slice(-5).toUpperCase() || '---'}</span>
                                    <span className="text-xs text-slate-500 flex items-center gap-1">
                                      <Clock className="h-3 w-3" />
                                      {new Date(ped.orderDateTime || ped.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-600 truncate" title={ped.deliveryAddress?.street || ped.deliveryAddress}>
                                    {ped.deliveryAddress?.street ? `${ped.deliveryAddress.street}, ${ped.deliveryAddress.number || 'S/N'}` : (ped.deliveryAddress || 'Sem endereço')}
                                  </p>
                                </div>
                                <div className="text-right shrink-0">
                                  <span className="text-xs font-bold text-slate-700">R$ {Number(ped.deliveryFee || 0).toFixed(2)}</span>
                                </div>
                              </div>
                            ))}
                            {m.taxa > 0 && m.entregas > 0 && (
                              <div className="flex justify-between items-center bg-blue-50/50 p-2.5 rounded-lg border border-blue-100">
                                <span className="text-xs font-semibold text-blue-800">Diária / Taxa Fixa</span>
                                <span className="text-xs font-bold text-blue-700">R$ {m.taxa.toFixed(2)}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Coluna 2: Vales e Sangrias */}
                      <div className="p-4 bg-slate-50/30">
                        <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
                          <ReceiptText className="h-4 w-4 text-rose-500" /> Vales e Sangrias
                        </h4>
                        {m.sangriasLista.length === 0 ? (
                          <p className="text-xs text-slate-400 italic">Nenhum vale registrado nesta sessão.</p>
                        ) : (
                          <div className="space-y-3">
                            {m.sangriasLista.map((val: any, idx: number) => (
                              <div key={idx} className="flex justify-between items-start gap-2 text-sm bg-white p-2.5 rounded-lg border border-slate-100 shadow-sm">
                                <div>
                                  <div className="text-xs text-slate-500 flex items-center gap-1 mb-1">
                                    <Clock className="h-3 w-3" />
                                    {val.data?.toDate ? val.data.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '---'}
                                  </div>
                                  <p className="text-xs text-slate-600">{val.titulo || 'Vale'}</p>
                                </div>
                                <div className="text-right shrink-0">
                                  <span className="text-xs font-bold text-rose-600">-R$ {Math.abs(val.valor).toFixed(2)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
