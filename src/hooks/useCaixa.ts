'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useFirestore, useCollection, useUser, useMemoFirebase } from '@/firebase';
import { collection, query, where, addDoc, updateDoc, setDoc, doc, serverTimestamp, Timestamp, getCountFromServer } from 'firebase/firestore';

export interface Caixa {
  id: string;
  ownerId: string;
  status: 'aberto' | 'fechado';
  sessao: number;
  saldoInicial: number;
  dataAbertura: any;
  dataFechamento?: any;
  usuarioAbertura: string;
  totalFechamento?: number;
  fechamentoDetalhes?: {
    taxaGarcom: number;
    motoboys: Array<{
      id?: string;
      name: string;
      entregas: number;
      taxa: number;
      total: number;
      jaPago?: number;
      saldo?: number;
      valorPago?: number;
      saldoRestante?: number;
      incluidoNoFechamento?: boolean;
    }>;
    freelancers: Array<{
      name: string;
      tipo: string;
      diaria: number;
      comissao: number;
      entregas: number;
      total: number;
      jaPago?: number;
      saldo?: number;
      valorPago?: number;
      saldoRestante?: number;
      incluidoNoFechamento?: boolean;
    }>;
    dinheiroApurado: number;
    diferencaCaixa: number;
    justificativaFalta: string;
    totalDeducoes: number;
    valorRetirada: number;
  };
}

export interface LancamentoCaixa {
  id: string;
  caixaId: string;
  ownerId: string;
  tipo: 'venda' | 'sangria' | 'suprimento' | 'abertura' | 'fechamento' | 'retirada_fechamento';
  titulo: string;
  valor: number;
  formaPagamento: string;
  data: any;
  usuario: string;
  destinatarioId?: string;
  destinatarioTipo?: 'motoboy' | 'freelancer';
}

