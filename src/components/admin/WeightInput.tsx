import React from 'react';
import { Input } from '@/components/ui/input';
import { brl } from '@/lib/utils';

interface WeightInputProps {
  /** Peso atual em gramas. */
  grams: number;
  /** Preço por quilo (para exibir a referência "R$ X/kg"). */
  pricePerKg: number;
  /** Chamado com o novo peso em gramas ao digitar. */
  onChange: (grams: number) => void;
  size?: 'sm' | 'md';
  autoFocus?: boolean;
}

/**
 * Campo para digitar o peso (em gramas) de um item vendido por quilo.
 * O valor da linha é calculado por quem usa (unitPrice × quantity segue valendo);
 * aqui só entra o peso e a referência de preço por kg.
 */
export function WeightInput({ grams, pricePerKg, onChange, size = 'md', autoFocus }: WeightInputProps) {
  const inputCls = size === 'sm' ? 'h-6 w-14 text-xs' : 'h-8 w-16 text-sm';
  return (
    <div className="flex flex-col items-start gap-0.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1 bg-slate-100 border rounded-md px-1.5 py-0.5">
        <Input
          type="text"
          inputMode="numeric"
          autoFocus={autoFocus}
          value={grams ? String(grams) : ''}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^0-9]/g, '');
            const g = digits === '' ? 0 : parseInt(digits, 10);
            onChange(Number.isFinite(g) ? g : 0);
          }}
          placeholder="0"
          aria-label="Peso em gramas"
          className={`text-right font-bold px-1 border-0 bg-transparent shadow-none focus-visible:ring-1 ${inputCls}`}
        />
        <span className="text-[11px] font-bold text-slate-500">g</span>
      </div>
      <span className="text-[9px] text-slate-400 whitespace-nowrap">{brl((Number(pricePerKg) || 0))}/kg</span>
    </div>
  );
}
