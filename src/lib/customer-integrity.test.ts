import { describe, expect, it } from 'vitest';
import {
  balanceDivergenceIssue,
  creditBalanceFromTransactions,
  findCustomerIdentityIssues,
  findOrderIdentityIssues,
  isIntegrityIssueIgnored,
  isValidCustomerPhone,
} from './customer-integrity';

describe('integridade da identidade do cliente', () => {
  it('aceita os dois tamanhos de telefone brasileiro e rejeita texto', () => {
    expect(isValidCustomerPhone('(16) 99999-9999')).toBe(true);
    expect(isValidCustomerPhone('1633334444')).toBe(true);
    expect(isValidCustomerPhone('LARA')).toBe(false);
  });

  it('detecta telefone repetido mesmo com formatos diferentes', () => {
    const issues = findCustomerIdentityIssues([
      { id: 'a', nome: 'Ana', celular: '(16) 99999-0000' },
      { id: 'b', nome: 'Bia', celular: '5516999990000' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('duplicate_phone');
    expect(issues[0].customerIds).toEqual(['a', 'b']);
  });

  it('não funde homônimos e não inclui arquivados no conflito', () => {
    const issues = findCustomerIdentityIssues([
      { id: 'a', nome: 'José', celular: '' },
      { id: 'b', nome: 'JOSE', celular: '' },
      { id: 'c', nome: 'José', celular: '', archived: true },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('homonym_without_phone');
    expect(issues[0].customerIds).toEqual(['a', 'b']);
  });

  it('separa telefone inválido de cadastro realmente sem telefone', () => {
    const issues = findCustomerIdentityIssues([
      { id: 'a', nome: 'Lara', celular: 'LARA' },
      { id: 'b', nome: 'Balcão', celular: '' },
    ]);
    expect(issues.map((issue) => issue.type)).toEqual(['invalid_phone']);
  });
});

describe('integridade da identidade nos pedidos legados', () => {
  it('expõe telefone textual para correção manual e respeita decisão ignorada', () => {
    const issues = findOrderIdentityIssues([
      { id: 'p1', orderCode: 'ABC12345', customerPhone: 'LARA' },
      { id: 'p2', customerPhone: '(16) 99999-9999' },
      { id: 'p3', customerPhone: 'CIDINHA', customerIdentityIssueIgnored: true },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ type: 'order_invalid_phone', orderId: 'p1', currentValue: 'LARA' });
  });
});

describe('integridade do saldo', () => {
  it('o extrato calcula débito menos crédito', () => {
    expect(creditBalanceFromTransactions([
      { type: 'debit', amount: 100 },
      { type: 'credit', amount: 35 },
      { type: 'unknown', amount: 999 },
    ])).toBe(65);
  });

  it('gera conflito apenas quando o contador diverge', () => {
    expect(balanceDivergenceIssue({ id: 'a', nome: 'Ana', creditBalance: 10 }, [
      { type: 'debit', amount: 12 },
    ])?.expectedBalance).toBe(12);
    expect(balanceDivergenceIssue({ id: 'a', creditBalance: 12 }, [
      { type: 'debit', amount: 12 },
    ])).toBeNull();
  });

  it('só considera ignorado quando todos os cadastros envolvidos registraram a decisão', () => {
    const issue = findCustomerIdentityIssues([
      { id: 'a', nome: 'Ana', celular: '16999990000' },
      { id: 'b', nome: 'Bia', celular: '16999990000' },
    ])[0];
    expect(isIntegrityIssueIgnored(issue, [
      { id: 'a', integrityIgnoredIssues: [issue.key] },
      { id: 'b', integrityIgnoredIssues: [] },
    ])).toBe(false);
    expect(isIntegrityIssueIgnored(issue, [
      { id: 'a', integrityIgnoredIssues: [issue.key] },
      { id: 'b', integrityIgnoredIssues: [issue.key] },
    ])).toBe(true);
  });
});
