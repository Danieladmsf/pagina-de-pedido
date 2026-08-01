import type { UserRecord } from 'firebase-admin/auth';
import { FieldValue, type DocumentData, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { firebaseConfig } from '@/firebase/config';
import { getOptionalAdminAuth, getOptionalAdminDb } from '@/lib/firebase-admin';
import { normalizeOperatorPermissions } from '@/lib/user-permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPERATOR_COLLECTION = 'roles_operador';
const OWNER_COLLECTION = 'roles_admin';

type JsonObject = Record<string, unknown>;

class UsuariosApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'UsuariosApiError';
  }
}

function noStoreJson(data: JsonObject, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJsonObject(request: Request): Promise<JsonObject> {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
    throw new UsuariosApiError(413, 'Corpo da requisicao muito grande.');
  }

  const body = await request.json().catch(() => null);
  if (!isObject(body)) {
    throw new UsuariosApiError(400, 'Corpo JSON invalido.');
  }
  return body;
}

function normalizeName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new UsuariosApiError(400, 'Informe o nome do usuario.');
  }
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 100) {
    throw new UsuariosApiError(400, 'O nome deve ter entre 1 e 100 caracteres.');
  }
  return name;
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new UsuariosApiError(400, 'Informe o e-mail do usuario.');
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new UsuariosApiError(400, 'Informe um e-mail valido.');
  }
  return email;
}

function normalizeUid(value: unknown): string {
  if (typeof value !== 'string') {
    throw new UsuariosApiError(400, 'Usuario invalido.');
  }
  const uid = value.trim();
  if (!uid || uid.length > 128 || uid.includes('/')) {
    throw new UsuariosApiError(400, 'Usuario invalido.');
  }
  return uid;
}

/**
 * Permissoes de operador sao sempre fail-closed: somente booleanos conhecidos
 * entram no documento, ausencias viram false e o kill switch do PDV fica
 * ligado. Em PATCH, folhas omitidas preservam o valor confirmado no servidor.
 */
function sanitizePermissions(input: unknown, current?: unknown) {
  const mergePatch = (base: unknown, patch: unknown): unknown => {
    if (!isObject(base) || !isObject(patch)) return patch;
    const merged: JsonObject = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      merged[key] = isObject(value) && isObject(merged[key])
        ? mergePatch(merged[key], value)
        : value;
    }
    return merged;
  };

  const baseline = normalizeOperatorPermissions(current);
  const merged = isObject(input) ? mergePatch(baseline, input) : baseline;
  return normalizeOperatorPermissions(merged);
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]?.trim()) {
    throw new UsuariosApiError(401, 'Sessao expirada. Faca login novamente.');
  }
  return match[1].trim();
}

async function requireOwner(request: Request) {
  const auth = getOptionalAdminAuth();
  const db = getOptionalAdminDb();
  if (!auth || !db) {
    throw new UsuariosApiError(503, 'Firebase Admin nao configurado no servidor.');
  }

  let decodedToken;
  try {
    // checkRevoked tambem impede que uma sessao revogada continue criando ou
    // alterando logins ate o ID token expirar naturalmente.
    decodedToken = await auth.verifyIdToken(bearerToken(request), true);
  } catch (error) {
    if (error instanceof UsuariosApiError) throw error;
    throw new UsuariosApiError(401, 'Nao foi possivel validar a sessao do usuario.');
  }

  const ownerSnapshot = await db.collection(OWNER_COLLECTION).doc(decodedToken.uid).get();
  if (!ownerSnapshot.exists) {
    throw new UsuariosApiError(403, 'Somente o master pode gerenciar usuarios.');
  }

  return { auth, db, ownerUid: decodedToken.uid };
}

async function requireOwnedOperator(
  db: NonNullable<ReturnType<typeof getOptionalAdminDb>>,
  ownerUid: string,
  operatorUid: string,
) {
  if (operatorUid === ownerUid) {
    throw new UsuariosApiError(403, 'A conta master nao pode ser alterada por esta API.');
  }

  const reference = db.collection(OPERATOR_COLLECTION).doc(operatorUid);
  const snapshot = await reference.get();
  if (!snapshot.exists || snapshot.data()?.ownerId !== ownerUid) {
    throw new UsuariosApiError(404, 'Usuario nao encontrado.');
  }
  return { reference, snapshot, data: snapshot.data()! };
}

