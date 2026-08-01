import { describe, expect, it } from 'vitest';
import { emDinheiro, somaDinheiro } from './dinheiro';

describe('emDinheiro', () => {
  it('limpa o resíduo que ficou gravado num fechamento real', () => {
    // 141,60 - 130 deu 11.599999999999994 na producao (01/08/2026).
    expect(emDinheiro(141.6 - 130)).toBe(11.6);
    expect(emDinheiro(0.1 + 0.2)).toBe(0.3);
  });

  it('mantém centavos de verdade', () => {
    expect(emDinheiro(18.8)).toBe(18.8);
    expect(emDinheiro(0.05)).toBe(0.05);
    expect(emDinheiro(-11.599999999999994)).toBe(-11.6);
  });

  it('arredonda a partir do meio centavo', () => {
    expect(emDinheiro(1.005)).toBe(1.01);
    expect(emDinheiro(2.344)).toBe(2.34);
    expect(emDinheiro(2.345)).toBe(2.35);
  });

  it('lixo vira zero em vez de NaN no banco', () => {
    expect(emDinheiro(undefined)).toBe(0);
    expect(emDinheiro(null)).toBe(0);
    expect(emDinheiro('abc')).toBe(0);
    expect(emDinheiro(Infinity)).toBe(0);
  });

  it('aceita número em texto (vem de input)', () => {
    expect(emDinheiro('130')).toBe(130);
    expect(emDinheiro('11.599999999999994')).toBe(11.6);
  });
});

describe('somaDinheiro', () => {
  it('soma sem acumular resíduo', () => {
    expect(somaDinheiro(0.1, 0.2)).toBe(0.3);
    expect(somaDinheiro(100, 108, 0.5, -48.1, -18.8)).toBe(141.6);
  });

  it('ignora o que não é número', () => {
    expect(somaDinheiro(10, null, undefined, '5')).toBe(15);
  });
});
