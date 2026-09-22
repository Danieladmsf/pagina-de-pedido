import { describe, expect, it } from 'vitest';
import { brl } from '@/lib/utils';
import { janelaDoPeriodo } from '@/lib/periodo';
import { buildStatement, type CreditTransaction } from '@/lib/prazo-statement';
import { buildExtratoWhatsApp, periodoDoExtrato } from './prazo-whatsapp';

const AGORA = Date.parse('2026-09-22T15:00:00.000Z');
let seq = 0;
const tx = (dia: string, type: 'debit' | 'credit', amount: number, description?: string): CreditTransaction => ({
  id: `t${++seq}`,
  type,
  amount,
  // Meio do dia em UTC: a data mostrada não muda em nenhum fuso do Brasil.
  date: `${dia}T15:00:00.000Z`,
  description: description || (type === 'debit' ? `PDV #${dia.slice(5)}` : 'Pagamento recebido (PIX)'),
});

// Conta de uma cliente real: compras de julho quitadas em agosto, compras de
// agosto e setembro quitadas em 15/09 (70 + 95 + 0,90).
const EXTRATO: CreditTransaction[] = [
  tx('2026-07-14', 'debit', 24),
  tx('2026-07-22', 'debit', 20),
  tx('2026-07-31', 'debit', 73),
  tx('2026-08-11', 'credit', 117),
  tx('2026-08-11', 'debit', 61),
  tx('2026-08-14', 'debit', 24),
  tx('2026-08-20', 'debit', 18.9),
  tx('2026-08-26', 'debit', 38),
  tx('2026-09-03', 'debit', 24),
  tx('2026-09-15', 'credit', 70),
  tx('2026-09-15', 'credit', 95),
  tx('2026-09-15', 'credit', 0.9),
];

const montar = (transacoes: CreditTransaction[], periodo: Parameters<typeof janelaDoPeriodo>[0], extra = {}) =>
  buildExtratoWhatsApp({
    rows: buildStatement(transacoes),
    janela: janelaDoPeriodo(periodo, AGORA),
    nome: 'Aline',
    agora: AGORA,
    ...extra,
  });

describe('extrato do Prazo no WhatsApp', () => {
  it('período personalizado manda só o recorte, com o saldo que vinha de antes', () => {
    const { mensagem, lancamentos, compras, pagamentos, saldoAnterior } =
      montar(EXTRATO, { preset: 'custom', de: '2026-09-01', ate: '2026-09-22' });

    expect(mensagem).toContain('📅 Período: 01/09/2026 a 22/09/2026');
    expect(mensagem).toContain(`📌 Saldo anterior: ${brl(141.9)}`);
    expect(mensagem).not.toContain('PDV #07-14');
    expect(mensagem).not.toContain('PDV #08-26');
    expect(mensagem).toContain('PDV #09-03');
    expect({ lancamentos, compras, pagamentos, saldoAnterior }).toEqual({
      lancamentos: 4, compras: 24, pagamentos: 165.9, saldoAnterior: 141.9,
    });
    expect(mensagem).toContain('✅ *CONTA QUITADA* — nada a pagar 🙌');
  });

  it('lê em ordem cronológica: saldo anterior, lançamentos e o saldo do fim', () => {
    const { mensagem } = montar(EXTRATO, { preset: 'custom', de: '2026-09-01', ate: '2026-09-22' });
    const posicao = (trecho: string) => mensagem.indexOf(trecho);

    expect(posicao('Saldo anterior')).toBeLessThan(posicao('PDV #09-03'));
    expect(posicao('PDV #09-03')).toBeLessThan(posicao(`− ${brl(70)}`));
    expect(posicao(`− ${brl(0.9)}`)).toBeLessThan(posicao('CONTA QUITADA'));
  });

  it('histórico inteiro não ganha linha de período nem de saldo anterior', () => {
    const { mensagem, lancamentos } = montar(EXTRATO, { preset: 'tudo' });

    expect(mensagem).not.toContain('Período');
    expect(mensagem).not.toContain('Saldo anterior');
    expect(mensagem).toContain('PDV #07-14');
    expect(lancamentos).toBe(EXTRATO.length);
  });

  it('atalho de dias vira datas — o cliente não sabe de quando contam os "30 dias"', () => {
    expect(periodoDoExtrato(janelaDoPeriodo({ preset: '30' }, AGORA), AGORA)).toBe('23/08/2026 a 22/09/2026');
    expect(periodoDoExtrato(janelaDoPeriodo({ preset: 'tudo' }, AGORA), AGORA)).toBeNull();
  });

  it('período sem lançamento ainda cobra a dívida que vinha de antes', () => {
    const devendo = [tx('2026-08-20', 'debit', 18.9)];
    const { mensagem, lancamentos } = montar(
      devendo,
      { preset: 'custom', de: '2026-09-01', ate: '2026-09-22' },
      { vencimento: 'Vencida em 10/09/2026', pixKey: '16999998877', pixName: 'Gostinho' },
    );

    expect(lancamentos).toBe(0);
    expect(mensagem).toContain(`📌 Saldo anterior: ${brl(18.9)}`);
    expect(mensagem).toContain('Nenhuma compra ou pagamento neste período.');
    expect(mensagem).toContain(`💰 *SALDO DEVEDOR: ${brl(18.9)}*`);
    expect(mensagem).toContain('🗓️ Vencida em 10/09/2026');
    expect(mensagem).toContain('🔑 16999998877');
  });

  it('período que acaba antes de hoje mostra o saldo daquele dia e o de hoje', () => {
    const { mensagem } = montar(EXTRATO, { preset: 'custom', de: '2026-08-01', ate: '2026-08-31' });

    expect(mensagem).toContain('📅 Período: 01/08/2026 a 31/08/2026');
    expect(mensagem).toContain(`📌 Saldo anterior: ${brl(117)}`);
    expect(mensagem).toContain(`📌 Saldo em 31/08/2026: ${brl(141.9)}`);
    expect(mensagem).not.toContain('PDV #09-03');
    expect(mensagem).toContain('CONTA QUITADA');
  });

  it('saldo anterior negativo é crédito do cliente, não dívida', () => {
    const pagouAMais = [tx('2026-08-10', 'debit', 24), tx('2026-08-11', 'credit', 48), tx('2026-09-05', 'debit', 30)];
    const { mensagem } = montar(pagouAMais, { preset: 'custom', de: '2026-09-01', ate: '2026-09-22' });

    expect(mensagem).toContain(`📌 Saldo anterior: ${brl(24)} a seu favor`);
    expect(mensagem).toContain(`💰 *SALDO DEVEDOR: ${brl(6)}*`);
  });

  it('conta quitada não pede PIX', () => {
    const { mensagem } = montar(EXTRATO, { preset: 'tudo' }, { pixKey: 'chave', pixName: 'Loja' });

    expect(mensagem).not.toContain('Pague via PIX');
  });
});
