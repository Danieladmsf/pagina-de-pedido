'use client';

/**
 * Painel de um "Acerto de Prazo" no caixa — o que aquele recebimento pagou.
 *
 * A linha do caixa só guarda o valor e o nome do cliente no título, porque o
 * recebimento não é uma venda: é a baixa de uma dívida que nasceu em compras de
 * outros dias. Quem tem essa história é o extrato do cliente
 * (`clientes/{id}/credit_transactions`), e é ele que este painel abre.
 *
 * A conta é buscada SÓ quando o dono expande a linha: em toda a base existem 4
 * acertos, não vale um listener aberto na aba inteira por causa deles.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import { Loader2, Wallet } from 'lucide-react';
import { brl, normalizeSearch } from '@/lib/utils';
import { formatBrazilPhone } from '@/lib/customer-credit';
import {
  allocatePayment,
  findPaymentTransaction,
  type CreditTransaction,
  type PaymentAllocation,
} from '@/lib/prazo-statement';
import type { LancamentoCaixa } from '@/hooks/useCaixa';

/** Nome do cliente escrito no título ("Acerto de Prazo - Fulano"). */
export function clienteDoTitulo(titulo?: string): string {
  const m = (titulo || '').match(/^\s*acerto de prazo\s*-\s*(.+)$/i);
  return m ? m[1].trim() : '';
}

/** A linha é um recebimento de dívida do Prazo (e não uma venda de verdade)? */
export function isAcertoPrazo(lanc: { tipo?: string; titulo?: string }): boolean {
  return lanc.tipo === 'venda' && /^\s*acerto de prazo\b/i.test(lanc.titulo || '');
}

type Estado =
  | { status: 'carregando' }
  | { status: 'sem-cliente'; nome: string }
  | { status: 'erro' }
  | {
      status: 'ok';
      cliente: any;
      /** null quando o recebimento não pôde ser apontado no extrato. */
      alocacao: PaymentAllocation | null;
    };

type Conta =
  | { achou: true; cliente: any; transacoes: CreditTransaction[] }
  | { achou: false; nome: string };

/**
 * Acha a conta do cliente. Lançamento novo carrega `clienteId` e vai direto;
 * o antigo só tem o nome no título, então a busca é pelo cadastro da loja —
 * e, havendo homônimos, ganha aquele cujo extrato contém este recebimento.
 */
async function carregarConta(
  db: any,
  lanc: LancamentoCaixa,
  ownerId?: string | null,
): Promise<Conta> {
  const lerExtrato = async (clienteId: string): Promise<CreditTransaction[]> => {
    const snap = await getDocs(collection(db, 'clientes', clienteId, 'credit_transactions'));
    return snap.docs.map((d) => ({ ...(d.data() as CreditTransaction), id: d.id }));
  };

  if (lanc.clienteId) {
    const snap = await getDoc(doc(db, 'clientes', lanc.clienteId));
    if (snap.exists()) {
      const cliente = { id: snap.id, ...snap.data() };
      return { achou: true, cliente, transacoes: await lerExtrato(snap.id) };
    }
  }

  const nome = clienteDoTitulo(lanc.titulo);
  if (!nome || !ownerId) return { achou: false, nome };

  const snap = await getDocs(query(collection(db, 'clientes'), where('ownerId', '==', ownerId)));
  const alvo = normalizeSearch(nome);
  const candidatos = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .filter((c) => normalizeSearch(c.nome || '') === alvo);

  if (candidatos.length === 0) return { achou: false, nome };

  const at = lanc.data?.toDate?.() ?? null;
  const valor = Math.abs(Number(lanc.valor) || 0);
  let primeiro: Conta | null = null;

  // Homônimos são raros, mas escolher o errado mostraria a conta de outra
  // pessoa: vence quem tem este recebimento no extrato.
  for (const cliente of candidatos.slice(0, 3)) {
    const transacoes = await lerExtrato(cliente.id);
    if (!primeiro) primeiro = { achou: true, cliente, transacoes };
    if (findPaymentTransaction(transacoes, { amount: valor, at })) return { achou: true, cliente, transacoes };
  }

  return primeiro!;
}

