import { describe, expect, it } from 'vitest';
import {
  MAX_TENTATIVAS, SEM_TENTATIVAS, TRAVA_MS, aposTentativa, conferirSenha, gerarHashDaSenha,
  mensagemDeTrava, problemaNaSenha, restoDaTrava,
} from './cancel-pin';

describe('hash da senha de cancelamento', () => {
  it('confere a senha certa e recusa a errada', () => {
    const reg = gerarHashDaSenha('4821');
    expect(conferirSenha('4821', reg)).toBe(true);
    expect(conferirSenha('4822', reg)).toBe(false);
    expect(conferirSenha('', reg)).toBe(false);
    expect(conferirSenha(4821, reg)).toBe(false);
  });

  it('não guarda a senha e usa salt diferente a cada vez', () => {
    const a = gerarHashDaSenha('4821');
    const b = gerarHashDaSenha('4821');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(JSON.stringify(a)).not.toContain('4821');
  });

  it('com o mesmo salt o hash é reproduzível', () => {
    const a = gerarHashDaSenha('1234');
    expect(gerarHashDaSenha('1234', a.salt).hash).toBe(a.hash);
  });

  it('registro vazio ou corrompido nunca confere', () => {
    expect(conferirSenha('1234', { hash: '', salt: '' })).toBe(false);
    expect(conferirSenha('1234', undefined as any)).toBe(false);
  });

  it('valida o formato: 4 a 8 números', () => {
    expect(problemaNaSenha('1234')).toBeNull();
    expect(problemaNaSenha('12345678')).toBeNull();
    expect(problemaNaSenha('123')).not.toBeNull();
    expect(problemaNaSenha('123456789')).not.toBeNull();
    expect(problemaNaSenha('12a4')).not.toBeNull();
    expect(problemaNaSenha(1234)).not.toBeNull();
  });
});

describe('trava contra chute', () => {
  const T0 = 1_000_000;

  it('conta erros seguidos e trava no quinto', () => {
    let s = { ...SEM_TENTATIVAS };
    for (let i = 1; i < MAX_TENTATIVAS; i++) {
      s = aposTentativa(s, false, T0);
      expect(s.failedAttempts).toBe(i);
      expect(restoDaTrava(s, T0)).toBe(0);
    }
    s = aposTentativa(s, false, T0);
    expect(restoDaTrava(s, T0)).toBe(TRAVA_MS);
    expect(s.failedAttempts).toBe(0);
  });

  it('acerto zera o contador', () => {
    let s = aposTentativa(aposTentativa(SEM_TENTATIVAS, false, T0), false, T0);
    expect(s.failedAttempts).toBe(2);
    s = aposTentativa(s, true, T0);
    expect(s).toEqual(SEM_TENTATIVAS);
  });

  it('destrava depois dos 5 minutos e recomeça do zero', () => {
    let s = { ...SEM_TENTATIVAS };
    for (let i = 0; i < MAX_TENTATIVAS; i++) s = aposTentativa(s, false, T0);
    expect(restoDaTrava(s, T0 + TRAVA_MS - 1)).toBe(1);
    expect(restoDaTrava(s, T0 + TRAVA_MS)).toBe(0);
    s = aposTentativa(s, false, T0 + TRAVA_MS);
    expect(s.failedAttempts).toBe(1);
    expect(restoDaTrava(s, T0 + TRAVA_MS)).toBe(0);
  });

  it('estado ausente não trava', () => {
    expect(restoDaTrava(undefined, T0)).toBe(0);
  });

  it('mensagem amigável em minutos', () => {
    expect(mensagemDeTrava(TRAVA_MS)).toContain('5 minutos');
    expect(mensagemDeTrava(1000)).toContain('1 minuto');
  });
});
