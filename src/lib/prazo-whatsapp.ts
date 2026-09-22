/**
 * Extrato do Prazo em texto de WhatsApp — o que o dono manda para o cliente
 * conferir e pagar.
 *
 * Mandava o histórico inteiro, sempre: cliente antigo recebia meses de compras
 * para achar a conta do mês. Agora sai só o período escolhido, e aí o texto
 * precisa fechar a conta sozinho: um recorte com R$ 24 de compras e "saldo
 * devedor R$ 165,90" no fim parece erro. Por isso entram as datas do período e
 * o saldo que já vinha de antes, em ordem cronológica, como extrato de banco.
 *
 * Pura de propósito: a mesma função monta a prévia da tela e o que é enviado.
 */

import { brl } from '@/lib/utils';
import type { JanelaDePeriodo } from '@/lib/periodo';
import type { StatementRow } from '@/lib/prazo-statement';

const SEP = '━━━━━━━━━━━━━━';
const EPS = 0.009;

const dataBR = (t: number) => new Date(t).toLocaleDateString('pt-BR');

/** Lançamento sem data válida fica no começo do extrato (é assim que `buildStatement` ordena). */
const momento = (row: StatementRow) => {
  const t = Date.parse(row.tx.date || '');
  return Number.isNaN(t) ? -Infinity : t;
};

export type ExtratoWhatsApp = {
  mensagem: string;
  /** Lançamentos do período que entraram no texto. */
  lancamentos: number;
  compras: number;
  pagamentos: number;
  /** Saldo da conta antes do começo do período (0 quando é o histórico todo). */
  saldoAnterior: number;
};

/**
 * Período com as datas — "30 dias" não diz ao cliente desde quando. `null`
 * quando é o histórico inteiro. O fim nunca passa de hoje: extrato não tem
 * lançamento no futuro.
 */
export function periodoDoExtrato(janela: JanelaDePeriodo, agora = Date.now()): string | null {
  const { inicio, fim } = janela;
  if (inicio === null && fim === null) return null;
  const ultimo = fim === null ? agora : Math.min(fim - 1, agora);
  if (inicio === null) return `até ${dataBR(ultimo)}`;
  const de = dataBR(inicio);
  const ate = dataBR(Math.max(inicio, ultimo));
  return de === ate ? de : `${de} a ${ate}`;
}

/** Saldo por extenso: negativo é dinheiro do cliente, nunca "dívida de -R$ 24". */
const descreverSaldo = (valor: number) => {
  if (valor > EPS) return brl(valor);
  if (valor < -EPS) return `${brl(-valor)} a seu favor`;
  return brl(0);
};

export function buildExtratoWhatsApp(params: {
  /** Extrato inteiro em ordem cronológica, como sai de `buildStatement`. */
  rows: StatementRow[];
  janela: JanelaDePeriodo;
  nome?: string;
  /** Texto pronto do vencimento ("Vence em 10/10/2026 (18 dias)"). */
  vencimento?: string | null;
  pixKey?: string;
  pixName?: string;
  agora?: number;
}): ExtratoWhatsApp {
  const { rows, janela, nome, vencimento, pixKey, pixName, agora = Date.now() } = params;
  const saldo = rows.length > 0 ? rows[rows.length - 1].balanceAfter : 0;
  const creditoAFavor = saldo < -EPS ? -saldo : 0;

  const inicio = janela.inicio ?? -Infinity;
  const fim = janela.fim ?? Infinity;
  const antes = rows.filter((row) => momento(row) < inicio);
  const doPeriodo = rows.filter((row) => momento(row) >= inicio && momento(row) < fim);
  const depois = rows.filter((row) => momento(row) >= fim);
  const saldoAnterior = antes.length > 0 ? antes[antes.length - 1].balanceAfter : 0;

  let compras = 0;
  let pagamentos = 0;
  const blocos = doPeriodo.map(({ tx, order }) => {
    const valor = Number(tx.amount) || 0;
    const data = new Date(tx.date).toLocaleDateString('pt-BR');
    if (tx.type !== 'debit') {
      pagamentos += valor;
      return `${SEP}\n✅ ${data} · ${tx.description || 'Pagamento recebido'}\n− ${brl(valor)}`;
    }
    compras += valor;
    const itens = (order?.items || []).map((item: any) => {
      const addons = (item?.addons?.length > 0) ? ` (${item.addons.map((a: any) => a.name).join(', ')})` : '';
      return `${item?.quantity || 1}x ${item?.name || ''}${addons}`;
    });
    let bloco = `${SEP}\n🛒 ${data} · ${tx.description || 'Compra'}`;
    if (itens.length > 0) bloco += `\n${itens.join('\n')}`;
    bloco += `\nSubtotal: ${brl(valor)}`;
    return bloco;
  });

  const periodo = periodoDoExtrato(janela, agora);
  const cabecalho = [nome ? `👤 *${nome}*` : null, periodo ? `📅 Período: ${periodo}` : null].filter(Boolean);
  let msg = '🧾 *EXTRATO DA SUA CONTA*\n';
  if (cabecalho.length > 0) msg += `\n${cabecalho.join('\n')}\n`;

  // O que já vinha de antes do período: sem esta linha as compras listadas não
  // somam o saldo do fim e o cliente acha que a conta está errada.
  if (Math.abs(saldoAnterior) > EPS) msg += `\n📌 Saldo anterior: ${descreverSaldo(saldoAnterior)}`;
  if (blocos.length > 0) {
    msg += `\n${blocos.join('\n')}\n${SEP}\n`;
  } else if (periodo) {
    msg += '\nNenhuma compra ou pagamento neste período.\n';
  }

  // Período que termina antes de hoje: o saldo do fim dele é outro número que o
  // de hoje, e os dois aparecem com a data para não se confundirem.
  if (depois.length > 0 && janela.fim !== null) {
    const saldoNoFim = doPeriodo.length > 0
      ? doPeriodo[doPeriodo.length - 1].balanceAfter
      : saldoAnterior;
    msg += `📌 Saldo em ${dataBR(janela.fim - 1)}: ${descreverSaldo(saldoNoFim)}\n`;
  }

  // Conta quitada (ou com crédito sobrando) não pede pagamento nem manda PIX.
  if (creditoAFavor > 0) {
    msg += `\n✅ *CONTA QUITADA*\n💚 Crédito a favor: *${brl(creditoAFavor)}* — vira desconto na próxima compra`;
  } else if (saldo <= EPS) {
    msg += '\n✅ *CONTA QUITADA* — nada a pagar 🙌';
  } else {
    msg += `\n💰 *SALDO DEVEDOR: ${brl(saldo)}*`;
    if (vencimento) msg += `\n🗓️ ${vencimento}`;
    if (pixKey || pixName) {
      msg += '\n\n📲 *Pague via PIX*';
      if (pixKey) msg += `\n🔑 ${pixKey}`;
      if (pixName) msg += `\n🏦 ${pixName}`;
    }
    msg += '\n\nEnvie o comprovante por aqui após o pagamento 🙏';
  }

  return {
    mensagem: msg,
    lancamentos: doPeriodo.length,
    compras,
    pagamentos,
    saldoAnterior,
  };
}
