/**
 * Cancelar (e reativar) uma venda POR COMPLETO.
 *
 * O X da aba Caixa e o ✕ da aba Delivery passam por aqui, para o efeito ser o
 * mesmo nos dois lugares:
 *   1. os lançamentos do caixa do pedido saem dos somatórios (`canceled: true`);
 *   2. a dívida do Prazo do pedido é estornada;
 *   3. o pedido vira `canceled` pelo fluxo padrão do PDV (devolve estoque e avisa
 *      o cliente no WhatsApp — isso continua em `updateOrderStatus`).
 * A reativação é o espelho: o lançamento volta a somar, a dívida volta e o
 * pedido volta a finalizado.
 *
 * Vínculo SÓ por id: o caixa e o Prazo se ligam ao pedido pelo `orderId`
 * gravado. Compra antiga sem `orderId` NÃO é procurada pelo texto da descrição
 * (ver CLAUDE.md, "Integridade de dados"): o operador é avisado e confere o
 * extrato do cliente.
 *
 * A parte pura (quais compras estornar/voltar) não conhece o Firestore e está
 * coberta por testes; o resto só lê, monta o lote e grava.
 */

import {
  collection, doc, getDoc, getDocs, increment, query, where, writeBatch,
  serverTimestamp, type Firestore,
} from 'firebase/firestore';
import { emDinheiro, somaDinheiro } from '@/lib/dinheiro';
import { anulacoesDoExtrato, type CreditTransaction } from '@/lib/prazo-statement';
import type { LancamentoCaixa } from '@/hooks/useCaixa';
import { brl } from '@/lib/utils';

export const ORIGEM_CANCELAMENTO_VENDA = 'cancelamento_venda';

/* ───────────────────────── Parte pura ───────────────────────── */

/** Compras (débitos originais) do pedido: sem estorno e ligadas pelo `orderId`. */
function debitosDoPedido(extrato: CreditTransaction[], orderId: string): CreditTransaction[] {
  if (!orderId) return [];
  return extrato.filter((tx) => tx.type === 'debit' && !tx.reversalOf && tx.orderId === orderId);
}

/**
 * Cancelar: as compras do pedido que hoje estão valendo (nenhum estorno as
 * anula). Compra já estornada à mão fica de fora — estornar de novo daria
 * crédito indevido ao cliente.
 */
export function debitosParaEstornar(extrato: CreditTransaction[], orderId: string): CreditTransaction[] {
  const { anulados } = anulacoesDoExtrato(extrato);
  return debitosDoPedido(extrato, orderId).filter((tx) => !anulados.has(tx.id));
}

export type DebitoParaReativar = {
  debito: CreditTransaction;
  /** O estorno ativo que anula a compra (feito por este botão ou à mão). */
  estorno: CreditTransaction;
};

/**
 * Reativar: as compras do pedido hoje anuladas, cada uma com o estorno que a
 * anula. A dívida volta com um "estorno do estorno" apontando para ele.
 */
export function debitosParaReativar(extrato: CreditTransaction[], orderId: string): DebitoParaReativar[] {
  const { anuladoPor } = anulacoesDoExtrato(extrato);
  const porId = new Map(extrato.map((tx) => [tx.id, tx]));
  const lista: DebitoParaReativar[] = [];
  for (const debito of debitosDoPedido(extrato, orderId)) {
    const estorno = porId.get(anuladoPor.get(debito.id) ?? '');
    if (estorno) lista.push({ debito, estorno });
  }
  return lista;
}

/** Documento do estorno, igual ao da tela do Prazo, mais o pedido e a origem. */
export function montarEstorno(debito: CreditTransaction, orderId: string, id: string, agora: Date = new Date()): CreditTransaction {
  return {
    id,
    type: 'credit',
    amount: emDinheiro(debito.amount),
    date: agora.toISOString(),
    description: `Estorno - ${debito.description || 'Compra'}`,
    channel: 'estorno',
    reversalOf: debito.id,
    orderId,
    origem: ORIGEM_CANCELAMENTO_VENDA,
  };
}

