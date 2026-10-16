'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import { brl } from '@/lib/utils';

/**
 * Janela de "Cancelar venda" usada pelo Caixa e pelo Delivery.
 *
 * Tem aparência própria, fora do padrão dos outros diálogos: a venda aparece
 * como o cupom da bobina (borda picotada) com o carimbo de cancelamento, e o
 * que o cancelamento desfaz vem em linhas de cupom. Cada tela continua dona do
 * estado e da ação (senha, confirmar); aqui só mora a aparência.
 *
 * O campo da senha é montado para o Chrome NÃO tratar a janela como tela de
 * login: sem `type="password"` (o navegador ignora `autocomplete="off"` nesse
 * tipo e preenche com a senha de login, o que gastaria as tentativas da senha
 * de cancelamento). É um campo de texto numérico invisível por cima das casas
 * de dígito, que mostram só bolinhas.
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
const fraseDeAviso = (frase: string) => /^Não achei/i.test(frase);

const ATRIBUTOS_ANTI_AUTOFILL = {
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
  'data-lpignore': 'true',
  'data-1p-ignore': true,
  'data-form-type': 'other',
} as const;

const MAX_DIGITOS = 8;
const CASAS_MINIMAS = 4;

/* Estilo isolado (prefixo cvd-): cores explícitas, não seguem o tema do painel. */
const CSS = `
.cvd-overlay{position:fixed;inset:0;z-index:60;background:rgba(17,19,23,.58);backdrop-filter:blur(2px);animation:cvd-fade .16s ease-out}
.cvd-panel{
  --counter:#e7e9ec; --paper:#ffffff; --ink:#1d2127; --muted:#69707a; --rule:#c4c9d0;
  --stamp:#c4122f; --stamp-dark:#a10e26; --amber:#9a5a00;
  --mono:ui-monospace,"Cascadia Mono","Cascadia Code",Consolas,"Liberation Mono","Courier New",monospace;
  position:fixed;z-index:61;left:50%;top:50%;transform:translate(-50%,-50%);
  width:min(43rem,calc(100vw - 2rem));max-height:calc(100vh - 2rem);overflow-y:auto;
  scrollbar-width:none;-ms-overflow-style:none;
  background:var(--counter);color:var(--ink);border-radius:1.25rem;padding:1.1rem;
  box-shadow:0 30px 70px -20px rgba(10,12,16,.55),0 0 0 1px rgba(255,255,255,.5) inset;
  animation:cvd-rise .22s cubic-bezier(.2,.8,.3,1)
}
.cvd-panel::-webkit-scrollbar{display:none}
.cvd-panel:focus{outline:none}
/* Horizontal: o cupom à esquerda, o que acontece + senha + botões à direita. */
.cvd-grid{display:grid;grid-template-columns:minmax(0,17rem) minmax(0,1fr);gap:1.25rem;align-items:start}
.cvd-side{display:flex;flex-direction:column;gap:.8rem;min-width:0;padding-top:.3rem}
@media (max-width:640px){.cvd-grid{grid-template-columns:minmax(0,1fr);gap:1rem}}
.cvd-close{position:absolute;top:.7rem;right:.7rem;z-index:2;display:grid;place-items:center;width:2rem;height:2rem;border-radius:999px;color:var(--muted);background:transparent;border:0;cursor:pointer}
.cvd-close:hover{background:rgba(29,33,39,.07);color:var(--ink)}
.cvd-close:focus-visible,.cvd-btn:focus-visible{outline:2px solid var(--ink);outline-offset:2px}

.cvd-slip-wrap{filter:drop-shadow(0 6px 10px rgba(20,24,30,.12)) drop-shadow(0 1px 1px rgba(20,24,30,.1));margin-top:.2rem}
.cvd-slip{
  --z:7px; position:relative;background:var(--paper);padding:1rem 1.1rem calc(var(--z) + 1rem);
  border-radius:.5rem .5rem 0 0;font-family:var(--mono);
  -webkit-mask:conic-gradient(from -45deg at bottom,#0000,#000 1deg 89deg,#0000 90deg) 50%/calc(2*var(--z)) 100%;
  mask:conic-gradient(from -45deg at bottom,#0000,#000 1deg 89deg,#0000 90deg) 50%/calc(2*var(--z)) 100%
}
.cvd-slip-head{display:flex;justify-content:space-between;gap:.75rem;font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.cvd-client{margin:.7rem 0 0;font-family:inherit;font-size:.95rem;font-weight:700;line-height:1.25;color:var(--ink);overflow-wrap:anywhere;padding-right:5.5rem}
.cvd-line{display:flex;justify-content:space-between;gap:.75rem;font-size:.74rem;color:var(--muted);margin-top:.3rem}
.cvd-line b{font-weight:600;color:var(--ink)}
.cvd-cut{border:0;border-top:1px dashed var(--rule);margin:.8rem 0 .65rem}
.cvd-total{display:flex;align-items:baseline;justify-content:space-between;gap:.75rem}
.cvd-total span{font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.cvd-total strong{font-size:1.55rem;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--ink)}

.cvd-stamp{font-size:.78rem;
  position:absolute;right:.9rem;top:2.35rem;transform:rotate(-9deg);
  font-family:var(--mono);font-weight:800;letter-spacing:.16em;text-transform:uppercase;
  color:var(--stamp);border:3px double var(--stamp);border-radius:.4rem;padding:.28rem .5rem .22rem;
  opacity:.9;mix-blend-mode:multiply;pointer-events:none;
  animation:cvd-stamp .42s cubic-bezier(.2,.9,.25,1.25) .12s both
}

.cvd-effects{display:grid;gap:.4rem;margin:0;padding:0;list-style:none}
.cvd-effects-title{margin:0 2.2rem -.25rem 0;font-family:var(--mono);font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.cvd-effects li{display:grid;grid-template-columns:4.9rem minmax(0,1fr);gap:.6rem;align-items:baseline;font-size:.82rem;line-height:1.38}
.cvd-effects li > span:first-child{font-family:var(--mono);font-size:.66rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.cvd-effects li.cvd-warn > span:last-child{color:var(--amber);font-weight:600}

.cvd-pin{display:grid;justify-items:start;gap:.45rem}
.cvd-pin label{font-family:var(--mono);font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.cvd-cells{position:relative;display:flex;gap:.5rem}
.cvd-cell{width:2.45rem;height:2.75rem;border-radius:.7rem;background:var(--paper);border:1.5px solid var(--rule);display:grid;place-items:center;transition:border-color .12s,box-shadow .12s}
.cvd-cell i{width:.62rem;height:.62rem;border-radius:999px;background:var(--ink)}
.cvd-cells:focus-within .cvd-cell.cvd-next{border-color:var(--ink);box-shadow:0 0 0 3px rgba(29,33,39,.12)}
.cvd-cells.cvd-err .cvd-cell{border-color:var(--stamp)}
.cvd-cells.cvd-err{animation:cvd-shake .32s ease-in-out}
.cvd-pin-input{position:absolute;inset:0;width:100%;height:100%;opacity:0;font-size:16px;color:transparent;caret-color:transparent;background:transparent;border:0;cursor:text}
.cvd-msg{margin:0;font-size:.78rem;color:var(--stamp-dark)}

.cvd-actions{display:grid;grid-template-columns:1fr 1.45fr;gap:.6rem;margin-top:.1rem}
.cvd-btn{height:2.6rem;border-radius:.75rem;font-size:.86rem;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:.4rem;transition:background-color .12s,opacity .12s}
.cvd-btn-back{background:transparent;color:var(--ink);border:1.5px solid var(--rule)}
.cvd-btn-back:hover{background:rgba(29,33,39,.05)}
.cvd-btn-go{background:var(--stamp);color:#fff;border:0}
.cvd-btn-go:hover{background:var(--stamp-dark)}
.cvd-btn:disabled{opacity:.42;cursor:not-allowed}

.cvd-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

@keyframes cvd-fade{from{opacity:0}to{opacity:1}}
@keyframes cvd-rise{from{opacity:0;transform:translate(-50%,calc(-50% + 10px))}to{opacity:1;transform:translate(-50%,-50%)}}
@keyframes cvd-stamp{from{opacity:0;transform:rotate(-16deg) scale(1.7)}to{opacity:.9;transform:rotate(-9deg) scale(1)}}
@keyframes cvd-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}50%{transform:translateX(5px)}75%{transform:translateX(-3px)}}
@media (prefers-reduced-motion:reduce){.cvd-overlay,.cvd-panel,.cvd-stamp,.cvd-cells.cvd-err{animation:none}}
@media (max-width:380px){.cvd-effects li{grid-template-columns:4.4rem minmax(0,1fr)}.cvd-cell{width:2.2rem}}
`;

