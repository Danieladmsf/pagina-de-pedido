'use client';

import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, setDoc, updateDoc, increment } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, CheckCircle2, User, MapPin, Phone, Printer, Info, CreditCard, Banknote, QrCode, Wallet, Bike, Calculator } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { PrintReceipt } from './PrintReceipt';
import { QuickRegisterClientModal } from './QuickRegisterClientModal';
import { validateCustomerCredit } from '@/lib/customer-credit';

interface DeliveryTabProps {
  orders: any[];
  updateOrderStatus: (orderId: string, statusOrUpdates: string | any) => Promise<boolean | void> | boolean | void;
  registrarLancamento?: (params: { tipo: 'venda'; titulo: string; valor: number; formaPagamento: string }) => Promise<void>;
  caixaAberto?: boolean;
  isCaixaHistorico?: boolean;
  onOpenCaixa?: () => void;
  storeProfile?: any;
  db?: any;
  user?: any;
}

const DEFAULT_FORMAS_PAGAMENTO = [
  { id: 'dinheiro', label: 'Dinheiro', icon: '💵', active: true },
  { id: 'pix', label: 'Pix', icon: '📱', active: true },
  { id: 'debito', label: 'Débito', icon: '💳', active: true },
  { id: 'credito', label: 'Crédito', icon: '💳', active: true },
];