export function AcertoPrazoDetalhe({
  lanc,
  ownerId,
  orders,
}: {
  lanc: LancamentoCaixa;
  ownerId?: string | null;
  /** Pedidos da loja, para mostrar os itens de cada compra quitada. */
  orders: any[];
}) {
  const db = useFirestore();
  const [estado, setEstado] = useState<Estado>({ status: 'carregando' });

  const valorPago = Math.abs(Number(lanc.valor) || 0);
  const nomeTitulo = useMemo(() => clienteDoTitulo(lanc.titulo), [lanc.titulo]);

  useEffect(() => {
    if (!db) return;
    let cancelado = false;
    setEstado({ status: 'carregando' });

    (async () => {
      try {
        const conta = await carregarConta(db, lanc, ownerId);
        if (cancelado) return;

        if (!conta.achou) {
          setEstado({ status: 'sem-cliente', nome: conta.nome || nomeTitulo });
          return;
        }

        const pagamento = findPaymentTransaction(conta.transacoes, {
          id: lanc.creditTxId,
          amount: valorPago,
          at: lanc.data?.toDate?.() ?? null,
        });
        setEstado({
          status: 'ok',
          cliente: conta.cliente,
          alocacao: pagamento ? allocatePayment(conta.transacoes, pagamento.id, orders) : null,
        });
      } catch (err) {
        console.error('[AcertoPrazoDetalhe] Erro ao abrir a conta do cliente:', err);
        if (!cancelado) setEstado({ status: 'erro' });
      }
    })();

    return () => { cancelado = true; };
    // `orders` muda de referência a cada snapshot de pedidos; refazer a busca
    // por causa disso seria ida ao banco à toa. O que identifica a conta é o
    // lançamento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, lanc.id, ownerId]);

  const moldura = 'border-l-2 border-fuchsia-400 bg-fuchsia-50/40 rounded-r-lg rounded-bl-lg px-4 py-3.5 my-1';

  if (estado.status === 'carregando') {
    return (
      <div className={`${moldura} flex items-center gap-2 text-[12.5px] text-slate-500`}>
        <Loader2 className="h-4 w-4 animate-spin text-fuchsia-500" />
        Abrindo a conta de {nomeTitulo || 'cliente'}...
      </div>
    );
  }

  if (estado.status === 'erro') {
    return (
      <div className={`${moldura} text-[12.5px] text-slate-500`}>
        Não consegui abrir a conta deste cliente agora. Tente de novo em instantes.
      </div>
    );
  }

  if (estado.status === 'sem-cliente') {
    return (
      <div className={`${moldura} text-[12.5px] text-slate-500`}>
        Não encontrei <strong className="text-slate-700">{estado.nome || 'este cliente'}</strong> no cadastro —
        o nome pode ter sido alterado depois deste acerto. O extrato completo fica na ficha do cliente, em Clientes › Prazo.
      </div>
    );
  }

  const { cliente, alocacao } = estado;
  const telefone = cliente?.celular ? formatBrazilPhone(cliente.celular) : '';
  const hora = lanc.data?.toDate
    ? lanc.data.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className={moldura}>
      {/* Cabeçalho: de quem é a conta */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-fuchsia-100">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fuchsia-600 text-white shadow-sm">
            <Wallet className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <p className="text-[13px] font-bold text-slate-800">
              Recebimento de dívida
              <span className="font-semibold text-slate-500"> · {cliente?.nome || nomeTitulo}</span>
            </p>
            <p className="text-[11px] font-medium text-slate-400">
              {hora ? `${hora}` : ''}{telefone ? `${hora ? ' · ' : ''}${telefone}` : ''}
            </p>
          </div>
        </div>
        <span className="inline-flex items-center rounded-md border border-fuchsia-200 bg-fuchsia-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-fuchsia-700">
          Prazo
        </span>
      </div>

      {/* Cancelar o acerto tira o dinheiro do caixa, mas NÃO estorna o extrato
          do cliente (o estorno é um lançamento próprio, na tela do Prazo). Sem
          este aviso o painel diria "compra quitada" numa baixa desfeita. */}
      {lanc.canceled && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-700">
          Este acerto foi cancelado no caixa. O cancelamento não desfaz sozinho a baixa na conta do cliente —
          confira o extrato em Clientes › Prazo.
        </p>
      )}

      {!alocacao ? (
        <p className="text-[12.5px] text-slate-500">
          Este recebimento de <strong className="text-slate-700">{brl(valorPago)}</strong> não pôde ser apontado no
          extrato de {cliente?.nome || 'cliente'} — ele pode ter sido estornado. Confira em Clientes › Prazo.
        </p>
      ) : (
        <>
          {alocacao.covered.length > 0 ? (
            <>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                {alocacao.covered.length === 1 ? 'Compra paga com este acerto' : `Compras pagas com este acerto (${alocacao.covered.length})`}
              </p>
              <ul className="space-y-2.5">
                {alocacao.covered.map((compra) => (
                  <CompraQuitada key={compra.tx.id} compra={compra} />
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[12.5px] text-slate-500">
              Não havia compra em aberto quando este pagamento entrou — os {brl(valorPago)} viraram crédito a favor
              de {cliente?.nome || 'cliente'} e abatem as próximas compras.
            </p>
          )}

          {/* Antes → pago → depois: os três números que o cliente confere. */}
          <div className="mt-3.5 pt-3 border-t border-dashed border-fuchsia-200 space-y-1 text-[12.5px]">
            <div className="flex justify-between text-slate-500">
              <span>Devia antes deste acerto</span>
              <span className="tabular-nums">{brl(Math.max(0, alocacao.balanceBefore))}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Pagou</span>
              <span className="tabular-nums text-emerald-600 font-semibold">{brl(alocacao.paid)}</span>
            </div>
            {alocacao.leftover > 0.009 && (
              <div className="flex justify-between text-slate-500">
                <span>Sobrou de crédito a favor</span>
                <span className="tabular-nums">{brl(alocacao.leftover)}</span>
              </div>
            )}
            <div className="flex justify-between items-baseline pt-1">
              <span className="text-[13px] font-bold text-slate-800">
                {alocacao.balanceAfter > 0.009 ? 'Continuou devendo' : 'Depois deste acerto'}
              </span>
              <span
                className={`text-[15px] font-black tabular-nums ${
                  alocacao.balanceAfter > 0.009 ? 'text-rose-600' : 'text-emerald-600'
                }`}
              >
                {alocacao.balanceAfter > 0.009
                  ? brl(alocacao.balanceAfter)
                  : alocacao.balanceAfter < -0.009
                    ? `${brl(-alocacao.balanceAfter)} a favor`
                    : 'Conta quitada'}
              </span>
            </div>
            <p className="pt-1 text-[11px] text-slate-400">
              Saldo do dia deste acerto. O extrato completo fica em Clientes › Prazo.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/** Uma compra abatida pelo acerto: quando foi, o que era e quanto entrou nela. */
function CompraQuitada({ compra }: { compra: PaymentAllocation['covered'][number] }) {
  const { tx, order, amount, applied, settled } = compra;
  const data = tx.date ? new Date(tx.date) : null;
  const dataLabel = data && !Number.isNaN(data.getTime()) ? data.toLocaleDateString('pt-BR') : '';

  const itens: any[] = Array.isArray(order?.items) ? order.items : [];
  const resumoItens = itens
    .map((it) => `${Number(it?.quantity) || 0}× ${it?.name || 'item'}`)
    .join(' · ');

  return (
    <li className="rounded-lg border border-fuchsia-100 bg-white/70 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-slate-800">
          {dataLabel || 'Compra'}
          {tx.description ? <span className="font-medium text-slate-500"> · {tx.description}</span> : null}
        </span>
        <span className="text-[13px] font-bold text-slate-700 whitespace-nowrap tabular-nums">{brl(applied)}</span>
      </div>

      {resumoItens && (
        <p className="mt-0.5 text-[11.5px] text-slate-500 line-clamp-2">{resumoItens}</p>
      )}

      <div className="mt-1">
        {settled ? (
          <span className="inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
            Quitada
          </span>
        ) : (
          <span className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
            Parcial · {brl(applied)} de {brl(amount)}
          </span>
        )}
      </div>
    </li>
  );
}
