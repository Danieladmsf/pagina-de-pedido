import { describe, expect, it } from 'vitest';
import {
  generateOperatorPassword,
  getOperatorDisplayLogin,
  isInternalOperatorEmail,
  normalizeOperatorHandle,
  OPERATOR_LOGIN_DOMAIN,
  resolveOperatorLogin,
  suggestAlternativeHandles,
  suggestOperatorHandle,
  validateOperatorPassword,
} from './operator-login';

describe('resolveOperatorLogin', () => {
  it('transforma apelido em endereço interno determinístico', () => {
    expect(resolveOperatorLogin('Maria')).toEqual({
      email: `maria@${OPERATOR_LOGIN_DOMAIN}`,
      login: 'maria',
      kind: 'handle',
    });
  });

  it('leva o mesmo apelido ao mesmo endereço, venha da tela de criar ou da de login', () => {
    const criacao = resolveOperatorLogin('  Maria José  ');
    const login = resolveOperatorLogin('maria.jose');

    expect(criacao?.email).toBe(login?.email);
  });

  it('mantém e-mail de verdade como e-mail', () => {
    expect(resolveOperatorLogin('Fulano@Loja.com.br')).toEqual({
      email: 'fulano@loja.com.br',
      login: 'fulano@loja.com.br',
      kind: 'email',
    });
  });

  it('reconhece o endereço interno digitado por inteiro como apelido', () => {
    const resolvido = resolveOperatorLogin(`maria@${OPERATOR_LOGIN_DOMAIN}`);

    expect(resolvido).toEqual({
      email: `maria@${OPERATOR_LOGIN_DOMAIN}`,
      login: 'maria',
      kind: 'handle',
    });
  });

  it('recusa apelido curto demais, e-mail quebrado e vazio', () => {
    expect(resolveOperatorLogin('ma')).toBeNull();
    expect(resolveOperatorLogin('joao@')).toBeNull();
    expect(resolveOperatorLogin('   ')).toBeNull();
    expect(resolveOperatorLogin(undefined)).toBeNull();
  });

  it('recusa apelido que vira vazio depois da normalização', () => {
    expect(resolveOperatorLogin('...')).toBeNull();
    expect(resolveOperatorLogin('###')).toBeNull();
  });
});

describe('normalizeOperatorHandle', () => {
  it('tira acento, espaço e maiúscula', () => {
    expect(normalizeOperatorHandle('José da Silva')).toBe('jose.da.silva');
    expect(normalizeOperatorHandle('  ANA__PAULA ')).toBe('ana.paula');
  });
});

describe('exibição do login', () => {
  it('mostra só o apelido para endereço interno', () => {
    expect(getOperatorDisplayLogin(`maria@${OPERATOR_LOGIN_DOMAIN}`)).toBe('maria');
    expect(isInternalOperatorEmail(`maria@${OPERATOR_LOGIN_DOMAIN}`)).toBe(true);
  });

  it('mostra o e-mail inteiro para endereço de verdade', () => {
    expect(getOperatorDisplayLogin('Fulano@Loja.com')).toBe('fulano@loja.com');
    expect(isInternalOperatorEmail('fulano@loja.com')).toBe(false);
  });
});

describe('senha', () => {
  it('exige seis caracteres, como o Firebase Auth', () => {
    expect(validateOperatorPassword('12345')).toContain('6');
    expect(validateOperatorPassword('123456')).toBeNull();
    expect(validateOperatorPassword('')).not.toBeNull();
    expect(validateOperatorPassword(undefined)).not.toBeNull();
  });

  it('recusa espaço nas pontas, que ninguém consegue digitar de volta', () => {
    expect(validateOperatorPassword(' senha123 ')).not.toBeNull();
  });

  it('gera senha sem caractere ambíguo', () => {
    for (let tentativa = 0; tentativa < 50; tentativa += 1) {
      expect(generateOperatorPassword()).toMatch(/^[abcdefghijkmnpqrstuvwxyz23456789]{8}$/);
    }
  });
});

describe('sugestões', () => {
  it('propõe o primeiro nome como apelido', () => {
    expect(suggestOperatorHandle('Maria Aparecida')).toBe('maria');
    expect(suggestOperatorHandle('Ana Lu')).toBe('ana');
    expect(suggestOperatorHandle('Jô Silva')).toBe('jo.silva');
    expect(suggestOperatorHandle('')).toBe('');
  });

  it('propõe alternativas quando o apelido já é de outra pessoa', () => {
    expect(suggestAlternativeHandles('maria', 'Pizzaria do João')).toEqual([
      'maria.pizzaria',
      'maria2',
      'maria.pdv',
    ]);
  });
});