function timestampToIso(value: unknown): string | null {
  if (isObject(value) && typeof value.toDate === 'function') {
    try {
      return (value.toDate as () => Date)().toISOString();
    } catch {
      return null;
    }
  }
  return typeof value === 'string' ? value : null;
}

function operatorDto(
  uid: string,
  role: DocumentData,
  authUser?: UserRecord,
) {
  return {
    uid,
    name: typeof role.name === 'string' ? role.name : authUser?.displayName || '',
    email: authUser?.email || (typeof role.email === 'string' ? role.email : ''),
    active: role.active === true,
    permissions: sanitizePermissions(role.permissions),
    emailVerified: authUser?.emailVerified === true,
    authDisabled: authUser?.disabled === true,
    authMissing: !authUser,
    createdAt: timestampToIso(role.createdAt) || authUser?.metadata.creationTime || null,
    updatedAt: timestampToIso(role.updatedAt),
  };
}

async function getAuthUsersByUid(
  auth: NonNullable<ReturnType<typeof getOptionalAdminAuth>>,
  uids: string[],
) {
  const users = new Map<string, UserRecord>();
  for (let offset = 0; offset < uids.length; offset += 100) {
    const chunk = uids.slice(offset, offset + 100);
    const result = await auth.getUsers(chunk.map((uid) => ({ uid })));
    for (const user of result.users) users.set(user.uid, user);
  }
  return users;
}

/**
 * O Admin SDK gera links, mas nao envia e-mail. Como o projeto nao possui um
 * provedor SMTP/transacional, usamos o endpoint oficial que tambem sustenta
 * `sendPasswordResetEmail` do Firebase Web SDK; assim o template do Firebase
 * envia o link sem expor a URL de definicao de senha ao master ou ao browser.
 */
async function sendPasswordSetupEmail(email: string) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Firebase-Locale': 'pt-BR',
      },
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    throw new Error('O Firebase nao conseguiu enviar o e-mail de definicao de senha.');
  }
}

function mapFirebaseAuthError(error: unknown): UsuariosApiError | null {
  const code = isObject(error) && typeof error.code === 'string' ? error.code : '';
  if (code === 'auth/email-already-exists') {
    return new UsuariosApiError(409, 'Ja existe uma conta com este e-mail.');
  }
  if (code === 'auth/invalid-email') {
    return new UsuariosApiError(400, 'Informe um e-mail valido.');
  }
  if (code === 'auth/user-not-found') {
    return new UsuariosApiError(409, 'O login deste usuario nao existe mais no Firebase Auth.');
  }
  return null;
}

function errorResponse(error: unknown) {
  const knownError = error instanceof UsuariosApiError ? error : mapFirebaseAuthError(error);
  if (knownError) return noStoreJson({ error: knownError.message }, knownError.status);

  console.error('[api/usuarios] Falha inesperada:', error);
  return noStoreJson({ error: 'Nao foi possivel concluir a operacao.' }, 500);
}

