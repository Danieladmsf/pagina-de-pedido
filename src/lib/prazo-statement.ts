/**
 * Extrato do Prazo (Conta da Casa) — a regra pura, sem Firestore e sem React.
 *
 * O saldo do cliente existe em dois lugares: o campo `creditBalance` do
 * cadastro (contador rápido, escrito com `increment`) e a soma do extrato
 * (`clientes/{id}/credit_transactions`). Quando os dois divergem, QUEM MANDA É
 * O EXTRATO — ele tem lançamento por lançamento e data; o contador é só um
 * atalho de leitura. Por isso o saldo desta tela é sempre reconstruído aqui.
 *
 * O vínculo lançamento → pedido também mora aqui. Lançamentos novos gravam
 * `orderId`; os antigos só têm o prefixo de 5 caracteres do id dentro da
 * descrição ("PDV #ab12c"), e os de mesa nem isso. As duas formas continuam
 * sendo aceitas para o histórico não sumir da tela.
 */

import { getOrderCode } from '@/lib/order-code';
import { findLegacyOrderBefore } from '@/lib/order-linking';

export type CreditTransactionType = 'debit' | 'credit';

export type CreditTransaction = {
  id: string;
  type: CreditTransactionType;
  amount: number;
  /** ISO string — é o que o app grava desde sempre. */
  date: string;
  description?: string;
  /** Gravado nos lançamentos novos (lib/payments.ts). Ausente no histórico. */
  orderId?: string;
  /** Encomenda que originou a compra — mora em `encomendas`, não em `orders`. */
  encomendaId?: string;
  /** 'balcao' | 'mesa' | 'delivery' | 'acerto' — só nos lançamentos novos. */
  channel?: string;
  /** Forma usada no recebimento (pix, dinheiro...). Só em `credit`. */
  paymentMethod?: string;
};

export type StatementRow = {
  tx: CreditTransaction;
  /** Pedido casado (por orderId ou pelo prefixo antigo), quando existir. */
  order: any | null;
  /** Saldo devedor DEPOIS deste lançamento. */
  balanceAfter: number;
};

export type StatementTotals = {
  /** Saldo devedor reconstruído pelo extrato. */
  balance: number;
  /** Tudo que foi comprado a prazo (débitos). */
  totalPurchases: number;
  /** Tudo que já foi pago (créditos). */
  totalPaid: number;
  purchaseCount: number;
  paymentCount: number;
  averageTicket: number;
  /** Data da compra que abriu a dívida atual (null se está quite). */
  debtSince: Date | null;
  lastPurchaseAt: Date | null;
  lastPaymentAt: Date | null;
};

const toTime = (value?: string) => {
  const parsed = Date.parse(value || '');
  return Number.isNaN(parsed) ? 0 : parsed;
};

const signed = (tx: CreditTransaction) =>
  (tx.type === 'debit' ? 1 : -1) * (Number(tx.amount) || 0);

