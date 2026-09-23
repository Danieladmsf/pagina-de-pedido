import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O que estes testes seguram: "Desconectar" nunca mais apaga o ID e a chave da
 * instância. Até 23/09/2026 apagava, e religar a loja passava a depender do
 * suporte.
 */
const fake = vi.hoisted(() => {
  process.env.WAPI_BLOCKED_INSTANCE_IDS = 'LITE-COMPARTILHADA';
  return {
    docs: new Map<string, Record<string, any>>(),
    logouts: [] as Array<{ instanceId: string; token: string }>,
    falhaNoLogout: null as Error | null,
  };
});

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

vi.mock('@/lib/wapi/wapi.service', () => ({
  disconnectWapiInstance: async (instanceId: string, token: string) => {
    if (fake.falhaNoLogout) throw fake.falhaNoLogout;
    fake.logouts.push({ instanceId, token });
    return { error: false };
  },
}));

vi.mock('@/lib/wapi/crypto', () => ({
  decryptSecret: (valor: string) => valor.replace(/^cifrado:/, ''),
  encryptSecret: (valor: string) => `cifrado:${valor}`,
}));

vi.mock('@/lib/firebase-admin', () => ({ getOptionalAdminDb: () => null }));

import { desconectarCelular, removerIntegracao } from './desconexao';

const EMPRESA = 'loja-1';
const CAMINHO = `roles_admin/${EMPRESA}`;

function integracaoConectada(instanceId = 'LITE-8NDQT1-UWX43P') {
  return {
    ownerId: EMPRESA,
    clienteId: EMPRESA,
    empresaId: EMPRESA,
    provider: 'wapi',
    wapiInstanceId: instanceId,
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
  it('desloga o celular e mantém o ID e a chave da instância', async () => {
    const integration = fake.docs.get(CAMINHO)!.whatsappIntegration;

    await desconectarCelular({ empresaId: EMPRESA, integration, token: 'token-da-loja', idToken: 'sessao' });

    expect(fake.logouts).toEqual([{ instanceId: 'LITE-8NDQT1-UWX43P', token: 'token-da-loja' }]);
    const salva = fake.docs.get(CAMINHO)!.whatsappIntegration;
    expect(salva.wapiInstanceId).toBe('LITE-8NDQT1-UWX43P');
    expect(salva.wapiTokenEncrypted).toBe('cifrado:token-da-loja');
    expect(salva.webhookUrl).toContain('/webhooks/wapi');
    expect(salva.createdAt).toBe('2026-07-18T17:14:50.911Z');
    expect(salva.connected).toBe(false);
    expect(salva.status).toBe('pending_qr');
    expect(salva.numeroWhatsapp).toBe('');
    // O resto do documento da loja não é tocado.
    expect(fake.docs.get(CAMINHO)!.storeAddress).toBe('Rua X');
  });

  it('se a W-API não confirmar o logout, nada muda e o erro sobe para a tela', async () => {
    fake.falhaNoLogout = new Error('W-API fora do ar');
    const integration = fake.docs.get(CAMINHO)!.whatsappIntegration;

    await expect(
      desconectarCelular({ empresaId: EMPRESA, integration, token: 'token-da-loja', idToken: 'sessao' }),
    ).rejects.toThrow('W-API fora do ar');

    expect(fake.docs.get(CAMINHO)!.whatsappIntegration.connected).toBe(true);
  });
});

describe('removerIntegracao', () => {
  it('desloga o celular e apaga o cadastro do WhatsApp', async () => {
    await removerIntegracao(EMPRESA, 'sessao');

    expect(fake.logouts).toEqual([{ instanceId: 'LITE-8NDQT1-UWX43P', token: 'token-da-loja' }]);
    expect(fake.docs.get(CAMINHO)!.whatsappIntegration).toBeNull();
    expect(fake.docs.get(CAMINHO)!.storeAddress).toBe('Rua X');
  });

  it('apaga mesmo quando a W-API recusa o logout (instância quebrada)', async () => {
    fake.falhaNoLogout = new Error('instância não encontrada');

    await removerIntegracao(EMPRESA, 'sessao');

    expect(fake.docs.get(CAMINHO)!.whatsappIntegration).toBeNull();
  });

  it('não desloga a instância de teste compartilhada, mas apaga o cadastro', async () => {
    fake.docs.set(CAMINHO, { whatsappIntegration: integracaoConectada('LITE-COMPARTILHADA') });

    await removerIntegracao(EMPRESA, 'sessao');

    expect(fake.logouts).toEqual([]);
    expect(fake.docs.get(CAMINHO)!.whatsappIntegration).toBeNull();
  });
});
