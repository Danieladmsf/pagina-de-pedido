'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Receipt, ChevronDown, Tag, Wallet } from 'lucide-react';
import { brl } from '@/lib/utils';
import type { UseFechamentoReturn } from './useFechamento';

interface FechamentoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fechamento: UseFechamentoReturn;
  title?: string;
  subtitle?: string;
  confirmLabel?: string;
  caixaAberto?: boolean;
  /** Avisos extras exibidos na descrição (abaixo do aviso de caixa fechado). */
  warnings?: React.ReactNode;
  /** Itens para o resumo recolhível (opcional). */
  items?: any[];
  /**
   * Quem vai ficar devendo se o pagamento for no Prazo. O botão "Prazo" existe
   * em todo fechamento, e sem isto o operador só descobria em qual conta a
   * dívida caiu (ou que precisava cadastrar alguém) DEPOIS de confirmar.
   */
  prazoCustomer?: {
    name?: string;
    phone?: string;
    /** Cadastro já localizado nesta tela (busca/seleção). */
    matched?: boolean;
    /** Quanto ainda cabe no limite, quando conhecido. */
    available?: number | null;
  };
  isSubmitting?: boolean;
  onConfirm: () => void;
}

// Modal único de fechamento de venda — mesmo visual e recursos (desconto/
// acréscimo, split, dinheiro/troco, Prazo) para Balcão, Mesas e Delivery.
// Todo o cálculo vem do useFechamento; aqui é só apresentação.
//
// LAYOUT: uma ordem só no DOM, dois arranjos.
//   - Tela estreita (tablet): pilha única, na ordem em que o operador trabalha —
//     ajuste do preço → como vai pagar → quanto deu → conferir os itens.
//   - Tela larga (>= md): duas colunas via `col-start`/`row-start`. À esquerda o
//     dinheiro (ajuste, totais, resumo), à direita a ação (formas de pagamento e
//     troco), coluna que fica colada no botão Confirmar. Assim o total NUNCA sai
//     da vista enquanto o operador escolhe a forma de pagamento.
// Nada é duplicado com `hidden md:block` — é o mesmo markup reposicionado.
export function FechamentoModal({
  open,
  onOpenChange,
  fechamento: f,
  title = 'Pagamento',
  subtitle,
  confirmLabel = '✅ Confirmar Pedido',
  caixaAberto = true,
  warnings,
  items,
  prazoCustomer,
  isSubmitting = false,
  onConfirm,
}: FechamentoModalProps) {
  const [resumoAberto, setResumoAberto] = useState(false);
  useEffect(() => { if (open) setResumoAberto(false); }, [open]);

  const totalItens = (items || []).reduce((a: number, i: any) => a + (Number(i.quantity) || 0), 0);

  const onMoneyInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '');
    if (!val) f.setValorRecebido('');
    else f.setValorRecebido((Number(val) / 100).toFixed(2));
  };

  const temAjustes = !!f.allowAdjustments;
  const temResumo = !!(items && items.length > 0);

  // A coluna da direita precisa atravessar todas as linhas da esquerda, senão o
  // bloco de pagamento (mais alto) empurraria os totais para baixo dele.
  // Classe literal por caso: string montada em runtime o Tailwind não enxerga.
  const linhasEsquerda = (temAjustes ? 1 : 0) + 1 + (temResumo ? 1 : 0);
  const spanPagamento =
    linhasEsquerda >= 3 ? 'md:row-span-3' : linhasEsquerda === 2 ? 'md:row-span-2' : 'md:row-span-1';

  const rotulo = (texto: string, Icone: typeof Tag) => (
    <div className="mb-2.5 flex items-center gap-2">
      <Icone className="h-3.5 w-3.5 text-slate-400" />
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{texto}</span>
    </div>
  );

  const renderFormas = () => (
    f.formasPagamento.map((fp: any) => (
      <button
        key={fp.id}
        type="button"
        onClick={() => { f.setSelectedPayment(fp.id); f.setValorRecebido(''); }}
        className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 py-2.5 text-[11px] font-bold transition ${
          f.selectedPayment === fp.id
            ? 'border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-100'
            : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
        }`}
      >
        <span className="text-xl">{fp.icon}</span>
        {fp.label}
      </button>
    ))
  );

  // Pagamento simples: grade de formas + Múltiplos, e o painel de dinheiro/troco.
  const pagamentoSimples = (
    <>
      <div className="grid grid-cols-3 gap-2">
        {renderFormas()}
        <button
          type="button"
          onClick={() => { f.setIsSplitMode(true); f.setSelectedPayment(''); f.setValorRecebido(''); }}
          className="flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-200 py-2.5 text-[11px] font-bold text-slate-500 transition hover:border-blue-300 hover:text-blue-600"
        >
          <span className="text-xl">🔀</span>
          Múltiplos
        </button>
      </div>

      {f.selectedPayment === 'dinheiro' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <label className="text-[12px] font-bold text-amber-800">💵 Valor recebido</label>
          <Input
            type="text"
            inputMode="numeric"
            placeholder="R$ 0,00"
            value={f.valorRecebido ? `R$ ${f.valorRecebido.replace('.', ',')}` : ''}
            onChange={onMoneyInput}
            className="mt-1.5 h-10 bg-white text-center text-base font-black"
            autoFocus
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[{ l: 'Exato', v: f.finalTotal }, { l: 'R$ 50', v: 50 }, { l: 'R$ 100', v: 100 }, { l: 'R$ 200', v: 200 }].map((b, i) => (
              <button key={i} type="button" onClick={() => f.setValorRecebido(b.v.toFixed(2))} className="rounded-lg bg-white px-2.5 py-1 text-[12px] font-bold text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100">{b.l}</button>
            ))}
          </div>
          {/* Troco logo abaixo de onde se digita: a conferência acontece no mesmo olhar. */}
          {f.troco > 0 && (
            <div className="mt-2.5 flex items-center justify-between rounded-lg bg-white px-3 py-2 ring-1 ring-amber-200">
              <span className="text-[12px] font-bold uppercase tracking-wide text-amber-700">Troco</span>
              <span className="text-[19px] font-black leading-none text-amber-700 tabular-nums">{brl(f.troco)}</span>
            </div>
          )}
        </div>
      )}
    </>
  );

  // Pagamento dividido (Múltiplos): lista do que já entrou + campo do próximo.
  const pagamentoDividido = (
    <>
      <button
        onClick={() => f.setIsSplitMode(false)}
        className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
      >
        ← Voltar ao Pagamento Simples
      </button>

      {f.paymentSplits.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] font-bold uppercase text-slate-500">Pagamentos adicionados:</span>
          {f.paymentSplits.map((split, idx) => (
            <div key={idx} className="flex items-center justify-between rounded border bg-slate-50 p-1.5 text-xs">
              <span className="flex items-center gap-1 font-medium text-slate-700">
                {split.label}
                {split.received && split.received > split.amount && (
                  <span className="text-[9px] text-muted-foreground">(Recebeu {brl(split.received)})</span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <span className="font-bold text-green-600 tabular-nums">{brl(split.amount)}</span>
                <button onClick={() => f.setPaymentSplits(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!f.isFullyPaid && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {renderFormas()}
          </div>

          {f.selectedPayment && (
            <div className="space-y-1.5 rounded-lg border border-blue-200 bg-blue-50 p-2">
              <label className="text-xs font-medium text-blue-800">
                Valor a ser pago em {f.selectedPayment === 'conta_casa' ? 'Prazo' : f.formasPagamento.find((fp: any) => fp.id === f.selectedPayment)?.label || f.selectedPayment}
              </label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder={brl(f.remaining)}
                  value={f.valorRecebido ? `R$ ${f.valorRecebido.replace('.', ',')}` : ''}
                  onChange={onMoneyInput}
                  className="h-9 bg-white text-center text-sm font-bold"
                  autoFocus
                />
                <Button onClick={f.addSplit} className="h-9 whitespace-nowrap bg-blue-600 text-white hover:bg-blue-700" size="sm">
                  Adicionar
                </Button>
              </div>
              {f.selectedPayment === 'dinheiro' && Number(f.valorRecebido) > f.remaining && (
                <div className="rounded bg-amber-100 p-1 text-center text-xs font-bold text-amber-700">
                  Troco: {brl(Number(f.valorRecebido) - f.remaining)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  );

  // Em qual conta a dívida vai cair. Telefone é a chave do Prazo: sem ele o
  // fechamento não tem onde lançar e vai parar no cadastro rápido.
  const prazoPhoneDigits = (prazoCustomer?.phone || '').replace(/\D/g, '');
  const prazoTemTelefone = prazoPhoneDigits.length >= 10;
  const avisoPrazo = !f.prazoInvolved ? null : (
    <div className={`rounded-xl border px-3 py-2 text-[12px] leading-snug ${
      prazoTemTelefone ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-rose-200 bg-rose-50 text-rose-700'
    }`}>
      {prazoTemTelefone ? (
        <>
          <span className="font-bold">📝 A dívida vai para {prazoCustomer?.name?.trim() || 'o cadastro do telefone'} </span>
          <span className="font-semibold">{prazoCustomer?.phone}</span>
          {prazoCustomer?.matched && typeof prazoCustomer.available === 'number' && (
            <span className="block text-[11px]">Disponível no limite: <span className="font-bold">{brl(prazoCustomer.available)}</span></span>
          )}
          {!prazoCustomer?.matched && (
            <span className="block text-[11px]">Se não houver cadastro com esse número, o sistema pede o cadastro ao confirmar.</span>
          )}
        </>
      ) : (
        <>
          <span className="font-bold">⚠️ Nenhum cliente informado.</span>
          <span className="block text-[11px]">Prazo precisa de um cliente com telefone. Ao confirmar, o sistema abre o cadastro rápido para saber de quem é a dívida.</span>
        </>
      )}
    </div>
  );

  const confirmDisabled = isSubmitting || (
    f.isSplitMode
      ? (f.paymentSplits.length === 0 && !f.selectedPayment) || (!f.isFullyPaid && !f.selectedPayment)
      : !f.selectedPayment
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-4 sm:max-w-[430px] md:max-w-[780px]">
        <DialogHeader className="space-y-0 text-left">
          <DialogTitle className="flex items-center gap-2.5 pr-6 text-left">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
              <Receipt className="h-[18px] w-[18px]" />
            </span>
            <span className="leading-tight">
              <span className="block text-[15px] font-bold text-slate-900">{title}</span>
              {subtitle && <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">{subtitle}</span>}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {!caixaAberto && <span className="mt-1 block text-red-500">⚠️ Caixa fechado — venda não será registrada nele.</span>}
            {f.prazoFeeNote && (
              <span className="mt-1 block text-blue-600">🛵 Prazo: a taxa de entrega ({brl(f.deliveryFee)}) fica de fora da cobrança — o cliente paga direto ao motoboy.</span>
            )}
            {warnings}
          </DialogDescription>
        </DialogHeader>

        {/* A ordem abaixo é a ordem em tela estreita. Em tela larga o grid
            reposiciona: esquerda = dinheiro, direita = pagamento. */}
        <div className="grid gap-3 md:grid-cols-2 md:items-start">

          {/* 1 · Desconto / Acréscimo — esquerda, primeira linha */}
          {temAjustes && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 md:col-start-1">
              {rotulo('Desconto / Acréscimo', Tag)}
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg bg-white p-0.5 ring-1 ring-slate-200">
                  <button type="button" onClick={() => f.setAjusteTipo('desconto')} className={`rounded-md px-2 py-1.5 text-[12px] font-bold transition ${f.ajusteTipo === 'desconto' ? 'bg-emerald-500 text-white' : 'text-slate-500'}`}>− Desc.</button>
                  <button type="button" onClick={() => f.setAjusteTipo('acrescimo')} className={`rounded-md px-2 py-1.5 text-[12px] font-bold transition ${f.ajusteTipo === 'acrescimo' ? 'bg-amber-500 text-white' : 'text-slate-500'}`}>+ Acrés.</button>
                </div>
                <div className="flex rounded-lg bg-white p-0.5 ring-1 ring-slate-200">
                  <button type="button" onClick={() => f.setAjusteUnidade('reais')} className={`rounded-md px-2.5 py-1.5 text-[12px] font-bold transition ${f.ajusteUnidade === 'reais' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>R$</button>
                  <button type="button" onClick={() => f.setAjusteUnidade('percent')} className={`rounded-md px-2.5 py-1.5 text-[12px] font-bold transition ${f.ajusteUnidade === 'percent' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>%</button>
                </div>
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-300">{f.ajusteUnidade === 'percent' ? '%' : 'R$'}</span>
                  <Input inputMode="decimal" placeholder="0" value={f.ajusteRaw} onChange={(e) => f.setAjusteRaw(e.target.value.replace(/[^0-9.,]/g, ''))} className="h-9 pl-7 text-right text-sm font-bold text-slate-800" />
                </div>
              </div>
            </div>
          )}

          {/* 2 · Como vai pagar — direita, atravessando a coluna toda */}
          <div className={`space-y-3 md:col-start-2 md:row-start-1 ${spanPagamento}`}>
            {rotulo(f.isSplitMode ? 'Pagamento dividido' : 'Como vai pagar', Wallet)}
            {f.isSplitMode ? pagamentoDividido : pagamentoSimples}
            {avisoPrazo}
          </div>

          {/* 3 · Totais — esquerda */}
          <div className="rounded-xl border border-slate-200 px-4 py-3 md:col-start-1">
            <div className="flex justify-between text-[13px] text-slate-500">
              <span>Subtotal</span>
              <span className="tabular-nums">{brl(f.subtotal)}</span>
            </div>
            {f.feeInCharge > 0 && (
              <div className="mt-1 flex justify-between text-[13px] text-slate-500">
                <span>Taxa de entrega</span>
                <span className="tabular-nums">{brl(f.feeInCharge)}</span>
              </div>
            )}
            {f.feeOffApplied && (
              <div className="mt-1 flex justify-between text-[13px] font-semibold text-blue-600">
                <span>Taxa paga ao motoboy (Prazo)</span>
                <span className="tabular-nums">− {brl(f.deliveryFee)}</span>
              </div>
            )}
            {f.descontoAplicado > 0 && (
              <div className="mt-1 flex justify-between text-[13px] font-semibold text-emerald-600">
                <span>Desconto{f.ajusteUnidade === 'percent' ? ` (${f.ajusteValor}%)` : ''}</span>
                <span className="tabular-nums">− {brl(f.descontoAplicado)}</span>
              </div>
            )}
            {f.acrescimoAplicado > 0 && (
              <div className="mt-1 flex justify-between text-[13px] font-semibold text-amber-600">
                <span>Acréscimo{f.ajusteUnidade === 'percent' ? ` (${f.ajusteValor}%)` : ''}</span>
                <span className="tabular-nums">+ {brl(f.acrescimoAplicado)}</span>
              </div>
            )}
            <div className="mt-2 flex items-end justify-between border-t border-dashed border-slate-200 pt-2.5">
              <span className="text-[13px] font-bold text-slate-800">Total a pagar</span>
              <span className="text-[26px] font-black leading-none text-slate-900 tabular-nums">{brl(f.finalTotal)}</span>
            </div>
            <div className="mt-2.5 flex items-center justify-end">
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-bold ${f.quitado ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>
                {f.quitado ? 'Pago ✅' : `Falta ${brl(f.falta)}`}
              </span>
            </div>
          </div>

          {/* 4 · Resumo dos itens (recolhível) — esquerda, por último */}
          {temResumo && (
            <div className="overflow-hidden rounded-xl border border-slate-200 md:col-start-1">
              <button
                type="button"
                onClick={() => setResumoAberto((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50"
              >
                <span className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-600">
                  <Receipt className="h-3.5 w-3.5 text-slate-400" />
                  Resumo dos itens
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{totalItens}</span>
                </span>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${resumoAberto ? 'rotate-180' : ''}`} />
              </button>
              {resumoAberto && (
                <ul className="max-h-44 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100 px-3 py-1">
                  {(items || []).map((it: any, i: number) => (
                    <li key={i} className="flex items-start justify-between gap-3 py-1.5">
                      <span className="flex items-start gap-2 text-[12.5px] text-slate-700">
                        <span className="mt-px font-bold text-blue-600">{it.saleUnit === 'kg' ? `${Number(it.weightGrams) || 0}g` : `${Number(it.quantity) || 0}×`}</span>
                        <span>
                          {it.name}
                          {it.addons?.length ? (
                            <span className="block text-[11px] text-slate-400">{it.addons.map((a: any) => `+ ${a.name}`).join(' · ')}</span>
                          ) : null}
                        </span>
                      </span>
                      <span className="whitespace-nowrap text-[12.5px] font-semibold text-slate-600 tabular-nums">{brl(((it.unitPrice ?? it.price) || 0) * (Number(it.quantity) || 0))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="mt-2 gap-2 border-t pt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            size="sm"
            disabled={confirmDisabled}
            onClick={onConfirm}
            className="bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
          >
            {isSubmitting ? '...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
