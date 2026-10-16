'use client';

import * as React from 'react';
import { ArrowRight, Ban, Check, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { brl, cn } from '@/lib/utils';

/**
 * Janela de "Cancelar venda" usada pelo Caixa e pelo Delivery.
 *
 * Cada tela continua dona do estado e da ação (senha, confirmar); aqui
 * só mora a aparência. O campo da senha é montado para o Chrome
 * NÃO tratar a janela como tela de login: sem `type="password"` (o navegador
 * ignora `autocomplete="off"` nesse tipo e preenche com a senha de login, o que
 * gastaria as tentativas da senha de cancelamento). A senha é um campo de texto
 * numérico com os dígitos escondidos por CSS.
 */

export type ParteDaVenda = { id: string; forma: string; valor: number };

export type CancelarVendaCorpoProps = {
  /** Linha pequena do cabeçalho, ex.: "Pedido #4R2NV · entregue". */
  subtitulo: string;
  cliente: string;
  valor: number;
  /** Forma de pagamento como veio do pedido/lançamento (será limpa para exibição). */
  formaPagamento?: string | null;
  /** Venda dividida: uma linha por forma de pagamento. */
  partes?: ParteDaVenda[];
  /** O que a venda desfaz (cada tela diz o que é verdade no seu caso). */
  saiDoCaixa: boolean;
  devolveEstoque: boolean;
  avisaCliente: boolean;
  /** Observação livre (ex.: encomenda que não é cancelada por esta tela). */
  nota?: string;
  /** Frase do Prazo vinda de `textoDoPrazoNoCancelamento`. */
  fraseDoPrazo?: string | null;

  /** `null` = ainda consultando; `false` = loja sem senha. */
  senhaConfigurada: boolean | null;
  senhaFalhou: boolean;
  senha: string;
  onSenha: (v: string) => void;
  senhaErro: string;

  executando: boolean;
  onConfirmar: () => void;
  onVoltar: () => void;
};

/** "PRAZO (TAXA DE ENTREGA PAGA DIRETO AO MOTOBOY)" -> "Prazo". */
export function formaDePagamentoLimpa(bruta?: string | null): string {
  const base = (bruta || '').split('(')[0].trim();
  if (!base) return '';
  if (base.toLowerCase() === 'conta_casa') return 'Prazo';
  const minusculo = base.toLowerCase().replace(/_/g, ' ');
  return minusculo.charAt(0).toUpperCase() + minusculo.slice(1);
}

const taxaPagaAoMotoboy = (bruta?: string | null) => /motoboy/i.test(bruta || '');

function frasePrazoTom(frase: string): 'aviso' | 'feito' | 'normal' {
  if (/^Não achei/i.test(frase)) return 'aviso';
  if (/já foi estornada/i.test(frase)) return 'feito';
  return 'normal';
}

const ATRIBUTOS_ANTI_AUTOFILL = {
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
  'data-lpignore': 'true',
  'data-1p-ignore': true,
  'data-form-type': 'other',
} as const;

function Passo({ children, tom = 'normal' }: { children: React.ReactNode; tom?: 'aviso' | 'feito' | 'normal' | 'seta' }) {
  const Icone = tom === 'seta' ? ArrowRight : Check;
  return (
    <li className="flex items-start gap-2">
      <Icone
        className={cn(
          'mt-0.5 h-3.5 w-3.5 shrink-0',
          tom === 'aviso' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
        )}
        aria-hidden
      />
      <span className={cn(tom === 'aviso' && 'text-amber-800 dark:text-amber-300')}>{children}</span>
    </li>
  );
}

/** Conteúdo da janela (separado para poder ser montado em teste, sem o portal do Dialog). */
export function CancelarVendaCorpo(p: CancelarVendaCorpoProps) {
  const forma = formaDePagamentoLimpa(p.formaPagamento);
  const partes = p.partes && p.partes.length > 1 ? p.partes : null;
  const precisaSenha = p.senhaConfigurada === true;
  const desabilitado = p.executando || p.senhaConfigurada === null || (precisaSenha && !p.senha);
  const tomPrazo = p.fraseDoPrazo ? frasePrazoTom(p.fraseDoPrazo) : 'normal';

  return (
    <>
      <DialogHeader className="flex-row items-center gap-3 space-y-0 text-left">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
          <Ban className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <DialogTitle className="text-lg leading-tight">Cancelar venda</DialogTitle>
          <DialogDescription className="mt-0.5 truncate">{p.subtitulo}</DialogDescription>
        </div>
      </DialogHeader>

      <div className="rounded-xl border bg-muted/40 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{p.cliente}</p>
            {!partes && forma && (
              <span className="mt-1 inline-block rounded-full border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {forma}
              </span>
            )}
          </div>
          <p className="shrink-0 text-xl font-bold tabular-nums text-foreground">{brl(p.valor)}</p>
        </div>
        {!partes && taxaPagaAoMotoboy(p.formaPagamento) && (
          <p className="mt-2 text-xs text-muted-foreground">Taxa de entrega paga ao motoboy</p>
        )}
        {partes && (
          <ul className="mt-2 space-y-1 border-t pt-2 text-sm">
            {partes.map((x) => (
              <li key={x.id} className="flex items-center justify-between text-muted-foreground">
                <span>{formaDePagamentoLimpa(x.forma)}</span>
                <span className="tabular-nums">{brl(x.valor)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold text-muted-foreground">O que vai acontecer</p>
        <ul className="space-y-1.5 text-sm text-foreground">
          {p.saiDoCaixa && <Passo>Sai do caixa de hoje</Passo>}
          {p.devolveEstoque && <Passo>Estoque devolvido</Passo>}
          {p.avisaCliente && <Passo>Cliente avisado no WhatsApp</Passo>}
          {p.fraseDoPrazo && <Passo tom={tomPrazo}>{p.fraseDoPrazo}</Passo>}
          {p.nota && <Passo tom="seta">{p.nota}</Passo>}
        </ul>
      </div>

      {p.senhaFalhou && (
        <p className="text-sm text-rose-600">Não consegui conferir a senha da loja. Feche e tente de novo.</p>
      )}

      {precisaSenha && (
        <div className="space-y-2">
          <Label htmlFor="codigo-cancelamento" className="block text-center">Senha de cancelamento</Label>
          <Input
            id="codigo-cancelamento"
            name="codigo-cancelamento"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            {...ATRIBUTOS_ANTI_AUTOFILL}
            // Dígitos escondidos sem `type="password"` (ver comentário no topo).
            style={{ WebkitTextSecurity: 'disc' } as React.CSSProperties}
            className="mx-auto h-12 w-44 text-center text-2xl tracking-[0.4em]"
            value={p.senha}
            onChange={(e) => p.onSenha(e.target.value.replace(/\D/g, '').slice(0, 8))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && p.senha && !p.executando) {
                e.preventDefault();
                p.onConfirmar();
              }
            }}
            aria-invalid={!!p.senhaErro}
          />
          {p.senhaErro && <p className="text-center text-sm text-rose-600">{p.senhaErro}</p>}
        </div>
      )}

      <DialogFooter className="gap-2 sm:space-x-0">
        <Button variant="outline" className="flex-1" onClick={p.onVoltar} disabled={p.executando}>
          Voltar
        </Button>
        <Button
          className="flex-1 bg-rose-600 text-white hover:bg-rose-700"
          onClick={p.onConfirmar}
          disabled={desabilitado}
        >
          {p.executando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cancelar venda'}
        </Button>
      </DialogFooter>
    </>
  );
}

export function CancelarVendaDialog({
  open,
  onOpenChange,
  ...corpo
}: CancelarVendaCorpoProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[440px]">
        <CancelarVendaCorpo {...corpo} />
      </DialogContent>
    </Dialog>
  );
}
