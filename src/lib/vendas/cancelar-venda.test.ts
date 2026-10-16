import { describe, expect, it } from 'vitest';
import { unpaidDebt, type CreditTransaction } from '@/lib/prazo-statement';
import {
  bloqueioDeCaixa, debitosParaEstornar, debitosParaReativar, montarEstorno, montarReativacao,
  MSG_CAIXA_FECHADO, ORIGEM_CANCELAMENTO_VENDA,
} from './cancelar-venda';

const tx = (p: Partial<CreditTransaction> & Pick<CreditTransaction, 'id' | 'type' | 'amount' | 'date'>): CreditTransaction => p;

const COMPRA = tx({ id: 'D1', type: 'debit', amount: 68, date: '2026-10-10T12:00:00Z', description: 'Pedido #4R2NV', orderId: 'P1' });

/** Aplica o que o módulo gravaria, como o Firestore devolveria na leitura seguinte. */
function cancelar(extrato: CreditTransaction[], orderId: string, quando: string): CreditTransaction[] {
  const novos = debitosParaEstornar(extrato, orderId).map((d, i) =>
    montarEstorno(d, orderId, `E-${quando}-${i}`, new Date(quando)));
  return [...extrato, ...novos];
}
function reativar(extrato: CreditTransaction[], orderId: string, quando: string): CreditTransaction[] {
  const novos = debitosParaReativar(extrato, orderId).map((r, i) =>
    montarReativacao(r, orderId, `R-${quando}-${i}`, new Date(quando)));
  return [...extrato, ...novos];
}
const saldo = (extrato: CreditTransaction[]) =>
  extrato.reduce((s, t) => s + (t.type === 'debit' ? t.amount : -t.amount), 0);

