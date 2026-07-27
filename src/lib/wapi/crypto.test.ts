import { afterEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, needsReencrypt } from './crypto';

const ORIGINAL_ENV = { ...process.env };

function setKeys(keys: { nova?: string; api?: string; legado?: string }) {
  delete process.env.WAPI_TOKEN_ENCRYPTION_KEY;
  delete process.env.WAPI_API_KEY;
  delete process.env.WAPI_INTEGRATOR_TOKEN;
  delete process.env.WAPI_TOKEN_ENCRYPTION_KEY_LEGACY;
  if (keys.nova) process.env.WAPI_TOKEN_ENCRYPTION_KEY = keys.nova;
  if (keys.api) process.env.WAPI_API_KEY = keys.api;
  if (keys.legado) process.env.WAPI_TOKEN_ENCRYPTION_KEY_LEGACY = keys.legado;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const TOKEN = 'AbCdEf123456-token-da-instancia-w-api';

describe('criptografia do token da instancia', () => {
  it('ida e volta com a mesma chave', () => {
    setKeys({ api: 'chave-antiga' });
    expect(decryptSecret(encryptSecret(TOKEN))).toBe(TOKEN);
  });

  it('token cifrado com a WAPI_API_KEY continua legivel depois de adicionar a chave dedicada', () => {
    // Este e o cenario real das 3 lojas: os tokens foram cifrados com a
    // WAPI_API_KEY porque WAPI_TOKEN_ENCRYPTION_KEY nunca existiu. Antes, criar
    // essa variavel tornava TODOS os tokens salvos ilegiveis de uma vez.
    setKeys({ api: 'chave-antiga' });
    const salvo = encryptSecret(TOKEN);

    setKeys({ nova: 'chave-nova-dedicada', api: 'chave-antiga' });
    expect(decryptSecret(salvo)).toBe(TOKEN);
    expect(needsReencrypt(salvo)).toBe(true);
  });

  it('sobrevive a troca da API key da conta W-API se a antiga ficar no LEGACY', () => {
    setKeys({ api: 'api-key-v1' });
    const salvo = encryptSecret(TOKEN);

    setKeys({ nova: 'chave-fixa', api: 'api-key-v2', legado: 'api-key-v1' });
    expect(decryptSecret(salvo)).toBe(TOKEN);
  });

  it('grava sempre com a chave preferencial', () => {
    setKeys({ nova: 'chave-fixa', api: 'api-key-v2' });
    const novo = encryptSecret(TOKEN);
    expect(needsReencrypt(novo)).toBe(false);

    // So a chave preferencial basta para ler o que ela gravou.
    setKeys({ nova: 'chave-fixa' });
    expect(decryptSecret(novo)).toBe(TOKEN);
  });

  it('recusa token que nao confere com nenhuma chave conhecida', () => {
    setKeys({ api: 'chave-a' });
    const salvo = encryptSecret(TOKEN);
    setKeys({ api: 'chave-totalmente-outra' });
    expect(() => decryptSecret(salvo)).toThrow(/nenhuma chave conhecida/i);
  });

  it('recusa formato invalido', () => {
    setKeys({ api: 'chave-a' });
    expect(() => decryptSecret('nao-e-um-token')).toThrow(/formato invalido/i);
  });
});