/** Prefixo do pedido escondido na descrição do lançamento antigo ("PDV #ab12c"). */
export function legacyOrderRef(description?: string): string {
  const text = description || '';
  if (!text.includes('#')) return '';
  return text.replace(/^.*#/, '').trim();
}

/**
 * Pedido de um lançamento: `orderId`/`encomendaId` quando existem, senão o
 * prefixo antigo. Encomenda entra na MESMA lista de origens (a tela carrega as
 * duas coleções), mas só casa por id: a descrição dela é "Encomenda ab12c",
 * sem "#", e casar esse prefixo contra `orders` acharia um pedido qualquer.
 */
export function matchOrderForTransaction(tx: CreditTransaction, orders: any[]): any | null {
  if (tx.orderId) {
    return orders.find((order) => order?.id === tx.orderId && order?.origem !== 'encomenda') || null;
  }
  if (tx.encomendaId) {
    return orders.find((order) => order?.id === tx.encomendaId && order?.origem === 'encomenda') || null;
  }
  const ref = legacyOrderRef(tx.description);
  if (!ref) return null;
  return findLegacyOrderBefore(
    orders.filter((order) => order?.origem !== 'encomenda'),
    ref,
    tx.date,
  );
}

/**
 * Compras do extrato cujo pedido NÃO está na lista carregada.
 *
 * A tela busca os pedidos do cliente pelo telefone, e o telefone é gravado no
 * pedido do jeito que foi digitado no PDV ("(16)992156780" numa venda,
 * "16992156780" na outra) — a busca por formato conhecido erra alguns. Como o
 * próprio lançamento carrega o pedido (`orderId` nos novos, "#lstG2" nos
 * antigos), o que faltou pode ser buscado pelo id, e aí o formato do telefone
 * não importa mais. Devolve separado porque a busca é diferente: id completo é
 * leitura direta; prefixo antigo é faixa de ids.
 */
export function missingOrderRefs(
  transactions: CreditTransaction[],
  orders: any[],
): { ids: string[]; prefixes: string[] } {
  const ids = new Set<string>();
  const prefixes = new Set<string>();

  for (const tx of transactions) {
    if (tx.type !== 'debit') continue;
    if (matchOrderForTransaction(tx, orders)) continue;
    if (tx.orderId) {
      ids.add(tx.orderId);
      continue;
    }
    // Encomenda não é buscada por id solto: ela está em outra coleção, e quem
    // carrega é a tela (que sabe se a loja tem encomendas).
    if (tx.encomendaId) continue;
    const ref = legacyOrderRef(tx.description);
    if (ref) prefixes.add(ref);
  }

  return { ids: [...ids], prefixes: [...prefixes] };
}

/**
 * Monta o extrato em ordem cronológica com o saldo acumulado em cada linha.
 * A tela pode filtrar/inverter depois — o saldo de cada linha continua sendo o
 * do momento do lançamento, que é o que o cliente confere.
 */
export function buildStatement(transactions: CreditTransaction[], orders: any[] = []): StatementRow[] {
  const ascending = [...transactions].sort((a, b) => toTime(a.date) - toTime(b.date));
  let running = 0;
  return ascending.map((tx) => {
    running += signed(tx);
    return {
      tx,
      order: matchOrderForTransaction(tx, orders),
      balanceAfter: running,
    };
  });
}

/**
 * Desde quando o cliente está devendo: percorre o extrato e acha o início do
 * período em que o saldo ficou positivo sem nunca zerar. Pagamento total zera a
 * idade da dívida. Mesma regra do bloqueio por vencimento (customer-credit.ts),
 * só que aqui já com o extrato em mãos, sem ida ao banco.
 */
export function statementTotals(rows: StatementRow[]): StatementTotals {
  let totalPurchases = 0;
  let totalPaid = 0;
  let purchaseCount = 0;
  let paymentCount = 0;
  let debtSince: string | null = null;
  let lastPurchaseAt: string | null = null;
  let lastPaymentAt: string | null = null;

  rows.forEach(({ tx, balanceAfter }) => {
    const amount = Number(tx.amount) || 0;
    if (tx.type === 'debit') {
      totalPurchases += amount;
      purchaseCount += 1;
      lastPurchaseAt = tx.date;
    } else {
      totalPaid += amount;
      paymentCount += 1;
      lastPaymentAt = tx.date;
    }
    if (balanceAfter > 0.009) {
      if (!debtSince) debtSince = tx.date;
    } else {
      debtSince = null;
    }
  });

  const balance = rows.length > 0 ? rows[rows.length - 1].balanceAfter : 0;

  return {
    balance,
    totalPurchases,
    totalPaid,
    purchaseCount,
    paymentCount,
    averageTicket: purchaseCount > 0 ? totalPurchases / purchaseCount : 0,
    debtSince: debtSince ? new Date(debtSince) : null,
    lastPurchaseAt: lastPurchaseAt ? new Date(lastPurchaseAt) : null,
    lastPaymentAt: lastPaymentAt ? new Date(lastPaymentAt) : null,
  };
}

// ────────────────────────── O que um pagamento quitou ──────────────────────────

export type CoveredPurchase = {
  /** A compra (débito) que este pagamento abateu. */
  tx: CreditTransaction;
  order: any | null;
  /** Valor cheio da compra. */
  amount: number;
  /** Quanto DESTE pagamento entrou nela (menor que `amount` = abatimento parcial). */
  applied: number;
  /** A compra ficou quitada depois deste pagamento? */
  settled: boolean;
};

export type PaymentAllocation = {
  /** Saldo devedor imediatamente ANTES do pagamento (negativo = crédito a favor). */
  balanceBefore: number;
  paid: number;
  /** Saldo devedor depois. Negativo = sobrou crédito a favor do cliente. */
  balanceAfter: number;
  /** Parte do pagamento que não achou compra em aberto e virou crédito a favor. */
  leftover: number;
  /** As compras abatidas, da mais antiga para a mais nova. */
  covered: CoveredPurchase[];
};

/**
 * O que um pagamento quitou.
 *
 * O extrato do Prazo é um SALDO CORRENTE: o recebimento entra como um crédito
 * solto, sem apontar para compra nenhuma. Então "o que foi pago" não está
 * gravado em lugar nenhum — é reconstruído aqui, quitando da compra mais antiga
 * para a mais nova (o cliente paga o que está atrasado primeiro), que é como
 * dono e cliente conferem a conta na prática.
 *
 * A reconstrução roda o extrato inteiro até o pagamento, e não só as compras
 * ainda em aberto hoje: pagamento antigo tem que mostrar o que ele quitou NA
 * ÉPOCA, senão o acerto de julho apareceria abatendo a compra de agosto.
 *
 * Pagamento acima da dívida vira crédito a favor (`leftover`) e é usado nas
 * compras seguintes — mesmo modelo do saldo negativo da tela do Prazo.
 */
export function allocatePayment(
  transactions: CreditTransaction[],
  paymentId: string,
  orders: any[] = [],
): PaymentAllocation | null {
  const EPS = 0.009;
  const ascending = [...transactions].sort((a, b) => toTime(a.date) - toTime(b.date));

  /** Compras ainda em aberto, da mais antiga para a mais nova. */
  const open: Array<{ tx: CreditTransaction; remaining: number }> = [];
  /** Pagamento adiantado ainda não consumido por nenhuma compra. */
  let creditPool = 0;

  for (const tx of ascending) {
    const amount = Number(tx.amount) || 0;

    if (tx.type === 'debit') {
      let devido = amount;
      const usaCredito = Math.min(creditPool, devido);
      creditPool -= usaCredito;
      devido -= usaCredito;
      if (devido > EPS) open.push({ tx, remaining: devido });
      continue;
    }

    const isAlvo = tx.id === paymentId;
    const balanceBefore = open.reduce((s, o) => s + o.remaining, 0) - creditPool;
    const covered: CoveredPurchase[] = [];
    let rest = amount;

    while (rest > EPS && open.length > 0) {
      const head = open[0];
      const applied = Math.min(head.remaining, rest);
      head.remaining -= applied;
      rest -= applied;
      const settled = head.remaining <= EPS;
      covered.push({
        tx: head.tx,
        order: matchOrderForTransaction(head.tx, orders),
        amount: Number(head.tx.amount) || 0,
        applied,
        settled,
      });
      if (settled) open.shift();
    }

    if (isAlvo) {
      return {
        balanceBefore,
        paid: amount,
        balanceAfter: balanceBefore - amount,
        leftover: rest,
        covered,
      };
    }

    creditPool += rest;
  }

  return null;
}

/**
 * Acha, no extrato do cliente, o crédito que corresponde a um recebimento
 * lançado no caixa.
 *
 * Lançamentos novos carregam o id do crédito e casam direto. Os antigos só têm
 * valor e hora: o caixa grava `serverTimestamp` e o extrato grava o relógio do
 * navegador, então a comparação é por proximidade, nunca por igualdade. Fora da
 * janela, só casa se existir um único crédito com aquele valor — melhor não
 * mostrar nada do que apontar o pagamento errado.
 */
export function findPaymentTransaction(
  transactions: CreditTransaction[],
  ref: { id?: string | null; amount: number; at?: Date | null; toleranceMs?: number },
): CreditTransaction | null {
  if (ref.id) {
    const exato = transactions.find((tx) => tx.id === ref.id);
    if (exato) return exato;
  }

  const candidatos = transactions.filter(
    (tx) => tx.type === 'credit' && Math.abs((Number(tx.amount) || 0) - ref.amount) < 0.009,
  );
  if (candidatos.length === 0) return null;

  const alvo = ref.at ? ref.at.getTime() : NaN;
  if (!Number.isNaN(alvo)) {
    const tolerancia = ref.toleranceMs ?? 10 * 60 * 1000;
    const perto = candidatos
      .map((tx) => ({ tx, dist: Math.abs(toTime(tx.date) - alvo) }))
      .filter(({ dist }) => dist <= tolerancia)
      .sort((a, b) => a.dist - b.dist)[0];
    if (perto) return perto.tx;
  }

  return candidatos.length === 1 ? candidatos[0] : null;
}

// ─────────────────────────────── Exportação ───────────────────────────────

/** Sem o BOM o Excel abre o arquivo em ANSI e come os acentos. */
const BOM = '\uFEFF';

/** Excel em português abre CSV com ponto-e-vírgula; vírgula vira uma coluna só. */
const SEP = ';';

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(SEP);
}