/** Documento que faz a compra voltar: estorno do estorno (tipo `debit`). */
export function montarReativacao(
  { debito, estorno }: DebitoParaReativar, orderId: string, id: string, agora: Date = new Date(),
): CreditTransaction {
  return {
    id,
    type: 'debit',
    amount: emDinheiro(estorno.amount),
    date: agora.toISOString(),
    description: `Estorno - ${estorno.description || debito.description || 'Compra'}`,
    channel: 'estorno',
    reversalOf: estorno.id,
    orderId,
    origem: ORIGEM_CANCELAMENTO_VENDA,
  };
}

export const MSG_CAIXA_FECHADO = 'Esta venda é de um caixa já fechado e não pode mais ser cancelada';
export const MSG_CAIXA_FECHADO_REATIVAR = 'Esta venda é de um caixa já fechado e não pode mais ser reativada';

/**
 * Caixa fechado é imutável (mexer nele dessincroniza o total gravado no
 * fechamento). Devolve a mensagem de bloqueio, ou null se pode seguir.
 */
export function bloqueioDeCaixa(
  lancamentosAfetados: Array<Pick<LancamentoCaixa, 'caixaId'>>,
  caixaAbertoId: string | null | undefined,
  acao: 'cancelar' | 'reativar' = 'cancelar',
): string | null {
  if (lancamentosAfetados.length === 0) return null;
  const todosNoAberto = !!caixaAbertoId && lancamentosAfetados.every((l) => l.caixaId === caixaAbertoId);
  if (todosNoAberto) return null;
  return acao === 'cancelar' ? MSG_CAIXA_FECHADO : MSG_CAIXA_FECHADO_REATIVAR;
}

const ehContaCasa = (l: Pick<LancamentoCaixa, 'formaPagamento'>) => String(l.formaPagamento || '').includes('conta_casa');

/* ───────────────────────── Leitura (Firestore) ───────────────────────── */

export type ContextoVenda = {
  db: Firestore;
  ownerId: string;
  /** Id do caixa aberto agora (null se não há). */
  caixaAbertoId: string | null;
  ator: { id: string; nome: string };
  /** Pedido ao qual o caixa e o Prazo estão ligados. Só o id gravado conta. */
  orderId: string | null;
  /** Pedido a mudar de status no passo 3 (null: nada a fazer, ex.: venda manual). */
  pedido: { id: string; status?: string; clienteId?: string; customerName?: string } | null;
  /** Lançamentos já em memória (Caixa). Sem isso, são buscados no Firestore. */
  lancamentos?: LancamentoCaixa[];
  /** `updateOrderStatus` do pdv/page.tsx. */
  atualizarPedido?: (orderId: string, status: string) => Promise<boolean | void> | boolean | void;
};

export async function buscarLancamentosDoPedido(db: Firestore, ownerId: string, orderId: string): Promise<LancamentoCaixa[]> {
  const snap = await getDocs(query(
    collection(db, 'cash_transactions'),
    where('ownerId', '==', ownerId),
    where('orderId', '==', orderId),
  ));
  return snap.docs
    .map((d) => ({ ...(d.data() as LancamentoCaixa), id: d.id }))
    .filter((l) => l.tipo === 'venda');
}

async function lerExtrato(db: Firestore, clienteId: string): Promise<CreditTransaction[]> {
  const snap = await getDocs(collection(db, 'clientes', clienteId, 'credit_transactions'));
  return snap.docs.map((d) => ({ ...(d.data() as CreditTransaction), id: d.id }));
}

export type PlanoVenda = {
  lancamentos: LancamentoCaixa[];
  /** Ainda somam no caixa. */
  ativos: LancamentoCaixa[];
  /** Já cancelados. */
  cancelados: LancamentoCaixa[];
  /** A venda tem parte no Prazo (ativa ou já cancelada). */
  temContaCasa: boolean;
  clienteId: string | null;
  /** Nome do cadastro do cliente (null se não deu para ler). */
  clienteNome: string | null;
  /** Compras do Prazo a estornar ao cancelar. */
  aEstornar: CreditTransaction[];
  /** Compras do Prazo anuladas, que voltam ao reativar. */
  aReativar: DebitoParaReativar[];
  /** Compras do pedido que já estavam estornadas (para avisar na tela). */
  jaEstornadas: CreditTransaction[];
  /** Extrato lido (null se a venda não tem Prazo). */
  extrato: CreditTransaction[] | null;
};

