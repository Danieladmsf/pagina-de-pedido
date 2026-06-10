import { collection, getDocs, query, where } from 'firebase/firestore';

export type CreditCustomer = {
  id: string;
  data: any;
};

export type CreditValidationResult = {
  allowed: boolean;
  reason?: 'not_found' | 'disabled' | 'past_due' | 'over_limit';
  message?: string;
  customer?: CreditCustomer;
  balance?: number;
  limit?: number;
  nextBalance?: number;
};

const formatMoney = (value: number) => `R$ ${value.toFixed(2).replace('.', ',')}`;

// creditEnabled explícito (true/false, gravado pela aba Clientes) tem
// precedência; o legado contaCasa.enabled só vale quando creditEnabled
// nunca foi definido. Sem isso, desativar o prazo na aba Clientes não
// surtia efeito para clientes do cadastro rápido (que gravava os dois).
export const isCreditEnabled = (data: any) =>
  data?.creditEnabled === true ||
  (data?.creditEnabled === undefined && data?.contaCasa?.enabled === true);

export const normalizeCreditPhone = (phone: string) => {
  const digits = (phone || '').replace(/\D/g, '');
  return digits.replace(/^55(?=\d{10,11}$)/, '');
};

const formatBrazilPhone = (digits: string) => {
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return '';
};

export const getPhoneVariants = (phone: string) => {
  const raw = (phone || '').trim();
  const normalized = normalizeCreditPhone(phone);
  const compact = raw.replace(/[\s\-()+]/g, '');
  const withoutNinthDigit = normalized.length === 11 && normalized[2] === '9'
    ? `${normalized.slice(0, 2)}${normalized.slice(3)}`
    : '';
  const withNinthDigit = normalized.length === 10
    ? `${normalized.slice(0, 2)}9${normalized.slice(2)}`
    : '';
  const localNumbers = Array.from(new Set([normalized, withoutNinthDigit, withNinthDigit].filter(Boolean)));

  return Array.from(new Set([
    raw,
    compact,
    ...localNumbers.flatMap((localNumber) => [
      localNumber,
      formatBrazilPhone(localNumber),
      `+55${localNumber}`,
      `55${localNumber}`,
    ]),
  ].filter(Boolean)));
};

// Desde quando o cliente está devendo, reconstruído pelo extrato: percorre as
// transações em ordem e acha o início do período em que o saldo ficou > 0 sem
// nunca zerar. Pagamento total zera e "reseta" a idade da dívida.
async function getDebtSince(db: any, clienteId: string): Promise<Date | null> {
  const snap = await getDocs(collection(db, 'clientes', clienteId, 'credit_transactions'));
  const transactions = snap.docs
    .map((transactionDoc: any) => transactionDoc.data())
    .filter((transaction: any) => transaction?.date)
    .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));

  let runningBalance = 0;
  let since: string | null = null;
  for (const transaction of transactions) {
    const amount = Number(transaction.amount) || 0;
    runningBalance += transaction.type === 'debit' ? amount : -amount;
    if (runningBalance > 0.009) {
      if (!since) since = transaction.date;
    } else {
      since = null;
    }
  }
  return since ? new Date(since) : null;
}

// Vencimento da dívida: o próximo "dia de pagamento" depois da compra.
// Comprou até o dia X -> vence no dia X do mesmo mês; depois -> mês seguinte.
const dueDateFor = (debtSince: Date, payDay: number) => {
  const monthOffset = debtSince.getDate() <= payDay ? 0 : 1;
  const year = debtSince.getFullYear();
  const month = debtSince.getMonth() + monthOffset;
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(payDay, lastDayOfMonth), 23, 59, 59, 999);
};

const isPendingCreditOrder = (order: any, ownerId: string) =>
  order?.ownerId === ownerId &&
  typeof order?.paymentMethod === 'string' &&
  order.paymentMethod.includes('conta_casa') &&
  !['delivered', 'canceled'].includes(order?.status);

/**
 * Soma os pedidos a prazo ainda em andamento do próprio cliente (consulta por
 * customerUid — é o que as regras permitem no lado do cliente). Sem isso o
 * limite só enxergava dívida de pedidos já entregues.
 */
export async function sumPendingCreditOrdersForCustomer(db: any, ownerId: string, customerUid: string): Promise<number> {
  if (!db || !ownerId || !customerUid) return 0;
  try {
    const snap = await getDocs(query(collection(db, 'orders'), where('customerUid', '==', customerUid)));
    return snap.docs.reduce((sum: number, orderDoc: any) => {
      const order = orderDoc.data();
      return isPendingCreditOrder(order, ownerId) ? sum + (Number(order.totalAmount) || 0) : sum;
    }, 0);
  } catch {
    return 0;
  }
}

/** Versão do painel admin: varre os pedidos da loja e casa por telefone. */
export async function sumPendingCreditOrdersForOwner(db: any, ownerId: string, phone: string): Promise<number> {
  if (!db || !ownerId || !phone) return 0;
  try {
    const variants = new Set(getPhoneVariants(phone));
    const snap = await getDocs(query(collection(db, 'orders'), where('ownerId', '==', ownerId)));
    return snap.docs.reduce((sum: number, orderDoc: any) => {
      const order = orderDoc.data();
      const matchesPhone = variants.has(order?.customerIdentifier) || variants.has(order?.customerPhone);
      return matchesPhone && isPendingCreditOrder(order, ownerId) ? sum + (Number(order.totalAmount) || 0) : sum;
    }, 0);
  } catch {
    return 0;
  }
}

