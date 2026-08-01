import { describe, expect, it } from 'vitest';
import {
  buildCustomerImportIndex,
  hasExactLegacyCustomerPhone,
  resolveCustomerImportPhone,
} from './customer-import';

const OWNER = 'loja-1';

describe('resolucao de identidade durante importacao', () => {
  it('reutiliza o id real de um unico cadastro ativo, mesmo que seja legado', () => {
    const index = buildCustomerImportIndex(OWNER, [
      { id: 'id-aleatorio-legado', ownerId: OWNER, celular: '+55 (16) 99999-8888' },
    ]);

    expect(resolveCustomerImportPhone(index, '16999998888')).toMatchObject({
      status: 'existing',
      id: 'id-aleatorio-legado',
      normalizedPhone: '16999998888',
    });
  });

  it('bloqueia telefone com mais de um cadastro ativo', () => {
    const index = buildCustomerImportIndex(OWNER, [
      { id: 'c1', ownerId: OWNER, celular: '16999998888' },
      { id: 'c2', ownerId: OWNER, celular: '(16) 99999-8888' },
    ]);

    expect(resolveCustomerImportPhone(index, '16999998888')).toEqual({
      status: 'duplicate',
      normalizedPhone: '16999998888',
      customerIds: ['c1', 'c2'],
    });
  });

  it('nao restaura nem sobrescreve cadastro arquivado', () => {
    const index = buildCustomerImportIndex(OWNER, [
      { id: 'arquivado-legado', ownerId: OWNER, celular: '16988887777', archived: true },
    ]);

    expect(resolveCustomerImportPhone(index, '16988887777')).toMatchObject({
      status: 'archived',
      customerIds: ['arquivado-legado'],
    });
  });

  it('bloqueia colisao quando o id deterministico pertence a outro telefone', () => {
    const incomingPhone = '16977776666';
    const id = `${OWNER}_${incomingPhone}`;
    const index = buildCustomerImportIndex(OWNER, [
      { id, ownerId: OWNER, celular: '16911112222' },
    ]);

    expect(resolveCustomerImportPhone(index, incomingPhone)).toEqual({
      status: 'collision',
      id,
      normalizedPhone: incomingPhone,
      customerIds: [id],
    });
  });

  it('propoe id deterministico apenas quando nao existe identidade nem colisao', () => {
    const index = buildCustomerImportIndex(OWNER, []);
    expect(resolveCustomerImportPhone(index, '(16) 96666-5555')).toEqual({
      status: 'new',
      id: `${OWNER}_16966665555`,
      normalizedPhone: '16966665555',
    });
  });

  it('rejeita telefone vazio ou invalido', () => {
    const index = buildCustomerImportIndex(OWNER, []);
    expect(resolveCustomerImportPhone(index, '123')).toEqual({
      status: 'invalid',
      normalizedPhone: '123',
    });
  });
});

describe('referencia legada durante exclusao', () => {
  it('aceita apenas telefone normalizado exatamente igual e sem clienteId', () => {
    expect(hasExactLegacyCustomerPhone(
      { customerPhone: '+55 (16) 99999-8888' },
      '16999998888',
    )).toBe(true);
    expect(hasExactLegacyCustomerPhone(
      { cliente: { telefone: '(16) 99999-8888' } },
      '16999998888',
    )).toBe(true);
    expect(hasExactLegacyCustomerPhone(
      { clienteId: 'outro', customerPhone: '16999998888' },
      '16999998888',
    )).toBe(false);
  });

  it('nao cria alias entre numeros de 10 e 11 digitos', () => {
    expect(hasExactLegacyCustomerPhone(
      { customerPhone: '1699998888' },
      '16999998888',
    )).toBe(false);
  });
});
