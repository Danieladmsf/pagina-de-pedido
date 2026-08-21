import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOptionalAdminAuth, getOptionalAdminDb } from '@/lib/firebase-admin';
import { DELETE, GET, PATCH, POST } from '@/app/api/usuarios/route';

vi.mock('@/lib/firebase-admin', () => ({
  getOptionalAdminAuth: vi.fn(),
  getOptionalAdminDb: vi.fn(),
}));

type StoredRole = Record<string, any>;

interface FakeDbOptions {
  events?: string[];
  failRoleUpdate?: (uid: string, value: StoredRole) => boolean;
}

interface FakeAuthOptions {
  events?: string[];
  failUpdate?: (uid: string, value: StoredRole) => boolean;
  failRevoke?: (uid: string) => boolean;
}

function snapshot(id: string, data?: StoredRole) {
  return {
    id,
    exists: data !== undefined,
    data: () => data,
  };
}

function createFakeDb(
  ownerUids: string[],
  initialRoles: Record<string, StoredRole> = {},
  options: FakeDbOptions = {},
) {
  const owners = new Set(ownerUids);
  const roles = new Map(Object.entries(initialRoles));

  const db = {
    collection(name: string) {
      return {
        doc(uid: string) {
          return {
            async get() {
              return name === 'roles_admin'
                ? snapshot(uid, owners.has(uid) ? { name: 'Master' } : undefined)
                : snapshot(uid, roles.get(uid));
            },
            async set(value: StoredRole) {
              roles.set(uid, value);
            },
            async update(value: StoredRole) {
              if (name === 'roles_operador') {
                const active = Object.prototype.hasOwnProperty.call(value, 'active')
                  ? String(value.active)
                  : 'unchanged';
                options.events?.push(`firestore:update:${uid}:active=${active}`);
                if (options.failRoleUpdate?.(uid, value)) {
                  throw new Error('forced role update failure');
                }
              }
              const current = roles.get(uid);
              if (!current) throw new Error('not found');
              roles.set(uid, { ...current, ...value });
            },
            async delete() {
              roles.delete(uid);
            },
          };
        },
        where(field: string, operator: string, value: unknown) {
          expect(field).toBe('ownerId');
          expect(operator).toBe('==');
          return {
            async get() {
              return {
                docs: [...roles.entries()]
                  .filter(([, role]) => role.ownerId === value)
                  .map(([uid, role]) => snapshot(uid, role)),
              };
            },
          };
        },
      };
    },
  };

  return { db, roles };
}

function createFakeAuth(uid = 'owner-1', options: FakeAuthOptions = {}) {
  const users = new Map<string, any>();
  const auth = {
    verifyIdToken: vi.fn(async () => ({ uid })),
    createUser: vi.fn(async ({ email, displayName, password }) => {
      const user = {
        uid: 'operator-new',
        email,
        displayName,
        password,
        emailVerified: false,
        disabled: false,
        metadata: { creationTime: '2026-07-19T00:00:00.000Z' },
      };
      users.set(user.uid, user);
      return user;
    }),
    getUser: vi.fn(async (targetUid: string) => {
      const user = users.get(targetUid);
      if (!user) throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
      return user;
    }),
    updateUser: vi.fn(async (targetUid: string, value: StoredRole) => {
      const disabled = Object.prototype.hasOwnProperty.call(value, 'disabled')
        ? String(value.disabled)
        : 'unchanged';
      options.events?.push(`auth:update:${targetUid}:disabled=${disabled}`);
      if (options.failUpdate?.(targetUid, value)) {
        throw new Error('forced auth update failure');
      }
      const current = users.get(targetUid);
      if (!current) throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
      const updated = { ...current, ...value };
      users.set(targetUid, updated);
      return updated;
    }),
    revokeRefreshTokens: vi.fn(async (targetUid: string) => {
      options.events?.push(`auth:revoke:${targetUid}`);
      if (options.failRevoke?.(targetUid)) {
        throw new Error('forced auth revoke failure');
      }
    }),
    getUsers: vi.fn(async (identifiers: Array<{ uid: string }>) => ({
      users: identifiers.map(({ uid: targetUid }) => users.get(targetUid)).filter(Boolean),
      notFound: [],
    })),
    deleteUser: vi.fn(async (targetUid: string) => {
      users.delete(targetUid);
    }),
  };
  return { auth, users };
}