/** Número no formato que a planilha brasileira entende (1234.5 -> "1234,50"). */
function csvNumber(value: number): string {
  return (Number(value) || 0).toFixed(2).replace('.', ',');
}

function csvDate(value?: string) {
  const time = toTime(value);
  if (!time) return { data: '', hora: '' };
  const date = new Date(time);
  return {
    data: date.toLocaleDateString('pt-BR'),
    hora: date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  };
}

export type ExportCustomer = {
  nome?: string;
  celular?: string;
};

/** Cabeçalho comum dos dois arquivos: de quem é o extrato e quando saiu. */
function exportHeader(customer: ExportCustomer, titulo: string): string[] {
  const { data, hora } = csvDate(new Date().toISOString());
  return [
    csvLine([titulo]),
    csvLine(['Cliente', customer.nome || '']),
    csvLine(['Telefone', customer.celular || '']),
    csvLine(['Gerado em', `${data} ${hora}`]),
    '',
  ];
}

/** Extrato lançamento a lançamento (o arquivo que fecha com o saldo). */
export function buildStatementCsv(rows: StatementRow[], customer: ExportCustomer): string {
  const totals = statementTotals(rows);
  const linhas = [
    ...exportHeader(customer, 'Extrato do Prazo'),
    csvLine(['Data', 'Hora', 'Tipo', 'Descricao', 'Pedido', 'Compra (R$)', 'Pagamento (R$)', 'Saldo (R$)', 'Forma']),
    ...rows.map(({ tx, order, balanceAfter }) => {
      const { data, hora } = csvDate(tx.date);
      const isDebit = tx.type === 'debit';
      return csvLine([
        data,
        hora,
        isDebit ? 'Compra' : 'Pagamento',
        tx.description || (isDebit ? 'Compra' : 'Pagamento'),
        (order ? getOrderCode(order) : '') || tx.orderId || legacyOrderRef(tx.description),
        isDebit ? csvNumber(tx.amount) : '',
        isDebit ? '' : csvNumber(tx.amount),
        csvNumber(balanceAfter),
        tx.paymentMethod || '',
      ]);
    }),
    '',
    csvLine(['', '', '', 'TOTAIS', '', csvNumber(totals.totalPurchases), csvNumber(totals.totalPaid), csvNumber(totals.balance), '']),
  ];
  return BOM + linhas.join('\r\n');
}

