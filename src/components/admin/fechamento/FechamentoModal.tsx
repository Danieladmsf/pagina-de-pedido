'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Receipt, ChevronDown, Tag } from 'lucide-react';
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
  isSubmitting?: boolean;
  onConfirm: () => void;
}

// Modal único de fechamento de venda — mesmo visual e recursos (desconto/
// acréscimo, split, dinheiro/troco, Prazo) para Balcão, Mesas e Delivery.
// Todo o cálculo vem do useFechamento; aqui é só apresentação.
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[430px] p-4">
        <DialogHeader className="space-y-0 text-left">
          <DialogTitle className="flex items-center gap-2.5 pr-6 text-left">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white shrink-0">
              <Receipt className="h-[18px] w-[18px]" />
            </span>
            <span className="leading-tight">
              <span className="block text-[15px] font-bold text-slate-900">{title}</span>
              {subtitle && <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">{subtitle}</span>}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {!caixaAberto && <span className="text-red-500 block mt-1">⚠️ Caixa fechado — venda não será registrada nele.</span>}
            {f.prazoFeeNote && (
              <span className="text-blue-600 block mt-1">🛵 Prazo: a taxa de entrega (R$ {f.deliveryFee.toFixed(2)}) fica de fora da cobrança — o cliente paga direto ao motoboy.</span>
            )}
            {warnings}
          </DialogDescription>
        </DialogHeader>

        {/* Resumo de itens (recolhível) */}
        {items && items.length > 0 && (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
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
                {items.map((it: any, i: number) => (
                  <li key={i} className="flex items-start justify-between gap-3 py-1.5">
                    <span className="flex items-start gap-2 text-[12.5px] text-slate-700">
                      <span className="mt-px font-bold text-blue-600">{Number(it.quantity) || 0}×</span>
                      <span>
                        {it.name}
                        {it.addons?.length ? (
                          <span className="block text-[11px] text-slate-400">{it.addons.map((a: any) => `+ ${a.name}`).join(' · ')}</span>
                        ) : null}
                      </span>
                    </span>
                    <span className="whitespace-nowrap text-[12.5px] font-semibold text-slate-600 tabular-nums">R$ {(((it.unitPrice ?? it.price) || 0) * (Number(it.quantity) || 0)).toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Desconto / Acréscimo */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2.5 flex items-center gap-2">
            <Tag className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Desconto / Acréscimo</span>
          </div>
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

        {/* Totais */}
        <div className="rounded-xl border border-slate-200 px-4 py-3">
          <div className="flex justify-between text-[13px] text-slate-500">
            <span>Subtotal</span>
            <span className="tabular-nums">R$ {f.subtotal.toFixed(2)}</span>
          </div>
          {f.feeInCharge > 0 && (
            <div className="mt-1 flex justify-between text-[13px] text-slate-500">
              <span>Taxa de entrega</span>
              <span className="tabular-nums">R$ {f.feeInCharge.toFixed(2)}</span>
            </div>
          )}
          {f.feeOffApplied && (
            <div className="mt-1 flex justify-between text-[13px] font-semibold text-blue-600">
              <span>Taxa paga ao motoboy (Prazo)</span>
              <span className="tabular-nums">− R$ {f.deliveryFee.toFixed(2)}</span>
            </div>
          )}
          {f.descontoAplicado > 0 && (
            <div className="mt-1 flex justify-between text-[13px] font-semibold text-emerald-600">
              <span>Desconto{f.ajusteUnidade === 'percent' ? ` (${f.ajusteValor}%)` : ''}</span>
              <span className="tabular-nums">− R$ {f.descontoAplicado.toFixed(2)}</span>
            </div>
          )}
          {f.acrescimoAplicado > 0 && (
            <div className="mt-1 flex justify-between text-[13px] font-semibold text-amber-600">
              <span>Acréscimo{f.ajusteUnidade === 'percent' ? ` (${f.ajusteValor}%)` : ''}</span>
              <span className="tabular-nums">+ R$ {f.acrescimoAplicado.toFixed(2)}</span>
            </div>
          )}
          <div className="mt-2 flex items-end justify-between border-t border-dashed border-slate-200 pt-2.5">
            <span className="text-[13px] font-bold text-slate-800">Total a pagar</span>
            <span className="text-[26px] font-black leading-none text-slate-900 tabular-nums">R$ {f.finalTotal.toFixed(2)}</span>
          </div>
          <div className="mt-2.5 flex items-center justify-end gap-2">
            {f.troco > 0 && <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-[12px] font-bold text-amber-700">Troco R$ {f.troco.toFixed(2)}</span>}
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-bold ${f.quitado ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>{f.quitado ? 'Pago ✅' : `Falta R$ ${f.falta.toFixed(2)}`}</span>
          </div>
        </div>

        {!f.isSplitMode ? (
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
              <div className="bg-amber-50 p-3 rounded-xl border border-amber-200">
                <label className="text-[12px] font-bold text-amber-800">💵 Valor recebido</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="R$ 0,00"
                  value={f.valorRecebido ? `R$ ${f.valorRecebido.replace('.', ',')}` : ''}
                  onChange={onMoneyInput}
                  className="mt-1.5 text-base font-black text-center bg-white h-10"
                  autoFocus
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[{ l: 'Exato', v: f.finalTotal }, { l: 'R$ 50', v: 50 }, { l: 'R$ 100', v: 100 }, { l: 'R$ 200', v: 200 }].map((b, i) => (
                    <button key={i} type="button" onClick={() => f.setValorRecebido(b.v.toFixed(2))} className="rounded-lg bg-white px-2.5 py-1 text-[12px] font-bold text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100">{b.l}</button>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter className="pt-2 gap-2 border-t mt-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button
                size="sm"
                disabled={!f.selectedPayment || isSubmitting}
                onClick={onConfirm}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white"
              >
                {isSubmitting ? '...' : confirmLabel}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <button
              onClick={() => f.setIsSplitMode(false)}
              className="text-xs text-blue-600 hover:underline mb-2 flex items-center gap-1"
            >
              ← Voltar ao Pagamento Simples
            </button>

            {f.paymentSplits.length > 0 && (
              <div className="py-2 space-y-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Pagamentos Adicionados:</span>
                {f.paymentSplits.map((split, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-slate-50 border p-1.5 rounded text-xs">
                    <span className="font-medium text-slate-700 flex items-center gap-1">
                      {split.label}
                      {split.received && split.received > split.amount && <span className="text-[9px] text-muted-foreground">(Recebeu R$ {split.received.toFixed(2)})</span>}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-green-600">R$ {split.amount.toFixed(2)}</span>
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
                  <div className="bg-blue-50 p-2 rounded-lg border border-blue-200 space-y-1.5">
                    <label className="text-xs font-medium text-blue-800">Valor a ser pago em {f.selectedPayment === 'conta_casa' ? 'Prazo' : f.formasPagamento.find((fp: any) => fp.id === f.selectedPayment)?.label || f.selectedPayment} (R$)</label>
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        inputMode="numeric"
                        placeholder={`R$ ${f.remaining.toFixed(2).replace('.', ',')}`}
                        value={f.valorRecebido ? `R$ ${f.valorRecebido.replace('.', ',')}` : ''}
                        onChange={onMoneyInput}
                        className="text-sm font-bold text-center bg-white h-9"
                        autoFocus
                      />
                      <Button onClick={f.addSplit} className="h-9 whitespace-nowrap bg-blue-600 hover:bg-blue-700 text-white" size="sm">
                        Adicionar
                      </Button>
                    </div>
                    {f.selectedPayment === 'dinheiro' && Number(f.valorRecebido) > f.remaining && (
                      <div className="text-center p-1 font-bold text-xs bg-amber-100 text-amber-700 rounded">
                        Troco: R$ {(Number(f.valorRecebido) - f.remaining).toFixed(2)}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <DialogFooter className="pt-2 gap-2 border-t mt-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button
                size="sm"
                disabled={(f.paymentSplits.length === 0 && !f.selectedPayment) || isSubmitting || (!f.isFullyPaid && !f.selectedPayment)}
                onClick={onConfirm}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white"
              >
                {isSubmitting ? '...' : confirmLabel}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