describe('cancelar venda: dívida do Prazo', () => {
  it('débito ativo é estornado', () => {
    expect(debitosParaEstornar([COMPRA], 'P1').map((d) => d.id)).toEqual(['D1']);
  });

  it('estorno gravado igual ao manual, com pedido e origem', () => {
    const e = montarEstorno(COMPRA, 'P1', 'E1', new Date('2026-10-11T00:00:00Z'));
    expect(e).toMatchObject({
      type: 'credit', amount: 68, channel: 'estorno', reversalOf: 'D1',
      description: 'Estorno - Pedido #4R2NV', orderId: 'P1', origem: ORIGEM_CANCELAMENTO_VENDA,
    });
    expect(e.date).toBe('2026-10-11T00:00:00.000Z');
  });

  it('caso Kenia: débito já estornado à mão não é estornado de novo', () => {
    const manual = tx({ id: 'M1', type: 'credit', amount: 68, date: '2026-10-12T12:00:00Z', channel: 'estorno', reversalOf: 'D1' });
    expect(debitosParaEstornar([COMPRA, manual], 'P1')).toEqual([]);
  });

  it('reativar depois do estorno do botão: a dívida volta', () => {
    const ap = cancelar([COMPRA], 'P1', '2026-10-11T00:00:00Z');
    expect(saldo(ap)).toBe(0);
    expect(debitosParaEstornar(ap, 'P1')).toEqual([]);

    const volta = reativar(ap, 'P1', '2026-10-11T01:00:00Z');
    expect(saldo(volta)).toBe(68);
    expect(unpaidDebt(volta)?.since).toEqual(new Date(COMPRA.date));
  });

  it('reativar quando o estorno foi manual: a dívida volta', () => {
    const manual = tx({ id: 'M1', type: 'credit', amount: 68, date: '2026-10-12T12:00:00Z', channel: 'estorno', reversalOf: 'D1' });
    const r = debitosParaReativar([COMPRA, manual], 'P1');
    expect(r.map((x) => [x.debito.id, x.estorno.id])).toEqual([['D1', 'M1']]);
    const volta = reativar([COMPRA, manual], 'P1', '2026-10-13T00:00:00Z');
    expect(volta.at(-1)).toMatchObject({ type: 'debit', reversalOf: 'M1', amount: 68, orderId: 'P1' });
    expect(saldo(volta)).toBe(68);
  });

  it('reativar sem estorno não faz nada', () => {
    expect(debitosParaReativar([COMPRA], 'P1')).toEqual([]);
  });

  it('cancelar, reativar e cancelar de novo', () => {
    let e = cancelar([COMPRA], 'P1', '2026-10-11T00:00:00Z');
    e = reativar(e, 'P1', '2026-10-11T01:00:00Z');
    expect(saldo(e)).toBe(68);
    // a "compra" que voltou é estorno do estorno: não conta como débito do pedido
    expect(debitosParaEstornar(e, 'P1').map((d) => d.id)).toEqual(['D1']);

    e = cancelar(e, 'P1', '2026-10-11T02:00:00Z');
    expect(saldo(e)).toBe(0);
    expect(debitosParaEstornar(e, 'P1')).toEqual([]);
    expect(debitosParaReativar(e, 'P1').map((x) => x.debito.id)).toEqual(['D1']);

    e = reativar(e, 'P1', '2026-10-11T03:00:00Z');
    expect(saldo(e)).toBe(68);
    expect(unpaidDebt(e)).not.toBeNull();
  });

  it('venda dividida: dois débitos do pedido, cada um com o seu estorno', () => {
    const d2 = tx({ id: 'D2', type: 'debit', amount: 30, date: '2026-10-10T12:00:01Z', description: 'Pedido #4R2NV (2)', orderId: 'P1' });
    const base = [COMPRA, d2];
    expect(debitosParaEstornar(base, 'P1').map((d) => d.id).sort()).toEqual(['D1', 'D2']);
    const ap = cancelar(base, 'P1', '2026-10-11T00:00:00Z');
    expect(saldo(ap)).toBe(0);
    expect(debitosParaReativar(ap, 'P1')).toHaveLength(2);
    expect(saldo(reativar(ap, 'P1', '2026-10-11T01:00:00Z'))).toBe(98);
  });

  it('só um dos dois já estornado: estorna apenas o outro', () => {
    const d2 = tx({ id: 'D2', type: 'debit', amount: 30, date: '2026-10-10T12:00:01Z', orderId: 'P1' });
    const manual = tx({ id: 'M1', type: 'credit', amount: 30, date: '2026-10-12T00:00:00Z', channel: 'estorno', reversalOf: 'D2' });
    expect(debitosParaEstornar([COMPRA, d2, manual], 'P1').map((d) => d.id)).toEqual(['D1']);
  });

  it('débito sem orderId é ignorado (nada de procurar pela descrição)', () => {
    const antigo = tx({ id: 'A1', type: 'debit', amount: 68, date: '2026-10-10T12:00:00Z', description: 'PDV #P1xx' });
    expect(debitosParaEstornar([antigo], 'P1')).toEqual([]);
    expect(debitosParaReativar([antigo], 'P1')).toEqual([]);
  });

  it('débito de outro pedido é ignorado', () => {
    const outro = tx({ id: 'O1', type: 'debit', amount: 68, date: '2026-10-10T12:00:00Z', orderId: 'P2' });
    expect(debitosParaEstornar([COMPRA, outro], 'P1').map((d) => d.id)).toEqual(['D1']);
    expect(debitosParaEstornar([outro], 'P1')).toEqual([]);
  });

  it('pagamento (credit) com o mesmo orderId não é compra', () => {
    const pago = tx({ id: 'C1', type: 'credit', amount: 68, date: '2026-10-11T00:00:00Z', orderId: 'P1' });
    expect(debitosParaEstornar([COMPRA, pago], 'P1').map((d) => d.id)).toEqual(['D1']);
  });

  it('orderId vazio não casa com nada', () => {
    expect(debitosParaEstornar([COMPRA], '')).toEqual([]);
  });
});

describe('cancelar venda: caixa fechado é imutável', () => {
  it('bloqueia se algum lançamento ativo é de outro caixa', () => {
    expect(bloqueioDeCaixa([{ caixaId: 'C1' }, { caixaId: 'C0' }], 'C1')).toBe(MSG_CAIXA_FECHADO);
  });
  it('bloqueia se não há caixa aberto', () => {
    expect(bloqueioDeCaixa([{ caixaId: 'C1' }], null)).toBe(MSG_CAIXA_FECHADO);
  });
  it('libera quando todos são do caixa aberto, ou quando não há lançamento ativo', () => {
    expect(bloqueioDeCaixa([{ caixaId: 'C1' }, { caixaId: 'C1' }], 'C1')).toBeNull();
    expect(bloqueioDeCaixa([], null)).toBeNull();
  });
});