/** Conteúdo da janela (separado do Dialog para poder ser montado em teste). */
export function CancelarVendaCorpo(p: CancelarVendaCorpoProps & { pinRef?: React.Ref<HTMLInputElement> }) {
  const forma = formaDePagamentoLimpa(p.formaPagamento);
  const partes = p.partes && p.partes.length > 1 ? p.partes : null;
  const precisaSenha = p.senhaConfigurada === true;
  const desabilitado = p.executando || p.senhaConfigurada === null || (precisaSenha && !p.senha);
  const casas = Math.min(MAX_DIGITOS, Math.max(CASAS_MINIMAS, p.senha.length));

  return (
    <div className="cvd-grid">
      <div className="cvd-slip-wrap">
        <div className="cvd-slip">
          <div className="cvd-slip-head">
            <span>Venda</span>
            <span>{p.subtitulo}</span>
          </div>
          <p className="cvd-client">{p.cliente}</p>
          {partes ? (
            partes.map((x) => (
              <div key={x.id} className="cvd-line">
                <span>{formaDePagamentoLimpa(x.forma)}</span>
                <b>{brl(x.valor)}</b>
              </div>
            ))
          ) : (
            forma && (
              <div className="cvd-line">
                <span>Pagamento: <b>{forma}</b></span>
              </div>
            )
          )}
          {!partes && taxaPagaAoMotoboy(p.formaPagamento) && (
            <div className="cvd-line"><span>Taxa de entrega paga ao motoboy</span></div>
          )}
          <hr className="cvd-cut" />
          <div className="cvd-total">
            <span>Total</span>
            <strong>{brl(p.valor)}</strong>
          </div>
          <div className="cvd-stamp" aria-hidden>{p.executando ? 'Cancelando' : 'Cancelar'}</div>
        </div>
      </div>

      <div className="cvd-side">
      <p className="cvd-effects-title">Ao cancelar</p>
      <ul className="cvd-effects">
        {p.saiDoCaixa && <li><span>Caixa</span><span>Sai do fechamento de hoje</span></li>}
        {p.devolveEstoque && <li><span>Estoque</span><span>Os produtos voltam</span></li>}
        {p.avisaCliente && <li><span>WhatsApp</span><span>O cliente recebe o aviso</span></li>}
        {p.fraseDoPrazo && (
          <li className={fraseDeAviso(p.fraseDoPrazo) ? 'cvd-warn' : undefined}>
            <span>Prazo</span><span>{p.fraseDoPrazo}</span>
          </li>
        )}
        {p.nota && <li><span>Atenção</span><span>{p.nota}</span></li>}
      </ul>

      {p.senhaFalhou && <p className="cvd-msg">Não consegui conferir a senha da loja. Feche e tente de novo.</p>}

      {precisaSenha && (
        <div className="cvd-pin">
          <label htmlFor="codigo-cancelamento">Senha de cancelamento</label>
          {/* key muda a cada erro para a casa tremer de novo */}
          <div key={p.senhaErro || 'ok'} className={`cvd-cells${p.senhaErro ? ' cvd-err' : ''}`}>
            {Array.from({ length: casas }, (_, i) => (
              <span key={i} className={`cvd-cell${i === Math.min(p.senha.length, casas - 1) ? ' cvd-next' : ''}`}>
                {i < p.senha.length ? <i /> : null}
              </span>
            ))}
            <input
              ref={p.pinRef}
              id="codigo-cancelamento"
              name="codigo-cancelamento"
              className="cvd-pin-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={MAX_DIGITOS}
              {...ATRIBUTOS_ANTI_AUTOFILL}
              value={p.senha}
              onChange={(e) => p.onSenha(e.target.value.replace(/\D/g, '').slice(0, MAX_DIGITOS))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && p.senha && !p.executando) {
                  e.preventDefault();
                  p.onConfirmar();
                }
              }}
              aria-invalid={!!p.senhaErro}
            />
          </div>
          {p.senhaErro && <p className="cvd-msg" role="alert">{p.senhaErro}</p>}
        </div>
      )}

      <div className="cvd-actions">
        <button type="button" className="cvd-btn cvd-btn-back" onClick={p.onVoltar} disabled={p.executando}>
          Voltar
        </button>
        <button type="button" className="cvd-btn cvd-btn-go" onClick={p.onConfirmar} disabled={desabilitado}>
          {p.executando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {p.executando ? 'Cancelando' : 'Cancelar venda'}
        </button>
      </div>
      </div>
    </div>
  );
}

export function CancelarVendaDialog({
  open,
  onOpenChange,
  ...corpo
}: CancelarVendaCorpoProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const pinRef = React.useRef<HTMLInputElement>(null);
  const precisaSenha = corpo.senhaConfigurada === true;

  // A consulta da senha chega depois da janela abrir: quando o campo aparece,
  // o cursor já vai para ele (é só digitar e dar Enter).
  React.useEffect(() => {
    if (open && precisaSenha) pinRef.current?.focus();
  }, [open, precisaSenha]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <style>{CSS}</style>
        <DialogPrimitive.Overlay className="cvd-overlay" />
        <DialogPrimitive.Content
          className="cvd-panel"
          onOpenAutoFocus={(e) => {
            // Não começar com o foco no botão vermelho nem no X.
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
        >
          <DialogPrimitive.Title className="cvd-sr">Cancelar venda de {corpo.cliente}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="cvd-sr">
            Confira o que será desfeito e confirme o cancelamento.
          </DialogPrimitive.Description>
          <DialogPrimitive.Close className="cvd-close" aria-label="Fechar">
            <X className="h-4 w-4" aria-hidden />
          </DialogPrimitive.Close>
          <CancelarVendaCorpo {...corpo} pinRef={pinRef} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