/** Olha o que a venda tem hoje: caixa e Prazo. Só lê. */
export async function planejarVenda(ctx: Pick<ContextoVenda, 'db' | 'ownerId' | 'orderId' | 'pedido' | 'lancamentos'>): Promise<PlanoVenda> {
  const lancamentos = (ctx.lancamentos
    ?? (ctx.orderId ? await buscarLancamentosDoPedido(ctx.db, ctx.ownerId, ctx.orderId) : []))
    .filter((l) => l.tipo === 'venda');
  const ativos = lancamentos.filter((l) => !l.canceled);
  const cancelados = lancamentos.filter((l) => !!l.canceled);
  const temContaCasa = lancamentos.some(ehContaCasa);
  const clienteId = lancamentos.find((l) => ehContaCasa(l) && l.clienteId)?.clienteId
    || (temContaCasa ? ctx.pedido?.clienteId : undefined)
    || null;

  let clienteNome: string | null = null;
  if (temContaCasa && clienteId) {
    try {
      clienteNome = ((await getDoc(doc(ctx.db, 'clientes', clienteId))).data() as any)?.nome || null;
    } catch {
      clienteNome = null; // sem permissão de ver o cadastro: segue sem o nome
    }
  }

  let extrato: CreditTransaction[] | null = null;
  let aEstornar: CreditTransaction[] = [];
  let aReativar: DebitoParaReativar[] = [];
  let jaEstornadas: CreditTransaction[] = [];
  if (temContaCasa && clienteId && ctx.orderId) {
    extrato = await lerExtrato(ctx.db, clienteId);
    aEstornar = debitosParaEstornar(extrato, ctx.orderId);
    aReativar = debitosParaReativar(extrato, ctx.orderId);
    jaEstornadas = aReativar.map((r) => r.debito);
  }
  return { lancamentos, ativos, cancelados, temContaCasa, clienteId, clienteNome, aEstornar, aReativar, jaEstornadas, extrato };
}

/** Frase do que acontece com o Prazo, para a tela de confirmação (null: venda sem Prazo). */
export function textoDoPrazoNoCancelamento(plano: PlanoVenda, nomePedido: string): string | null {
  if (!plano.temContaCasa) return null;
  const nomeCliente = plano.clienteNome || nomePedido || 'o cliente';
  if (plano.aEstornar.length > 0) {
    const total = somaDinheiro(...plano.aEstornar.map((d) => d.amount));
    return `A compra de ${brl(total)} sai do Prazo de ${nomeCliente}.`;
  }
  if (plano.jaEstornadas.length > 0) {
    return `A compra no Prazo de ${nomeCliente} já foi estornada; nada será estornado de novo.`;
  }
  return `Não achei a compra no Prazo de ${nomeCliente}; depois confira o extrato dele.`;
}

/* ───────────────────────── Execução ───────────────────────── */

export type ResultadoVenda = {
  /** Tudo que devia ser feito foi feito (aviso de "não achei a compra" não conta contra). */
  concluiu: boolean;
  /** Nada foi gravado (bloqueio ou erro no 1º passo). */
  nadaFeito: boolean;
  toast: { variant?: 'destructive'; title: string; description: string; duration?: number };
};

const erroTexto = (e: unknown) => (e instanceof Error ? e.message : 'Falha na comunicação.');

function nomeDoCliente(ctx: ContextoVenda, plano: PlanoVenda): string {
  return plano.clienteNome || ctx.pedido?.customerName || 'o cliente';
}

/** Passo 1: marca/desmarca os lançamentos de uma vez (venda dividida inteira ou nada). */
async function gravarCancelamentoNoCaixa(ctx: ContextoVenda, alvo: LancamentoCaixa[], cancelar: boolean, motivo?: string) {
  if (alvo.length === 0) return;
  const batch = writeBatch(ctx.db);
  for (const l of alvo) {
    const ref = doc(ctx.db, 'cash_transactions', l.id);
    if (cancelar) {
      batch.update(ref, {
        canceled: true,
        canceledAt: serverTimestamp(),
        canceledBy: ctx.ator.nome,
        canceledByUid: ctx.ator.id,
        ...(motivo?.trim() ? { canceledReason: motivo.trim() } : {}),
      });
    } else {
      batch.update(ref, { canceled: false });
    }
  }
  await batch.commit();
}

