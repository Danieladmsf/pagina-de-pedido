import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOptionalAdminAuth, getOptionalAdminDb } from '@/lib/firebase-admin';
import { DELETE, GET, PATCH, POST } from '@/app/api/usuarios/route';

vi.mock('@/lib/firebase-admin', () => ({
  getOptionalAdminAuth: vi.fn(),
  getOptionalAdminDb: vi.fn(),
}));

type StoredRole = Record<string, any>;

function snapshot(id: string, data?: StoredRole) {
  return {
    id,
    exists: data !== undefined,
    data: () => data,
  };
}

function createFakeDb(ownerUids: string[], initialRoles: Record<string, StoredRole> = {}) {
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

function createFakeAuth(uid = 'owner-1') {
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