/** Itens comprados (só as compras que têm pedido casado). */
export function buildItemsCsv(rows: StatementRow[], customer: ExportCustomer): string {
  const linhas = [
    ...exportHeader(customer, 'Itens comprados a prazo'),
    csvLine(['Data', 'Pedido', 'Item', 'Qtd', 'Adicionais', 'Valor unit. (R$)', 'Total do item (R$)']),
  ];

  rows.forEach(({ tx, order }) => {
    if (tx.type !== 'debit' || !order) return;
    const { data } = csvDate(tx.date);
    (order.items || []).forEach((item: any) => {
      const quantity = Number(item?.quantity) || 0;
      const unitPrice = Number(item?.unitPrice ?? item?.price) || 0;
      linhas.push(csvLine([
        data,
        getOrderCode(order),
        item?.name || '',
        quantity,
        (item?.addons || []).map((addon: any) => addon?.name).filter(Boolean).join(' + '),
        csvNumber(unitPrice),
        csvNumber(unitPrice * quantity),
      ]));
    });
  });

  return BOM + linhas.join('\r\n');
}

/** Nome de arquivo previsível e sem acento/espaço (Windows e Excel agradecem). */
export function exportFileName(prefix: string, customerName?: string): string {
  const slug = (customerName || 'cliente')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40) || 'cliente';
  const hoje = new Date().toISOString().slice(0, 10);
  return `${prefix}-${slug}-${hoje}.csv`;
}
