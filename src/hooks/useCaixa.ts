'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useFirestore, useCollection, useUser, useMemoFirebase } from '@/firebase';
import { collection, query, where, addDoc, updateDoc, setDoc, doc, serverTimestamp, Timestamp, getCountFromServer, writeBatch } from 'firebase/firestore';

export interface Caixa {
  id: string;
  ownerId: string;
  status: 'aberto' | 'fechado';
  sessao: number;
  saldoInicial: number;
  dataAbertura: any;
  dataFechamento?: any;
  usuarioAbertura: string;
  valorEmCaixa?: number;
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
  /** Cancelamento lógico: a venda fica na lista (apontada como cancelada),
   *  mas sai de TODOS os somatórios (totalizadores, gaveta e fechamento). */
  canceled?: boolean;
  canceledAt?: any;
  canceledBy?: string;
  canceledReason?: string;
}

interface UseCaixaOptions {
  /** UID da loja resolvido pelo PdvAccessContext (diferente do ator no operador). */
  ownerId?: string | null;
  /** Evita montar listeners financeiros em telas que não usam o Caixa. */
  enabled?: boolean;
  /** Quem está operando (dono ou funcionário), para carimbar cada lançamento. */
  actorId?: string | null;
  actorName?: string | null;
  caixaSelecionadoId?: string | null;
  onCaixaSelecionadoIdChange?: (id: string | null) => void;
}