export function DeliveryTab({ orders, updateOrderStatus, registrarLancamento, caixaAberto, isCaixaHistorico = false, onOpenCaixa, storeProfile, db, user }: DeliveryTabProps) {
  const FORMAS_PAGAMENTO = (storeProfile?.paymentMethods && storeProfile.paymentMethods.length > 0 ? storeProfile.paymentMethods : DEFAULT_FORMAS_PAGAMENTO).filter((m: any) => m.active);
  if (!FORMAS_PAGAMENTO.find((m: any) => m.id === 'conta_casa')) {
    FORMAS_PAGAMENTO.push({ id: 'conta_casa', label: 'Prazo', icon: '📝', active: true });
  }
  // Ocultar pedidos de Balcão/Mesas criados manualmente no painel, mostrando apenas pedidos do App
  // Mostrar todos os pedidos de delivery, além de pedidos do App de outros tipos
  const onlyDeliveryAppOrders = orders?.filter(o => {
    if (o.orderType === 'delivery') return true;
    const nameLower = o.customerName?.toLowerCase() || '';
    return !nameLower.includes('balcão') && !nameLower.includes('mesa');
  }) || [];

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(onlyDeliveryAppOrders.length > 0 ? onlyDeliveryAppOrders[0].id : null);
  const [paymentModalOrder, setPaymentModalOrder] = useState<any>(null);
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [paymentSplits, setPaymentSplits] = useState<{methodId: string, label: string, amount: number, received?: number}[]>([]);
  const [selectedPayment, setSelectedPayment] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [orderToPrint, setOrderToPrint] = useState<any>(null);
  const [showMotoboyModal, setShowMotoboyModal] = useState<any>(null);
  const [selectedMotoboyId, setSelectedMotoboyId] = useState<string>('');
  const [valorRecebido, setValorRecebido] = useState<string>('');
  const [quickRegisterModal, setQuickRegisterModal] = useState<{isOpen: boolean, name: string, phone: string, address: string} | null>(null);
  const { toast } = useToast();
  const isReadOnlyHistorico = isCaixaHistorico;
  
  // Clientes Online
  const [onlineCount, setOnlineCount] = useState(0);

  // Rastreia usuários ativos no cardápio
  useEffect(() => {
    if (!db) return;
    
    // Observa sessões ativas da loja
    const q = collection(db, 'active_sessions');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      // Filtra localmente os que deram sinal de vida no último 1 minuto (60000 ms)
      const activeThreshold = Date.now() - 60000;
      let count = 0;
      
      snapshot.forEach(doc => {
        const data = doc.data();
        const matchesStore = !storeProfile?.id || data.storeId === storeProfile.id || data.storeId === 'default' || !data.storeId;
        
        if (data.lastActive && data.lastActive >= activeThreshold && matchesStore) {
          count++;
        }
      });
      setOnlineCount(count);
    });

    return () => unsubscribe();
  }, [db, storeProfile?.id]);

  const filteredOrders = onlyDeliveryAppOrders.filter(o => 
    o.id.includes(searchTerm) || 
    o.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    o.customerPhone?.includes(searchTerm)
  );

  const selectedOrder = onlyDeliveryAppOrders?.find(o => o.id === selectedOrderId);

  // Auto-selecionar o primeiro se a busca mudar e o selecionado atual não estiver na lista
  React.useEffect(() => {
    if (filteredOrders.length > 0 && (!selectedOrderId || !filteredOrders.find(o => o.id === selectedOrderId))) {
      setSelectedOrderId(filteredOrders[0].id);
    }
  }, [filteredOrders, selectedOrderId]);

  const getStatusLabel = (status: string, type?: string) => {
    switch (status) {
      case 'pending': return 'Pendente';
      case 'received': return 'Em preparo';
      case 'ready': return 'Pronto';
      case 'out_for_delivery': 
        if (type === 'pickup') return 'Pronto para Retirada';
        if (type === 'dine_in') return 'Prato disponível!';
        return 'Saiu p/ entrega';
      case 'delivered': return 'Foi entregue';
      case 'canceled': return 'Cancelado';
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500 text-white';
      case 'received': return 'bg-blue-500 text-white';
      case 'ready': return 'bg-green-500 text-white';
      case 'out_for_delivery': return 'bg-purple-500 text-white';
      case 'delivered': return 'bg-teal-500 text-white';
      case 'canceled': return 'bg-red-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  const proceedToPayment = (order: any) => {
    if (isReadOnlyHistorico) {
      toast({ title: 'Sessão histórica', description: 'Abra o caixa atual para alterar ou finalizar pedidos.' });
      return;
    }

    if (order.paymentRegistered) {
      // Se já foi pago no Balcão (paymentRegistered = true), não cobra de novo. Apenas marca como entregue.
      updateOrderStatus(order.id, 'delivered');
      toast({ title: 'Pedido entregue!', description: 'Status atualizado (pagamento já havia sido registrado no balcão).' });
      return;
    }
    setPaymentModalOrder(order);
    setSelectedPayment('');
    setValorRecebido('');
    setPaymentSplits([]);
    setIsSplitMode(false);
  };

  // Ao clicar "Marcar Entregue", abre o modal de pagamento
  const handleMarkDelivered = (order: any) => {
    if (isReadOnlyHistorico) {
      toast({ title: 'Sessão histórica', description: 'Pedidos de caixas anteriores ficam apenas para consulta.' });
      return;
    }

    if (order.status === 'delivered') {
      toast({ title: 'Aviso', description: 'Este pedido já foi finalizado e registrado no caixa.' });
      return;
    }
    
    // Se pular direto para Entregue sem informar motoboy, força a escolha do motoboy primeiro
    if (order.orderType === 'delivery' && !order.motoboyId) {
      setShowMotoboyModal({ 
        order, 
        dispatch: false, 
        onConfirm: () => proceedToPayment(order) 
      });
      return;
    }

    proceedToPayment(order);
  };

  if (!caixaAberto && !isCaixaHistorico) {
    return (
      <div className="flex justify-center">
        <div className="bg-white border rounded-2xl py-6 px-6 text-center space-y-3 max-w-sm w-full shadow-sm">
          <Calculator className="h-12 w-12 text-muted-foreground/30 mx-auto" />
          <h2 className="text-lg font-bold text-slate-700 uppercase tracking-wider">Caixa Fechado</h2>
          <div className="bg-slate-50 border rounded-xl p-3 text-xs text-muted-foreground space-y-0.5">
            <p>A operação de caixa de um pedido é lançada apenas quando ele é finalizado.</p>
            <p>O caixa precisa estar aberto para registrar vendas de delivery.</p>
            <p className="font-semibold text-slate-600">Abra o caixa antes de finalizar pedidos.</p>
          </div>
          <div className="flex gap-3 justify-center">
            <Button
              onClick={() => onOpenCaixa ? onOpenCaixa() : toast({ title: 'Como abrir o caixa:', description: 'Acesse a aba Caixa para abrir o caixa.' })}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 font-bold"
            >
              Abrir Caixa
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Confirmar pagamento + registrar no caixa
  const handleConfirmPayment = async () => {
    if (isSplitMode && paymentSplits.length === 0 && !selectedPayment) return;
    if (!isSplitMode && !selectedPayment) return;
    if (!paymentModalOrder) return;
    
    setIsProcessing(true);
    try {
      let paymentString = '';
      const splitsToProcess = isSplitMode ? [...paymentSplits] : [];
      
      if (!isSplitMode) {
        // Fluxo SIMPLES (1 forma de pagamento)
        let received = undefined;
        let change = 0;
        if (selectedPayment === 'dinheiro' && valorRecebido) {
           const valRec = Number(valorRecebido);
           if (valRec > paymentModalOrder.totalAmount) {
             change = valRec - paymentModalOrder.totalAmount;
           }
        }
        let label = FORMAS_PAGAMENTO.find((f: any) => f.id === selectedPayment)?.label || selectedPayment;
        if (selectedPayment === 'conta_casa') label = 'Prazo';
        paymentString = selectedPayment === 'dinheiro' && change > 0 
           ? `${label} (Troco para R$ ${Number(valorRecebido).toFixed(2)})` 
           : label;
        splitsToProcess.push({ methodId: selectedPayment, label, amount: paymentModalOrder.totalAmount });
      } else {
        // Fluxo MÚLTIPLO (Split)
        if (selectedPayment) {
          const remaining = Math.max(0, paymentModalOrder.totalAmount - splitsToProcess.reduce((sum, s) => sum + s.amount, 0));
          let amount = remaining;
          let received: number | undefined = undefined;
          const valRec = valorRecebido ? Number(valorRecebido) : 0;
          if (selectedPayment === 'dinheiro') {
            if (valRec > 0) {
              if (valRec >= remaining) {
                amount = remaining;
                received = valRec;
              } else {
                amount = valRec;
                received = valRec;
              }
            }
          } else if (valRec > 0) {
            amount = Math.min(valRec, remaining);
          }
          if (amount > 0) {
             let label = FORMAS_PAGAMENTO.find((f: any) => f.id === selectedPayment)?.label || selectedPayment;
             if (selectedPayment === 'conta_casa') label = 'Prazo';
             splitsToProcess.push({ methodId: selectedPayment, label, amount, received });
          }
        }

        paymentString = splitsToProcess.map(s => `${s.label}: R$ ${s.amount.toFixed(2)}`).join(' | ');
        const totalReceived = splitsToProcess.reduce((acc, s) => acc + (s.received || s.amount), 0);
        if (totalReceived > paymentModalOrder.totalAmount) {
           paymentString += ` (Troco para R$ ${totalReceived.toFixed(2)})`;
        }
      }

      const ownerId = storeProfile?.id || paymentModalOrder.ownerId || (user as any)?.uid || 'default';
      const hasContaCasa = splitsToProcess.some(s => s.methodId === 'conta_casa');
      let contaCasaCustomerId: string | null = null;
      if (hasContaCasa) {
        const phone = paymentModalOrder.customerPhone || '';
        const contaCasaAmount = splitsToProcess
          .filter(s => s.methodId === 'conta_casa')
          .reduce((sum, split) => sum + split.amount, 0);

        if (!phone || phone.replace(/\D/g, '').length < 10) {
          setIsProcessing(false);
          setQuickRegisterModal({ isOpen: true, name: paymentModalOrder.customerName || '', phone: '', address: paymentModalOrder.deliveryAddress || '' });
          return;
        }

        const creditCheck = await validateCustomerCredit(db, ownerId, phone, contaCasaAmount);
        if (!creditCheck.allowed) {
          if (creditCheck.reason === 'not_found') {
            setIsProcessing(false);
            setQuickRegisterModal({ isOpen: true, name: paymentModalOrder.customerName || '', phone, address: paymentModalOrder.deliveryAddress || '' });
            return;
          }

          toast({
            variant: 'destructive',
            title: 'Prazo bloqueado',
            description: creditCheck.message || 'Este pedido passa do limite de prazo do cliente.',
          });
          return;
        }
        contaCasaCustomerId = creditCheck.customer?.id || null;
      }

      // 1. Atualizar status do pedido para 'delivered' e salvar paymentMethod composto
      const statusUpdated = await updateOrderStatus(paymentModalOrder.id, { status: 'delivered', paymentMethod: paymentString });
      if (statusUpdated === false) return;
      
      // 2. Registrar venda no caixa (se caixa estiver aberto) ou Conta da Casa
      if (caixaAberto) {
        for (const split of splitsToProcess) {
          if (split.methodId === 'conta_casa') {
             if (contaCasaCustomerId) {
                const cId = contaCasaCustomerId;
                const newTrans = doc(collection(db, 'clientes', cId, 'credit_transactions'));
                await setDoc(newTrans, {
                   id: newTrans.id,
                   type: 'debit',
                   amount: split.amount,
                   date: new Date().toISOString(),
                   description: `Delivery #${paymentModalOrder.id.substring(0,5)}`
                });
                await updateDoc(doc(db, 'clientes', cId), { creditBalance: increment(split.amount) });
             } else {
                toast({ variant: 'destructive', title: 'Aviso', description: 'Conta da Casa: cliente não encontrado para lançar dívida.' });
             }
          } else if (registrarLancamento) {
            await registrarLancamento({
              tipo: 'venda',
              titulo: `Delivery #${paymentModalOrder.id.substring(0, 5)} - ${paymentModalOrder.customerName}`,
              valor: split.amount,
              formaPagamento: split.methodId,
            });
          }
        }
        toast({ title: 'Pedido finalizado!', description: splitsToProcess.length > 1 ? `Venda registrada em ${splitsToProcess.length} partes.` : `Venda registrada (${selectedPayment}).` });
      } else {
        toast({ title: 'Pedido finalizado!', description: caixaAberto === false ? 'Caixa fechado - venda não registrada.' : 'Status atualizado.' });
      }
      setPaymentModalOrder(null);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err.message || 'Falha ao registrar.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddSplit = () => {
    if (!selectedPayment || !paymentModalOrder) return;
    const remaining = Math.max(0, paymentModalOrder.totalAmount - paymentSplits.reduce((sum, s) => sum + s.amount, 0));
    let amount = remaining;
    let received: number | undefined = undefined;
    const valRec = valorRecebido ? Number(valorRecebido) : 0;

    if (selectedPayment === 'dinheiro') {
      if (valRec > 0) {
        if (valRec >= remaining) {
          amount = remaining;
          received = valRec;
        } else {
          amount = valRec;
          received = valRec;
        }
      }
    } else if (valRec > 0) {
      amount = Math.min(valRec, remaining);
    }

    if (amount <= 0) return;

    let label = FORMAS_PAGAMENTO.find((f: any) => f.id === selectedPayment)?.label || selectedPayment;
    if (selectedPayment === 'conta_casa') label = 'Prazo';
    setPaymentSplits(prev => [...prev, { methodId: selectedPayment, label, amount, received }]);
    setSelectedPayment('');
    setValorRecebido('');
  };


  const triggerPrint = (order: any) => {
    setOrderToPrint(order);
    setTimeout(() => {
      window.print();
    }, 500);
  };

  const assignMotoboy = () => {
    if (!showMotoboyModal || !selectedMotoboyId) return;
    
    const updates: any = {};
    let msg = '';
    
    if (selectedMotoboyId === 'retirada') {
      updates.motoboyId = null;
      updates.orderType = 'pickup';
      msg = 'Pedido alterado para Retirada no Local.';
    } else {
      updates.motoboyId = selectedMotoboyId;
      msg = 'O motoboy foi atribuído com sucesso.';
    }

    if (showMotoboyModal.dispatch) {
      updates.status = 'out_for_delivery';
      msg += ' Status alterado para Saiu para Entrega/Retirada.';
    }
    
    updateOrderStatus(showMotoboyModal.order.id, updates);
    const onConfirmCallback = showMotoboyModal.onConfirm;
    
    setShowMotoboyModal(null);
    setSelectedMotoboyId('');
    toast({ title: 'Sucesso', description: msg });

    if (onConfirmCallback) {
      setTimeout(() => onConfirmCallback(), 300);
    }
  };

  return (
    <>
    <div className="flex flex-col md:flex-row gap-4 flex-1 w-full overflow-hidden">
      {/* Coluna Esquerda: Lista de Pedidos */}
      <div className="w-full md:w-1/3 flex flex-col gap-3 bg-muted/30 p-2 rounded-xl border h-full">
        <div className="p-2 bg-white rounded-lg shadow-sm border flex gap-2">
          <Input 
            placeholder="Nº do pedido, celular ou nome" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1"
          />
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
          {filteredOrders.length === 0 ? (
            <div className="text-center p-8 text-muted-foreground">Nenhum pedido encontrado.</div>
          ) : (
            filteredOrders.map(order => (
              <div 
                key={order.id} 
                onClick={() => setSelectedOrderId(order.id)}
                className={`px-2 py-1.5 bg-white border-l-3 rounded-r cursor-pointer hover:bg-slate-50 transition-colors ${selectedOrderId === order.id ? 'ring-1 ring-primary/50 bg-blue-50' : ''} ${order.status === 'pending' ? 'border-l-yellow-500' : order.status === 'canceled' ? 'border-l-red-500' : 'border-l-teal-500'}`}
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">#{order.id.substring(0, 5)}</span>
                    <span className="text-xs font-semibold text-slate-800 truncate">{order.customerName}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs font-black text-green-600">R$ {order.totalAmount?.toFixed(2)}</span>
                    <Badge className={`text-[8px] uppercase font-bold px-1.5 py-0 h-4 leading-none ${getStatusColor(order.status)}`}>
                      {getStatusLabel(order.status, order.orderType)}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-muted-foreground">{order.customerPhone}</span>
                  <span className="text-[10px] text-slate-400">· {new Date(order.orderDateTime).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
              </div>
            ))
          )}
        </div>
        
        <div className="bg-white p-2.5 rounded-lg shadow-sm border flex justify-between items-center font-bold text-base">
          <div className="bg-red-500 text-white px-4 py-2 rounded-md">
            Total: R$ {filteredOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0).toFixed(2)}
          </div>
          <div className="bg-green-500 text-white px-4 py-2 rounded-md flex items-center gap-2">
            {onlineCount} Cliente{onlineCount !== 1 ? 's' : ''} online <Clock className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Coluna Direita: Detalhes do Pedido Selecionado */}
      <div className="w-full md:w-2/3 bg-white rounded-xl shadow-sm border p-4 flex flex-col h-full overflow-y-auto custom-scrollbar">
        {!selectedOrder ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground flex-col gap-2">
            <Info className="h-10 w-10 text-slate-300" />
            <p>Selecione um pedido para ver os detalhes</p>
          </div>
        ) : (
          <>
            {/* Cabeçalho do Pedido */}
            <div className="flex justify-between items-center border-b pb-2 mb-2">
              <div>
                <h2 className="text-base font-bold text-slate-800">
                  Pedido #{selectedOrder.id.substring(0, 5)} <span className="text-muted-foreground font-normal text-xs">({selectedOrder.id})</span>
                </h2>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>CPF: Não informado</span>
                  {selectedOrder.motoboyId && (
                    <span className="font-medium text-amber-600">
                      🏍️ {storeProfile?.motoboys?.find((m:any) => m.id === selectedOrder.motoboyId)?.name || 'Desconhecido'}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-teal-50 text-teal-700 border-teal-200 text-[10px]">{new Date(selectedOrder.orderDateTime).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}</Badge>
                <Button size="icon" className="bg-amber-500 hover:bg-amber-600 text-white h-8 w-8" onClick={() => setShowMotoboyModal({ order: selectedOrder, dispatch: false })} disabled={isReadOnlyHistorico}>
                  <Bike className="h-4 w-4" />
                </Button>
                <Button size="icon" className="bg-blue-500 hover:bg-blue-600 text-white h-8 w-8" onClick={() => triggerPrint(selectedOrder)}>
                  <Printer className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Timeline compacta */}
            <div className="flex items-center gap-1 mb-2 px-1 py-1.5 bg-slate-50 rounded-lg">
              <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-slate-200 -z-10"></div>
              {[
                { key: 'received', label: 'Recebido', active: ['received','ready','out_for_delivery','delivered'].includes(selectedOrder.status), action: () => { 
                  updateOrderStatus(selectedOrder.id, 'received'); 
                  if (storeProfile?.general?.manualPrint || storeProfile?.manualPrint) triggerPrint(selectedOrder); 
                } },
                { key: 'ready', label: 'Preparo', active: ['ready','out_for_delivery','delivered'].includes(selectedOrder.status), action: () => updateOrderStatus(selectedOrder.id, 'ready') },
                { key: 'out', label: selectedOrder.orderType === 'pickup' ? 'Retirada' : selectedOrder.orderType === 'dine_in' ? 'Disponível' : 'Saiu entrega', active: ['out_for_delivery','delivered'].includes(selectedOrder.status), action: () => {
                  if (selectedOrder.orderType === 'delivery' && !selectedOrder.motoboyId) {
                    setShowMotoboyModal({ order: selectedOrder, dispatch: true });
                  } else {
                    updateOrderStatus(selectedOrder.id, 'out_for_delivery');
                  }
                } },
                { key: 'delivered', label: 'Entregue', active: selectedOrder.status === 'delivered', action: () => handleMarkDelivered(selectedOrder) },
              ].map(step => (
                <button 
                  key={step.key} 
                  onClick={step.action} 
                  disabled={isReadOnlyHistorico || selectedOrder.status === 'delivered' || selectedOrder.status === 'canceled'}
                  className={`flex-1 flex items-center justify-center gap-1 py-1 rounded text-[10px] font-bold transition-colors ${step.active ? 'bg-teal-500 text-white' : 'bg-white border text-slate-500 hover:bg-teal-50'} disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  <div className={`h-2.5 w-2.5 rounded-full ${step.active ? 'bg-white' : 'bg-slate-300'}`}></div>
                  {step.label}
                </button>
              ))}
              <button 
                onClick={() => updateOrderStatus(selectedOrder.id, 'canceled')} 
                disabled={isReadOnlyHistorico || selectedOrder.status === 'delivered' || selectedOrder.status === 'canceled'}
                className={`flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-colors ${selectedOrder.status === 'canceled' ? 'bg-red-500 text-white' : 'bg-white border border-red-200 text-red-500 hover:bg-red-50'} disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                ✕
              </button>
            </div>

            {/* Endereço + Resumo Financeiro - Linha compacta */}
            <div className="flex items-center gap-2 mb-2 text-xs">
              <div className="border rounded px-2 py-1 text-red-500 font-medium flex items-center gap-1 flex-1 truncate">
                {selectedOrder.orderType === 'pickup' ? '🏪 Retirar no Local' : selectedOrder.orderType === 'dine_in' ? '🍽️ Comer no Local' : `🛵 ${selectedOrder.deliveryAddress}`}
              </div>
              <div className="bg-[#f05a66] text-white px-3 py-1 rounded font-bold whitespace-nowrap">
                R$ {selectedOrder.totalAmount?.toFixed(2)}
              </div>
              <div className="border px-3 py-1 rounded text-slate-700 font-medium whitespace-nowrap">
                {selectedOrder.paymentMethod === 'conta_casa' ? 'Prazo' : (selectedOrder.paymentMethod || 'Não definido')}
              </div>
              {selectedOrder.orderType === 'delivery' && (
                <div className="border border-teal-200 bg-teal-50 px-3 py-1 rounded text-teal-700 font-bold whitespace-nowrap">
                  🛵 Frete: R$ {selectedOrder.deliveryFee?.toFixed(2) || '0.00'}
                  {selectedOrder.distanceKm && <span className="text-[10px] font-normal ml-1">({selectedOrder.distanceKm}km)</span>}
                </div>
              )}
            </div>

            {/* Tabela de Itens */}
            <div className="flex-1 overflow-y-auto border rounded-lg">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-700 uppercase bg-slate-50 border-b">
                  <tr>
                    <th className="px-4 py-3 w-16">Qtde</th>
                    <th className="px-4 py-3">Título</th>
                    <th className="px-4 py-3">Descrição</th>
                    <th className="px-4 py-3 text-right">Valor unitário</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3">OBS</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedOrder.items?.map((item: any, idx: number) => (
                    <tr key={idx} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="px-4 py-3 text-center">{item.quantity}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{item.name}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {item.addons?.map((a: any) => `1x ${a.name} - R$ ${a.price.toFixed(2)}`).join('\n')}
                      </td>
                      <td className="px-4 py-3 text-right">R$ {item.unitPrice?.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-medium">R$ {(item.unitPrice * item.quantity).toFixed(2)}</td>
                      <td className="px-4 py-3 text-xs text-red-500">{item.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </>
        )}
      </div>
    </div>

    {/* Modal: Forma de Pagamento para Concluir Pedido */}
    <Dialog open={!!paymentModalOrder} onOpenChange={(open) => { if (!open) setPaymentModalOrder(null); }}>
      <DialogContent className="sm:max-w-[380px] p-4">
        {(() => {
          const totalOrder = paymentModalOrder?.totalAmount || 0;
          const totalPaid = paymentSplits.reduce((sum, s) => sum + s.amount, 0);
          const remaining = Math.max(0, totalOrder - totalPaid);
          const isFullyPaid = remaining <= 0;

          return (
            <>
              <DialogHeader className="pb-1 border-b">
                <DialogTitle className="text-sm flex items-center justify-between">
                  <span>💰 Pagamento #{paymentModalOrder?.id?.substring(0, 5)}</span>
                  <div className="flex flex-col items-end">
                    <span className="text-xs text-muted-foreground font-normal">Total: R$ {totalOrder.toFixed(2)}</span>
                    <span className={`text-lg font-black ${remaining > 0 ? 'text-red-500' : 'text-green-600'}`}>
                      {remaining > 0 ? `Falta R$ ${remaining.toFixed(2)}` : 'Pago ✅'}
                    </span>
                  </div>
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {!caixaAberto && <span className="text-red-500 block mb-1">⚠️ Caixa fechado — venda não será registrada nele.</span>}
                </DialogDescription>
              </DialogHeader>

              {!isSplitMode ? (
                <>
                  <div className="grid grid-cols-4 gap-2 py-2">
                    {FORMAS_PAGAMENTO.map((fp: any) => (
                        <button
                          key={fp.id}
                          type="button"
                          onClick={() => { setSelectedPayment(fp.id); setValorRecebido(''); }}
                          className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 font-bold text-xs transition-all ${
                            selectedPayment === fp.id 
                              ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary/30' 
                              : 'border-muted text-muted-foreground hover:border-slate-300'
                          }`}
                        >
                          <span className="text-lg">{fp.icon}</span>
                          {fp.label}
                        </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => { setIsSplitMode(true); setSelectedPayment(''); setValorRecebido(''); }}
                      className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 font-bold text-xs transition-all border-muted text-muted-foreground hover:border-slate-300`}
                    >
                      <span className="text-lg">🔀</span>
                      Múltiplos
                    </button>
                  </div>

                  {selectedPayment === 'dinheiro' && (
                    <div className="bg-amber-50 p-2 rounded-lg border border-amber-200 space-y-1.5">
                      <label className="text-xs font-medium text-amber-800">💵 Valor recebido (R$)</label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        placeholder="R$ 0,00"
                        value={valorRecebido ? `R$ ${valorRecebido.replace('.', ',')}` : ''}
                        onChange={(e) => {
                          let val = e.target.value.replace(/\D/g, '');
                          if (!val) setValorRecebido('');
                          else setValorRecebido((Number(val) / 100).toFixed(2));
                        }}
                        className="text-sm font-bold text-center bg-white h-9"
                        autoFocus
                      />
                      {Number(valorRecebido) > 0 && (
                        <div className={`text-center p-1.5 rounded font-bold text-sm ${Number(valorRecebido) >= totalOrder ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                          {Number(valorRecebido) >= totalOrder 
                            ? `Troco: R$ ${(Number(valorRecebido) - totalOrder).toFixed(2)}`
                            : `Falta: R$ ${(totalOrder - Number(valorRecebido)).toFixed(2)}`
                          }
                        </div>
                      )}
                    </div>
                  )}

                  <DialogFooter className="pt-2 gap-2 border-t mt-2">
                    <Button variant="outline" size="sm" onClick={() => setPaymentModalOrder(null)}>Cancelar</Button>
                    <Button 
                      size="sm"
                      disabled={!selectedPayment || isProcessing} 
                      onClick={handleConfirmPayment}
                      className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white"
                    >
                      {isProcessing ? '...' : '✅ Confirmar Pedido'}
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <button 
                    onClick={() => setIsSplitMode(false)}
                    className="text-xs text-blue-600 hover:underline mb-2 flex items-center gap-1"
                  >
                    ← Voltar ao Pagamento Simples
                  </button>

                  {paymentSplits.length > 0 && (
                    <div className="py-2 space-y-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Pagamentos Adicionados:</span>
                      {paymentSplits.map((split, idx) => (
                        <div key={idx} className="flex justify-between items-center bg-slate-50 border p-1.5 rounded text-xs">
                          <span className="font-medium text-slate-700 flex items-center gap-1">
                            {split.label}
                            {split.received && split.received > split.amount && <span className="text-[9px] text-muted-foreground">(Recebeu R$ {split.received.toFixed(2)})</span>}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-green-600">R$ {split.amount.toFixed(2)}</span>
                            <button onClick={() => setPaymentSplits(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600">✕</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {!isFullyPaid && (
                    <>
                      <div className="grid grid-cols-4 gap-2 py-2">
                        {FORMAS_PAGAMENTO.map((fp: any) => (
                            <button
                              key={fp.id}
                              type="button"
                              onClick={() => { setSelectedPayment(fp.id); setValorRecebido(''); }}
                              className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 font-bold text-xs transition-all ${
                                selectedPayment === fp.id 
                                  ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary/30' 
                                  : 'border-muted text-muted-foreground hover:border-slate-300'
                              }`}
                            >
                              <span className="text-lg">{fp.icon}</span>
                              {fp.label}
                            </button>
                        ))}
                      </div>

                      {selectedPayment && (
                        <div className="bg-blue-50 p-2 rounded-lg border border-blue-200 space-y-1.5">
                          <label className="text-xs font-medium text-blue-800">Valor a ser pago em {selectedPayment === 'conta_casa' ? 'Prazo' : FORMAS_PAGAMENTO.find((f: any)=>f.id===selectedPayment)?.label || selectedPayment} (R$)</label>
                          <div className="flex gap-2">
                            <Input
                              type="text"
                              inputMode="numeric"
                              placeholder={`R$ ${remaining.toFixed(2).replace('.', ',')}`}
                              value={valorRecebido ? `R$ ${valorRecebido.replace('.', ',')}` : ''}
                              onChange={(e) => {
                                let val = e.target.value.replace(/\D/g, '');
                                if (!val) setValorRecebido('');
                                else setValorRecebido((Number(val) / 100).toFixed(2));
                              }}
                              className="text-sm font-bold text-center bg-white h-9"
                              autoFocus
                            />
                            <Button onClick={handleAddSplit} className="h-9 whitespace-nowrap bg-blue-600 hover:bg-blue-700 text-white" size="sm">
                              Adicionar
                            </Button>
                          </div>
                          {selectedPayment === 'dinheiro' && Number(valorRecebido) > remaining && (
                            <div className="text-center p-1 font-bold text-xs bg-amber-100 text-amber-700 rounded">
                              Troco: R$ {(Number(valorRecebido) - remaining).toFixed(2)}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  <DialogFooter className="pt-2 gap-2 border-t mt-2">
                    <Button variant="outline" size="sm" onClick={() => setPaymentModalOrder(null)}>Cancelar</Button>
                    <Button 
                      size="sm"
                      disabled={(paymentSplits.length === 0 && !selectedPayment) || isProcessing || (!isFullyPaid && !selectedPayment)} 
                      onClick={handleConfirmPayment}
                      className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white"
                    >
                      {isProcessing ? '...' : '✅ Confirmar Pedido'}
                    </Button>
                  </DialogFooter>
                </>
              )}
            </>
          );
        })()}
      </DialogContent>
    </Dialog>

      {/* Modal Vincular Entregador */}
      <Dialog open={!!showMotoboyModal} onOpenChange={(open) => !open && setShowMotoboyModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Informe o Entregador</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <Select value={selectedMotoboyId} onValueChange={setSelectedMotoboyId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um motoboy ou Retirada..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="retirada" className="text-amber-600 font-bold">Retirou no local</SelectItem>
                {storeProfile?.motoboys?.map((m: any) => (
                  <SelectItem key={m.id} value={m.id}>{m.name} (R$ {Number(m.fee || 0).toFixed(2)})</SelectItem>
                ))}
                {(!storeProfile?.motoboys || storeProfile.motoboys.length === 0) && (
                  <SelectItem value="none" disabled>Nenhum motoboy cadastrado</SelectItem>
                )}
              </SelectContent>
            </Select>
            {showMotoboyModal?.dispatch && (
              <p className="text-xs text-muted-foreground bg-slate-50 p-2 rounded border border-slate-100">
                O pedido será marcado como <strong>{selectedMotoboyId === 'retirada' ? 'Retirada no Local' : 'Saiu para Entrega'}</strong> após confirmar.
              </p>
            )}
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setShowMotoboyModal(null)}>Cancelar</Button>
            <Button variant="default" className="bg-teal-500 hover:bg-teal-600" onClick={assignMotoboy} disabled={!selectedMotoboyId || selectedMotoboyId === 'none'}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Componente Invisível de Impressão */}
      {orderToPrint && (
        <PrintReceipt order={orderToPrint} storeInfo={storeProfile} />
      )}
      {quickRegisterModal && (
        <QuickRegisterClientModal
          isOpen={quickRegisterModal.isOpen}
          onClose={() => setQuickRegisterModal(null)}
          onSuccess={() => {
            setQuickRegisterModal(null);
            handleConfirmPayment();
          }}
          db={db}
          ownerId={storeProfile?.id || (user as any)?.uid || 'default'}
          initialName={quickRegisterModal.name}
          initialPhone={quickRegisterModal.phone}
          initialAddress={quickRegisterModal.address}
        />
      )}
    </>
  );
}