function apiRequest(method: string, body?: unknown) {
  return new Request('http://localhost/api/usuarios', {
    method,
    headers: {
      Authorization: 'Bearer valid-token',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

describe('/api/usuarios', () => {
  it('recusa uma sessao autenticada que nao possui papel de master', async () => {
    const { auth } = createFakeAuth('operator-1');
    const { db } = createFakeDb([]);
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await GET(apiRequest('GET'));

    expect(response.status).toBe(403);
  });

  it('lista somente operadores pertencentes ao master autenticado', async () => {
    const { auth, users } = createFakeAuth();
    users.set('mine', {
      uid: 'mine', email: 'mine@example.com', emailVerified: false, disabled: false,
      metadata: { creationTime: '2026-07-19T00:00:00.000Z' },
    });
    users.set('other', {
      uid: 'other', email: 'other@example.com', emailVerified: false, disabled: false,
      metadata: { creationTime: '2026-07-19T00:00:00.000Z' },
    });
    const { db } = createFakeDb(['owner-1'], {
      mine: { ownerId: 'owner-1', name: 'Meu operador', active: true },
      other: { ownerId: 'owner-2', name: 'Operador alheio', active: true },
    });
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await GET(apiRequest('GET'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.usuarios).toHaveLength(1);
    expect(data.usuarios[0].uid).toBe('mine');
  });

  it('expõe como inativo um papel ativo cujo login está bloqueado no Auth', async () => {
    const { auth, users } = createFakeAuth();
    users.set('blocked', {
      uid: 'blocked', email: 'blocked@example.com', emailVerified: true, disabled: true,
      metadata: { creationTime: '2026-07-19T00:00:00.000Z' },
    });
    const { db } = createFakeDb(['owner-1'], {
      blocked: { ownerId: 'owner-1', name: 'Bloqueado', active: true },
    });
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await GET(apiRequest('GET'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.usuarios[0]).toMatchObject({ active: false, authDisabled: true });
  });

  it('cria perfil fail-closed: só o que foi marcado entra', async () => {
    const { auth } = createFakeAuth();
    const { db, roles } = createFakeDb(['owner-1']);
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await POST(apiRequest('POST', {
      name: 'Maria',
      email: 'MARIA@example.com',
      permissions: {
        pdv: {
          tabs: { caixa: true },
          actions: { caixa: { abrirCaixa: true, verCaixasAnteriores: true } },
        },
        retaguarda: {
          produtos: { ver: true, editar: true },
          clientes: { ver: true },
          campanhas: { editar: true },
        },
      },
    }));
    const saved = roles.get('operator-new')!;

    expect(response.status).toBe(201);
    expect(saved.ownerId).toBe('owner-1');
    expect(saved.email).toBe('maria@example.com');
    expect(saved.permissions.pdv.enabled).toBe(true);
    expect(saved.permissions.pdv.tabs.caixa).toBe(true);
    expect(saved.permissions.pdv.tabs.delivery).toBe(false);
    // Nada mais é derrubado por decisão do código: o dono marcou, o dono manda.
    expect(saved.permissions.pdv.actions.caixa.verCaixasAnteriores).toBe(true);
    expect(saved.permissions.retaguarda.produtos).toEqual({ ver: true, editar: true });
    expect(saved.permissions.retaguarda.clientes).toEqual({ ver: true, editar: false });
    // Alterar sem ver não existe.
    expect(saved.permissions.retaguarda.campanhas).toEqual({ ver: false, editar: false });
    expect(saved.permissions.retaguarda.usuarios).toEqual({ ver: false, editar: false });
  });

  it('cria acesso por apelido com a senha escolhida pelo dono, sem e-mail nenhum', async () => {
    const { auth, users } = createFakeAuth();
    const { db, roles } = createFakeDb(['owner-1']);
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await POST(apiRequest('POST', {
      name: 'Maria Aparecida',
      login: 'Maria',
      password: 'trocar123',
      permissions: { pdv: { tabs: { caixa: true } } },
    }));
    const data = await response.json();
    const saved = roles.get('operator-new')!;

    expect(response.status).toBe(201);
    expect(saved.login).toBe('maria');
    expect(saved.email).toBe('maria@usuarios.polarispdv.app');
    expect(users.get('operator-new').password).toBe('trocar123');
    expect(data.inviteSent).toBe(false);
    expect(data.usuario.login).toBe('maria');
    expect(data.usuario.canReceiveEmail).toBe(false);
    // Nenhuma chamada ao endpoint de e-mail do Firebase.
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('recusa apelido sem senha, porque ninguém conseguiria entrar', async () => {
    const { auth } = createFakeAuth();
    const { db, roles } = createFakeDb(['owner-1']);
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await POST(apiRequest('POST', {
      name: 'Maria',
      login: 'maria',
      permissions: { pdv: { tabs: { caixa: true } } },
    }));

    expect(response.status).toBe(400);
    expect(roles.size).toBe(0);
  });

  it('recusa senha curta demais para o Firebase Auth', async () => {
    const { auth } = createFakeAuth();
    const { db } = createFakeDb(['owner-1']);
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await POST(apiRequest('POST', {
      name: 'Maria', login: 'maria', password: '123',
      permissions: { pdv: { tabs: { caixa: true } } },
    }));

    expect(response.status).toBe(400);
    expect(auth.createUser).not.toHaveBeenCalled();
  });

  it('com e-mail e sem senha, mantém o convite por link', async () => {
    const { auth } = createFakeAuth();
    const { db } = createFakeDb(['owner-1']);
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await POST(apiRequest('POST', {
      name: 'João', login: 'joao@loja.com.br',
      permissions: { pdv: { tabs: { caixa: true } } },
    }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.inviteSent).toBe(true);
    expect(data.usuario.canReceiveEmail).toBe(true);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
  });

  it('troca a senha e derruba quem estava dentro com a antiga', async () => {
    const events: string[] = [];
    const { auth, users } = createFakeAuth('owner-1', { events });
    users.set('op-1', {
      uid: 'op-1', email: 'maria@usuarios.polarispdv.app', emailVerified: false, disabled: false,
      metadata: { creationTime: '2026-07-19T00:00:00.000Z' },
    });
    const { db, roles } = createFakeDb(['owner-1'], {
      'op-1': { ownerId: 'owner-1', name: 'Maria', active: true },
    });
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await PATCH(apiRequest('PATCH', {
      uid: 'op-1', action: 'set_password', password: 'senhanova1',
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.passwordChanged).toBe(true);
    expect(auth.updateUser).toHaveBeenCalledWith('op-1', { password: 'senhanova1' });
    expect(events).toContain('auth:revoke:op-1');
    expect(roles.get('op-1')?.passwordUpdatedAt).toBeDefined();
  });

  it('não troca a senha de operador de outra loja', async () => {
    const { auth, users } = createFakeAuth();
    users.set('alheio', {
      uid: 'alheio', email: 'x@y.com', emailVerified: false, disabled: false,
      metadata: { creationTime: '2026-07-19T00:00:00.000Z' },
    });
    const { db } = createFakeDb(['owner-1'], {
      alheio: { ownerId: 'owner-2', name: 'Alheio', active: true },
    });
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await PATCH(apiRequest('PATCH', {
      uid: 'alheio', action: 'set_password', password: 'senhanova1',
    }));

    expect(response.status).toBe(404);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('quem entra por apelido não recebe convite por e-mail', async () => {
    const { auth, users } = createFakeAuth();
    users.set('op-1', {
      uid: 'op-1', email: 'maria@usuarios.polarispdv.app', emailVerified: false, disabled: false,
      metadata: { creationTime: '2026-07-19T00:00:00.000Z' },
    });
    const { db } = createFakeDb(['owner-1'], {
      'op-1': { ownerId: 'owner-1', name: 'Maria', active: true },
    });
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await PATCH(apiRequest('PATCH', { uid: 'op-1', action: 'resend_invite' }));

    expect(response.status).toBe(409);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('funcionário com o módulo Usuários lista a equipe da loja', async () => {
    const { auth, users } = createFakeAuth('gestor-1');
    users.set('colega', {
      uid: 'colega', email: 'colega@loja.com', emailVerified: false, disabled: false,
      metadata: { creationTime: '2026-08-19T00:00:00.000Z' },
    });
    const { db } = createFakeDb(['owner-1'], {
      'gestor-1': {
        ownerId: 'owner-1', name: 'Gerente', active: true,
        permissions: { retaguarda: { usuarios: { ver: true, editar: false } } },
      },
      colega: { ownerId: 'owner-1', name: 'Colega', active: true },
    });
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await GET(apiRequest('GET'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.usuarios.map((u: any) => u.uid)).toContain('colega');
  });

  it('quem só consulta Usuários não cria ninguém', async () => {
    const { auth } = createFakeAuth('gestor-1');
    const { db, roles } = createFakeDb(['owner-1'], {
      'gestor-1': {
        ownerId: 'owner-1', name: 'Gerente', active: true,
        permissions: { retaguarda: { usuarios: { ver: true, editar: false } } },
      },
    });
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await POST(apiRequest('POST', {
      name: 'Novo', login: 'novo', password: 'senha123',
      permissions: { pdv: { tabs: { caixa: true } } },
    }));

    expect(response.status).toBe(403);
    expect(roles.has('operator-new')).toBe(false);
  });

  it('gestor delegado não cria colega com mais acesso do que ele tem', async () => {
    const { auth } = createFakeAuth('gestor-1');
    const { db, roles } = createFakeDb(['owner-1'], {
      'gestor-1': {
        ownerId: 'owner-1', name: 'Gerente', active: true,
        permissions: {
          pdv: { tabs: { caixa: true } },
          retaguarda: { usuarios: { ver: true, editar: true } },
        },
      },
    });
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await POST(apiRequest('POST', {
      name: 'Novo', login: 'novo', password: 'senha123',
      permissions: { retaguarda: { clientes: { ver: true, editar: true } } },
    }));

    expect(response.status).toBe(403);
    expect(roles.has('operator-new')).toBe(false);
  });

  it('gestor delegado cria colega dentro do próprio limite', async () => {
    const { auth } = createFakeAuth('gestor-1');
    const { db, roles } = createFakeDb(['owner-1'], {
      'gestor-1': {
        ownerId: 'owner-1', name: 'Gerente', active: true,
        permissions: {
          pdv: { tabs: { caixa: true }, actions: { caixa: { abrirCaixa: true } } },
          retaguarda: { usuarios: { ver: true, editar: true } },
        },
      },
    });
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await POST(apiRequest('POST', {
      name: 'Novo', login: 'novo', password: 'senha123',
      permissions: { pdv: { tabs: { caixa: true }, actions: { caixa: { abrirCaixa: true } } } },
    }));
    const saved = roles.get('operator-new')!;

    expect(response.status).toBe(201);
    expect(saved.ownerId).toBe('owner-1');
    expect(saved.createdBy).toBe('gestor-1');
  });

  it('gestor delegado não mexe no próprio acesso', async () => {
    const { auth, users } = createFakeAuth('gestor-1');
    users.set('gestor-1', {
      uid: 'gestor-1', email: 'gerente@loja.com', emailVerified: false, disabled: false,
      metadata: { creationTime: '2026-08-19T00:00:00.000Z' },
    });
    const { db, roles } = createFakeDb(['owner-1'], {
      'gestor-1': {
        ownerId: 'owner-1', name: 'Gerente', active: true,
        permissions: {
          pdv: { tabs: { caixa: true } },
          retaguarda: { usuarios: { ver: true, editar: true } },
        },
      },
    });
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await PATCH(apiRequest('PATCH', {
      uid: 'gestor-1',
      permissions: { retaguarda: { clientes: { ver: true, editar: true } } },
    }));

    expect(response.status).toBe(403);
    expect(roles.get('gestor-1')?.permissions?.retaguarda?.clientes).toBeUndefined();
  });

  it('funcionário sem o módulo Usuários continua fora', async () => {
    const { auth } = createFakeAuth('op-1');
    const { db } = createFakeDb(['owner-1'], {
      'op-1': {
        ownerId: 'owner-1', name: 'Operador', active: true,
        permissions: { pdv: { tabs: { caixa: true } } },
      },
    });
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await GET(apiRequest('GET'));

    expect(response.status).toBe(403);
  });

  it('funcionário desativado não gerencia ninguém, mesmo com o módulo ligado', async () => {
    const { auth } = createFakeAuth('gestor-1');
    const { db } = createFakeDb(['owner-1'], {
      'gestor-1': {
        ownerId: 'owner-1', name: 'Gerente', active: false,
        permissions: { retaguarda: { usuarios: { ver: true, editar: true } } },
      },
    });
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await GET(apiRequest('GET'));

    expect(response.status).toBe(403);
  });

  it('nao altera um operador pertencente a outro master', async () => {
    const { auth } = createFakeAuth();
    const { db, roles } = createFakeDb(['owner-1'], {
      target: { ownerId: 'owner-2', name: 'Outro', active: true },
    });
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await PATCH(apiRequest('PATCH', { uid: 'target', active: false }));

    expect(response.status).toBe(404);
    expect(roles.get('target')?.active).toBe(true);
  });

  it('desativa primeiro no Firestore, bloqueia o Auth e revoga as sessoes', async () => {
    const events: string[] = [];
    const { auth, users } = createFakeAuth('owner-1', { events });
    users.set('target', {
      uid: 'target', email: 'target@example.com', displayName: 'Operador',
      emailVerified: true, disabled: false,
      metadata: { creationTime: '2026-07-19T00:00:00.000Z' },
    });
    const { db, roles } = createFakeDb(['owner-1'], {
      target: { ownerId: 'owner-1', name: 'Operador', active: true },
    }, { events });
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await PATCH(apiRequest('PATCH', { uid: 'target', active: false }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(roles.get('target')?.active).toBe(false);
    expect(users.get('target')?.disabled).toBe(true);
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('target');
    expect(data.usuario).toMatchObject({ active: false, authDisabled: true });
    expect(events).toEqual([
      'firestore:update:target:active=false',
      'auth:update:target:disabled=true',
      'auth:revoke:target',
    ]);
  });

  it('mantém o papel inativo e tenta revogar sessões se o bloqueio do Auth falhar', async () => {
    const events: string[] = [];
    const { auth, users } = createFakeAuth('owner-1', {
      events,
      failUpdate: (_uid, value) => value.disabled === true,
    });
    users.set('target', {
      uid: 'target', email: 'target@example.com', displayName: 'Operador',
      emailVerified: true, disabled: false,
      metadata: { creationTime: '2026-07-19T00:00:00.000Z' },
    });
    const { db, roles } = createFakeDb(['owner-1'], {
      target: { ownerId: 'owner-1', name: 'Operador', active: true },
    }, { events });
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await PATCH(apiRequest('PATCH', { uid: 'target', active: false }));

    expect(response.status).toBe(500);
    expect(roles.get('target')?.active).toBe(false);
    expect(users.get('target')?.disabled).toBe(false);
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('target');
    expect(events).toEqual([
      'firestore:update:target:active=false',
      'auth:update:target:disabled=true',
      'auth:revoke:target',
    ]);
  });

  it('reativa o Auth antes de conceder active=true no Firestore', async () => {
    const events: string[] = [];
    const { auth, users } = createFakeAuth('owner-1', { events });
    users.set('target', {
      uid: 'target', email: 'target@example.com', displayName: 'Operador',
      emailVerified: true, disabled: true,
      metadata: { creationTime: '2026-07-19T00:00:00.000Z' },
    });
    const { db, roles } = createFakeDb(['owner-1'], {
      target: { ownerId: 'owner-1', name: 'Operador', active: false },
    }, { events });
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await PATCH(apiRequest('PATCH', { uid: 'target', active: true }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(users.get('target')?.disabled).toBe(false);
    expect(roles.get('target')?.active).toBe(true);
    expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
    expect(data.usuario).toMatchObject({ active: true, authDisabled: false });
    expect(events).toEqual([
      'auth:update:target:disabled=false',
      'firestore:update:target:active=true',
    ]);
  });

  it('sincroniza a alteracao de nome com o displayName do Firebase Auth', async () => {
    const { auth, users } = createFakeAuth();
    users.set('target', {
      uid: 'target', email: 'target@example.com', displayName: 'Nome antigo',
      emailVerified: true, disabled: false,
      metadata: { creationTime: '2026-07-19T00:00:00.000Z' },
    });
    const { db, roles } = createFakeDb(['owner-1'], {
      target: { ownerId: 'owner-1', name: 'Nome antigo', active: true },
    });
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await PATCH(apiRequest('PATCH', { uid: 'target', name: '  Nome novo  ' }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(auth.updateUser).toHaveBeenCalledWith('target', { displayName: 'Nome novo' });
    expect(users.get('target')?.displayName).toBe('Nome novo');
    expect(roles.get('target')?.name).toBe('Nome novo');
    expect(data.usuario.name).toBe('Nome novo');
  });

  it('reverte o Auth se o Firestore falhar ao concluir uma ativacao', async () => {
    const events: string[] = [];
    const { auth, users } = createFakeAuth('owner-1', { events });
    users.set('target', {
      uid: 'target', email: 'target@example.com', displayName: 'Operador',
      emailVerified: true, disabled: true,
      metadata: { creationTime: '2026-07-19T00:00:00.000Z' },
    });
    const { db, roles } = createFakeDb(['owner-1'], {
      target: { ownerId: 'owner-1', name: 'Operador', active: false },
    }, {
      events,
      failRoleUpdate: (_uid, value) => value.active === true,
    });
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await PATCH(apiRequest('PATCH', { uid: 'target', active: true }));

    expect(response.status).toBe(500);
    expect(roles.get('target')?.active).toBe(false);
    expect(users.get('target')?.disabled).toBe(true);
    expect(events).toEqual([
      'auth:update:target:disabled=false',
      'firestore:update:target:active=true',
      'auth:update:target:disabled=true',
      'auth:revoke:target',
    ]);
  });

  it('mantem o usuario criado e devolve aviso quando apenas o convite falha', async () => {
    const { auth } = createFakeAuth();
    const { db, roles } = createFakeDb(['owner-1']);
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 500 }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const response = await POST(apiRequest('POST', {
      name: 'Sem convite',
      email: 'sem-convite@example.com',
    }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.inviteSent).toBe(false);
    expect(data.warning).toContain('Usuario criado');
    expect(roles.has('operator-new')).toBe(true);
  });

  it('remove o Auth e o papel apenas de um operador do proprio master', async () => {
    const { auth, users } = createFakeAuth();
    users.set('target', {
      uid: 'target', email: 'target@example.com', emailVerified: false, disabled: false,
      metadata: { creationTime: '2026-07-19T00:00:00.000Z' },
    });
    const { db, roles } = createFakeDb(['owner-1'], {
      target: { ownerId: 'owner-1', name: 'Meu operador', active: true },
    });
    vi.mocked(getOptionalAdminAuth).mockReturnValue(auth as any);
    vi.mocked(getOptionalAdminDb).mockReturnValue(db as any);

    const response = await DELETE(new Request('http://localhost/api/usuarios?uid=target', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-token' },
    }));

    expect(response.status).toBe(200);
    expect(auth.deleteUser).toHaveBeenCalledWith('target');
    expect(roles.has('target')).toBe(false);
  });
});
