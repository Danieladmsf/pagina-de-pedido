'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useCaixa, type LancamentoCaixa } from '@/hooks/useCaixa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Plus, Minus, Loader2, Calculator, Search, ChevronLeft, ChevronRight, Lock, Unlock, Trash2, UserPlus, Bike, Printer, BarChart3, Receipt, Eye, History, ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';

const ITEMS_PER_PAGE = 15;

interface FreelancerEntry {
  name: string;
  tipo: 'diaria' | 'comissao' | 'diaria_comissao';
  diaria: number;
  comissao: number;
  entregas: number;
}

interface PaymentSelection {
  include: boolean;
  amount: number;
}

const fechamentoSteps = ['Resumo', 'Pagamentos', 'Apuracao', 'Revisao'];

export function CaixaTab({ storeProfile, orders, autoOpenAbrirCaixa, onModalOpened }: { storeProfile?: any; orders?: any[]; autoOpenAbrirCaixa?: boolean; onModalOpened?: () => void }) {
  const {
    caixaAberto,
    caixaAtual,
    caixasOrdenados,
    lancamentos,
    loading,
    abrirCaixa,
    fecharCaixa,
    registrarLancamento,
    caixaSelecionadoId,
    setCaixaSelecionadoId,
    proximaSessao,
  } = useCaixa();
  const { toast } = useToast();

  // Modal state
  const [modalOpen, setModalOpen] = useState<'abrir' | 'sangria' | 'suprimento' | 'venda' | null>(null);

  useEffect(() => {
    if (autoOpenAbrirCaixa && !caixaAberto) {
      setModalOpen('abrir');
      if (onModalOpened) onModalOpened();
    }
  }, [autoOpenAbrirCaixa, caixaAberto, onModalOpened]);
  const [valorInput, setValorInput] = useState<number>(0);
  const [formaPagamentoInput, setFormaPagamentoInput] = useState('dinheiro');
  const [justificativaInput, setJustificativaInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showFechamentoModal, setShowFechamentoModal] = useState(false);
  const [destinatarioTipoInput, setDestinatarioTipoInput] = useState<'avulso'|'motoboy'|'freelancer'>('avulso');
  const [destinatarioIdInput, setDestinatarioIdInput] = useState<string>('');
  const [freelancers, setFreelancers] = useState<FreelancerEntry[]>([]);
  const [view, setView] = useState<'caixa' | 'anteriores'>('caixa');
  const [printRequested, setPrintRequested] = useState(false);
  const [dinheiroApurado, setDinheiroApurado] = useState<string>('');
  const [justificativaFalta, setJustificativaFalta] = useState<string>('');
  const [fechamentoStep, setFechamentoStep] = useState(0);
  const [motoboyPayments, setMotoboyPayments] = useState<Record<string, PaymentSelection>>({});
  const [freelancerPayments, setFreelancerPayments] = useState<Record<string, PaymentSelection>>({});

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterFormaPagamento, setFilterFormaPagamento] = useState('todas');
  const [filterTipoOperacao, setFilterTipoOperacao] = useState('todos');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);

  // ---- Totalizadores ----
  const totais = useMemo(() => {
    let saldoInicial = 0;
    let totalSangria = 0;
    let totalSuprimento = 0;
    let totalCredito = 0;
    let totalDebito = 0;
    let totalDinheiro = 0;
    let totalPix = 0;

    lancamentos.forEach(lanc => {
      const v = lanc.valor || 0;
      const fp = (lanc.formaPagamento || '').toLowerCase();

      if (lanc.tipo === 'abertura') {
        saldoInicial = v; // já vem negativo
      } else if (lanc.tipo === 'sangria') {
        totalSangria += v; // já vem negativo
      } else if (lanc.tipo === 'suprimento') {
        totalSuprimento += v;
      } else if (lanc.tipo === 'venda') {
        if (fp.includes('credito') || fp.includes('crédito')) totalCredito += v;
        else if (fp.includes('debito') || fp.includes('débito')) totalDebito += v;
        else if (fp.includes('pix')) totalPix += v;
        else if (fp.includes('dinheiro')) totalDinheiro += v;
      }
    });

    const vendasTotal = totalCredito + totalDebito + totalDinheiro + totalPix;
    const valorEmCaixa = Math.abs(saldoInicial) + totalSuprimento + totalDinheiro + totalSangria; // sangria já é negativo

    return { saldoInicial, valorEmCaixa, totalSangria, totalSuprimento, totalCredito, totalDebito, totalDinheiro, totalPix };
  }, [lancamentos]);

  // ---- Filtered + Paginated Lancamentos ----
  const filteredLancamentos = useMemo(() => {
    let result = [...lancamentos];

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(l =>
        l.titulo.toLowerCase().includes(term) ||
        l.usuario.toLowerCase().includes(term) ||
        l.formaPagamento.toLowerCase().includes(term)
      );
    }

    if (filterFormaPagamento !== 'todas') {
      result = result.filter(l => l.formaPagamento.toLowerCase() === filterFormaPagamento);
    }

    if (filterTipoOperacao !== 'todos') {
      result = result.filter(l => l.tipo === filterTipoOperacao);
    }

    return result;
  }, [lancamentos, searchTerm, filterFormaPagamento, filterTipoOperacao]);

  const totalPages = Math.max(1, Math.ceil(filteredLancamentos.length / ITEMS_PER_PAGE));
  const paginatedLancamentos = filteredLancamentos.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const printerSize = storeProfile?.general?.printerSize || storeProfile?.printerSize || '80mm';
  const maxWidth = printerSize === '58mm' ? '58mm' : '80mm';
  const fontSize = printerSize === '58mm' ? '10px' : '12px';

  // ── Estilo térmico compartilhado ──
  const thermalCSS = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Courier New', Courier, monospace; padding: 16px; color: #000; font-size: ${fontSize}; line-height: 1.4; max-width: ${maxWidth}; margin: 0 auto; background: #fff; }
    .header { text-align: center; margin-bottom: 4px; }
    .header h1 { font-size: 14px; font-weight: bold; text-transform: uppercase; }
    .header p { font-size: 11px; }
    .sep { text-align: center; margin: 4px 0; letter-spacing: -1px; }
    .section { margin: 4px 0; }
    .title { font-weight: bold; text-transform: uppercase; margin-bottom: 4px; }
    .row { display: flex; justify-content: space-between; padding: 1px 0; }
    .bold { font-weight: bold; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 2px 0; font-size: 11px; }
    th { border-bottom: 1px solid #000; font-weight: bold; }
    .r { text-align: right; }
    .resumo { margin-top: 4px; }
    .resumo .row { padding: 1px 0; }
    .total-final { font-size: 14px; font-weight: bold; border-top: 1px solid #000; padding-top: 4px; margin-top: 4px; }
    .footer { text-align: center; margin-top: 16px; font-size: 10px; }
    @media print { 
      body { padding: 0; width: ${maxWidth} !important; max-width: ${maxWidth} !important; } 
      @page { size: ${maxWidth} auto !important; margin: 0 !important; } 
    }
  `;

  const openPrintWindow = (title: string, bodyHTML: string) => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) return;

    doc.write(`
      <html>
        <head>
          <title>${title}</title>
          <style>${thermalCSS}</style>
        </head>
        <body>${bodyHTML}</body>
      </html>
    `);
    doc.close();

    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 2000);
    }, 500);
  };

  // ── Comprovante de Abertura ──
  const printComprovanteAbertura = (sessao: number, saldoInicial: number) => {
    const agora = new Date();
    const dataFormatada = agora.toLocaleDateString('pt-BR');
    const horaFormatada = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const storeName = storeProfile?.general?.name || storeProfile?.storeName || 'Loja';
    const sep = '--------------------------------';

    openPrintWindow('Abertura de Caixa', `
      <div class="header">
        <h1>${storeName}</h1>
        <p>ABERTURA DE CAIXA</p>
        <p>Sessão: ${sessao}</p>
        <p>Data: ${dataFormatada} ${horaFormatada}</p>
      </div>
      <p class="sep">${sep}</p>
      <div class="section">
        <div class="row bold"><span>Saldo Inicial</span><span>R$ ${saldoInicial.toFixed(2)}</span></div>
      </div>
      <p class="sep">${sep}</p>
      <div class="section">
        <div class="row"><span>Operador</span><span>${storeProfile?.general?.name || 'Principal'}</span></div>
      </div>
      <div class="footer">
        <p>${sep}</p>
        <p>Documento gerado automaticamente</p>
        <p>${storeName}</p>
      </div>
    `);
  };

  // ── Comprovante de Operação (Sangria / Suprimento / Venda) ──
  const printComprovanteOperacao = (tipo: string, titulo: string, valor: number, formaPagamento: string) => {
    const agora = new Date();
    const dataFormatada = agora.toLocaleDateString('pt-BR');
    const horaFormatada = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const storeName = storeProfile?.general?.name || storeProfile?.storeName || 'Loja';
    const sep = '--------------------------------';

    const tipoLabels: Record<string, string> = {
      sangria: 'SANGRIA DE CAIXA',
      suprimento: 'SUPRIMENTO DE CAIXA',
      venda: 'VENDA MANUAL',
    };

    const isSangria = tipo === 'sangria';

    openPrintWindow(tipoLabels[tipo] || 'Operação', `
      <div class="header">
        <h1>${storeName}</h1>
        <p>${tipoLabels[tipo] || tipo.toUpperCase()}</p>
        <p>Sessão: ${caixaAtual?.sessao || '-'}</p>
        <p>Data: ${dataFormatada} ${horaFormatada}</p>
      </div>
      <p class="sep">${sep}</p>
      <div class="section">
        <div class="row"><span>Descrição</span></div>
        <div class="row bold"><span>${titulo}</span></div>
      </div>
      <p class="sep">${sep}</p>
      <div class="section">
        <div class="row"><span>Forma de Pgto.</span><span>${(formaPagamento === 'conta_casa' ? 'Prazo' : formaPagamento).toUpperCase()}</span></div>
        <div class="row total-final"><span>${isSangria ? '(−) Valor' : 'Valor'}</span><span>R$ ${valor.toFixed(2)}</span></div>
      </div>
      <div class="footer">
        <p>${sep}</p>
        <p>Documento gerado automaticamente</p>
        <p>${storeName}</p>
      </div>
    `);
  };

  // ---- Handlers ----
  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (valorInput <= 0) {
      setErrorMsg('Informe um valor maior que zero.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (modalOpen === 'abrir') {
        await abrirCaixa(valorInput);
        toast({ title: 'Caixa aberto com sucesso!' });
        printComprovanteAbertura(proximaSessao, valorInput);
      } else if (modalOpen === 'sangria' || modalOpen === 'suprimento' || modalOpen === 'venda') {
        let titulo = justificativaInput;
        let destId = undefined;
        let destTipo = undefined;

        if (modalOpen === 'sangria' && destinatarioTipoInput !== 'avulso') {
          destTipo = destinatarioTipoInput;
          destId = destinatarioIdInput;
          const labelTipo = destinatarioTipoInput === 'motoboy' ? 'Motoboy' : 'Freelancer';
          const name = destinatarioTipoInput === 'motoboy' 
            ? storeProfile?.motoboys?.find((m:any) => m.id === destinatarioIdInput)?.name 
            : destinatarioIdInput;
          titulo = justificativaInput || `Adiantamento / Vale para ${labelTipo}: ${name || 'Desconhecido'}`;
        } else {
          titulo = justificativaInput || (
            modalOpen === 'sangria' ? 'Sangria de Caixa' :
            modalOpen === 'suprimento' ? 'Suprimento de Caixa' :
            'Venda Manual'
          );
        }

        await registrarLancamento({
          tipo: modalOpen,
          titulo,
          valor: valorInput,
          formaPagamento: formaPagamentoInput,
          destinatarioId: destId,
          destinatarioTipo: destTipo as any
        });
        toast({ title: `${modalOpen === 'sangria' ? 'Sangria' : modalOpen === 'suprimento' ? 'Suprimento' : 'Venda'} registrado!` });
        printComprovanteOperacao(modalOpen, titulo, valorInput, formaPagamentoInput);
      }
      setModalOpen(null);
      resetForm();
    } catch (err: any) {
      console.error('Erro no Caixa:', err);
      setErrorMsg(err.message || 'Ocorreu um erro.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Pedidos da sessão (entre abertura e fechamento)
  const pedidosDaSessao = useMemo(() => {
    if (!orders || !caixaAtual) return [];
    const abertura = caixaAtual.dataAbertura?.toDate?.() || new Date(0);
    const fechamento = caixaAtual.dataFechamento?.toDate?.() || new Date();
    return orders.filter((o: any) => {
      const dt = new Date(o.orderDateTime);
      return dt >= abertura && (caixaAtual.status === 'fechado' ? dt <= fechamento : true) && o.status !== 'canceled';
    });
  }, [orders, caixaAtual]);

  // Cálculo da taxa do garçom
  const taxaGarcomCalculada = useMemo(() => {
    const fee = Number(storeProfile?.fees?.tableServiceFee || 0);
    const tipo = storeProfile?.fees?.tableServiceFeeType || 'percentage';
    if (fee <= 0) return 0;
    const totalVendasSessao = pedidosDaSessao.reduce((s: number, o: any) => s + (o.totalAmount || 0), 0);
    if (tipo === 'percentage' || tipo === '%') return (totalVendasSessao * fee) / 100;
    return fee * pedidosDaSessao.length; // valor fixo por pedido
  }, [storeProfile, pedidosDaSessao]);

  // Cálculo dos motoboys: Diária fixa + Soma do Frete de cada entrega
  const motoboysSessao = useMemo(() => {
    const motoboys = storeProfile?.motoboys || [];
    const map: Record<string, { id: string; name: string; entregas: number; taxa: number; somaFretes: number; total: number; jaPago: number; saldo: number }> = {};
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

  const totalMotoboys = motoboysSessao.reduce((s, m) => s + m.saldo, 0);

  const addFreelancer = () => {
    setFreelancers(prev => [...prev, { name: '', tipo: 'diaria', diaria: 0, comissao: 0, entregas: 0 }]);
  };

  const removeFreelancer = (idx: number) => {
    setFreelancers(prev => prev.filter((_, i) => i !== idx));
  };

  const updateFreelancer = (idx: number, field: string, value: any) => {
    setFreelancers(prev => prev.map((f, i) => i === idx ? { ...f, [field]: value } : f));
  };

  const getFreelancerTotal = (f: FreelancerEntry) => {
    if (f.tipo === 'diaria') return f.diaria;
    if (f.tipo === 'comissao') return f.comissao * f.entregas;
    return f.diaria + (f.comissao * f.entregas);
  };

  const freelancersComSaldo = useMemo(() => {
    return freelancers.map(f => {
      const total = getFreelancerTotal(f);
      const adiantamentos = lancamentos
        .filter(l => l.tipo === 'sangria' && l.destinatarioTipo === 'freelancer' && l.destinatarioId === f.name)
        .reduce((s, l) => s + Math.abs(l.valor), 0);
      return {
        ...f,
        total,
        jaPago: adiantamentos,
        saldo: Math.max(0, total - adiantamentos)
      };
    });
  }, [freelancers, lancamentos]);

  const totalFreelancersCalc = useMemo(() => {
    return freelancersComSaldo.reduce((s, f) => s + f.saldo, 0);
  }, [freelancersComSaldo]);

  const clampPaymentAmount = (value: number, max: number) => {
    if (!Number.isFinite(value)) return 0;
    return Math.min(Math.max(value, 0), max);
  };

  useEffect(() => {
    if (!showFechamentoModal) return;

    setMotoboyPayments(prev => {
      if (Object.keys(prev).length > 0 || motoboysSessao.length === 0) return prev;
      return Object.fromEntries(
        motoboysSessao.map(m => [m.id, { include: m.saldo > 0, amount: m.saldo }])
      );
    });

    setFreelancerPayments(prev => {
      if (Object.keys(prev).length > 0 || freelancersComSaldo.length === 0) return prev;
      return Object.fromEntries(
        freelancersComSaldo.map((f, index) => [f.name || `freelancer-${index}`, { include: f.saldo > 0, amount: f.saldo }])
      );
    });
  }, [showFechamentoModal, motoboysSessao, freelancersComSaldo]);

  const motoboysFechamento = useMemo(() => {
    return motoboysSessao.map(m => {
      const payment = motoboyPayments[m.id];
      const include = payment?.include ?? m.saldo > 0;
      const amount = payment?.amount ?? m.saldo;
      const valorPago = include ? clampPaymentAmount(amount, m.saldo) : 0;
      return {
        ...m,
        valorPago,
        saldoRestante: Math.max(0, m.saldo - valorPago),
        incluidoNoFechamento: valorPago > 0,
      };
    });
  }, [motoboysSessao, motoboyPayments]);

  const freelancersFechamento = useMemo(() => {
    return freelancersComSaldo.map((f, index) => {
      const paymentKey = f.name || `freelancer-${index}`;
      const payment = freelancerPayments[paymentKey];
      const include = payment?.include ?? f.saldo > 0;
      const amount = payment?.amount ?? f.saldo;
      const valorPago = include ? clampPaymentAmount(amount, f.saldo) : 0;
      return {
        ...f,
        paymentKey,
        valorPago,
        saldoRestante: Math.max(0, f.saldo - valorPago),
        incluidoNoFechamento: valorPago > 0,
      };
    });
  }, [freelancersComSaldo, freelancerPayments]);

  const totalMotoboysFechamento = useMemo(() => {
    return motoboysFechamento.reduce((s, m) => s + m.valorPago, 0);
  }, [motoboysFechamento]);

  const totalFreelancersFechamento = useMemo(() => {
    return freelancersFechamento.reduce((s, f) => s + f.valorPago, 0);
  }, [freelancersFechamento]);

  const valorEsperadoFechamento = totais.valorEmCaixa - taxaGarcomCalculada - totalMotoboysFechamento - totalFreelancersFechamento;

  const diferencaApuracao = dinheiroApurado !== '' ? Number(dinheiroApurado) - valorEsperadoFechamento : 0;
  const apuracaoComFaltaSemJustificativa = dinheiroApurado !== '' && diferencaApuracao < 0 && !justificativaFalta.trim();

  const updateMotoboyPayment = (id: string, saldo: number, next: Partial<PaymentSelection>) => {
    setMotoboyPayments(prev => {
      const current = prev[id] ?? { include: saldo > 0, amount: saldo };
      const include = next.include ?? current.include;
      const amount = next.amount !== undefined
        ? clampPaymentAmount(next.amount, saldo)
        : include
          ? current.amount > 0 ? clampPaymentAmount(current.amount, saldo) : saldo
          : 0;

      return {
        ...prev,
        [id]: { include, amount: include ? amount : 0 },
      };
    });
  };

  const updateFreelancerPayment = (key: string, saldo: number, next: Partial<PaymentSelection>) => {
    setFreelancerPayments(prev => {
      const current = prev[key] ?? { include: saldo > 0, amount: saldo };
      const include = next.include ?? current.include;
      const amount = next.amount !== undefined
        ? clampPaymentAmount(next.amount, saldo)
        : include
          ? current.amount > 0 ? clampPaymentAmount(current.amount, saldo) : saldo
          : 0;

      return {
        ...prev,
        [key]: { include, amount: include ? amount : 0 },
      };
    });
  };

  const handleFecharCaixa = () => {
    // ─── Segurança: bloquear se houver pedidos abertos ───
    const pedidosAbertos = (orders || []).filter((o: any) =>
      !['delivered', 'canceled'].includes(o.status)
    );

    if (pedidosAbertos.length > 0) {
      const tipoMap: Record<string, string> = {
        delivery: 'Delivery',
        pickup: 'Balcão/Retirada',
        dine_in: 'Mesa',
      };
      const resumo = pedidosAbertos.reduce((acc: Record<string, number>, o: any) => {
        const label = tipoMap[o.orderType] || o.orderType || 'Outros';
        acc[label] = (acc[label] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const detalhes = Object.entries(resumo).map(([tipo, qtd]) => `${qtd} ${tipo}`).join(', ');

      toast({
        variant: 'destructive',
        title: '⚠️ Não é possível fechar o caixa',
        description: `Existem ${pedidosAbertos.length} pedido(s) aberto(s): ${detalhes}. Finalize ou cancele todos antes de fechar.`,
        duration: 8000,
      });
      return;
    }

    if (freelancers.length === 0 && storeProfile?.freelancers) {
      const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
      const diaAtual = diasSemana[new Date().getDay()];
      
      const freelancersDoDia = storeProfile.freelancers
        .filter((f: any) => f.active && f.workDays?.includes(diaAtual))
        .map((f: any) => ({
          name: f.name,
          tipo: 'diaria',
          diaria: Number(f.dailyRate) || 0,
          comissao: 0,
          entregas: 0
        }));

      if (freelancersDoDia.length > 0) {
        setFreelancers(freelancersDoDia);
      }
    }
    setMotoboyPayments({});
    setFreelancerPayments({});
    setFechamentoStep(0);
    setDinheiroApurado('');
    setJustificativaFalta('');
    setShowFechamentoModal(true);
  };

  const confirmarFechamento = async () => {
    setIsSubmitting(true);
    try {
      const detalhesMotoboys = motoboysFechamento.map(m => ({
        id: m.id,
        name: m.name,
        entregas: m.entregas,
        taxa: m.taxa,
        total: m.total,
        jaPago: m.jaPago,
        saldo: m.saldo,
        valorPago: m.valorPago,
        saldoRestante: m.saldoRestante,
        incluidoNoFechamento: m.incluidoNoFechamento,
      }));

      const detalhesFreelancers = freelancersFechamento.map(({ paymentKey, ...f }) => f);

      const valorLiquidoCaixaFisico = valorEsperadoFechamento;
      const numApurado = dinheiroApurado !== '' ? Number(dinheiroApurado) : valorLiquidoCaixaFisico;
      const diferencaCaixa = numApurado - valorLiquidoCaixaFisico;

      if (diferencaCaixa < 0 && !justificativaFalta.trim()) {
        toast({ variant: 'destructive', title: 'Erro', description: 'Por favor, informe a justificativa para a falta de caixa.' });
        setIsSubmitting(false);
        return;
      }

      await fecharCaixa({
        taxaGarcom: taxaGarcomCalculada,
        detalhesMotoboys,
        detalhesFreelancers,
        dinheiroApurado: numApurado,
        diferencaCaixa: diferencaCaixa,
        justificativaFalta: justificativaFalta,
      });
      toast({ title: 'Caixa fechado com sucesso!', description: 'Todas as deduções foram registradas.' });
      handlePrint();
      setShowFechamentoModal(false);
      setFreelancers([]);
      setDinheiroApurado('');
      setJustificativaFalta('');
      setMotoboyPayments({});
      setFreelancerPayments({});
      setFechamentoStep(0);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrint = () => {
    const isFechado = caixaAtual?.status === 'fechado';
    const motoboyRows = isFechado
      ? caixaAtual?.fechamentoDetalhes?.motoboys || []
      : motoboysFechamento;
    const freelancerRows = isFechado
      ? caixaAtual?.fechamentoDetalhes?.freelancers || []
      : freelancersFechamento;
    const totalMotoboysImpressao = motoboyRows.reduce((s, m) => s + (m.valorPago ?? m.total), 0);
    const totalFreelancersImpressao = freelancerRows.reduce((s, f) => s + (f.valorPago ?? f.total), 0);
    const totalMotoboys = totalMotoboysImpressao;
    const totalFreelancersCalc = totalFreelancersImpressao;
    const valorLiquido = isFechado
      ? totais.valorEmCaixa
      : valorEsperadoFechamento;
    const agora = new Date();
    const dataFormatada = agora.toLocaleDateString('pt-BR');
    const horaFormatada = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const storeName = storeProfile?.general?.name || storeProfile?.storeName || 'Loja';

    const feeLabel = (storeProfile?.fees?.tableServiceFeeType === 'percentage' || storeProfile?.fees?.tableServiceFeeType === '%')
      ? `${storeProfile?.fees?.tableServiceFee}%`
      : `R$ ${Number(storeProfile?.fees?.tableServiceFee || 0).toFixed(2)}`;

    const sep = '--------------------------------';

    let motoboyBlock = '';
    if (motoboyRows.length > 0) {
      motoboyBlock = `
        <div class="section">
          <p class="title">MOTOBOYS / ENTREGAS</p>
          <table>
            <thead><tr><th>Nome</th><th class="r">Devido</th><th class="r">Pago</th><th class="r">Rest.</th></tr></thead>
            <tbody>
              ${motoboyRows.map(m => {
                const saldoBase = m.saldo ?? m.total;
                const valorPago = m.valorPago ?? m.total;
                const saldoRestante = m.saldoRestante ?? Math.max(0, saldoBase - valorPago);
                return `<tr><td>${m.name}</td><td class="r">R$ ${saldoBase.toFixed(2)}</td><td class="r">R$ ${valorPago.toFixed(2)}</td><td class="r bold">R$ ${saldoRestante.toFixed(2)}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
          <div class="row bold"><span>Pago no fechamento</span><span>R$ ${totalMotoboysImpressao.toFixed(2)}</span></div>
        </div>
        <p class="sep">${sep}</p>
      `;
    }

    let freelancerBlock = '';
    if (freelancerRows.length > 0) {
      freelancerBlock = `
        <div class="section">
          <p class="title">FREELANCERS / EXTRAS</p>
          <table>
            <thead><tr><th>Nome</th><th class="r">Devido</th><th class="r">Pago</th><th class="r">Rest.</th></tr></thead>
            <tbody>
              ${freelancerRows.map(f => {
                const saldoBase = f.saldo ?? f.total;
                const valorPago = f.valorPago ?? f.total;
                const saldoRestante = f.saldoRestante ?? Math.max(0, saldoBase - valorPago);
                return `<tr><td>${f.name}</td><td class="r">R$ ${saldoBase.toFixed(2)}</td><td class="r">R$ ${valorPago.toFixed(2)}</td><td class="r bold">R$ ${saldoRestante.toFixed(2)}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
          <div class="row bold"><span>Pago no fechamento</span><span>R$ ${totalFreelancersImpressao.toFixed(2)}</span></div>
        </div>
        <p class="sep">${sep}</p>
      `;
    }

    openPrintWindow('Fechamento de Caixa', `
      <div class="header">
        <h1>${storeName}</h1>
        <p>FECHAMENTO DE CAIXA</p>
        <p>Sessão: ${caixaAtual?.sessao || '-'}</p>
        <p>Data: ${dataFormatada} ${horaFormatada}</p>
      </div>

      <p class="sep">${sep}</p>

      <div class="section">
        <p class="title">Resumo de Vendas</p>
        <div class="row"><span>Dinheiro</span><span>R$ ${totais.totalDinheiro.toFixed(2)}</span></div>
        <div class="row"><span>Pix</span><span>R$ ${totais.totalPix.toFixed(2)}</span></div>
        <div class="row"><span>Débito</span><span>R$ ${totais.totalDebito.toFixed(2)}</span></div>
        <div class="row"><span>Crédito</span><span>R$ ${totais.totalCredito.toFixed(2)}</span></div>
      </div>

      <p class="sep">${sep}</p>

      <div class="section">
        <div class="row"><span>Saldo Inicial</span><span>R$ ${Math.abs(totais.saldoInicial).toFixed(2)}</span></div>
        <div class="row"><span>Sangrias</span><span>R$ ${Math.abs(totais.totalSangria).toFixed(2)}</span></div>
        <div class="row"><span>Suprimentos</span><span>R$ ${totais.totalSuprimento.toFixed(2)}</span></div>
        <div class="row bold"><span>Valor em Caixa</span><span>R$ ${totais.valorEmCaixa.toFixed(2)}</span></div>
      </div>

      <p class="sep">${sep}</p>

      ${taxaGarcomCalculada > 0 ? `
      <div class="section">
        <p class="title">Taxa Garçom / Serviço</p>
        <div class="row"><span>Taxa: ${feeLabel} · ${pedidosDaSessao.length} ped.</span><span>R$ ${taxaGarcomCalculada.toFixed(2)}</span></div>
      </div>
      <p class="sep">${sep}</p>
      ` : ''}

      ${motoboyBlock}
      ${freelancerBlock}

      <div class="resumo">
        <p class="title">Resumo Final</p>
        <div class="row"><span>Valor em Caixa</span><span>R$ ${totais.valorEmCaixa.toFixed(2)}</span></div>
        ${taxaGarcomCalculada > 0 ? `<div class="row"><span>(−) Taxa Garçom</span><span>R$ ${taxaGarcomCalculada.toFixed(2)}</span></div>` : ''}
        ${totalMotoboys > 0 ? `<div class="row"><span>(−) Motoboys</span><span>R$ ${totalMotoboys.toFixed(2)}</span></div>` : ''}
        ${totalFreelancersCalc > 0 ? `<div class="row"><span>(−) Freelancers</span><span>R$ ${totalFreelancersCalc.toFixed(2)}</span></div>` : ''}
        <div class="row total-final"><span>Valor Esperado</span><span>R$ ${valorLiquido.toFixed(2)}</span></div>
      </div>

      ${isFechado && caixaAtual?.fechamentoDetalhes?.dinheiroApurado !== undefined ? `
      <div class="section" style="margin-top: 8px; border-top: 1px dashed #000; padding-top: 4px;">
        <div class="row"><span>Apurado na Gaveta</span><span>R$ ${caixaAtual.fechamentoDetalhes.dinheiroApurado.toFixed(2)}</span></div>
        ${caixaAtual.fechamentoDetalhes.diferencaCaixa !== 0 ? `
          <div class="row bold"><span>Diferença (${caixaAtual.fechamentoDetalhes.diferencaCaixa > 0 ? 'Sobra' : 'Quebra'})</span><span>R$ ${caixaAtual.fechamentoDetalhes.diferencaCaixa.toFixed(2)}</span></div>
        ` : ''}
      </div>
      ` : (!isFechado && dinheiroApurado !== '' ? `
      <div class="section" style="margin-top: 8px; border-top: 1px dashed #000; padding-top: 4px;">
        <div class="row"><span>Apurado na Gaveta</span><span>R$ ${Number(dinheiroApurado).toFixed(2)}</span></div>
        ${Number(dinheiroApurado) - valorLiquido !== 0 ? `
          <div class="row bold"><span>Diferença (${Number(dinheiroApurado) - valorLiquido > 0 ? 'Sobra' : 'Quebra'})</span><span>R$ ${(Number(dinheiroApurado) - valorLiquido).toFixed(2)}</span></div>
        ` : ''}
      </div>
      ` : '')}

      <div class="footer">
        <p>${sep}</p>
        <p>Documento gerado automaticamente</p>
        <p>${storeName}</p>
      </div>
    `);
  };

  const resetForm = () => {
    setValorInput(0);
    setFormaPagamentoInput('dinheiro');
    setJustificativaInput('');
    setDestinatarioTipoInput('avulso');
    setDestinatarioIdInput('');
    setErrorMsg('');
  };

  const isAberto = caixaAtual?.status === 'aberto';
  const sessaoLabel = caixaAtual
    ? `Caixa sessão: ${caixaAtual.sessao || '?'}`
    : 'Nenhum caixa';

  // Safe print trigger
  useEffect(() => {
    if (printRequested && !loading && caixaAtual) {
      setTimeout(() => {
        handlePrint();
        setPrintRequested(false);
      }, 300);
    }
  }, [printRequested, loading, caixaAtual]);

  if (loading) {
    return <div className="py-20 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="flex flex-col h-full gap-2 min-h-0">


      {view === 'caixa' && (caixaAberto || caixaSelecionadoId) && caixaAtual && (
        <>
          {/* ─── Header: Sessão + Ações ─── */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white px-4 py-2 rounded-xl shadow-sm border shrink-0">
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-lg ${isAberto ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                {isAberto ? <Unlock className="h-4 w-4 text-emerald-600" /> : <Lock className="h-4 w-4 text-slate-500" />}
              </div>
              <div>
                <h2 className="text-base font-bold flex items-center gap-2 leading-tight">
                  {sessaoLabel}
                  <Badge className={`text-[10px] uppercase font-bold ${isAberto ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-slate-100 text-slate-600 border-slate-300'} border`}>
                    {isAberto ? 'ABERTO' : 'FECHADO'}
                  </Badge>
                </h2>
                {caixaAtual && (
                  <p className="text-xs text-muted-foreground leading-tight">
                    Aberto em {caixaAtual.dataAbertura?.toDate ? caixaAtual.dataAbertura.toDate().toLocaleString('pt-BR') : '—'}
                    {caixaAtual.dataFechamento?.toDate && ` · Fechado em ${caixaAtual.dataFechamento.toDate().toLocaleString('pt-BR')}`}
                  </p>
                )}
              </div>
            </div>

            {/* Ações */}
            <div className="flex flex-wrap gap-2 w-full md:w-auto items-center">
              {!caixaAberto && (
                <Button onClick={() => setModalOpen('abrir')} className="bg-orange-500 hover:bg-orange-600 text-white">
                  Abrir Caixa
                </Button>
              )}
              {isAberto && (
                <>

                  <Button onClick={() => setView('anteriores')} variant="outline" className="border-slate-300 text-slate-700 hover:bg-slate-50">
                    Caixas anteriores
                  </Button>
                  <Button onClick={() => setModalOpen('suprimento')} className="bg-emerald-500 hover:bg-emerald-600 text-white">
                    <Plus className="h-4 w-4 mr-1" /> Suprimento
                  </Button>
                  <Button onClick={() => setModalOpen('sangria')} className="bg-rose-500 hover:bg-rose-600 text-white">
                    <Minus className="h-4 w-4 mr-1" /> Sangria
                  </Button>
                  <Button onClick={handleFecharCaixa} variant="outline" className="border-red-300 text-red-600 hover:bg-red-50" disabled={isSubmitting}>
                    <Lock className="h-4 w-4 mr-1" /> Fechar Caixa
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* ─── Filtros ─── */}
          <div className="flex flex-col md:flex-row gap-2 bg-white px-3 py-2 rounded-xl shadow-sm border shrink-0">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Pesquisar por título, usuário..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                className="pl-9 h-8"
              />
            </div>
            <Select value={filterFormaPagamento} onValueChange={(v) => { setFilterFormaPagamento(v); setCurrentPage(1); }}>
              <SelectTrigger className="w-[200px] h-8">
                <SelectValue placeholder="Formas de Pagamento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas Formas de Pagamento</SelectItem>
                <SelectItem value="dinheiro">Dinheiro</SelectItem>
                <SelectItem value="pix">Pix</SelectItem>
                <SelectItem value="debito">Débito</SelectItem>
                <SelectItem value="credito">Crédito</SelectItem>
                <SelectItem value="--">--</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterTipoOperacao} onValueChange={(v) => { setFilterTipoOperacao(v); setCurrentPage(1); }}>
              <SelectTrigger className="w-[200px] h-8">
                <SelectValue placeholder="Tipo de Operação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os Tipos</SelectItem>
                <SelectItem value="venda">Venda</SelectItem>
                <SelectItem value="sangria">Sangria</SelectItem>
                <SelectItem value="suprimento">Suprimento</SelectItem>
                <SelectItem value="abertura">Abertura</SelectItem>
                <SelectItem value="fechamento">Fechamento</SelectItem>
                <SelectItem value="retirada_fechamento">Retirada no Fechamento</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* ─── Cards Totalizadores (8 Cards) ─── */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 shrink-0">
            <SummaryCard label="Saldo Inicial" value={totais.saldoInicial} color="bg-orange-400" />
            <SummaryCard label="Valor em Caixa" value={totais.valorEmCaixa} color="bg-blue-600" border />
            <SummaryCard label="Sangria" value={totais.totalSangria} color="bg-rose-500" />
            <SummaryCard label="Suprimento" value={totais.totalSuprimento} color="bg-emerald-500" />
            <SummaryCard label="Crédito" value={totais.totalCredito} color="bg-violet-500" />
            <SummaryCard label="Debito" value={totais.totalDebito} color="bg-slate-500" />
            <SummaryCard label="Dinheiro" value={totais.totalDinheiro} color="bg-amber-600" />
            <SummaryCard label="Pix" value={totais.totalPix} color="bg-teal-500" />
          </div>

          {/* ─── Tabela de Lançamentos ─── */}
          <Card className="border shadow-md rounded-2xl overflow-hidden flex-1 min-h-0 flex flex-col">
            <CardContent className="p-0 flex-1 overflow-y-auto custom-scrollbar">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead className="pl-6">Data/Hora</TableHead>
                    <TableHead>Título</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Forma de Pagamento</TableHead>
                    <TableHead className="pr-6">Tipo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedLancamentos.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">Nenhum lançamento encontrado.</TableCell>
                    </TableRow>
                  ) : (
                    paginatedLancamentos.map((lanc) => {
                      const isNeg = lanc.valor < 0;
                      const isPos = lanc.valor > 0 && (lanc.tipo === 'venda' || lanc.tipo === 'suprimento');
                      const date = lanc.data?.toDate ? lanc.data.toDate().toLocaleString('pt-BR') : '';

                      const badgeMap: Record<string, string> = {
                        abertura: "bg-orange-100 text-orange-700 border-orange-200",
                        sangria: "bg-rose-100 text-rose-700 border-rose-200",
                        suprimento: "bg-emerald-100 text-emerald-700 border-emerald-200",
                        venda: "bg-blue-100 text-blue-700 border-blue-200",
                        fechamento: "bg-slate-100 text-slate-700 border-slate-300",
                        retirada_fechamento: "bg-purple-100 text-purple-700 border-purple-200",
                      };
                      const badgeColor = badgeMap[lanc.tipo] || "bg-slate-100 text-slate-700";
                      const tipoLabel: Record<string, string> = {
                        abertura: 'Abertura',
                        sangria: 'Sangria',
                        suprimento: 'Suprimento',
                        venda: 'Venda',
                        fechamento: 'Fechamento',
                        retirada_fechamento: 'Retirada no Fechamento',
                      };

                      return (
                        <TableRow key={lanc.id}>
                          <TableCell className="pl-6 text-muted-foreground whitespace-nowrap">{date}</TableCell>
                          <TableCell className="font-semibold text-slate-700">{lanc.titulo}</TableCell>
                          <TableCell className={`font-bold whitespace-nowrap ${isNeg ? 'text-rose-600' : isPos ? 'text-emerald-600' : ''}`}>
                            {isNeg ? '-R$ ' : 'R$ '}{Math.abs(lanc.valor).toFixed(2)}
                          </TableCell>
                          <TableCell className="uppercase text-xs font-bold text-muted-foreground">{lanc.formaPagamento}</TableCell>
                          <TableCell className="pr-6">
                            <Badge className={`${badgeColor} border text-[10px] uppercase font-bold`}>{tipoLabel[lanc.tipo] || lanc.tipo}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* ─── Paginação ─── */}
          <div className="flex items-center justify-between bg-white p-3 rounded-2xl shadow-sm border text-sm text-muted-foreground shrink-0">
            <span>
              Página {currentPage} de {totalPages}, mostrando {filteredLancamentos.length} resultado(s)
            </span>
            <div className="flex gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Tela: Caixa Fechado */}
      {!caixaAberto && view === 'caixa' && !caixaSelecionadoId && (
        <div className="flex justify-center">
          <div className="bg-white border rounded-2xl py-6 px-6 text-center space-y-3 max-w-sm w-full shadow-sm">
            <Calculator className="h-12 w-12 text-muted-foreground/30 mx-auto" />
            <h2 className="text-lg font-bold text-slate-700 uppercase tracking-wider">Caixa Fechado</h2>
            <div className="bg-slate-50 border rounded-xl p-3 text-xs text-muted-foreground space-y-0.5">
              <p>A operação de caixa de um pedido é lançada apenas quando ele é finalizado (Marcado com entregue).</p>
              <p>O caixa será automaticamente aberto após o lançamento do pedido.</p>
              <p className="font-semibold">Não esquecer de fechar o caixa no final do expediente.</p>
            </div>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => setView('anteriores')} variant="outline" size="sm" className="border-slate-300 text-slate-700 font-bold">Caixas Anteriores</Button>
              <Button onClick={() => setModalOpen('abrir')} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 font-bold">Abrir Caixa</Button>
            </div>
          </div>
        </div>
      )}

      {/* Tela: Caixas Anteriores */}
      {view === 'anteriores' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold text-slate-700">Caixas Anteriores</h2>
              <p className="text-sm text-muted-foreground">Histórico de todas as sessões</p>
            </div>
            <Button variant="outline" onClick={() => { setView('caixa'); setCaixaSelecionadoId(null); }}>
              Voltar ao Caixa
            </Button>
          </div>
          <Card className="border shadow-md rounded-2xl overflow-hidden">
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead className="pl-4">Sessão</TableHead>
                    <TableHead>Data Abertura</TableHead>
                    <TableHead>Saldo Inicial</TableHead>
                    <TableHead>Data Fechamento</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Usuário</TableHead>
                    <TableHead className="pr-4 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {caixasOrdenados.filter(c => c.status === 'fechado').length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Nenhum caixa anterior encontrado.</TableCell></TableRow>
                  ) : (
                    caixasOrdenados.filter(c => c.status === 'fechado').map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="pl-4 font-bold">{c.sessao}</TableCell>
                        <TableCell>{c.dataAbertura?.toDate?.().toLocaleString('pt-BR') || '—'}</TableCell>
                        <TableCell className="font-semibold">R$ {Math.abs(c.saldoInicial || 0).toFixed(2)}</TableCell>
                        <TableCell>{c.dataFechamento?.toDate?.().toLocaleString('pt-BR') || '—'}</TableCell>
                        <TableCell><Badge className="bg-slate-100 text-slate-600 border border-slate-300 text-[10px]">FECHADO</Badge></TableCell>
                        <TableCell className="text-muted-foreground">{c.usuarioAbertura || 'Principal'}</TableCell>
                        <TableCell className="pr-4 text-right">
                          <div className="flex gap-1 justify-end">
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-600" onClick={() => { setCaixaSelecionadoId(c.id); setView('caixa'); }}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-600" onClick={() => { setCaixaSelecionadoId(c.id); setView('caixa'); setPrintRequested(true); }}>
                              <Printer className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Modal Genérico ─── */}
      <Dialog open={modalOpen !== null} onOpenChange={(open) => { if (!open) { setModalOpen(null); resetForm(); } }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className={
              modalOpen === 'sangria' ? 'text-rose-600' :
              modalOpen === 'suprimento' ? 'text-emerald-600' :
              modalOpen === 'venda' ? 'text-blue-600' :
              'text-orange-500'
            }>
              {modalOpen === 'abrir' ? `Abertura de Caixa (Sessão ${proximaSessao})` :
               modalOpen === 'sangria' ? 'Nova Sangria' :
               modalOpen === 'suprimento' ? 'Novo Suprimento' :
               'Nova Venda Manual'}
            </DialogTitle>
            <DialogDescription>
              {modalOpen === 'abrir' ? 'Informe o valor em dinheiro na gaveta.' :
               modalOpen === 'sangria' ? 'Registre uma retirada do caixa.' :
               modalOpen === 'suprimento' ? 'Registre uma entrada extra no caixa.' :
               'Registre uma venda manualmente.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAction} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>{modalOpen === 'abrir' ? 'Saldo Inicial na Gaveta (R$)' : 'Valor (R$)'}</Label>
              <CurrencyInput value={valorInput} onChange={setValorInput} placeholder="0,00" required />
            </div>

            {modalOpen !== 'abrir' && (
              <>
                {modalOpen === 'sangria' && (
                  <div className="space-y-2">
                    <Label>Destino da Retirada</Label>
                    <Select value={destinatarioTipoInput} onValueChange={(val: any) => {
                      setDestinatarioTipoInput(val);
                      setDestinatarioIdInput('');
                      setJustificativaInput('');
                      setValorInput(0);
                    }}>
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="avulso">Outros / Despesa Avulsa</SelectItem>
                        <SelectItem value="motoboy">Motoboy</SelectItem>
                        <SelectItem value="freelancer">Freelancer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {modalOpen === 'sangria' && destinatarioTipoInput === 'motoboy' && (
                  <div className="space-y-2">
                    <Label>Selecione o Motoboy</Label>
                    <Select value={destinatarioIdInput} onValueChange={(val) => {
                      setDestinatarioIdInput(val);
                      const m = motoboysSessao.find(mb => mb.id === val);
                      if (m) setValorInput(m.saldo);
                    }}>
                      <SelectTrigger><SelectValue placeholder="Selecione o motoboy" /></SelectTrigger>
                      <SelectContent>
                        {motoboysSessao.map(m => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name} (Saldo: R$ {m.saldo.toFixed(2)})
                          </SelectItem>
                        ))}
                        {motoboysSessao.length === 0 && <SelectItem value="none" disabled>Nenhum motoboy registrado hoje</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {modalOpen === 'sangria' && destinatarioTipoInput === 'freelancer' && (
                  <div className="space-y-2">
                    <Label>Selecione o Freelancer</Label>
                    <Select value={destinatarioIdInput} onValueChange={(val) => {
                      setDestinatarioIdInput(val);
                      const f = freelancersComSaldo.find(fr => fr.name === val);
                      if (f) setValorInput(f.saldo);
                    }}>
                      <SelectTrigger><SelectValue placeholder="Selecione o freelancer" /></SelectTrigger>
                      <SelectContent>
                        {freelancersComSaldo.map(f => (
                          <SelectItem key={f.name} value={f.name}>
                            {f.name} (Saldo: R$ {f.saldo.toFixed(2)})
                          </SelectItem>
                        ))}
                        {freelancersComSaldo.length === 0 && <SelectItem value="none" disabled>Nenhum freelancer registrado hoje</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Forma de Pagamento</Label>
                  <Select value={formaPagamentoInput} onValueChange={setFormaPagamentoInput}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dinheiro">Dinheiro</SelectItem>
                      <SelectItem value="pix">Pix</SelectItem>
                      <SelectItem value="debito">Débito</SelectItem>
                      <SelectItem value="credito">Crédito</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {(modalOpen !== 'sangria' || destinatarioTipoInput === 'avulso') && (
                  <div className="space-y-2">
                    <Label>Título / Motivo</Label>
                    <Input
                      value={justificativaInput}
                      onChange={(e) => setJustificativaInput(e.target.value)}
                      placeholder={
                        modalOpen === 'sangria' ? "Ex: Material de limpeza" :
                        modalOpen === 'suprimento' ? "Ex: Troco inicial" :
                        "Ex: Pedido Nº 123 (PDV)"
                      }
                      required={modalOpen !== 'sangria' || destinatarioTipoInput === 'avulso'}
                    />
                  </div>
                )}
              </>
            )}

            {errorMsg && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{errorMsg}</div>
            )}

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => { setModalOpen(null); resetForm(); }} disabled={isSubmitting}>Cancelar</Button>
              <Button type="submit" disabled={isSubmitting} className={
                modalOpen === 'sangria' ? 'bg-rose-500 hover:bg-rose-600' :
                modalOpen === 'suprimento' ? 'bg-emerald-500 hover:bg-emerald-600' :
                modalOpen === 'venda' ? 'bg-blue-600 hover:bg-blue-700' :
                'bg-orange-500 hover:bg-orange-600'
              }>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── Tela de Fechamento Detalhado ─── */}
      {showFechamentoModal && (
        <section className="fixed inset-0 z-50 overflow-y-auto bg-slate-50">
          <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-4 sm:px-6 sm:py-6">
            <div className="mb-4 rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-1.5 text-left">
                <h2 className="text-xl font-semibold leading-none tracking-tight text-red-600 flex items-center gap-2">
                  <Lock className="h-5 w-5" /> Fechamento de Caixa — Sessão {caixaAtual?.sessao}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Confira os valores antes de confirmar. As deduções serão registradas como sangrias automáticas.
                </p>
              </div>
            </div>

            <div className="flex-1 space-y-4 py-1">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>Etapa {fechamentoStep + 1} de {fechamentoSteps.length}</span>
                <span className="font-semibold text-slate-700">{fechamentoSteps[fechamentoStep]}</span>
              </div>
              <Progress value={((fechamentoStep + 1) / fechamentoSteps.length) * 100} className="h-2" />
              <div className="grid grid-cols-4 gap-2">
                {fechamentoSteps.map((step, index) => (
                  <div
                    key={step}
                    className={`rounded-md border px-2 py-1 text-center text-[11px] font-semibold ${
                      index === fechamentoStep
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : index < fechamentoStep
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-slate-50 text-slate-500'
                    }`}
                  >
                    {step}
                  </div>
                ))}
              </div>
            </div>

            {fechamentoStep === 0 && (
              <div className="space-y-4">
                <div className="bg-slate-50 rounded-lg p-4 border space-y-3">
                  <h3 className="font-bold text-sm text-slate-700 flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" /> Resumo de Vendas
                  </h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-center">
                    <div className="bg-white p-3 rounded-md border">
                      <div className="text-xs text-muted-foreground">Dinheiro</div>
                      <div className="font-bold text-amber-600">R$ {totais.totalDinheiro.toFixed(2)}</div>
                    </div>
                    <div className="bg-white p-3 rounded-md border">
                      <div className="text-xs text-muted-foreground">Pix</div>
                      <div className="font-bold text-teal-600">R$ {totais.totalPix.toFixed(2)}</div>
                    </div>
                    <div className="bg-white p-3 rounded-md border">
                      <div className="text-xs text-muted-foreground">Debito</div>
                      <div className="font-bold text-slate-600">R$ {totais.totalDebito.toFixed(2)}</div>
                    </div>
                    <div className="bg-white p-3 rounded-md border">
                      <div className="text-xs text-muted-foreground">Credito</div>
                      <div className="font-bold text-violet-600">R$ {totais.totalCredito.toFixed(2)}</div>
                    </div>
                  </div>
                  <div className="grid gap-2 border-t pt-3 text-sm sm:grid-cols-3">
                    <div>Saldo Inicial: <strong>R$ {Math.abs(totais.saldoInicial).toFixed(2)}</strong></div>
                    <div>Sangrias: <strong className="text-rose-600">R$ {Math.abs(totais.totalSangria).toFixed(2)}</strong></div>
                    <div>Valor Caixa: <strong className="text-blue-600">R$ {totais.valorEmCaixa.toFixed(2)}</strong></div>
                  </div>
                </div>

                <div className="bg-amber-50 rounded-lg p-4 border border-amber-200 space-y-2">
                  <h3 className="font-bold text-sm text-amber-700 flex items-center gap-2">
                    <Receipt className="h-4 w-4" /> Taxa Garcom / Servico
                  </h3>
                  {taxaGarcomCalculada > 0 ? (
                    <div className="flex justify-between gap-4 text-sm">
                      <span>
                        Taxa: <strong>{storeProfile?.fees?.tableServiceFee}{(storeProfile?.fees?.tableServiceFeeType === 'percentage' || storeProfile?.fees?.tableServiceFeeType === '%') ? '%' : ' R$'}</strong>
                        {' - '}{pedidosDaSessao.length} ped.
                      </span>
                      <span className="font-black text-amber-700">R$ {taxaGarcomCalculada.toFixed(2)}</span>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhuma taxa configurada.</p>
                  )}
                </div>
              </div>
            )}

            {fechamentoStep === 1 && (
              <div className="space-y-4">
                <div className="rounded-lg border bg-slate-50 p-4 text-sm text-slate-700">
                  Marque apenas quem sera pago neste fechamento. O valor pode ser integral ou parcial; o saldo restante fica registrado no fechamento.
                </div>

                <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-bold text-sm text-blue-700 flex items-center gap-2">
                      <Bike className="h-4 w-4" /> Motoboys
                    </h3>
                    <span className="text-sm font-bold text-blue-700">Devido: R$ {totalMotoboys.toFixed(2)}</span>
                  </div>
                  {motoboysFechamento.length > 0 ? (
                    <div className="space-y-3">
                      {motoboysFechamento.map(m => {
                        const payment = motoboyPayments[m.id];
                        const checked = payment?.include ?? m.saldo > 0;
                        return (
                          <div key={m.id} className="rounded-md border bg-white p-3">
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(value) => updateMotoboyPayment(m.id, m.saldo, { include: value === true })}
                                    disabled={m.saldo <= 0}
                                  />
                                  <span className="font-semibold">{m.name}</span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {m.entregas} entregas - Total R$ {m.total.toFixed(2)} - Ja pago R$ {m.jaPago.toFixed(2)}
                                </div>
                              </div>
                              <div className="grid min-w-0 gap-2 sm:grid-cols-[140px_auto_auto] md:min-w-[360px] md:items-end">
                                <div className="space-y-1">
                                  <Label className="text-xs">Pagar agora</Label>
                                  <CurrencyInput
                                    value={payment?.amount ?? m.saldo}
                                    onChange={(value) => updateMotoboyPayment(m.id, m.saldo, { include: value > 0, amount: value })}
                                    disabled={!checked || m.saldo <= 0}
                                  />
                                </div>
                                <Button type="button" variant="outline" size="sm" onClick={() => updateMotoboyPayment(m.id, m.saldo, { include: true, amount: m.saldo })} disabled={m.saldo <= 0}>
                                  Tudo
                                </Button>
                                <Button type="button" variant="ghost" size="sm" onClick={() => updateMotoboyPayment(m.id, m.saldo, { include: false, amount: 0 })} disabled={m.saldo <= 0}>
                                  Adiar
                                </Button>
                              </div>
                            </div>
                            <div className="mt-3 grid gap-2 border-t pt-3 text-xs sm:grid-cols-3">
                              <span>Saldo devido: <strong>R$ {m.saldo.toFixed(2)}</strong></span>
                              <span>Pago agora: <strong className="text-blue-700">R$ {m.valorPago.toFixed(2)}</strong></span>
                              <span>Saldo depois: <strong className={m.saldoRestante > 0 ? 'text-rose-600' : 'text-emerald-600'}>R$ {m.saldoRestante.toFixed(2)}</strong></span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhum motoboy nesta sessao.</p>
                  )}
                </div>

                <div className="space-y-3 rounded-lg border border-purple-200 bg-purple-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-bold text-sm text-purple-700 flex items-center gap-2">
                      <UserPlus className="h-4 w-4" /> Freelancers / Extras
                    </h3>
                    <span className="text-sm font-bold text-purple-700">Devido: R$ {totalFreelancersCalc.toFixed(2)}</span>
                  </div>
                  {freelancersFechamento.length > 0 ? (
                    <div className="space-y-3">
                      {freelancersFechamento.map((f, index) => {
                        const payment = freelancerPayments[f.paymentKey];
                        const checked = payment?.include ?? f.saldo > 0;
                        return (
                          <div key={f.paymentKey} className="rounded-md border bg-white p-3">
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(value) => updateFreelancerPayment(f.paymentKey, f.saldo, { include: value === true })}
                                    disabled={f.saldo <= 0}
                                  />
                                  <span className="font-semibold">{f.name}</span>
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => removeFreelancer(index)}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  Total R$ {f.total.toFixed(2)} - Ja pago R$ {f.jaPago.toFixed(2)}
                                </div>
                              </div>
                              <div className="grid min-w-0 gap-2 sm:grid-cols-[140px_auto_auto] md:min-w-[360px] md:items-end">
                                <div className="space-y-1">
                                  <Label className="text-xs">Pagar agora</Label>
                                  <CurrencyInput
                                    value={payment?.amount ?? f.saldo}
                                    onChange={(value) => updateFreelancerPayment(f.paymentKey, f.saldo, { include: value > 0, amount: value })}
                                    disabled={!checked || f.saldo <= 0}
                                  />
                                </div>
                                <Button type="button" variant="outline" size="sm" onClick={() => updateFreelancerPayment(f.paymentKey, f.saldo, { include: true, amount: f.saldo })} disabled={f.saldo <= 0}>
                                  Tudo
                                </Button>
                                <Button type="button" variant="ghost" size="sm" onClick={() => updateFreelancerPayment(f.paymentKey, f.saldo, { include: false, amount: 0 })} disabled={f.saldo <= 0}>
                                  Adiar
                                </Button>
                              </div>
                            </div>
                            <div className="mt-3 grid gap-2 border-t pt-3 text-xs sm:grid-cols-3">
                              <span>Saldo devido: <strong>R$ {f.saldo.toFixed(2)}</strong></span>
                              <span>Pago agora: <strong className="text-purple-700">R$ {f.valorPago.toFixed(2)}</strong></span>
                              <span>Saldo depois: <strong className={f.saldoRestante > 0 ? 'text-rose-600' : 'text-emerald-600'}>R$ {f.saldoRestante.toFixed(2)}</strong></span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhum freelancer nesta sessao.</p>
                  )}
                </div>
              </div>
            )}

            {fechamentoStep === 2 && (
              <div className="space-y-4">
                <div className="rounded-lg border bg-slate-900 p-4 text-white">
                  <div className="flex justify-between text-sm">
                    <span>Valor em Caixa</span>
                    <strong>R$ {totais.valorEmCaixa.toFixed(2)}</strong>
                  </div>
                  {taxaGarcomCalculada > 0 && (
                    <div className="mt-2 flex justify-between text-sm text-amber-300">
                      <span>(-) Taxa Garcom</span>
                      <span>R$ {taxaGarcomCalculada.toFixed(2)}</span>
                    </div>
                  )}
                  {totalMotoboysFechamento > 0 && (
                    <div className="mt-2 flex justify-between text-sm text-blue-300">
                      <span>(-) Motoboys pagos agora</span>
                      <span>R$ {totalMotoboysFechamento.toFixed(2)}</span>
                    </div>
                  )}
                  {totalFreelancersFechamento > 0 && (
                    <div className="mt-2 flex justify-between text-sm text-purple-300">
                      <span>(-) Freelancers pagos agora</span>
                      <span>R$ {totalFreelancersFechamento.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="mt-3 flex justify-between border-t border-slate-700 pt-3 text-base">
                    <span className="font-bold">Valor Esperado</span>
                    <span className="font-black text-emerald-400">R$ {valorEsperadoFechamento.toFixed(2)}</span>
                  </div>
                </div>

                <div className="bg-white rounded-lg p-4 border space-y-3">
                  <h3 className="font-bold text-sm text-slate-700">Apuracao Fisica da Gaveta</h3>
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground font-bold">Total contado em dinheiro</Label>
                    <CurrencyInput
                      value={dinheiroApurado !== '' ? Number(dinheiroApurado) : undefined}
                      onChange={(val) => setDinheiroApurado(val.toString())}
                      placeholder="R$ 0,00"
                      className="font-bold text-lg h-11 w-full"
                    />
                  </div>

                  {dinheiroApurado !== '' && (
                    <div className="space-y-3">
                      <div className={`p-3 rounded-md border flex items-center justify-between ${
                        diferencaApuracao < 0
                          ? 'bg-rose-50 border-rose-200 text-rose-700'
                          : diferencaApuracao > 0
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : 'bg-blue-50 border-blue-200 text-blue-700'
                      }`}>
                        <div className="font-bold text-sm">
                          {diferencaApuracao === 0 ? 'Caixa bateu' : diferencaApuracao < 0 ? 'Falta de caixa' : 'Sobra de caixa'}
                        </div>
                        {diferencaApuracao !== 0 && (
                          <div className="font-black text-lg">R$ {Math.abs(diferencaApuracao).toFixed(2)}</div>
                        )}
                      </div>

                      {diferencaApuracao < 0 && (
                        <div className="bg-rose-50 p-3 rounded-md border border-rose-200 space-y-2">
                          <Label className="text-rose-700 font-bold text-xs">
                            Motivo / Justificativa da quebra *
                          </Label>
                          <Input
                            placeholder="Descreva por que faltou dinheiro na gaveta..."
                            value={justificativaFalta}
                            onChange={(e) => setJustificativaFalta(e.target.value)}
                            className="bg-white border-rose-300 focus-visible:ring-rose-500"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {fechamentoStep === 3 && (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border bg-slate-50 p-4 space-y-2">
                    <h3 className="font-bold text-sm text-slate-700">Resumo financeiro</h3>
                    <div className="flex justify-between text-sm"><span>Valor em Caixa</span><strong>R$ {totais.valorEmCaixa.toFixed(2)}</strong></div>
                    <div className="flex justify-between text-sm"><span>Taxa Garcom</span><strong>R$ {taxaGarcomCalculada.toFixed(2)}</strong></div>
                    <div className="flex justify-between text-sm"><span>Motoboys pagos agora</span><strong>R$ {totalMotoboysFechamento.toFixed(2)}</strong></div>
                    <div className="flex justify-between text-sm"><span>Freelancers pagos agora</span><strong>R$ {totalFreelancersFechamento.toFixed(2)}</strong></div>
                    <div className="flex justify-between border-t pt-2 text-base"><span className="font-bold">Valor Esperado</span><strong className="text-emerald-700">R$ {valorEsperadoFechamento.toFixed(2)}</strong></div>
                  </div>
                  <div className="rounded-lg border bg-white p-4 space-y-2">
                    <h3 className="font-bold text-sm text-slate-700">Apuracao</h3>
                    <div className="flex justify-between text-sm">
                      <span>Dinheiro contado</span>
                      <strong>R$ {(dinheiroApurado !== '' ? Number(dinheiroApurado) : valorEsperadoFechamento).toFixed(2)}</strong>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Diferenca</span>
                      <strong className={diferencaApuracao < 0 ? 'text-rose-600' : diferencaApuracao > 0 ? 'text-emerald-600' : 'text-slate-700'}>
                        R$ {diferencaApuracao.toFixed(2)}
                      </strong>
                    </div>
                    {diferencaApuracao < 0 && (
                      <div className="border-t pt-2 text-sm">
                        <div className="text-muted-foreground">Justificativa</div>
                        <div className="font-medium">{justificativaFalta || 'Nao informada'}</div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
                    <h3 className="font-bold text-sm text-blue-700">Motoboys</h3>
                    {motoboysFechamento.length > 0 ? motoboysFechamento.map(m => (
                      <div key={m.id} className="rounded-md bg-white p-3 text-sm">
                        <div className="font-semibold">{m.name}</div>
                        <div className="mt-1 grid gap-1 text-xs sm:grid-cols-3">
                          <span>Devido R$ {m.saldo.toFixed(2)}</span>
                          <span>Pago R$ {m.valorPago.toFixed(2)}</span>
                          <span>Restante R$ {m.saldoRestante.toFixed(2)}</span>
                        </div>
                      </div>
                    )) : <p className="text-sm text-muted-foreground">Nenhum motoboy nesta sessao.</p>}
                  </div>
                  <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 space-y-3">
                    <h3 className="font-bold text-sm text-purple-700">Freelancers / Extras</h3>
                    {freelancersFechamento.length > 0 ? freelancersFechamento.map(f => (
                      <div key={f.paymentKey} className="rounded-md bg-white p-3 text-sm">
                        <div className="font-semibold">{f.name}</div>
                        <div className="mt-1 grid gap-1 text-xs sm:grid-cols-3">
                          <span>Devido R$ {f.saldo.toFixed(2)}</span>
                          <span>Pago R$ {f.valorPago.toFixed(2)}</span>
                          <span>Restante R$ {f.saldoRestante.toFixed(2)}</span>
                        </div>
                      </div>
                    )) : <p className="text-sm text-muted-foreground">Nenhum freelancer nesta sessao.</p>}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="hidden space-y-3 py-1" id="print-fechamento-modal">

            {/* Seção 1: Resumo de Vendas */}
            <div className="bg-slate-50 rounded-xl p-3 border space-y-1.5">
              <h3 className="font-bold text-xs text-slate-700 uppercase tracking-wider flex items-center gap-1"><BarChart3 className="h-3.5 w-3.5" /> Resumo de Vendas</h3>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-white p-2 rounded-lg border">
                  <div className="text-[10px] text-muted-foreground">Dinheiro</div>
                  <div className="font-bold text-amber-600 text-sm">R$ {totais.totalDinheiro.toFixed(2)}</div>
                </div>
                <div className="bg-white p-2 rounded-lg border">
                  <div className="text-[10px] text-muted-foreground">Pix</div>
                  <div className="font-bold text-teal-600 text-sm">R$ {totais.totalPix.toFixed(2)}</div>
                </div>
                <div className="bg-white p-2 rounded-lg border">
                  <div className="text-[10px] text-muted-foreground">Débito</div>
                  <div className="font-bold text-slate-600 text-sm">R$ {totais.totalDebito.toFixed(2)}</div>
                </div>
                <div className="bg-white p-2 rounded-lg border">
                  <div className="text-[10px] text-muted-foreground">Crédito</div>
                  <div className="font-bold text-violet-600 text-sm">R$ {totais.totalCredito.toFixed(2)}</div>
                </div>
              </div>
              <div className="flex justify-between text-[11px] pt-1.5 border-t">
                <span>Saldo Inicial: <strong>R$ {Math.abs(totais.saldoInicial).toFixed(2)}</strong></span>
                <span>Sangrias: <strong className="text-rose-600">R$ {Math.abs(totais.totalSangria).toFixed(2)}</strong></span>
                <span>Valor Caixa: <strong className="text-blue-600">R$ {totais.valorEmCaixa.toFixed(2)}</strong></span>
              </div>
            </div>

            {/* Seção 2: Taxa do Garçom */}
            <div className="bg-amber-50 rounded-xl p-3 border border-amber-200 space-y-1">
              <h3 className="font-bold text-[11px] text-amber-700 uppercase tracking-wider flex items-center gap-1"><Receipt className="h-3 w-3" /> Taxa Garçom / Serviço</h3>
              {taxaGarcomCalculada > 0 ? (
                <div className="flex justify-between items-center text-[11px]">
                  <span>
                    Taxa: <strong>{storeProfile?.fees?.tableServiceFee}{(storeProfile?.fees?.tableServiceFeeType === 'percentage' || storeProfile?.fees?.tableServiceFeeType === '%') ? '%' : ' R$'}</strong>
                    {' · '}{pedidosDaSessao.length} ped.
                  </span>
                  <span className="text-sm font-black text-amber-700">R$ {taxaGarcomCalculada.toFixed(2)}</span>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">Nenhuma taxa configurada.</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Seção 3: Motoboys */}
              <div className="bg-blue-50 rounded-xl p-3 border border-blue-200 space-y-1">
                <h3 className="font-bold text-[11px] text-blue-700 uppercase tracking-wider flex items-center gap-1">
                  <Bike className="h-3 w-3" /> Entregas Motoboys
                </h3>
                {motoboysSessao.length > 0 ? (
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-0.5">Motoboy</th>
                        <th className="py-0.5 text-center" title="Entregas">Ent.</th>
                        <th className="py-0.5 text-right">Taxa</th>
                        <th className="py-0.5 text-right">Total</th>
                        <th className="py-0.5 text-right text-rose-500">Vale</th>
                        <th className="py-0.5 text-right font-bold text-emerald-600">Restante</th>
                      </tr>
                    </thead>
                    <tbody>
                      {motoboysSessao.map((m, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-1 font-medium">{m.name}</td>
                          <td className="py-1 text-center">{m.entregas}</td>
                          <td className="py-1 text-right">R$ {m.taxa.toFixed(2)}</td>
                          <td className="py-1 text-right">R$ {m.total.toFixed(2)}</td>
                          <td className="py-1 text-right text-rose-500">{m.jaPago > 0 ? `R$ ${m.jaPago.toFixed(2)}` : '-'}</td>
                          <td className="py-1 text-right font-bold text-emerald-600">R$ {m.saldo.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t font-bold">
                        <td colSpan={5} className="py-1 text-right">Saldo a pagar (Motoboys):</td>
                        <td className="py-1 text-right text-blue-700">R$ {totalMotoboys.toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                ) : (
                  <p className="text-[11px] text-muted-foreground">Nenhum motoboy nesta sessão.</p>
                )}
              </div>

              {/* Seção 4: Freelancers */}
              <div className="bg-purple-50 rounded-xl p-3 border border-purple-200 space-y-2">
                <h3 className="font-bold text-[11px] text-purple-700 uppercase tracking-wider flex items-center gap-1">
                  <UserPlus className="h-3 w-3" /> Freelancers / Extras
                </h3>
                {freelancers.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">Nenhum freelancer nesta sessão.</p>
                ) : (
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-0.5">Nome</th>
                        <th className="py-0.5 text-right">Total</th>
                        <th className="py-0.5 text-right text-rose-500">Vale</th>
                        <th className="py-0.5 text-right font-bold text-emerald-600">Restante</th>
                        <th className="py-0.5 w-6"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {freelancersComSaldo.map((f, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-1 font-medium">{f.name}</td>
                          <td className="py-1 text-right">R$ {f.total.toFixed(2)}</td>
                          <td className="py-1 text-right text-rose-500">{f.jaPago > 0 ? `R$ ${f.jaPago.toFixed(2)}` : '-'}</td>
                          <td className="py-1 text-right font-bold text-emerald-600">R$ {f.saldo.toFixed(2)}</td>
                          <td className="py-1 text-right">
                            <Button size="icon" variant="ghost" className="text-red-500 h-5 w-5" onClick={() => removeFreelancer(i)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t font-bold">
                        <td colSpan={3} className="py-1 text-right">Saldo a pagar (Freelancers):</td>
                        <td colSpan={2} className="py-1 text-right text-purple-700">R$ {totalFreelancersCalc.toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>

            {/* Seção 5: Resumo Final */}
            <div className="bg-slate-900 text-white rounded-xl p-3 space-y-1">
              <h3 className="font-bold text-[11px] uppercase tracking-wider text-slate-300">💰 Resumo Final</h3>
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span>Valor em Caixa</span>
                  <span className="font-bold">R$ {totais.valorEmCaixa.toFixed(2)}</span>
                </div>
                {taxaGarcomCalculada > 0 && (
                  <div className="flex justify-between text-amber-300">
                    <span>(−) Taxa Garçom</span>
                    <span>R$ {taxaGarcomCalculada.toFixed(2)}</span>
                  </div>
                )}
                {totalMotoboys > 0 && (
                  <div className="flex justify-between text-blue-300">
                    <span>(−) Motoboys</span>
                    <span>R$ {totalMotoboys.toFixed(2)}</span>
                  </div>
                )}
                {totalFreelancersCalc > 0 && (
                  <div className="flex justify-between text-purple-300">
                    <span>(−) Freelancers</span>
                    <span>R$ {totalFreelancersCalc.toFixed(2)}</span>
                  </div>
                )}
                <div className="border-t border-slate-600 pt-1 mt-1 flex justify-between text-sm">
                  <span className="font-bold">Valor Esperado</span>
                  <span className="font-black text-emerald-400">
                    R$ {(totais.valorEmCaixa - taxaGarcomCalculada - totalMotoboys - totalFreelancersCalc).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Seção 6: Apuração de Caixa (Novo) */}
            <div className="bg-white rounded-xl p-3 border space-y-3">
              <h3 className="font-bold text-[11px] uppercase tracking-wider text-slate-700">🔍 Apuração Física da Gaveta</h3>
              
              <div className="space-y-2">
                <div className="flex gap-2 items-center">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground font-bold">Total contado em Dinheiro</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <CurrencyInput
                        value={dinheiroApurado !== '' ? Number(dinheiroApurado) : undefined}
                        onChange={(val) => setDinheiroApurado(val.toString())}
                        placeholder="R$ 0,00"
                        className="font-bold text-lg h-10 w-full"
                      />
                    </div>
                  </div>
                </div>

                {dinheiroApurado !== '' && (() => {
                  const valorLiquido = totais.valorEmCaixa - taxaGarcomCalculada - totalMotoboys - totalFreelancersCalc;
                  const diferenca = Number(dinheiroApurado) - valorLiquido;
                  const isFalta = diferenca < 0;
                  const isSobra = diferenca > 0;
                  const isExato = diferenca === 0;

                  return (
                    <div className="space-y-3 mt-3">
                      <div className={`p-3 rounded-lg border flex items-center justify-between ${
                        isFalta ? 'bg-rose-50 border-rose-200 text-rose-700' :
                        isSobra ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                        'bg-blue-50 border-blue-200 text-blue-700'
                      }`}>
                        <div className="font-bold text-sm">
                          {isExato ? '✅ Caixa Bateu perfeitamente' : isFalta ? '⚠️ Falta de Caixa' : '⚠️ Sobra de Caixa'}
                        </div>
                        <div className="font-black text-lg">
                          {isExato ? '' : `R$ ${Math.abs(diferenca).toFixed(2)}`}
                        </div>
                      </div>

                      {isFalta && (
                        <div className="bg-rose-50 p-3 rounded-lg border border-rose-200 space-y-2">
                          <Label className="text-rose-700 font-bold text-xs flex gap-1">
                            Motivo / Justificativa da Quebra <span className="text-rose-500">*</span>
                          </Label>
                          <Input 
                            placeholder="Descreva por que faltou dinheiro na gaveta..."
                            value={justificativaFalta}
                            onChange={(e) => setJustificativaFalta(e.target.value)}
                            className="bg-white border-rose-300 focus-visible:ring-rose-500"
                          />
                          <p className="text-[10px] text-rose-600">
                            A falta de {Math.abs(diferenca).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL'})} será registrada como uma Sangria de Quebra no relatório.
                          </p>
                        </div>
                      )}
                      
                      {isSobra && (
                        <p className="text-[10px] text-emerald-600 px-1">
                          A sobra de {diferenca.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL'})} será registrada como um Suprimento de Sobra no relatório.
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
            
          </div>
            <div className="sticky bottom-0 mt-4 flex flex-col gap-3 border-t bg-slate-50/95 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2 w-full sm:w-auto">
              <Button variant="ghost" onClick={() => setShowFechamentoModal(false)} disabled={isSubmitting}>Cancelar</Button>
              {fechamentoStep > 0 && (
                <Button variant="outline" onClick={() => setFechamentoStep(prev => Math.max(0, prev - 1))} disabled={isSubmitting}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
                </Button>
              )}
            </div>
            <div className="flex gap-2 w-full sm:w-auto sm:justify-end">
              {fechamentoStep === fechamentoSteps.length - 1 ? (
                <>
                  <Button variant="outline" className="border-blue-300 text-blue-600" onClick={handlePrint}>
                    <Printer className="h-4 w-4 mr-1" /> Imprimir prévia
                  </Button>
                  <Button
                    className="bg-red-600 hover:bg-red-700 text-white font-bold"
                    onClick={confirmarFechamento}
                    disabled={isSubmitting || apuracaoComFaltaSemJustificativa}
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
                    Confirmar Fechamento
                  </Button>
                </>
              ) : (
                <Button
                  className="ml-auto"
                  onClick={() => setFechamentoStep(prev => Math.min(fechamentoSteps.length - 1, prev + 1))}
                  disabled={isSubmitting || (fechamentoStep === 2 && apuracaoComFaltaSemJustificativa)}
                >
                  Proximo <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              )}
            </div>
            </div>
          </div>
        </section>
      )}

    </div>
  );
}

// ─── Componente SummaryCard ───
function SummaryCard({ label, value, color, border }: { label: string; value: number; color: string; border?: boolean }) {
  return (
    <div className={`${color} text-white rounded-xl px-3 py-2 flex flex-col justify-center items-center shadow-sm ${border ? 'ring-2 ring-white/50' : ''}`}>
      <span className="text-[10px] uppercase tracking-wider font-bold opacity-90">{label}</span>
      <span className="text-base font-black whitespace-nowrap leading-tight">R$ {value.toFixed(2).replace('-', '- ')}</span>
    </div>
  );
}
