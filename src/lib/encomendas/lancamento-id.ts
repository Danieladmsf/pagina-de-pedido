/**
 * Id fixo do lançamento de caixa de cada etapa de pagamento da encomenda.
 *
 * Em 19/08/2026 a encomenda ZEQ5PNX4 (R$ 320,00) recebeu **dois** lançamentos
 * de sinal de R$ 160,00, com dois segundos de diferença: um duplo clique em
 * "Confirmar". A guarda que existia lia `sinalLancado` do documento, e o
 * documento só é atualizado DEPOIS que o lançamento grava — no intervalo, o
 * segundo clique via a encomenda ainda sem sinal e lançava de novo. O caixa
 * daquele dia fechou R$ 160,00 acima do que entrou de verdade.
 *
 * Com um id determinístico, o segundo clique escreve no MESMO documento em vez
 * de criar outro: a duplicata deixa de ser possível, mesmo vinda de dois
 * aparelhos ao mesmo tempo, onde nenhuma trava de tela alcança.
 *
 * Só serve para etapa que acontece uma vez por encomenda. A entrega paga em
 * várias formas gera um lançamento por forma e continua com id automático.
 */

export type EtapaDaEncomenda = 'sinal' | 'entrada';

export function idDoLancamentoDeEncomenda(encomendaId: string, etapa: EtapaDaEncomenda): string {
  const limpo = String(encomendaId || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!limpo) throw new Error('Encomenda sem id: não dá para gerar o lançamento.');
  return `enc-${limpo}-${etapa}`;
}
