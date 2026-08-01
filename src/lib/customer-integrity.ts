import { normalizeCreditPhone } from '@/lib/customer-credit';
import { normalizeSearch } from '@/lib/utils';

export type CustomerIntegrityIssueType =
  | 'duplicate_phone'
  | 'invalid_phone'
  | 'homonym_without_phone'
  | 'balance_divergence'
  | 'order_invalid_phone';

export type CustomerIntegrityIssue = {
  key: string;
  type: CustomerIntegrityIssueType;
  customerIds: string[];
  title: string;
  description: string;
  expectedBalance?: number;
  currentBalance?: number;
  orderId?: string;
  currentValue?: string;
};

type CustomerLike = {
  id: string;
  nome?: string;
  celular?: string;
  archived?: boolean;
  integrityIgnoredIssues?: string[];
  creditBalance?: number;
};

export const isValidCustomerPhone = (phone: string): boolean => {
  const normalized = normalizeCreditPhone(phone);
  return normalized.length === 10 || normalized.length === 11;
};

export const isCustomerArchived = (customer: any): boolean => customer?.archived === true;

const issueKey = (type: CustomerIntegrityIssueType, value: string, ids: string[]) =>
  `${type}:${value}:${[...ids].sort().join(',')}`;

/** Conflitos que podem ser descobertos sem ler subcoleções. */
export function findCustomerIdentityIssues(customers: CustomerLike[]): CustomerIntegrityIssue[] {
  const active = (customers || []).filter((customer) => !isCustomerArchived(customer));
  const issues: CustomerIntegrityIssue[] = [];
  const byPhone = new Map<string, CustomerLike[]>();
  const byNameWithoutPhone = new Map<string, CustomerLike[]>();

  for (const customer of active) {
    const rawPhone = String(customer.celular || '').trim();
    const phone = normalizeCreditPhone(rawPhone);
    if (rawPhone && !isValidCustomerPhone(rawPhone)) {
      issues.push({
        key: issueKey('invalid_phone', phone || rawPhone, [customer.id]),
        type: 'invalid_phone',
        customerIds: [customer.id],
        title: 'Telefone inválido',
        description: `${customer.nome || 'Cliente sem nome'} está com “${rawPhone}”.`,
      });
    }
    if (isValidCustomerPhone(rawPhone)) {
      const list = byPhone.get(phone) || [];
      list.push(customer);
      byPhone.set(phone, list);
      continue;
    }

    const name = normalizeSearch(customer.nome || '');
    if (!rawPhone && name) {
      const list = byNameWithoutPhone.get(name) || [];
      list.push(customer);
      byNameWithoutPhone.set(name, list);
    }
  }

  for (const [phone, group] of byPhone) {
    if (group.length < 2) continue;
    const ids = group.map((customer) => customer.id);
    issues.push({
      key: issueKey('duplicate_phone', phone, ids),
      type: 'duplicate_phone',
      customerIds: ids,
      title: 'Telefone repetido',
      description: `${phone} aparece em ${group.length} cadastros: ${group.map((customer) => customer.nome || customer.id).join(', ')}.`,
    });
  }

  for (const [name, group] of byNameWithoutPhone) {
    if (group.length < 2) continue;
    const ids = group.map((customer) => customer.id);
    issues.push({
      key: issueKey('homonym_without_phone', name, ids),
      type: 'homonym_without_phone',
      customerIds: ids,
      title: 'Mesmo nome sem telefone',
      description: `${group.length} cadastros usam “${group[0].nome || name}” sem uma identidade de telefone. Não serão unidos automaticamente.`,
    });
  }

  return issues.sort((a, b) => a.key.localeCompare(b.key));
}

/** Pedidos legados cujo campo de telefone precisa de decisão humana. */
export function findOrderIdentityIssues(orders: any[]): CustomerIntegrityIssue[] {
  const issues: CustomerIntegrityIssue[] = [];
  for (const order of orders || []) {
    if (order?.customerIdentityIssueIgnored === true) continue;
    const rawPhone = String(order?.customerPhone || order?.customerIdentifier || '').trim();
    if (!rawPhone || isValidCustomerPhone(rawPhone)) continue;
    const orderId = String(order?.id || '').trim();
    if (!orderId) continue;
    const code = String(order?.orderCode || orderId).slice(0, 12);
    issues.push({
      key: issueKey('order_invalid_phone', `${orderId}:${rawPhone}`, []),
      type: 'order_invalid_phone',
      customerIds: [],
      orderId,
      currentValue: rawPhone,
      title: `Telefone inválido no pedido #${code}`,
      description: `O pedido guarda “${rawPhone}” como telefone. Informe o número correto; nenhum cliente será escolhido pelo nome.`,
    });
  }
  return issues.sort((a, b) => a.key.localeCompare(b.key));
}

export function creditBalanceFromTransactions(transactions: any[]): number {
  return (transactions || []).reduce((balance, transaction) => {
    const amount = Number(transaction?.amount) || 0;
    if (transaction?.type === 'debit') return balance + amount;
    if (transaction?.type === 'credit') return balance - amount;
    return balance;
  }, 0);
}

export function balanceDivergenceIssue(
  customer: CustomerLike,
  transactions: any[],
): CustomerIntegrityIssue | null {
  const expectedBalance = creditBalanceFromTransactions(transactions);
  const currentBalance = Number(customer.creditBalance) || 0;
  if (Math.abs(expectedBalance - currentBalance) <= 0.009) return null;
  return {
    key: issueKey('balance_divergence', String(expectedBalance), [customer.id]),
    type: 'balance_divergence',
    customerIds: [customer.id],
    title: 'Saldo divergente do extrato',
    description: `${customer.nome || 'Cliente'}: cadastro ${currentBalance.toFixed(2)}, extrato ${expectedBalance.toFixed(2)}. O extrato é a fonte de verdade.`,
    expectedBalance,
    currentBalance,
  };
}

export function isIntegrityIssueIgnored(
  issue: CustomerIntegrityIssue,
  customers: CustomerLike[],
): boolean {
  const byId = new Map((customers || []).map((customer) => [customer.id, customer]));
  return issue.customerIds.every((id) => byId.get(id)?.integrityIgnoredIssues?.includes(issue.key));
}