export function useCaixa() {
  const db = useFirestore();
  const { user } = useUser();
  const isRealUser = !!(user && !user.isAnonymous);

  // Busca TODOS os caixas do dono
  const caixaQuery = useMemoFirebase(() => {
    if (!db || !isRealUser) return null;
    return query(
      collection(db, 'cash_registers'),
      where('ownerId', '==', user!.uid)
    );
  }, [db, isRealUser, user?.uid]);

  const { data: todosCaixas, isLoading: loadingCaixas, error: caixaError } = useCollection(caixaQuery);

  useEffect(() => {
    console.log('[useCaixa] todosCaixas:', todosCaixas?.length, 'loading:', loadingCaixas, 'error:', caixaError);
  }, [todosCaixas, loadingCaixas, caixaError]);

  // Lista de todos os caixas ordenados (mais recente primeiro)
  const caixasOrdenados = useMemo(() => {
    if (!todosCaixas || todosCaixas.length === 0) return [];
    return ([...todosCaixas] as Caixa[]).sort((a, b) => {
      const da = a.dataAbertura?.toDate?.() || new Date(0);
      const db2 = b.dataAbertura?.toDate?.() || new Date(0);
      return db2.getTime() - da.getTime();
    });
  }, [todosCaixas]);

  // Pega o caixa aberto (se existir)
  const caixaAberto = useMemo(() => {
    return caixasOrdenados.find(c => c.status === 'aberto') || null;
  }, [caixasOrdenados]);

  // Estado para selecionar qual caixa visualizar (aberto ou histórico)
  const [caixaSelecionadoId, setCaixaSelecionadoId] = useState<string | null>(null);

  // O caixa atualmente visualizado
  const caixaAtual = useMemo(() => {
    if (caixaSelecionadoId) {
      return caixasOrdenados.find(c => c.id === caixaSelecionadoId) || caixaAberto;
    }
    return caixaAberto || (caixasOrdenados.length > 0 ? caixasOrdenados[0] : null);
  }, [caixaSelecionadoId, caixaAberto, caixasOrdenados]);

  // Busca os lançamentos do caixa selecionado
  const lancamentosQuery = useMemoFirebase(() => {
    if (!db || !isRealUser || !caixaAtual?.id) return null;
    return query(
      collection(db, 'cash_transactions'),
      where('caixaId', '==', caixaAtual.id)
    );
  }, [db, isRealUser, caixaAtual?.id]);

  const { data: lancamentosData, isLoading: loadingLancamentos, error: lancError } = useCollection(lancamentosQuery);

  // Ordena lançamentos client-side (mais recente primeiro)
  const lancamentos = useMemo(() => {
    if (!lancamentosData) return [];
    return ([...lancamentosData] as LancamentoCaixa[]).sort((a, b) => {
      const da = a.data?.toDate?.() || new Date(0);
      const db2 = b.data?.toDate?.() || new Date(0);
      return db2.getTime() - da.getTime();
    });
  }, [lancamentosData]);

  // Calcula o próximo número de sessão
  const proximaSessao = useMemo(() => {
    if (!todosCaixas || todosCaixas.length === 0) return 1;
    const maxSessao = Math.max(...(todosCaixas as Caixa[]).map(c => c.sessao || 0));
    return maxSessao + 1;
  }, [todosCaixas]);

  const abrirCaixa = useCallback(async (saldoInicial: number) => {
    if (!db || !isRealUser) throw new Error("Usuário não autenticado");
    if (caixaAberto) throw new Error("Já existe um caixa aberto. Feche-o primeiro.");

    const sessao = proximaSessao;
    console.log('[useCaixa] Abrindo caixa sessão:', sessao, 'saldo:', saldoInicial);

    const caixaRef = await addDoc(collection(db, 'cash_registers'), {
      ownerId: user!.uid,
      status: 'aberto',
      sessao,
      saldoInicial: Number(saldoInicial),
      dataAbertura: serverTimestamp(),
      usuarioAbertura: user?.displayName || user?.email || 'Principal',
    });

    await addDoc(collection(db, 'cash_transactions'), {
      caixaId: caixaRef.id,
      ownerId: user!.uid,
      tipo: 'abertura',
      titulo: 'Abertura de Caixa',
      valor: Number(saldoInicial), // Positivo
      formaPagamento: '--',
      data: serverTimestamp(),
      usuario: user?.displayName || user?.email || 'Principal',
    });

    // Atualiza o perfil da loja para o cardápio de clientes
    await setDoc(doc(db, 'store_profiles', user!.uid), { isCaixaAberto: true }, { merge: true });

    setCaixaSelecionadoId(caixaRef.id);
    return caixaRef.id;
  }, [db, isRealUser, user, caixaAberto, proximaSessao]);

  const fecharCaixa = useCallback(async (params?: { 
    taxaGarcom?: number; 
    detalhesMotoboys?: Array<{
      id?: string;
      name: string;
      entregas: number;
      taxa: number;
      total: number;
      jaPago?: number;
      saldo?: number;
      valorPago?: number;
      saldoRestante?: number;
      incluidoNoFechamento?: boolean;
    }>;
    detalhesFreelancers?: Array<{
      name: string;
      tipo: string;
      diaria: number;
      comissao: number;
      entregas: number;
      total: number;
      jaPago?: number;
      saldo?: number;
      valorPago?: number;
      saldoRestante?: number;
      incluidoNoFechamento?: boolean;
    }>;
    dinheiroApurado?: number;
    diferencaCaixa?: number;
    justificativaFalta?: string;
  }) => {
    if (!db || !isRealUser || !caixaAberto?.id) return;

    // Calcular totais
    const lancs = lancamentos.filter(l => l.caixaId === caixaAberto.id);
    let totalVendas = 0;
    let totalVendasDinheiro = 0;
    let totalSangrias = 0;
    let totalSuprimentos = 0;
    const saldoIni = caixaAberto.saldoInicial || 0;

    lancs.forEach(l => {
      if (l.tipo === 'venda') {
        totalVendas += l.valor;
        if (l.formaPagamento.toLowerCase().includes('dinheiro')) {
          totalVendasDinheiro += l.valor;
        }
      }
      if (l.tipo === 'sangria') totalSangrias += Math.abs(l.valor);
      if (l.tipo === 'suprimento') totalSuprimentos += l.valor;
    });

    // Registrar sangria da Taxa do Garçom
    if (params?.taxaGarcom && params.taxaGarcom > 0) {
      await addDoc(collection(db, 'cash_transactions'), {
        caixaId: caixaAberto.id,
        ownerId: user!.uid,
        tipo: 'sangria',
        titulo: 'Taxa Garçom / Serviço de Mesa',
        valor: params.taxaGarcom * -1,
        formaPagamento: '--',
        data: serverTimestamp(),
        usuario: user?.displayName || user?.email || 'Principal',
      });
    }

    // Registrar sangria para cada Motoboy
    if (params?.detalhesMotoboys) {
      for (const m of params.detalhesMotoboys) {
        const valorPago = m.valorPago ?? m.total;
        if (valorPago > 0) {
          await addDoc(collection(db, 'cash_transactions'), {
            caixaId: caixaAberto.id,
            ownerId: user!.uid,
            tipo: 'sangria',
            titulo: `Motoboy: ${m.name} (${m.entregas} entregas)`,
            valor: valorPago * -1,
            formaPagamento: '--',
            data: serverTimestamp(),
            usuario: user?.displayName || user?.email || 'Principal',
            ...(m.id && { destinatarioId: m.id }),
            destinatarioTipo: 'motoboy',
          });
        }
      }
    }

    // Registrar sangria para cada Freelancer
    if (params?.detalhesFreelancers) {
      for (const f of params.detalhesFreelancers) {
        const valorPago = f.valorPago ?? f.total;
        if (valorPago > 0) {
          await addDoc(collection(db, 'cash_transactions'), {
            caixaId: caixaAberto.id,
            ownerId: user!.uid,
            tipo: 'sangria',
            titulo: `Freelancer: ${f.name} (${f.tipo})`,
            valor: valorPago * -1,
            formaPagamento: '--',
            data: serverTimestamp(),
            usuario: user?.displayName || user?.email || 'Principal',
            destinatarioId: f.name,
            destinatarioTipo: 'freelancer',
          });
        }
      }
    }

    // Recalcular totais com as novas sangrias
    const totalDeducoes = (params?.taxaGarcom || 0) 
      + (params?.detalhesMotoboys?.reduce((s, m) => s + (m.valorPago ?? m.total), 0) || 0) 
      + (params?.detalhesFreelancers?.reduce((s, f) => s + (f.valorPago ?? f.total), 0) || 0);

    // O dinheiro real físico na gaveta é apenas Vendas em Dinheiro, Suprimentos, menos Sangrias e Deduções.
    const dinheiroEmCaixa = saldoIni + totalVendasDinheiro + totalSuprimentos - totalSangrias - totalDeducoes;
    const valorRetirada = dinheiroEmCaixa > 0 ? dinheiroEmCaixa : 0;

    // Lançamentos de Apuração de Caixa (Falta/Sobra)
    if (params?.diferencaCaixa !== undefined && params.diferencaCaixa !== 0) {
      const isFalta = params.diferencaCaixa < 0;
      await addDoc(collection(db, 'cash_transactions'), {
        caixaId: caixaAberto.id,
        ownerId: user!.uid,
        tipo: isFalta ? 'sangria' : 'suprimento',
        titulo: isFalta ? `Falta de Caixa: ${params.justificativaFalta || 'Não justificada'}` : 'Sobra de Caixa Identificada',
        valor: params.diferencaCaixa, // Positivo para sobra (suprimento), negativo para falta (sangria)
        formaPagamento: '--',
        data: serverTimestamp(),
        usuario: user?.displayName || user?.email || 'Principal',
      });
    }

    // O valor a ser retirado para zerar a gaveta é o valor real apurado (se informado), ou o cálculo padrão.
    const valorParaRetirada = params?.dinheiroApurado !== undefined && params.dinheiroApurado >= 0 
      ? params.dinheiroApurado 
      : valorRetirada;

    // Registrar lançamento de Retirada no Fechamento
    if (valorParaRetirada > 0) {
      await addDoc(collection(db, 'cash_transactions'), {
        caixaId: caixaAberto.id,
        ownerId: user!.uid,
        tipo: 'retirada_fechamento',
        titulo: 'Retirada no Fechamento',
        valor: valorParaRetirada * -1,
        formaPagamento: '--',
        data: serverTimestamp(),
        usuario: user?.displayName || user?.email || 'Principal',
      });
    }



    await updateDoc(doc(db, 'cash_registers', caixaAberto.id), {
      status: 'fechado',
      dataFechamento: serverTimestamp(),
      totalFechamento: totalVendas + totalSuprimentos,
      fechamentoDetalhes: {
        taxaGarcom: params?.taxaGarcom || 0,
        motoboys: params?.detalhesMotoboys || [],
        freelancers: params?.detalhesFreelancers || [],
        dinheiroApurado: params?.dinheiroApurado || 0,
        diferencaCaixa: params?.diferencaCaixa || 0,
        justificativaFalta: params?.justificativaFalta || '',
        totalDeducoes,
        valorRetirada: valorParaRetirada,
      },
    });

    // Atualiza o perfil da loja para o cardápio de clientes
    await setDoc(doc(db, 'store_profiles', user!.uid), { isCaixaAberto: false }, { merge: true });
  }, [db, isRealUser, user, caixaAberto, lancamentos]);

  const registrarLancamento = useCallback(async ({ tipo, titulo, valor, formaPagamento, destinatarioId, destinatarioTipo }: {
    tipo: 'sangria' | 'suprimento' | 'venda',
    titulo: string,
    valor: number,
    formaPagamento: string,
    destinatarioId?: string,
    destinatarioTipo?: 'motoboy' | 'freelancer'
  }) => {
    if (!db || !isRealUser || !caixaAberto?.id) {
      throw new Error("Não há caixa aberto no momento.");
    }

    const valorFinal = tipo === 'sangria' ? Number(valor) * -1 : Number(valor);
    
    await addDoc(collection(db, 'cash_transactions'), {
      caixaId: caixaAberto.id,
      ownerId: user!.uid,
      tipo,
      titulo,
      valor: valorFinal,
      formaPagamento,
      data: serverTimestamp(),
      usuario: user?.displayName || user?.email || 'Principal',
      ...(destinatarioId && { destinatarioId }),
      ...(destinatarioTipo && { destinatarioTipo }),
    });
  }, [db, isRealUser, user, caixaAberto]);

  return {
    caixaAberto,
    caixaAtual,
    caixasOrdenados,
    lancamentos,
    loading: loadingCaixas || (!!caixaAtual && loadingLancamentos),
    abrirCaixa,
    fecharCaixa,
    registrarLancamento,
    caixaSelecionadoId,
    setCaixaSelecionadoId,
    proximaSessao,
  };
}