/** Passo 2: estornos + `creditBalance` no MESMO lote, como a tela do Prazo. */
async function gravarPrazo(ctx: ContextoVenda, clienteId: string, orderId: string, plano: PlanoVenda, cancelar: boolean): Promise<number> {
  const agora = new Date();
  const batch = writeBatch(ctx.db);
  const credits = collection(ctx.db, 'clientes', clienteId, 'credit_transactions');
  const valores: number[] = [];

  if (cancelar) {
    for (const debito of plano.aEstornar) {
      const ref = doc(credits);
      const estorno = montarEstorno(debito, orderId, ref.id, agora);
      batch.set(ref, estorno);
      valores.push(estorno.amount);
    }
  } else {
    for (const item of plano.aReativar) {
      const ref = doc(credits);
      const compra = montarReativacao(item, orderId, ref.id, agora);
      batch.set(ref, compra);
      valores.push(compra.amount);
    }
  }
  if (valores.length === 0) return 0;

  const total = somaDinheiro(...valores);
  batch.update(doc(ctx.db, 'clientes', clienteId), {
    creditBalance: increment(cancelar ? -total : total),
  });
  await batch.commit();
  return total;
}

export async function cancelarVendaCompleta(ctx: ContextoVenda & { motivo?: string }): Promise<ResultadoVenda> {
  let plano: PlanoVenda;
  try {
    plano = await planejarVenda(ctx);
  } catch (e) {
    return {
      concluiu: false, nadaFeito: true,
      toast: { variant: 'destructive', title: 'Erro ao cancelar venda', description: erroTexto(e) },
    };
  }

  const bloqueio = bloqueioDeCaixa(plano.ativos, ctx.caixaAbertoId, 'cancelar');
  if (bloqueio) {
    return { concluiu: false, nadaFeito: true, toast: { variant: 'destructive', title: 'Não foi possível cancelar', description: bloqueio } };
  }

  // 1º lançamentos do caixa (efeito financeiro imediato).
  try {
    await gravarCancelamentoNoCaixa(ctx, plano.ativos, true, ctx.motivo);
  } catch (e) {
    return {
      concluiu: false, nadaFeito: true,
      toast: { variant: 'destructive', title: 'Erro ao cancelar venda', description: erroTexto(e) },
    };
  }

  const feitos: string[] = [];
  if (plano.ativos.length > 0) feitos.push('saiu do caixa');

  // 2º Prazo.
  let avisoPrazo = '';
  if (plano.temContaCasa) {
    if (plano.aEstornar.length > 0 && plano.clienteId && ctx.orderId) {
      try {
        const total = await gravarPrazo(ctx, plano.clienteId, ctx.orderId, plano, true);
        feitos.push(`${brl(total)} saíram do Prazo`);
      } catch (e) {
        return {
          concluiu: false, nadaFeito: false,
          toast: {
            variant: 'destructive', duration: 10000,
            title: 'Venda cancelada no caixa, mas a dívida não saiu do Prazo',
            description: `${erroTexto(e)} O pedido continua como estava. Estorne a compra pelo extrato de ${nomeDoCliente(ctx, plano)} e cancele o pedido pela aba Delivery.`,
          },
        };
      }
    } else if (plano.jaEstornadas.length > 0) {
      feitos.push('a compra já estava estornada no Prazo');
    } else {
      avisoPrazo = `Não achei a compra no Prazo de ${nomeDoCliente(ctx, plano)}; confira o extrato dele.`;
    }
  }

  // 3º pedido.
  const pedido = ctx.pedido;
  let pedidoCancelado = false;
  if (pedido && pedido.status !== 'canceled' && ctx.atualizarPedido) {
    let ok: boolean | void = false;
    try {
      ok = await ctx.atualizarPedido(pedido.id, 'canceled');
    } catch {
      ok = false;
    }
    if (ok === false) {
      return {
        concluiu: false, nadaFeito: false,
        toast: {
          variant: 'destructive', duration: 10000,
          title: 'Venda cancelada, mas o pedido não',
          description: `${feitos.length ? `Já feito: ${feitos.join('; ')}. ` : ''}O pedido não pôde ser cancelado. Cancele-o pela aba Delivery.${avisoPrazo ? ` ${avisoPrazo}` : ''}`,
        },
      };
    }
    pedidoCancelado = true;
  }

  if (pedidoCancelado) feitos.push('o pedido foi cancelado (estoque devolvido)');
  const resumo = feitos.length ? `${feitos.map((f, i) => (i === 0 ? f.charAt(0).toUpperCase() + f.slice(1) : f)).join('; ')}.` : 'Nada mais a desfazer.';
  return {
    concluiu: true, nadaFeito: false,
    toast: {
      ...(avisoPrazo ? { variant: 'destructive' as const, duration: 10000 } : {}),
      title: pedidoCancelado ? 'Venda cancelada por completo' : 'Venda cancelada',
      description: avisoPrazo ? `${resumo} ${avisoPrazo}` : resumo,
    },
  };
}