export function useCaixa(options?: UseCaixaOptions) {
  const db = useFirestore();
  const { user } = useUser();
  const isRealUser = !!(user && !user.isAnonymous);
  const ownerId = options?.ownerId || (isRealUser ? user!.uid : null);
  const enabled = options?.enabled !== false;
  // Autoria do lançamento: uid p/ consultas confiáveis + nome p/ exibição.
  const actorId = options?.actorId || (isRealUser ? user!.uid : '');
  const actorName = options?.actorName || user?.displayName || user?.email || 'Principal';
  const autoria = { criadoPorUid: actorId, usuario: actorName };
  const controlledCaixaSelecionadoId = options?.caixaSelecionadoId;
  const onCaixaSelecionadoIdChange = options?.onCaixaSelecionadoIdChange;

  // Busca TODOS os caixas do dono
  const caixaQuery = useMemoFirebase(() => {
    if (!enabled || !db || !isRealUser || !ownerId) return null;
    return query(
      collection(db, 'cash_registers'),
      where('ownerId', '==', ownerId)
    );
  }, [db, enabled, isRealUser, ownerId]);

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
  const [internalCaixaSelecionadoId, setInternalCaixaSelecionadoId] = useState<string | null>(null);
  const caixaSelecionadoId = controlledCaixaSelecionadoId !== undefined
    ? controlledCaixaSelecionadoId
    : internalCaixaSelecionadoId;
  const setCaixaSelecionadoId = useCallback((id: string | null) => {
    if (onCaixaSelecionadoIdChange) {
      onCaixaSelecionadoIdChange(id);
      return;
    }
    setInternalCaixaSelecionadoId(id);
  }, [onCaixaSelecionadoIdChange]);

  // O caixa atualmente visualizado
  const caixaAtual = useMemo(() => {
    if (caixaSelecionadoId) {
      return caixasOrdenados.find(c => c.id === caixaSelecionadoId) || caixaAberto;
    }
    return caixaAberto || (caixasOrdenados.length > 0 ? caixasOrdenados[0] : null);
  }, [caixaSelecionadoId, caixaAberto, caixasOrdenados]);

  // Busca os lançamentos do caixa selecionado
  const lancamentosQuery = useMemoFirebase(() => {
    if (!enabled || !db || !isRealUser || !ownerId || !caixaAtual?.id) return null;
    // O filtro de ownerId é exigido pelas regras (leitura restrita ao dono)
    return query(
      collection(db, 'cash_transactions'),
      where('ownerId', '==', ownerId),
      where('caixaId', '==', caixaAtual.id)
    );
  }, [db, enabled, isRealUser, ownerId, caixaAtual?.id]);

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

  // Todas as transações do dono (qualquer caixa/sessão). Usado para calcular
  // saldos que atravessam dias — ex.: quanto ainda se deve a cada motoboy
  // somando o que foi pago em todas as sessões, não só na atual.
  const todasTransacoesQuery = useMemoFirebase(() => {
    if (!enabled || !db || !isRealUser || !ownerId) return null;
    return query(
      collection(db, 'cash_transactions'),
      where('ownerId', '==', ownerId)
    );
  }, [db, enabled, isRealUser, ownerId]);

  const { data: todasTransacoesData } = useCollection(todasTransacoesQuery);
  const todasTransacoes = useMemo(
    () => (todasTransacoesData || []) as LancamentoCaixa[],
    [todasTransacoesData]
  );

  // Calcula o próximo número de sessão
  const proximaSessao = useMemo(() => {
    if (!todosCaixas || todosCaixas.length === 0) return 1;
    const maxSessao = Math.max(...(todosCaixas as Caixa[]).map(c => c.sessao || 0));
    return maxSessao + 1;
  }, [todosCaixas]);

  const abrirCaixa = useCallback(async (saldoInicial: number) => {
    if (!enabled || !db || !isRealUser || !ownerId) throw new Error("Caixa indisponível nesta tela");
    if (caixaAberto) throw new Error("Já existe um caixa aberto. Feche-o primeiro.");

    const sessao = proximaSessao;
    console.log('[useCaixa] Abrindo caixa sessão:', sessao, 'saldo:', saldoInicial);

    const caixaRef = await addDoc(collection(db, 'cash_registers'), {
      ownerId,
      status: 'aberto',
      sessao,
      saldoInicial: Number(saldoInicial),
      dataAbertura: serverTimestamp(),
      usuarioAbertura: user?.displayName || user?.email || 'Principal',
    });

    await addDoc(collection(db, 'cash_transactions'), {
      caixaId: caixaRef.id,
      ownerId,
      tipo: 'abertura',
      titulo: 'Abertura de Caixa',
      valor: Number(saldoInicial), // Positivo
      formaPagamento: '--',
      data: serverTimestamp(),
      ...autoria,
    });

    // Atualiza o perfil da loja para o cardápio de clientes
    await setDoc(doc(db, 'store_profiles', ownerId), { isCaixaAberto: true }, { merge: true });

    setCaixaSelecionadoId(caixaRef.id);
    return caixaRef.id;
  }, [db, enabled, isRealUser, ownerId, actorId, actorName, user, caixaAberto, proximaSessao]);

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
    if (!enabled || !db || !isRealUser || !ownerId || !caixaAberto?.id) return;

    // Calcular totais
    const lancs = lancamentos.filter(l => l.caixaId === caixaAberto.id);
    let totalVendas = 0;
    let totalVendasDinheiro = 0;
    let totalSangrias = 0;
    let totalSuprimentos = 0;
    const saldoIni = caixaAberto.saldoInicial || 0;

    lancs.forEach(l => {
      if (l.canceled) return; // venda cancelada não entra no fechamento
      if (l.tipo === 'venda') {
        totalVendas += l.valor;
        if (l.formaPagamento.toLowerCase().includes('dinheiro')) {
          totalVendasDinheiro += l.valor;
        }
      }
      if (l.tipo === 'sangria') totalSangrias += Math.abs(l.valor);
      if (l.tipo === 'suprimento') totalSuprimentos += l.valor;
    });

    // Todas as gravações do fechamento vão num único batch atômico:
    // ou grava tudo (sangrias + fechamento), ou nada — falha no meio não
    // deixa sangria órfã com caixa aberto, e refazer não duplica.
    const batch = writeBatch(db);

    // Registrar sangria da Taxa do Garçom
    if (params?.taxaGarcom && params.taxaGarcom > 0) {
      batch.set(doc(collection(db, 'cash_transactions')), {
        caixaId: caixaAberto.id,
        ownerId,
        tipo: 'sangria',
        titulo: 'Taxa Garçom / Serviço de Mesa',
        valor: params.taxaGarcom * -1,
        formaPagamento: '--',
        data: serverTimestamp(),
        ...autoria,
      });
    }

    // Registrar sangria para cada Motoboy
    if (params?.detalhesMotoboys) {
      for (const m of params.detalhesMotoboys) {
        const valorPago = m.valorPago ?? m.total;
        if (valorPago > 0) {
          batch.set(doc(collection(db, 'cash_transactions')), {
            caixaId: caixaAberto.id,
            ownerId,
            tipo: 'sangria',
            titulo: `Motoboy: ${m.name} (${m.entregas} entregas)`,
            valor: valorPago * -1,
            formaPagamento: '--',
            data: serverTimestamp(),
            ...autoria,
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
          batch.set(doc(collection(db, 'cash_transactions')), {
            caixaId: caixaAberto.id,
            ownerId,
            tipo: 'sangria',
            titulo: `Freelancer: ${f.name} (${f.tipo})`,
            valor: valorPago * -1,
            formaPagamento: '--',
            data: serverTimestamp(),
            ...autoria,
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
      batch.set(doc(collection(db, 'cash_transactions')), {
        caixaId: caixaAberto.id,
        ownerId,
        tipo: isFalta ? 'sangria' : 'suprimento',
        titulo: isFalta ? `Falta de Caixa: ${params.justificativaFalta || 'Não justificada'}` : 'Sobra de Caixa Identificada',
        valor: params.diferencaCaixa, // Positivo para sobra (suprimento), negativo para falta (sangria)
        formaPagamento: '--',
        data: serverTimestamp(),
        ...autoria,
      });
    }

    // O valor a ser retirado para zerar a gaveta é o valor real apurado (se informado), ou o cálculo padrão.
    const valorParaRetirada = params?.dinheiroApurado !== undefined && params.dinheiroApurado >= 0 
      ? params.dinheiroApurado 
      : valorRetirada;

    // Registrar lançamento de Retirada no Fechamento
    if (valorParaRetirada > 0) {
      batch.set(doc(collection(db, 'cash_transactions')), {
        caixaId: caixaAberto.id,
        ownerId,
        tipo: 'retirada_fechamento',
        titulo: 'Retirada no Fechamento',
        valor: valorParaRetirada * -1,
        formaPagamento: '--',
        data: serverTimestamp(),
        ...autoria,
      });
    }



    batch.update(doc(db, 'cash_registers', caixaAberto.id), {
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
    batch.set(doc(db, 'store_profiles', ownerId), { isCaixaAberto: false }, { merge: true });

    await batch.commit();
  }, [db, enabled, isRealUser, ownerId, actorId, actorName, user, caixaAberto, lancamentos]);

  const registrarLancamento = useCallback(async ({ tipo, titulo, valor, formaPagamento, destinatarioId, destinatarioTipo }: {
    tipo: 'sangria' | 'suprimento' | 'venda',
    titulo: string,
    valor: number,
    formaPagamento: string,
    destinatarioId?: string,
    destinatarioTipo?: 'motoboy' | 'freelancer'
  }) => {
    if (!enabled || !db || !isRealUser || !ownerId || !caixaAberto?.id) {
      throw new Error("Não há caixa aberto no momento.");
    }

    const valorFinal = tipo === 'sangria' ? Number(valor) * -1 : Number(valor);
    
    await addDoc(collection(db, 'cash_transactions'), {
      caixaId: caixaAberto.id,
      ownerId,
      tipo,
      titulo,
      valor: valorFinal,
      formaPagamento,
      data: serverTimestamp(),
      ...autoria,
      ...(destinatarioId && { destinatarioId }),
      ...(destinatarioTipo && { destinatarioTipo }),
    });
  }, [db, enabled, isRealUser, ownerId, actorId, actorName, caixaAberto]);

  // Cancelamento lógico de venda: marca/desmarca canceled no lançamento.
  // Só vendas do caixa ABERTO — mexer em caixa fechado dessincronizaria o
  // totalFechamento já gravado no cash_register.
  const setVendaCancelada = useCallback(async (lancamentoId: string, cancelar: boolean, motivo?: string) => {
    if (!enabled || !db || !isRealUser) throw new Error('Caixa indisponível nesta tela');
    if (!caixaAberto?.id) throw new Error('Só é possível alterar vendas com o caixa aberto.');
    const lanc = lancamentos.find(l => l.id === lancamentoId);
    if (!lanc) throw new Error('Lançamento não encontrado.');
    if (lanc.tipo !== 'venda') throw new Error('Apenas vendas podem ser canceladas.');
    if (lanc.caixaId !== caixaAberto.id) throw new Error('Esta venda pertence a um caixa já fechado.');

    if (cancelar) {
      await updateDoc(doc(db, 'cash_transactions', lancamentoId), {
        canceled: true,
        canceledAt: serverTimestamp(),
        canceledBy: actorName,
        canceledByUid: actorId,
        ...(motivo?.trim() ? { canceledReason: motivo.trim() } : {}),
      });
    } else {
      await updateDoc(doc(db, 'cash_transactions', lancamentoId), { canceled: false });
    }
  }, [db, enabled, isRealUser, actorId, actorName, caixaAberto, lancamentos]);

  return {
    caixaAberto,
    caixaAtual,
    caixasOrdenados,
    lancamentos,
    todasTransacoes,
    loading: loadingCaixas || (!!caixaAtual && loadingLancamentos),
    abrirCaixa,
    fecharCaixa,
    registrarLancamento,
    setVendaCancelada,
    caixaSelecionadoId,
    setCaixaSelecionadoId,
    proximaSessao,
  };
}
