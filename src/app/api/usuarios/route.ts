import type { UpdateRequest, UserRecord } from 'firebase-admin/auth';
import { FieldValue, type DocumentData, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { firebaseConfig } from '@/firebase/config';
import { getOptionalAdminAuth, getOptionalAdminDb } from '@/lib/firebase-admin';
import {
  getOperatorDisplayLogin,
  isInternalOperatorEmail,
  resolveOperatorLogin,
  suggestAlternativeHandles,
  validateOperatorPassword,
} from '@/lib/operator-login';
import {
  excedePermissoes,
  normalizeOperatorPermissions,
} from '@/lib/user-permissions';

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

/**
 * O dono digita apelido ("maria") ou e-mail. O apelido vira um endereco interno
 * que existe so para o Firebase Auth ter o que guardar; quem entra digitando o
 * mesmo apelido no /login chega ao mesmo endereco.
 */
function normalizeLogin(value: unknown) {
  const resolved = resolveOperatorLogin(value);
  if (!resolved) {
    throw new UsuariosApiError(400, 'Informe um usuario (apelido com 3 letras ou mais) ou um e-mail valido.');
  }
  return resolved;
}

function normalizePassword(value: unknown): string {
  const problema = validateOperatorPassword(value);
  if (problema) throw new UsuariosApiError(400, problema);
  return value as string;
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

/**
 * Quem pode mexer nos usuarios da loja.
 *
 * O dono sempre pode. Um funcionario tambem pode, quando o dono ligou o modulo
 * "Usuarios e acesso" para ele - `ver` para consultar a lista e `editar` para
 * criar/alterar. Nesse caso valem duas travas que o dono nao tem: ele nao mexe
 * no proprio acesso e nao concede nada que ele mesmo nao possua.
 */
async function requireGestor(request: Request, precisaEditar: boolean) {
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

  const actorUid = decodedToken.uid;
  const ownerSnapshot = await db.collection(OWNER_COLLECTION).doc(actorUid).get();
  if (ownerSnapshot.exists) {
    const storeName = ownerSnapshot.data()?.storeName;
    return {
      auth,
      db,
      ownerUid: actorUid,
      actorUid,
      isOwner: true,
      actorPermissions: null,
      storeName: typeof storeName === 'string' ? storeName : '',
    };
  }

  const actorRole = await db.collection(OPERATOR_COLLECTION).doc(actorUid).get();
  const actorData = actorRole.data();
  if (!actorRole.exists || actorData?.active !== true || typeof actorData.ownerId !== 'string') {
    throw new UsuariosApiError(403, 'Este acesso nao pode gerenciar usuarios.');
  }

  const actorPermissions = normalizeOperatorPermissions(actorData.permissions);
  const modulo = actorPermissions.retaguarda.usuarios;
  if (!modulo.ver || (precisaEditar && !modulo.editar)) {
    throw new UsuariosApiError(403, precisaEditar
      ? 'Seu acesso permite consultar os usuarios, mas nao alterar.'
      : 'Seu acesso nao inclui Usuarios.');
  }

  const donoSnapshot = await db.collection(OWNER_COLLECTION).doc(actorData.ownerId).get();
  const storeName = donoSnapshot.data()?.storeName;

  return {
    auth,
    db,
    ownerUid: actorData.ownerId,
    actorUid,
    isOwner: false,
    actorPermissions,
    storeName: typeof storeName === 'string' ? storeName : '',
  };
}

/** Recusa o gestor delegado que tenta conceder mais do que ele proprio tem. */
function garantirSemEscalada(
  actorPermissions: ReturnType<typeof normalizeOperatorPermissions> | null,
  pedidas: ReturnType<typeof normalizeOperatorPermissions>,
) {
  if (!actorPermissions) return;
  if (excedePermissoes(pedidas, actorPermissions)) {
    throw new UsuariosApiError(403, 'Voce so pode liberar o que o seu proprio acesso ja tem.');
  }
}

/** O gestor delegado nao mexe no proprio acesso - seria autopromocao. */
function garantirQueNaoEhEleMesmo(isOwner: boolean, actorUid: string, alvoUid: string) {
  if (!isOwner && actorUid === alvoUid) {
    throw new UsuariosApiError(403, 'Voce nao pode alterar o proprio acesso.');
  }
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
    // O que o dono entrega ao funcionario: apelido puro ou o e-mail completo.
    login: getOperatorDisplayLogin(
      authUser?.email
        || (typeof role.login === 'string' ? role.login : '')
        || (typeof role.email === 'string' ? role.email : ''),
    ),
    // Apelido nao tem caixa de entrada; a tela esconde o convite por e-mail.
    canReceiveEmail: !!authUser?.email && !isInternalOperatorEmail(authUser.email),
    // A UI exibe o estado efetivo, não apenas uma das duas metades. Isso também
    // permite que o botão "Ativar" repare com um clique um Auth bloqueado
    // manualmente, em vez de mostrar "Ativo" e "Bloqueado" ao mesmo tempo.
    active: role.active === true && !!authUser && authUser.disabled !== true,
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
    const { auth, db, ownerUid } = await requireGestor(request, false);
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
    const { auth, db, ownerUid, actorUid, storeName, actorPermissions } = await requireGestor(request, true);
    const body = await readJsonObject(request);
    if ('ownerId' in body || 'role' in body || 'master' in body || 'uid' in body) {
      throw new UsuariosApiError(400, 'O papel e o proprietario nao podem ser definidos pelo cliente.');
    }
    if ('permissions' in body && !isObject(body.permissions)) {
      throw new UsuariosApiError(400, 'Permissoes invalidas.');
    }

    const name = normalizeName(body.name);
    const { email, login, kind } = normalizeLogin('login' in body ? body.login : body.email);
    const querSenha = body.password !== undefined && body.password !== null && body.password !== '';
    // Apelido nao tem caixa de entrada: sem senha definida aqui, ninguem entraria.
    if (kind === 'handle' && !querSenha) {
      throw new UsuariosApiError(400, 'Escolha uma senha: quem entra por apelido nao recebe e-mail.');
    }
    const password = querSenha ? normalizePassword(body.password) : undefined;
    const permissions = sanitizePermissions(body.permissions);
    garantirSemEscalada(actorPermissions, permissions);

    let authUser: UserRecord;
    try {
      authUser = await auth.createUser({
        email,
        ...(password ? { password } : {}),
        displayName: name,
        emailVerified: false,
        disabled: false,
      });
    } catch (error) {
      const code = isObject(error) && typeof error.code === 'string' ? error.code : '';
      // O apelido e unico na plataforma inteira (ver lib/operator-login), entao
      // "ja esta em uso" costuma ser homonimo de outra loja, nao erro do dono.
      if (code === 'auth/email-already-exists' && kind === 'handle') {
        const alternativas = suggestAlternativeHandles(login, storeName);
        throw new UsuariosApiError(409, alternativas.length > 0
          ? 'O usuario "' + login + '" ja esta em uso. Experimente ' + alternativas.join(', ') + '.'
          : 'O usuario "' + login + '" ja esta em uso. Escolha outro.');
      }
      throw error;
    }
    const roleReference = db.collection(OPERATOR_COLLECTION).doc(authUser.uid);

    try {
      await roleReference.set({
        ownerId: ownerUid,
        active: true,
        name,
        email,
        login,
        permissions,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      });
    } catch (error) {
      // Nao deixa um login orfao se a vinculacao segura com a loja falhar.
      await auth.deleteUser(authUser.uid).catch(() => undefined);
      throw error;
    }

    // Com a senha definida aqui nao existe convite: o dono ja entrega o acesso
    // na mao. O e-mail so entra em cena quando o dono opta por nao definir senha.
    let inviteSent = false;
    let warning: string | undefined;
    if (!password) {
      try {
        await sendPasswordSetupEmail(email);
        inviteSent = true;
      } catch (error) {
        warning = 'Usuario criado, mas o e-mail nao saiu. Defina uma senha para ele na tela.';
        console.warn('[api/usuarios] Usuario criado sem envio do convite:', error);
      }
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
    const { auth, db, ownerUid, actorUid, isOwner, actorPermissions } = await requireGestor(request, true);
    const body = await readJsonObject(request);
    const operatorUid = normalizeUid(body.uid);
    garantirQueNaoEhEleMesmo(isOwner, actorUid, operatorUid);
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
      if (body.action !== 'resend_invite' && body.action !== 'set_password') {
        throw new UsuariosApiError(400, 'Acao invalida.');
      }
      if ('name' in body || 'active' in body || 'permissions' in body) {
        throw new UsuariosApiError(400, 'Troque a senha separadamente das demais alteracoes.');
      }

      if (body.action === 'set_password') {
        const password = normalizePassword(body.password);
        try {
          await auth.updateUser(operatorUid, { password });
        } catch (error) {
          throw mapFirebaseAuthError(error) || error;
        }
        // Senha nova derruba quem ainda estiver dentro com a antiga.
        try {
          await auth.revokeRefreshTokens(operatorUid);
        } catch (error) {
          console.warn('[api/usuarios] Senha trocada, sessoes antigas nao revogadas:', error);
        }
        await ownedOperator.reference.update({
          passwordUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorUid,
        });
        return noStoreJson({ ok: true, passwordChanged: true });
      }

      if (!authUser.email) {
        throw new UsuariosApiError(409, 'Este usuario nao possui e-mail no Firebase Auth.');
      }
      if (isInternalOperatorEmail(authUser.email)) {
        throw new UsuariosApiError(409, 'Este usuario entra por apelido e nao tem e-mail. Troque a senha dele na tela.');
      }
      try {
        await sendPasswordSetupEmail(authUser.email);
      } catch {
        throw new UsuariosApiError(502, 'O Firebase nao conseguiu enviar o e-mail. Tente novamente.');
      }
      return noStoreJson({ ok: true, inviteSent: true });
    }

    const updates: DocumentData = {};
    const requestedName = 'name' in body ? normalizeName(body.name) : undefined;
    if (requestedName !== undefined) updates.name = requestedName;
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
      garantirSemEscalada(actorPermissions, updates.permissions);
    }
    if (Object.keys(updates).length === 0) {
      throw new UsuariosApiError(400, 'Nenhuma alteracao foi informada.');
    }

    const requestedActive = typeof updates.active === 'boolean'
      ? updates.active
      : undefined;
    let updatedAuthUser = authUser;

    const auditedUpdates = (values: DocumentData): DocumentData => ({
      ...values,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    });
    const updateAuthUser = async (values: UpdateRequest): Promise<UserRecord> => {
      try {
        return await auth.updateUser(operatorUid, values);
      } catch (error) {
        throw mapFirebaseAuthError(error) || error;
      }
    };
    const revokeOperatorSessions = async () => {
      try {
        await auth.revokeRefreshTokens(operatorUid);
      } catch (error) {
        throw mapFirebaseAuthError(error) || error;
      }
    };

    if (requestedActive === false) {
      // Fail-safe: as rules deixam de reconhecer o operador ANTES de qualquer
      // chamada ao Auth. Mesmo se desabilitar/revogar a conta falhar depois, o
      // papel permanece inativo e nenhum acesso a dados da loja e concedido.
      await ownedOperator.reference.update(auditedUpdates(updates));

      let authFailure: unknown;
      try {
        updatedAuthUser = await updateAuthUser({
          disabled: true,
          ...(requestedName !== undefined ? { displayName: requestedName } : {}),
        });
      } catch (error) {
        authFailure = error;
      }

      // Revoga tambem os tokens ja emitidos. A tentativa acontece mesmo se o
      // updateUser falhar, pois o documento inativo ja torna a operacao segura.
      try {
        await revokeOperatorSessions();
      } catch (error) {
        authFailure ??= error;
      }
      if (authFailure) throw authFailure;
    } else if (requestedActive === true) {
      const safeActivation = ownedOperator.data.active !== true || authUser.disabled === true;

      // Estado inconsistente (papel ativo, Auth desabilitado): corta primeiro o
      // papel para que habilitar o login nunca exponha as permissoes antigas.
      if (safeActivation && ownedOperator.data.active === true) {
        await ownedOperator.reference.update(auditedUpdates({ active: false }));
      }

      // Na ativacao, o login e habilitado primeiro. As rules continuam negando
      // acesso ate o update final gravar active=true no Firestore.
      updatedAuthUser = await updateAuthUser({
        disabled: false,
        ...(requestedName !== undefined ? { displayName: requestedName } : {}),
      });

      try {
        await ownedOperator.reference.update(auditedUpdates(updates));
      } catch (error) {
        if (safeActivation) {
          // Se o passo que concede o papel falhar, volta a bloquear o Auth. O
          // documento segue inativo, portanto ate uma falha da compensacao nao
          // concede acesso aos dados da loja.
          try {
            updatedAuthUser = await updateAuthUser({ disabled: true });
          } catch (rollbackError) {
            console.error('[api/usuarios] Falha ao reverter habilitacao do Auth:', rollbackError);
          }
          try {
            await revokeOperatorSessions();
          } catch (rollbackError) {
            console.error('[api/usuarios] Falha ao revogar sessao apos ativacao incompleta:', rollbackError);
          }
        }
        throw error;
      }
    } else {
      // Alteracao comum: sincroniza o nome no Auth antes de publicar o mesmo
      // valor no papel. Permissoes continuam sendo persistidas apenas no papel.
      if (requestedName !== undefined) {
        updatedAuthUser = await updateAuthUser({ displayName: requestedName });
      }
      await ownedOperator.reference.update(auditedUpdates(updates));
    }

    const updatedSnapshot = await ownedOperator.reference.get();
    return noStoreJson({
      usuario: operatorDto(operatorUid, updatedSnapshot.data() || {}, updatedAuthUser),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { auth, db, ownerUid, actorUid, isOwner } = await requireGestor(request, true);
    const operatorUid = normalizeUid(new URL(request.url).searchParams.get('uid'));
    garantirQueNaoEhEleMesmo(isOwner, actorUid, operatorUid);
    const ownedOperator = await requireOwnedOperator(db, ownerUid, operatorUid);

    // Primeiro corta o acesso nas rules. Se uma etapa posterior falhar, nunca
    // fica um login ativo e desvinculado que ainda consiga operar a loja.
    await ownedOperator.reference.update({
      active: false,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
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
