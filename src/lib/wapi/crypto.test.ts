import { afterEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, needsReencrypt } from './crypto';

const ORIGINAL_ENV = { ...process.env };

function setKeys(keys: { nova?: string; legado?: string; contaWapi?: string }) {
  delete process.env.WAPI_TOKEN_ENCRYPTION_KEY;
  delete process.env.WAPI_TOKEN_ENCRYPTION_KEY_LEGACY;
  delete process.env.WAPI_API_KEY;
  if (keys.nova) process.env.WAPI_TOKEN_ENCRYPTION_KEY = keys.nova;
  if (keys.legado) process.env.WAPI_TOKEN_ENCRYPTION_KEY_LEGACY = keys.legado;
  if (keys.contaWapi) process.env.WAPI_API_KEY = keys.contaWapi;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const TOKEN = 'AbCdEf123456-chave-da-sessao-da-loja';

describe('criptografia da chave da loja', () => {
  it('ida e volta com a mesma chave', () => {
    setKeys({ nova: 'chave-dedicada' });
    expect(decryptSecret(encryptSecret(TOKEN))).toBe(TOKEN);
  });

  it('sobrevive à troca da chave se a antiga ficar no LEGACY', () => {
    setKeys({ nova: 'chave-v1' });
    const salvo = encryptSecret(TOKEN);

    setKeys({ nova: 'chave-v2', legado: 'chave-v1' });
    expect(decryptSecret(salvo)).toBe(TOKEN);
    expect(needsReencrypt(salvo)).toBe(true);
  });

  it('grava sempre com a chave preferencial', () => {
    setKeys({ nova: 'chave-v2', legado: 'chave-v1' });
    const novo = encryptSecret(TOKEN);
    expect(needsReencrypt(novo)).toBe(false);

    // Só a chave preferencial basta para ler o que ela gravou.
    setKeys({ nova: 'chave-v2' });
    expect(decryptSecret(novo)).toBe(TOKEN);
  });

  it('a chave da conta W-API não é mais chave de cifra', () => {
    // Até 25/09/2026 ela era lida como reserva. A W-API saiu do sistema, e com
    // ela essa leitura: a variável pode ser apagada da Vercel.
    setKeys({ nova: 'chave-dedicada', contaWapi: 'chave-da-conta-w-api' });
    expect(decryptSecret(encryptSecret(TOKEN))).toBe(TOKEN);

    setKeys({ contaWapi: 'chave-da-conta-w-api' });
    expect(() => encryptSecret(TOKEN)).toThrow(/WAPI_TOKEN_ENCRYPTION_KEY/);
  });

  it('recusa valor que não confere com nenhuma chave conhecida', () => {
    setKeys({ nova: 'chave-a' });
    const salvo = encryptSecret(TOKEN);
    setKeys({ nova: 'chave-totalmente-outra' });
    expect(() => decryptSecret(salvo)).toThrow(/nenhuma chave conhecida/i);
  });

  it('recusa formato inválido', () => {
    setKeys({ nova: 'chave-a' });
    expect(() => decryptSecret('nao-e-um-token')).toThrow(/formato invalido/i);
  });
});
