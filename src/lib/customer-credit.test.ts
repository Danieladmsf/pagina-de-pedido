import { describe, expect, it } from 'vitest';
import {
  ambiguousCreditCustomerResult,
  creditOrderMatchesCustomer,
  creditPhonesAreEqual,
  isValidCreditPhone,
  getPhoneVariants,
  isCreditEnabled,
  maskCreditPhoneInput,
  matchUniqueActiveCustomerByPhone,
  normalizeCreditPhone,
  quickRegistrationCreditDefaults,
} from './customer-credit';

describe('contrato de telefone do cliente', () => {
  it('normaliza formatos brasileiros no mesmo identificador', () => {
    expect(normalizeCreditPhone('(16) 99999-8877')).toBe('16999998877');
    expect(normalizeCreditPhone('+55 16 99999-8877')).toBe('16999998877');
    // DDD 55 não é confundido com código do país.
    expect(normalizeCreditPhone('55999998888')).toBe('55999998888');
  });

  it('valida somente telefone com DDD e 10 ou 11 dígitos', () => {
    expect(isValidCreditPhone('1633334444')).toBe(true);
    expect(isValidCreditPhone('(16) 99999-8877')).toBe(true);
    expect(isValidCreditPhone('99998877')).toBe(false);
    expect(isValidCreditPhone('LARA')).toBe(false);
  });

  it('aplica uma única máscara progressiva para os formulários', () => {
    expect(maskCreditPhoneInput('16')).toBe('16');
    expect(maskCreditPhoneInput('1699999')).toBe('(16) 9999-9');
    expect(maskCreditPhoneInput('16999998877')).toBe('(16) 99999-8877');
  });

  it('cobre formatos legados sem ultrapassar o limite do operador in', () => {
    const variants = getPhoneVariants('16999998877');
    expect(variants).toContain('+55 16 99999-8877');
    expect(variants).toContain('(16)999998877');
    expect(variants).toContain('16 99999 8877');
    expect(variants).toContain('16-99999-8877');
    expect(variants.length).toBeLessThanOrEqual(30);
  });

  it('não confunde pessoas diferentes apenas pela presença do nono dígito', () => {
    expect(creditPhonesAreEqual('(16) 99999-8877', '+55 16 99999-8877')).toBe(true);
    expect(creditPhonesAreEqual('16999998877', '1699998877')).toBe(false);
    expect(getPhoneVariants('16999998877')).not.toContain('1699998877');
  });
});

describe('defaults do cadastro rápido', () => {
  it('inicializa Prazo e saldo apenas para cliente realmente novo', () => {
    expect(quickRegistrationCreditDefaults(false, '2026-07-31')).toEqual({
      createdAt: '2026-07-31',
      creditEnabled: true,
      creditLimit: 0,
      creditPayDay: 0,
      creditBalance: 0,
    });
  });

  it('não devolve nenhum campo financeiro para cadastro existente', () => {
    expect(quickRegistrationCreditDefaults(true, '2026-07-31')).toEqual({});
  });
});

describe('bloqueio temporário de unificação', () => {
  it('desativa o Prazo enquanto o cadastro está sendo incorporado', () => {
    expect(isCreditEnabled({ creditEnabled: true })).toBe(true);
    expect(isCreditEnabled({
      creditEnabled: true,
      mergeInProgress: { targetCustomerId: 'destino' },
    })).toBe(false);
  });
});

describe('vínculo de pedido pendente no Prazo', () => {
  it('prefere clienteId mesmo se o telefone do pedido ficou antigo', () => {
    expect(creditOrderMatchesCustomer(
      { clienteId: 'cliente-1', customerPhone: '16911112222' },
      '16999998888',
      'cliente-1',
    )).toBe(true);
  });

  it('não captura por telefone pedido já ligado a outro cliente', () => {
    expect(creditOrderMatchesCustomer(
      { clienteId: 'outro', customerPhone: '16999998888' },
      '16999998888',
      'cliente-1',
    )).toBe(false);
  });

  it('mantém telefone como fallback para pedido legado', () => {
    expect(creditOrderMatchesCustomer(
      { customerPhone: '(16) 99999-8888' },
      '16999998888',
      'cliente-1',
    )).toBe(true);
  });

  it('não captura pedido legado de outro número sem o nono dígito', () => {
    expect(creditOrderMatchesCustomer(
      { customerPhone: '1699998877' },
      '16999998877',
      'cliente-1',
    )).toBe(false);
  });
});

describe('Prazo com telefone duplicado', () => {
  it('bloqueia explicitamente em vez de escolher o primeiro cadastro', () => {
    const result = ambiguousCreditCustomerResult([
      { id: 'c1', data: { creditEnabled: true } },
      { id: 'c2', data: { creditEnabled: true } },
    ]);
    expect(result).toMatchObject({ allowed: false, reason: 'ambiguous' });
    expect(result?.message).toMatch(/conflito.*Clientes/i);
  });

  it('não interfere quando a identidade é única', () => {
    expect(ambiguousCreditCustomerResult([{ id: 'c1', data: {} }])).toBeNull();
  });
});

describe('matchUniqueActiveCustomerByPhone', () => {
  const target = '(16) 99999-8877';

  it('resolve um único cadastro ativo mesmo com formatação diferente', () => {
    const result = matchUniqueActiveCustomerByPhone([
      { id: 'c1', data: { celular: '16999998877' } },
      { id: 'outro', data: { celular: '16988887777' } },
    ], target);
    expect(result).toEqual({ kind: 'unique', customer: { id: 'c1', data: { celular: '16999998877' } } });
  });

  it('nunca escolhe o primeiro quando há duplicidade normalizada', () => {
    expect(matchUniqueActiveCustomerByPhone([
      { id: 'c1', data: { celular: '16999998877' } },
      { id: 'c2', data: { celular: '+55 16 99999-8877' } },
    ], target)).toEqual({ kind: 'ambiguous' });
  });

  it('ignora arquivados e não os reativa implicitamente', () => {
    expect(matchUniqueActiveCustomerByPhone([
      { id: 'arquivado', data: { celular: '16999998877', archived: true } },
    ], target)).toEqual({ kind: 'none' });
  });
});
