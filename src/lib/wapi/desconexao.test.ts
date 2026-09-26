import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O que estes testes seguram: "Desconectar" nunca mais apaga o ID e a chave da
 * sessão da loja. Até 23/09/2026 apagava, e religar a loja passava a depender
 * do suporte.
 */
const fake = vi.hoisted(() => ({
  docs: new Map<string, Record<string, any>>(),
  logouts: [] as Array<{ instanceId: string; token: string }>,
  falhaNoLogout: null as Error | null,
}));

vi.mock('@/lib/firestore-rest', () => ({
  getFirestoreDocument: async (path: string) => {
    const doc = fake.docs.get(path);
    return doc ? JSON.parse(JSON.stringify(doc)) : null;
  },
  patchFirestoreDocumentFields: async (path: string, data: Record<string, any>, fieldPaths: string[]) => {
    const atual = { ...(fake.docs.get(path) || {}) };
    for (const campo of fieldPaths) atual[campo] = data[campo];
    fake.docs.set(path, atual);
  },
  createFirestoreDocument: async () => 'id',
}));

vi.mock('@/lib/wuzapi/wuzapi.service', () => ({
  logoutWuz: async (instanceId: string, token: string) => {
    if (fake.falhaNoLogout) throw fake.falhaNoLogout;
    fake.logouts.push({ instanceId, token });
    return {};
  },
}));

vi.mock('@/lib/wapi/crypto', () => ({
  decryptSecret: (valor: string) => valor.replace(/^cifrado:/, ''),
  encryptSecret: (valor: string) => `cifrado:${valor}`,
}));

vi.mock('@/lib/firebase-admin', () => ({ getOptionalAdminDb: () => null }));

import { desconectarCelular } from './desconexao';

const EMPRESA = 'loja-1';
const CAMINHO = `roles_admin/${EMPRESA}`;

function integracaoConectada() {
  return {
    ownerId: EMPRESA,
    clienteId: EMPRESA,
    empresaId: EMPRESA,
    provider: 'wuzapi',
    wapiInstanceId: 'WUZ-GOSTINHO',
    wapiTokenEncrypted: 'cifrado:token-da-loja',
    instanceName: 'Gostinho de Céu',
    status: 'connected',
    connected: true,
    numeroWhatsapp: '5516993638485',
    qrCode: '',
    webhookUrl: 'https://polarispdv.vercel.app/webhooks/wapi?empresaId=loja-1',
    createdAt: '2026-07-18T17:14:50.911Z',
    updatedAt: '2026-09-23T10:00:00.000Z',
  };
}

beforeEach(() => {
  fake.docs.clear();
  fake.logouts.length = 0;
  fake.falhaNoLogout = null;
  fake.docs.set(CAMINHO, { whatsappIntegration: integracaoConectada(), storeAddress: 'Rua X' });
});

describe('desconectarCelular', () => {
  it('desloga o celular e mantém o ID e a chave da sessão', async () => {
    const integration = fake.docs.get(CAMINHO)!.whatsappIntegration;

    await desconectarCelular({ empresaId: EMPRESA, integration, token: 'token-da-loja', idToken: 'sessao' });

    expect(fake.logouts).toEqual([{ instanceId: 'WUZ-GOSTINHO', token: 'token-da-loja' }]);
    const salva = fake.docs.get(CAMINHO)!.whatsappIntegration;
    expect(salva.wapiInstanceId).toBe('WUZ-GOSTINHO');
    expect(salva.wapiTokenEncrypted).toBe('cifrado:token-da-loja');
    expect(salva.webhookUrl).toContain('/webhooks/wapi');
    expect(salva.createdAt).toBe('2026-07-18T17:14:50.911Z');
    expect(salva.connected).toBe(false);
    expect(salva.status).toBe('pending_qr');
    expect(salva.numeroWhatsapp).toBe('');
    // O resto do documento da loja não é tocado.
    expect(fake.docs.get(CAMINHO)!.storeAddress).toBe('Rua X');
  });

  it('se o servidor não confirmar o logout, nada muda e o erro sobe para a tela', async () => {
    fake.falhaNoLogout = new Error('servidor de WhatsApp fora do ar');
    const integration = fake.docs.get(CAMINHO)!.whatsappIntegration;

    await expect(
      desconectarCelular({ empresaId: EMPRESA, integration, token: 'token-da-loja', idToken: 'sessao' }),
    ).rejects.toThrow('servidor de WhatsApp fora do ar');

    expect(fake.docs.get(CAMINHO)!.whatsappIntegration.connected).toBe(true);
  });
});
