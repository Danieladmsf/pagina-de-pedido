import React, { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bike, Loader2, AlertCircle, ChevronDown, ChevronUp, Clock, MapPin, ReceiptText, CalendarRange } from 'lucide-react';
import { useCaixa } from '@/hooks/useCaixa';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface FreelanceTabProps {
  orders: any[];
  storeProfile: any;
}

export function FreelanceTab({ orders, storeProfile }: FreelanceTabProps) {
  const { caixaAtual, lancamentos: lancamentosSessao, loading } = useCaixa();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState('sessao');

  const db = useFirestore();
  const { user } = useUser();

  // Se o período não for a sessão atual, busca todos os lançamentos
  const lancamentosQuery = useMemoFirebase(() => {
    if (!db || !user || periodo === 'sessao') return null;
    return query(collection(db, 'cash_transactions'), where('ownerId', '==', user.uid));
  }, [db, user, periodo]);

  const { data: allLancamentos, isLoading: loadingAllLanc } = useCollection(lancamentosQuery);

  const dateRange = useMemo(() => {
    const now = new Date();
    if (periodo === 'sessao') {
      if (!caixaAtual) return null;
      const abertura = caixaAtual.dataAbertura?.toDate?.() || new Date(0);
      const fechamento = caixaAtual.dataFechamento?.toDate?.() || new Date();
      return { start: abertura, end: caixaAtual.status === 'fechado' ? fechamento : now };
    }
    
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    
    if (periodo === 'hoje') {
      // Mantém hoje à meia-noite
    } else if (periodo === '7d') {
      start.setDate(start.getDate() - 7);
    } else if (periodo === '15d') {
      start.setDate(start.getDate() - 15);
    } else if (periodo === '30d') {
      start.setDate(start.getDate() - 30);
    } else if (periodo === 'all') {
      start.setTime(0);
    }
    
    return { start, end: now };
  }, [periodo, caixaAtual]);

  // Pedidos filtrados
  const pedidosFiltrados = useMemo(() => {
    if (!orders || !dateRange) return [];
    return orders.filter((o: any) => {
      if (o.status === 'canceled') return false;
      const dt = new Date(o.orderDateTime || o.createdAt);
      return dt >= dateRange.start && dt <= dateRange.end;
    });
  }, [orders, dateRange]);

  // Lançamentos (Sangrias/Vales) filtrados
  const lancamentosFiltrados = useMemo(() => {
    if (!dateRange) return [];
    const source = periodo === 'sessao' ? lancamentosSessao : (allLancamentos || []);
    return source.filter((l: any) => {
      const dt = l.data?.toDate?.() || new Date(0);
      return dt >= dateRange.start && dt <= dateRange.end;
    });
  }, [periodo, lancamentosSessao, allLancamentos, dateRange]);

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
        sangriasLista: [],
        diasTrabalhados: 0
      };
    });

    // Soma entregas da sessão
    pedidosFiltrados.forEach((o: any) => {
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
          sangriasLista: [],
          diasTrabalhados: 0
        };
      }
      map[o.motoboyId].entregas++;
      map[o.motoboyId].somaFretes += Number(o.deliveryFee || 0);
      map[o.motoboyId].pedidosLista.push(o);
    });
    
    return Object.values(map).map(m => {
      const diasSet = new Set();
      m.pedidosLista.forEach((ped: any) => {
        const d = new Date(ped.orderDateTime || ped.createdAt);
        diasSet.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
      });
      
      m.diasTrabalhados = diasSet.size;
      const taxaAplicada = m.diasTrabalhados > 0 ? (m.taxa * m.diasTrabalhados) : 0;
      m.total = taxaAplicada + m.somaFretes;
      
      const adiantamentosLista = lancamentosFiltrados.filter((l: any) => l.tipo === 'sangria' && l.destinatarioTipo === 'motoboy' && l.destinatarioId === m.id);
      m.sangriasLista = adiantamentosLista;

      const adiantamentos = adiantamentosLista.reduce((s: number, l: any) => s + Math.abs(l.valor), 0);
      m.jaPago = adiantamentos;
      m.saldo = Math.max(0, m.total - m.jaPago);
      return m;
    });
  }, [storeProfile, pedidosFiltrados, lancamentosFiltrados]);

  if (loading || (periodo !== 'sessao' && loadingAllLanc)) {
    return <div className="py-20 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (periodo === 'sessao' && !caixaAtual) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
        <AlertCircle className="h-12 w-12 text-slate-300" />
        <p className="text-slate-500 font-medium">Não há caixa aberto no momento.</p>
        <p className="text-xs text-slate-400">Abra o caixa ou selecione outro período no filtro acima.</p>
        <div className="pt-4">
          <Select value={periodo} onValueChange={setPeriodo}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Selecionar Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sessao">Sessão Atual</SelectItem>
              <SelectItem value="hoje">Hoje</SelectItem>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="15d">Últimos 15 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="all">Todo o período</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl pb-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl border shadow-sm shrink-0">
        <div>
          <h2 className="text-xl font-bold text-slate-700 flex items-center gap-2">
            <Bike className="h-5 w-5 text-blue-600" /> Gestão de Entregas (Freelance)
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {periodo === 'sessao' 
              ? 'Acompanhe as entregas e vales limitados à sessão de caixa atual.'
              : 'Visualizando acumulado de múltiplos dias e sessões.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-slate-400" />
          <Select value={periodo} onValueChange={setPeriodo}>
            <SelectTrigger className="w-[180px] bg-slate-50">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sessao">Sessão Atual (Caixa)</SelectItem>
              <SelectItem value="hoje">Hoje</SelectItem>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="15d">Últimos 15 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="all">Todo o histórico</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {motoboysSessao.length === 0 ? (
        <Card className="border-dashed shadow-none bg-slate-50/50">
          <CardContent className="py-12 flex flex-col items-center text-center">
            <Bike className="h-10 w-10 text-slate-300 mb-3" />
            <p className="text-slate-500 font-medium">Nenhum motoboy configurado.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {motoboysSessao.map(m => {
            const isExpanded = expandedId === m.id;
            return (
              <Card key={m.id} className={`shadow-sm overflow-hidden transition-all duration-200 ${isExpanded ? 'ring-2 ring-blue-500/20 border-blue-200' : ''}`}>
                <div 
                  className={`p-4 cursor-pointer hover:bg-slate-50/50 transition-colors ${isExpanded ? 'bg-slate-50 border-b border-slate-100' : ''}`}
                  onClick={() => setExpandedId(isExpanded ? null : m.id)}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${m.saldo > 0 ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
                        <Bike className="h-6 w-6" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-lg text-slate-800 leading-none">{m.name}</span>
                          <Badge variant="secondary" className="bg-slate-100 text-slate-700 border-slate-200 text-xs font-bold">
                            {m.entregas} ped.
                          </Badge>
                          {m.diasTrabalhados > 1 && (
                            <Badge variant="secondary" className="bg-purple-50 text-purple-700 border-purple-200 text-xs font-bold">
                              {m.diasTrabalhados} dias
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-slate-500 mt-1.5 flex items-center gap-3">
                          <span>Ganhos: <strong className="text-slate-700">R$ {m.total.toFixed(2)}</strong></span>
                          <span className="text-slate-300">•</span>
                          <span>Pagos/Vales: <strong className="text-rose-600">-R$ {m.jaPago.toFixed(2)}</strong></span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between md:justify-end gap-6 pl-15 md:pl-0">
                      <div className="text-right">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block mb-0.5">Saldo / A Pagar</span>
                        <span className={`text-2xl font-black leading-none ${m.saldo > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>
                          R$ {m.saldo.toFixed(2)}
                        </span>
                      </div>
                      <div className="text-slate-400 bg-white shadow-sm border rounded-full p-1">
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
                      <div className="p-4 bg-slate-50/30 flex flex-col max-h-[400px]">
                        <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center justify-between shrink-0">
                          <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-blue-500" /> Entregas Feitas</span>
                          <span className="text-xs bg-white border px-2 py-0.5 rounded-full text-slate-500 font-medium">R$ {m.somaFretes.toFixed(2)} fretes + R$ {(m.total - m.somaFretes).toFixed(2)} diárias</span>
                        </h4>
                        {m.pedidosLista.length === 0 ? (
                          <p className="text-xs text-slate-400 italic">Nenhuma entrega neste período.</p>
                        ) : (
                          <div className="space-y-3 overflow-y-auto custom-scrollbar pr-2 pb-2 flex-1">
                            {m.pedidosLista.map((ped: any, idx: number) => (
                              <div key={idx} className="flex justify-between items-start gap-2 text-sm bg-white p-2.5 rounded-lg border border-slate-100 shadow-sm shrink-0">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <span className="font-mono text-[10px] font-bold text-slate-400 bg-slate-100 px-1 rounded">#{ped.id?.slice(-5).toUpperCase() || '---'}</span>
                                    <span className="text-xs text-slate-500 flex items-center gap-1">
                                      <Clock className="h-3 w-3" />
                                      {new Date(ped.orderDateTime || ped.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
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
                            {m.taxa > 0 && m.diasTrabalhados > 0 && (
                              <div className="flex justify-between items-center bg-blue-50/50 p-2.5 rounded-lg border border-blue-100 shrink-0 mt-2">
                                <span className="text-xs font-semibold text-blue-800">Taxa Fixa ({m.diasTrabalhados} dias x R$ {m.taxa.toFixed(2)})</span>
                                <span className="text-xs font-bold text-blue-700">R$ {(m.taxa * m.diasTrabalhados).toFixed(2)}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Coluna 2: Vales e Sangrias */}
                      <div className="p-4 bg-slate-50/30 flex flex-col max-h-[400px]">
                        <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center justify-between shrink-0">
                          <span className="flex items-center gap-1.5"><ReceiptText className="h-4 w-4 text-rose-500" /> Pagamentos e Vales</span>
                          <span className="text-xs bg-rose-50 border-rose-100 border px-2 py-0.5 rounded-full text-rose-600 font-bold">- R$ {m.jaPago.toFixed(2)}</span>
                        </h4>
                        {m.sangriasLista.length === 0 ? (
                          <p className="text-xs text-slate-400 italic">Nenhum vale ou pagamento registrado neste período.</p>
                        ) : (
                          <div className="space-y-3 overflow-y-auto custom-scrollbar pr-2 pb-2 flex-1">
                            {m.sangriasLista.map((val: any, idx: number) => (
                              <div key={idx} className="flex justify-between items-start gap-2 text-sm bg-white p-2.5 rounded-lg border border-slate-100 shadow-sm shrink-0">
                                <div>
                                  <div className="text-xs text-slate-500 flex items-center gap-1 mb-1">
                                    <Clock className="h-3 w-3" />
                                    {val.data?.toDate ? val.data.toDate().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '---'}
                                  </div>
                                  <p className="text-xs text-slate-600 font-medium">{val.titulo || 'Retirada / Vale'}</p>
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
