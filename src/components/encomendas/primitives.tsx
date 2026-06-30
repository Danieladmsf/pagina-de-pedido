import { Check, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export function money(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/* ---------- Indicador de passos ---------- */
export function StepIndicator({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5 sm:gap-2 px-2 overflow-x-auto no-scrollbar py-1">
      {Array.from({ length: total }).map((_, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <div key={n} className="flex items-center shrink-0">
            <div
              className={cn(
                'flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full text-xs font-bold transition-all',
                active && 'bg-primary text-primary-foreground shadow-soft scale-110 ring-4 ring-primary/15',
                done && 'bg-primary/80 text-primary-foreground',
                !active && !done && 'bg-primary/10 text-primary/40'
              )}
            >
              {done ? <Check className="h-4 w-4" /> : n}
            </div>
            {n < total && (
              <div className={cn('h-[2px] w-3 sm:w-6 rounded-full transition-colors', done ? 'bg-primary/60' : 'bg-primary/15')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Card selecionável ---------- */
export function OptionCard({
  selected, onClick, title, description, icon, price, included, disabled, badge,
}: {
  selected?: boolean; onClick?: () => void; title: string; description?: string;
  icon?: string; price?: number; included?: boolean; disabled?: boolean; badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'group relative w-full text-left rounded-2xl border-2 p-4 sm:p-5 transition-all',
        'bg-card shadow-card hover:-translate-y-0.5 hover:shadow-soft',
        selected ? 'border-primary ring-2 ring-primary/15' : 'border-border hover:border-primary/40',
        disabled && 'opacity-50 pointer-events-none'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {icon && (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xl">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <p className="font-display text-base sm:text-lg font-bold leading-tight text-foreground">{title}</p>
            {description && <p className="mt-1 text-xs sm:text-[13px] leading-snug text-muted-foreground">{description}</p>}
            {badge && <span className="mt-2 inline-block rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">{badge}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all',
              selected ? 'border-primary bg-primary text-primary-foreground' : 'border-primary/25 bg-transparent'
            )}
          >
            {selected && <Check className="h-3.5 w-3.5" />}
          </span>
          {included && <span className="text-xs font-semibold text-primary">Incluso</span>}
          {!included && price !== undefined && price > 0 && (
            <span className="whitespace-nowrap text-sm font-bold text-primary">+ {money(price)}</span>
          )}
          {!included && price === 0 && <span className="text-xs font-medium text-muted-foreground">Incluso</span>}
        </div>
      </div>
    </button>
  );
}

/* ---------- Stepper de quantidade ---------- */
export function QuantityStepper({ value, onChange, min = 0, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; step?: number; }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card p-1">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - step))}
        className="flex h-8 w-8 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/10 disabled:opacity-30"
        disabled={value <= min}
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="min-w-7 text-center text-sm font-bold tabular-nums">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + step)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ---------- Linha de SKU com quantidade ---------- */
export function SkuRow({ name, desc, price, qty, onQty, step = 1 }: { name: string; desc?: string; price: number; qty: number; onQty: (v: number) => void; step?: number; }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 rounded-2xl border-2 p-3 sm:p-4 transition-colors', qty > 0 ? 'border-primary/40 bg-secondary/40' : 'border-border bg-card')}>
      <div className="min-w-0">
        <p className="font-semibold leading-tight text-foreground text-sm sm:text-[15px]">{name}</p>
        {desc && <p className="mt-0.5 text-xs leading-snug text-muted-foreground line-clamp-2">{desc}</p>}
        <p className="mt-1 text-sm font-bold text-primary">{money(price)}</p>
      </div>
      <QuantityStepper value={qty} onChange={onQty} step={step} />
    </div>
  );
}

/* ---------- Cabeçalho de passo ---------- */
export function StepHeader({ kicker, title, subtitle }: { kicker?: string; title: string; subtitle?: string }) {
  return (
    <div className="text-center">
      {kicker && <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-gold">{kicker}</p>}
      <h1 className="font-display text-3xl sm:text-4xl font-bold text-foreground">{title}</h1>
      {subtitle && <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
