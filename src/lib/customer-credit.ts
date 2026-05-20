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

export const normalizeCreditPhone = (phone: string) => {
  const digits = (phone || '').replace(/\D/g, '');
  return digits.replace(/^55(?=\d{10,11}$)/, '');
};

const formatBrazilPhone = (digits: string) => {
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return '';
};

const getPhoneVariants = (phone: string) => {
  const raw = (phone || '').trim();
  const normalized = normalizeCreditPhone(phone);
  const compact = raw.replace(/[\s\-()+]/g, '');
  const formatted = formatBrazilPhone(normalized);

  return Array.from(new Set([
    normalized,
    raw,
    compact,
    formatted,
    normalized ? `+55${normalized}` : '',
  ].filter(Boolean)));
};

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

function validateCreditData(customer: CreditCustomer, amount: number): CreditValidationResult {
  const data = customer.data || {};
  const creditEnabled = data.creditEnabled === true || data.contaCasa?.enabled === true;

  if (!creditEnabled) {
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
  const nextBalance = balance + safeAmount;

  if (payDay > 0 && balance > 0 && new Date().getDate() > payDay) {
    return {
      allowed: false,
      reason: 'past_due',
      message: `Prazo bloqueado: existe divida em aberto apos o dia ${payDay}.`,
      customer,
      balance,
      limit,
      nextBalance,
    };
  }

  const limitReached = safeAmount > 0 ? nextBalance > limit : balance >= limit;
  if (limit > 0 && limitReached) {
    return {
      allowed: false,
      reason: 'over_limit',
      message: `Limite de prazo excedido. Saldo atual ${formatMoney(balance)} + compra ${formatMoney(safeAmount)} passa do limite de ${formatMoney(limit)}.`,
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
  amount: number
): Promise<CreditValidationResult> {
  const customers = await findCreditCustomers(db, ownerId, phone);
  if (customers.length === 0) {
    return {
      allowed: false,
      reason: 'not_found',
      message: 'Cliente nao cadastrado para compras a prazo.',
    };
  }

  const enabledCustomers = customers.filter((customer) => {
    const data = customer.data || {};
    return data.creditEnabled === true || data.contaCasa?.enabled === true;
  });

  if (enabledCustomers.length === 0) {
    return {
      allowed: false,
      reason: 'disabled',
      message: 'Prazo nao esta ativo para este cliente.',
      customer: customers[0],
    };
  }

  const validations = enabledCustomers.map((customer) => validateCreditData(customer, amount));
  const blocking =
    validations.find((validation) => validation.reason === 'past_due') ||
    validations.find((validation) => validation.reason === 'over_limit');
  if (blocking) return blocking;

  return validations.find((validation) => validation.allowed) || validations[0];
}
