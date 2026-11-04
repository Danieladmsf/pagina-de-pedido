import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O que estes testes seguram: loja nova ganha UMA sessão no servidor. Pedir de
 * novo (cadastro + botão da aba, duplo clique) acha a que existe em vez de
 * criar outra — duas sessões da mesma loja disputariam o mesmo celular.
 */
const servidor = vi.hoisted(() => ({
  usuarios: [] as Array<{ id: string; name: string; token: string }>,
  criados: [] as Array<Record<string, unknown>>,
  status: {} as Record<string, unknown>,
  cabecalhos: [] as Array<Record<string, string>>,
  foto: { status: 200, tipo: 'image/jpeg' },
  enviados: [] as Array<{ caminho: string; corpo: Record<string, unknown> }>,
}));

vi.mock('@/lib/firebase-admin', () => ({ getOptionalAdminDb: () => null }));

import { criarSessaoDaLoja, getWuzStatus, sendWuzImage } from './wuzapi.service';

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  servidor.usuarios = [
    { id: 'a1', name: 'WUZ-GOSTINHO Gostinho de Ceu', token: 'chave-gostinho' },
    { id: 'a2', name: 'WUZ-AMERIPAN Ameripan', token: 'chave-ameripan' },
  ];
  servidor.criados = [];
  servidor.cabecalhos = [];
  servidor.foto = { status: 200, tipo: 'image/jpeg' };
  servidor.enviados = [];
  process.env.WUZAPI_URL = 'https://servidor.teste';
  process.env.WUZAPI_ADMIN_TOKEN = 'chave-de-admin';

  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    // A foto mora fora do servidor de WhatsApp (Storage do Firebase).
    if (url.startsWith('https://fotos.teste/')) {
      const ok = servidor.foto.status === 200;
      return new Response(ok ? 'bytes-da-foto' : '{"error":{"code":402}}', {
        status: servidor.foto.status,
        headers: { 'Content-Type': ok ? servidor.foto.tipo : 'application/json' },
      });
    }
    const caminho = new URL(url).pathname;
    if (caminho === '/chat/send/text' || caminho === '/chat/send/image') {
      servidor.enviados.push({ caminho, corpo: JSON.parse(String(init.body)) });
      return resposta({ code: 200, data: { Id: caminho === '/chat/send/text' ? 'msg-texto' : 'msg-imagem' }, success: true });
    }
    servidor.cabecalhos.push({ ...(init.headers as Record<string, string>) });
    if (caminho === '/admin/users' && (init.method || 'GET') === 'GET') {
      return resposta({ code: 200, data: servidor.usuarios, success: true });
    }
    if (caminho === '/admin/users' && init.method === 'POST') {
      const corpo = JSON.parse(String(init.body));
      servidor.criados.push(corpo);
      servidor.usuarios.push({ id: `n${servidor.criados.length}`, name: corpo.name, token: corpo.token });
      return resposta({ code: 200, data: { id: 'novo' }, success: true });
    }
    if (caminho === '/session/status') return resposta({ code: 200, data: servidor.status, success: true });
    return resposta({ code: 404, error: 'rota desconhecida', success: false }, 404);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WUZAPI_URL;
  delete process.env.WUZAPI_ADMIN_TOKEN;
});

describe('criarSessaoDaLoja', () => {
  it('cria a sessão da loja nova com chave própria e os eventos do webhook', async () => {
    const { token, criada } = await criarSessaoDaLoja('WUZ-loja123');

    expect(criada).toBe(true);
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(servidor.criados).toEqual([
      expect.objectContaining({ name: 'WUZ-loja123', token, events: expect.stringContaining('Message') }),
    ]);
    // Criar sessão é coisa de admin: vai com a chave de admin, nunca a da loja.
    expect(servidor.cabecalhos.every((h) => h.Authorization === 'chave-de-admin' && !h.token)).toBe(true);
  });

  it('pedir de novo devolve a mesma sessão, sem criar outra', async () => {
    const primeira = await criarSessaoDaLoja('WUZ-loja123');
    const segunda = await criarSessaoDaLoja('WUZ-loja123');

    expect(segunda).toEqual({ token: primeira.token, criada: false });
    expect(servidor.criados).toHaveLength(1);
  });

  it('reconhece a sessão criada à mão, com o nome da loja depois do ID', async () => {
    expect(await criarSessaoDaLoja('WUZ-GOSTINHO')).toEqual({ token: 'chave-gostinho', criada: false });
    expect(servidor.criados).toHaveLength(0);
  });

  it('nome parecido não é a mesma loja', async () => {
    const { criada } = await criarSessaoDaLoja('WUZ-GOSTIN');
    expect(criada).toBe(true);
  });

  it('sem chave de admin não cria nada', async () => {
    delete process.env.WUZAPI_ADMIN_TOKEN;
    await expect(criarSessaoDaLoja('WUZ-loja123')).rejects.toThrow(/admin/i);
    expect(servidor.criados).toHaveLength(0);
  });
});

describe('getWuzStatus', () => {
  it('sessão logada: conectada, com o telefone da loja', async () => {
    servidor.status = { connected: true, loggedIn: true, jid: '5516993638485:12@s.whatsapp.net' };
    expect(await getWuzStatus('WUZ-GOSTINHO', 'chave-gostinho')).toMatchObject({
      connected: true,
      phone: '5516993638485',
    });
  });

  it('depois do logout o servidor ainda devolve o número antigo, e isso não é conexão', async () => {
    // O servidor guarda o `jid` do último pareamento e não apaga no logout.
    servidor.status = { connected: false, loggedIn: false, jid: '5516993638485@s.whatsapp.net' };
    expect(await getWuzStatus('WUZ-GOSTINHO', 'chave-gostinho')).toMatchObject({ connected: false });
  });
});

describe('sendWuzImage', () => {
  const envio = { phone: '5516999990000', image: 'https://fotos.teste/logo.jpg', caption: 'Olá! Veja nosso cardápio.' };

  it('foto no ar: vai a imagem com a legenda', async () => {
    const r = await sendWuzImage('WUZ-GOSTINHO', 'chave-gostinho', envio, { textoSeAImagemFalhar: true });

    expect(r.messageId).toBe('msg-imagem');
    expect(servidor.enviados).toEqual([
      expect.objectContaining({ caminho: '/chat/send/image', corpo: expect.objectContaining({ Caption: envio.caption }) }),
    ]);
  });

  it('resposta automática com a foto fora do ar (402 de 04/11/2026): vai só o texto', async () => {
    servidor.foto.status = 402;
    const r = await sendWuzImage('WUZ-GOSTINHO', 'chave-gostinho', envio, { textoSeAImagemFalhar: true });

    expect(r.messageId).toBe('msg-texto');
    expect(servidor.enviados).toEqual([{ caminho: '/chat/send/text', corpo: { Phone: envio.phone, Body: envio.caption } }]);
  });

  it('campanha e envio manual (sem a opção): foto fora do ar continua sendo erro', async () => {
    servidor.foto.status = 402;
    await expect(sendWuzImage('WUZ-GOSTINHO', 'chave-gostinho', envio)).rejects.toThrow(/baixar o arquivo/);
    expect(servidor.enviados).toHaveLength(0);
  });

  it('sem legenda não há texto para mandar: o erro sobe', async () => {
    servidor.foto.status = 402;
    await expect(
      sendWuzImage('WUZ-GOSTINHO', 'chave-gostinho', { ...envio, caption: '' }, { textoSeAImagemFalhar: true }),
    ).rejects.toThrow(/baixar o arquivo/);
    expect(servidor.enviados).toHaveLength(0);
  });
});
