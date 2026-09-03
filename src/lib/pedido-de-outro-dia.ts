/**
 * "Este pedido não é de hoje" — o aviso que faltava na hora de fechar a conta.
 *
 * Por que existe: em 03/09/2026 a dona da Gostinho abriu o caixa e viu uma
 * venda de R$ 31 que não tinha feito. Estava tudo certo — era um delivery de
 * ONTEM, que ficou pendente e foi finalizado às 10:53, 19 segundos antes de ela
 * fechar o caixa do dia anterior. Como o faturamento é datado pelo LANÇAMENTO
 * no caixa (ver `lib/faturamento`), e não pela data do pedido, a venda de ontem
 * entrou no dia de hoje.
 *
 * Nada disso é erro: o dinheiro (ou a dívida) nasce quando a conta é fechada.
 * O que faltava era o sistema dizer isso ANTES de confirmar, em vez de deixar a
 * surpresa para o dia seguinte. Medido em 45 dias: 4 de 331 vendas foram
 * lançadas em dia diferente do pedido — todas delivery da tarde finalizado na
 * manhã seguinte, entre 09h35 e 11h32, na hora de arrumar o caixa.
 *
 * Consequência conhecida e esperada (não é o que este aviso corrige): o
 * fechamento daquele caixa e o Dashboard daquele dia divergem pelo valor. No
 * caso real: caixa da sessão 51 = R$ 619,50, Dashboard de 02/09 = R$ 588,50.
 */

/** O dia (AAAA-MM-DD) que aquele instante tinha no fuso da loja. */
export function diaDaLoja(quando: Date, timezone = 'America/Sao_Paulo'): string {
  // `en-CA` já formata como AAAA-MM-DD, então não há remontagem manual de
  // partes — que é onde esse tipo de conta costuma errar na virada do mês.
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(quando);
  } catch {
    // Fuso inválido no cadastro não pode derrubar o fechamento da conta.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(quando);
  }
}

/** Aceita Timestamp do Firestore, Date, número ou string ISO. */
function paraData(valor: any): Date | null {
  if (!valor) return null;
  if (typeof valor?.toDate === 'function') {
    const d = valor.toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface AvisoDeOutroDia {
  /** "ontem", "3 de setembro", … — como a frase se refere ao dia do pedido. */
  quando: string;
  /** Quantos dias de diferença (1 = ontem). */
  diasAtras: number;
  /** A frase pronta, em português de dono de loja. */
  texto: string;
}

const MES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/**
 * Devolve o aviso quando o pedido é de um dia anterior; `null` quando é de hoje
 * (o caso normal), quando a data não dá para ler, ou quando o pedido é do
 * futuro — relógio adiantado de máquina de loja não pode virar alarme.
 */
export function avisoDePedidoDeOutroDia(
  dataDoPedido: any,
  agora: Date = new Date(),
  timezone = 'America/Sao_Paulo',
): AvisoDeOutroDia | null {
  const pedido = paraData(dataDoPedido);
  if (!pedido) return null;

  const diaDoPedido = diaDaLoja(pedido, timezone);
  const diaDeHoje = diaDaLoja(agora, timezone);
  if (diaDoPedido >= diaDeHoje) return null;

  // Diferença contada sobre as datas do calendário da loja, não sobre 24h
  // corridas: um pedido das 23h50 fechado às 00h10 é "de ontem", e um das 00h10
  // fechado às 23h50 do mesmo dia não é de dia nenhum.
  const [ay, am, ad] = diaDoPedido.split('-').map(Number);
  const [by, bm, bd] = diaDeHoje.split('-').map(Number);
  const diasAtras = Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000,
  );

  const quando = diasAtras === 1 ? 'ontem' : `${ad} de ${MES[am - 1]}`;

  return {
    quando,
    diasAtras,
    texto: `Este pedido é de ${quando}. A venda vai entrar no caixa e no faturamento de hoje.`,
  };
}