export async function reativarVendaCompleta(ctx: ContextoVenda): Promise<ResultadoVenda> {
  let plano: PlanoVenda;
  try {
    plano = await planejarVenda(ctx);
  } catch (e) {
    return {
      concluiu: false, nadaFeito: true,
      toast: { variant: 'destructive', title: 'Erro ao reativar venda', description: erroTexto(e) },
    };
  }

  const bloqueio = bloqueioDeCaixa(plano.cancelados, ctx.caixaAbertoId, 'reativar');
  if (bloqueio) {
    return { concluiu: false, nadaFeito: true, toast: { variant: 'destructive', title: 'Não foi possível reativar', description: bloqueio } };
  }

  try {
    await gravarCancelamentoNoCaixa(ctx, plano.cancelados, false);
  } catch (e) {
    return {
      concluiu: false, nadaFeito: true,
      toast: { variant: 'destructive', title: 'Erro ao reativar venda', description: erroTexto(e) },
    };
  }

  const feitos: string[] = [];
  if (plano.cancelados.length > 0) feitos.push('voltou a somar no caixa');

  if (plano.temContaCasa && plano.aReativar.length > 0 && plano.clienteId && ctx.orderId) {
    try {
      const total = await gravarPrazo(ctx, plano.clienteId, ctx.orderId, plano, false);
      feitos.push(`${brl(total)} voltaram para o Prazo`);
    } catch (e) {
      return {
        concluiu: false, nadaFeito: false,
        toast: {
          variant: 'destructive', duration: 10000,
          title: 'Venda reativada no caixa, mas a dívida não voltou ao Prazo',
          description: `${erroTexto(e)} O pedido continua como estava. Lance a compra de novo pelo extrato de ${nomeDoCliente(ctx, plano)}.`,
        },
      };
    }
  }

  const pedido = ctx.pedido;
  let pedidoReativado = false;
  if (pedido && pedido.status === 'canceled' && ctx.atualizarPedido) {
    let ok: boolean | void = false;
    try {
      ok = await ctx.atualizarPedido(pedido.id, 'delivered');
    } catch {
      ok = false;
    }
    if (ok === false) {
      return {
        concluiu: false, nadaFeito: false,
        toast: {
          variant: 'destructive', duration: 10000,
          title: 'Venda reativada, mas o pedido não',
          description: `${feitos.length ? `Já feito: ${feitos.join('; ')}. ` : ''}O pedido continua cancelado (possível falta de estoque). Verifique na aba Delivery.`,
        },
      };
    }
    pedidoReativado = true;
  }
  if (pedidoReativado) feitos.push('o pedido voltou a finalizado');

  const resumo = feitos.length ? `${feitos.map((f, i) => (i === 0 ? f.charAt(0).toUpperCase() + f.slice(1) : f)).join('; ')}.` : 'Nada mais a refazer.';
  return { concluiu: true, nadaFeito: false, toast: { title: 'Venda reativada', description: resumo } };
}