export async function findCreditCustomers(db: any, ownerId: string, phone: string): Promise<CreditCustomer[]> {
  if (!db || !ownerId || !phone) return [];

  const byId = new Map<string, CreditCustomer>();
  for (const phoneVariant of getPhoneVariants(phone)) {
    const snap = await getDocs(query(
      collection(db, 'clientes'),
      where('ownerId', '==', ownerId),
      where('celular', '==', phoneVariant)
    ));

    snap.docs.forEach((customerDoc: any) => {
      if (!byId.has(customerDoc.id)) {
        byId.set(customerDoc.id, { id: customerDoc.id, data: customerDoc.data() });
      }
    });
  }

  return Array.from(byId.values());
}

function validateCreditData(
  customer: CreditCustomer,
  amount: number,
  options?: { pendingAmount?: number; debtSince?: Date | null }
): CreditValidationResult {
  const data = customer.data || {};

  if (!isCreditEnabled(data)) {
    return {
      allowed: false,
      reason: 'disabled',
      message: 'Prazo nao esta ativo para este cliente.',
      customer,
    };
  }

  const balance = Number(data.creditBalance) || 0;
  const limit = Number(data.creditLimit) || 0;
  const payDay = Number(data.creditPayDay) || 0;
  const safeAmount = Number(amount) || 0;
  // Pedidos a prazo ainda não entregues também consomem o limite
  const pendingAmount = Number(options?.pendingAmount) || 0;
  const effectiveBalance = balance + pendingAmount;
  const nextBalance = effectiveBalance + safeAmount;

  if (payDay > 0 && balance > 0) {
    // Dívida vencida bloqueia em qualquer mês, até quitar. O vencimento é o
    // próximo "dia de pagamento" depois da compra mais antiga em aberto.
    // Sem extrato para datar a dívida, cai na regra antiga (dia do mês).
    const debtSince = options?.debtSince;
    const overdue = debtSince
      ? new Date() > dueDateFor(debtSince, payDay)
      : new Date().getDate() > payDay;
    if (overdue) {
      return {
        allowed: false,
        reason: 'past_due',
        message: `Prazo bloqueado: divida de ${formatMoney(balance)} venceu no dia ${payDay}. Quite o saldo para voltar a comprar a prazo.`,
        customer,
        balance,
        limit,
        nextBalance,
      };
    }
  }

  const limitReached = safeAmount > 0 ? nextBalance > limit : effectiveBalance >= limit;
  if (limit > 0 && limitReached) {
    const pendingNote = pendingAmount > 0 ? ` (inclui ${formatMoney(pendingAmount)} de pedidos em andamento)` : '';
    return {
      allowed: false,
      reason: 'over_limit',
      message: `Limite de prazo excedido. Saldo atual ${formatMoney(effectiveBalance)}${pendingNote} + compra ${formatMoney(safeAmount)} passa do limite de ${formatMoney(limit)}.`,
      customer,
      balance,
      limit,
      nextBalance,
    };
  }

  return {
    allowed: true,
    customer,
    balance,
    limit,
    nextBalance,
  };
}

export async function validateCustomerCredit(
  db: any,
  ownerId: string,
  phone: string,
  amount: number,
  options?: { pendingAmount?: number }
): Promise<CreditValidationResult> {
  const customers = await findCreditCustomers(db, ownerId, phone);
  if (customers.length === 0) {
    return {
      allowed: false,
      reason: 'not_found',
      message: 'Cliente nao cadastrado para compras a prazo.',
    };
  }

  const enabledCustomers = customers.filter((customer) => isCreditEnabled(customer.data || {}));

  if (enabledCustomers.length === 0) {
    return {
      allowed: false,
      reason: 'disabled',
      message: 'Prazo nao esta ativo para este cliente.',
      customer: customers[0],
    };
  }

  // Data da dívida (via extrato) só é necessária quando há saldo e dia de pagamento
  const debtSinceById = new Map<string, Date | null>();
  await Promise.all(enabledCustomers.map(async (customer) => {
    const data = customer.data || {};
    if ((Number(data.creditPayDay) || 0) > 0 && (Number(data.creditBalance) || 0) > 0) {
      try {
        debtSinceById.set(customer.id, await getDebtSince(db, customer.id));
      } catch {
        // Sem acesso ao extrato: validateCreditData cai na regra antiga
      }
    }
  }));

  const validations = enabledCustomers.map((customer) => validateCreditData(customer, amount, {
    pendingAmount: options?.pendingAmount,
    debtSince: debtSinceById.get(customer.id),
  }));
  const blocking =
    validations.find((validation) => validation.reason === 'past_due') ||
    validations.find((validation) => validation.reason === 'over_limit');
  if (blocking) return blocking;

  return validations.find((validation) => validation.allowed) || validations[0];
}