export async function GET(request: Request) {
  try {
    const { auth, db, ownerUid } = await requireOwner(request);
    const snapshot = await db
      .collection(OPERATOR_COLLECTION)
      .where('ownerId', '==', ownerUid)
      .get();
    const authUsers = await getAuthUsersByUid(auth, snapshot.docs.map((document) => document.id));
    const usuarios = snapshot.docs
      .map((document: QueryDocumentSnapshot) =>
        operatorDto(document.id, document.data(), authUsers.get(document.id)),
      )
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));

    return noStoreJson({ usuarios });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { auth, db, ownerUid } = await requireOwner(request);
    const body = await readJsonObject(request);
    if ('ownerId' in body || 'role' in body || 'master' in body || 'uid' in body) {
      throw new UsuariosApiError(400, 'O papel e o proprietario nao podem ser definidos pelo cliente.');
    }
    if ('permissions' in body && !isObject(body.permissions)) {
      throw new UsuariosApiError(400, 'Permissoes invalidas.');
    }

    const name = normalizeName(body.name);
    const email = normalizeEmail(body.email);
    const permissions = sanitizePermissions(body.permissions);

    const authUser = await auth.createUser({
      email,
      displayName: name,
      emailVerified: false,
      disabled: false,
    });
    const roleReference = db.collection(OPERATOR_COLLECTION).doc(authUser.uid);

    try {
      await roleReference.set({
        ownerId: ownerUid,
        active: true,
        name,
        email,
        permissions,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: ownerUid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: ownerUid,
      });
    } catch (error) {
      // Nao deixa um login orfao se a vinculacao segura com a loja falhar.
      await auth.deleteUser(authUser.uid).catch(() => undefined);
      throw error;
    }

    let inviteSent = true;
    let warning: string | undefined;
    try {
      await sendPasswordSetupEmail(email);
    } catch (error) {
      inviteSent = false;
      warning = 'Usuario criado, mas o e-mail de definicao de senha nao foi enviado. Use Reenviar convite.';
      console.warn('[api/usuarios] Usuario criado sem envio do convite:', error);
    }

    const savedRole = await roleReference.get();
    return noStoreJson({
      usuario: operatorDto(authUser.uid, savedRole.data() || {}, authUser),
      inviteSent,
      ...(warning ? { warning } : {}),
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { auth, db, ownerUid } = await requireOwner(request);
    const body = await readJsonObject(request);
    const operatorUid = normalizeUid(body.uid);
    if ('ownerId' in body || 'email' in body || 'role' in body || 'master' in body) {
      throw new UsuariosApiError(400, 'E-mail, papel e proprietario nao podem ser alterados.');
    }

    const ownedOperator = await requireOwnedOperator(db, ownerUid, operatorUid);
    let authUser: UserRecord;
    try {
      authUser = await auth.getUser(operatorUid);
    } catch (error) {
      throw mapFirebaseAuthError(error) || error;
    }

    if (body.action !== undefined) {
      if (body.action !== 'resend_invite') {
        throw new UsuariosApiError(400, 'Acao invalida.');
      }
      if ('name' in body || 'active' in body || 'permissions' in body) {
        throw new UsuariosApiError(400, 'Reenvie o convite separadamente das demais alteracoes.');
      }
      if (!authUser.email) {
        throw new UsuariosApiError(409, 'Este usuario nao possui e-mail no Firebase Auth.');
      }
      try {
        await sendPasswordSetupEmail(authUser.email);
      } catch {
        throw new UsuariosApiError(502, 'O Firebase nao conseguiu enviar o e-mail. Tente novamente.');
      }
      return noStoreJson({ ok: true, inviteSent: true });
    }

    const updates: DocumentData = {};
    if ('name' in body) updates.name = normalizeName(body.name);
    if ('active' in body) {
      if (typeof body.active !== 'boolean') {
        throw new UsuariosApiError(400, 'O estado ativo deve ser verdadeiro ou falso.');
      }
      updates.active = body.active;
    }
    if ('permissions' in body) {
      if (!isObject(body.permissions)) {
        throw new UsuariosApiError(400, 'Permissoes invalidas.');
      }
      updates.permissions = sanitizePermissions(body.permissions, ownedOperator.data.permissions);
    }
    if (Object.keys(updates).length === 0) {
      throw new UsuariosApiError(400, 'Nenhuma alteracao foi informada.');
    }

    updates.updatedAt = FieldValue.serverTimestamp();
    updates.updatedBy = ownerUid;
    await ownedOperator.reference.update(updates);

    const updatedSnapshot = await ownedOperator.reference.get();
    return noStoreJson({
      usuario: operatorDto(operatorUid, updatedSnapshot.data() || {}, authUser),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { auth, db, ownerUid } = await requireOwner(request);
    const operatorUid = normalizeUid(new URL(request.url).searchParams.get('uid'));
    const ownedOperator = await requireOwnedOperator(db, ownerUid, operatorUid);

    // Primeiro corta o acesso nas rules. Se uma etapa posterior falhar, nunca
    // fica um login ativo e desvinculado que ainda consiga operar a loja.
    await ownedOperator.reference.update({
      active: false,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: ownerUid,
    });

    try {
      await auth.deleteUser(operatorUid);
    } catch (error) {
      const code = isObject(error) && typeof error.code === 'string' ? error.code : '';
      if (code !== 'auth/user-not-found') throw error;
    }

    await ownedOperator.reference.delete();
    return noStoreJson({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
