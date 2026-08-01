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
    createUser: vi.fn(async ({ email, displayName }) => {
      const user = {
        uid: 'operator-new',
        email,
        displayName,
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

  it('cria perfil fail-closed e ignora tentativas de liberar capacidades exclusivas', async () => {
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
        retaguarda: { produtos: true, permissoes: true, usuarios: true },
      },
    }));
    const saved = roles.get('operator-new')!;

    expect(response.status).toBe(201);
    expect(saved.ownerId).toBe('owner-1');
    expect(saved.email).toBe('maria@example.com');
    expect(saved.permissions.pdv.enabled).toBe(true);
    expect(saved.permissions.pdv.tabs.caixa).toBe(true);
    expect(saved.permissions.pdv.tabs.delivery).toBe(false);
    expect(saved.permissions.pdv.actions.caixa.verCaixasAnteriores).toBe(false);
    expect(saved.permissions.retaguarda.produtos).toBe(true);
    expect(saved.permissions.retaguarda.permissoes).toBe(false);
    expect(saved.permissions.retaguarda.usuarios).toBe(false);
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
