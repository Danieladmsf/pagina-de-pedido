import { FieldValue } from 'firebase-admin/firestore';
import { getOptionalAdminAuth, getOptionalAdminDb } from '@/lib/firebase-admin';
import {
  aposTentativa,
  conferirSenha,
  gerarHashDaSenha,
  mensagemDeTrava,
  problemaNaSenha,
  restoDaTrava,
} from '@/lib/cancel-pin';

/**
 * Senha de cancelamento de venda, conferida no servidor.
 *
 * O hash fica em `store_secrets/{ownerId}` (campo `cancelPin`), que as regras do
 * Firestore fecham para qualquer cliente: só este código (Admin SDK) lê e grava.
 * O hash nunca sai daqui — a resposta traz só `configured` e `ok`.
 *
 * Ações (POST { action, pin? }):
 *  - status: qualquer usuário ativo da loja; diz se há senha.
 *  - verify: qualquer usuário ativo da loja (dono inclusive); confere a senha.
 *  - set / clear: só o dono.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPERATOR_COLLECTION = 'roles_operador';
const OWNER_COLLECTION = 'roles_admin';
const SECRETS_COLLECTION = 'store_secrets';

class CancelPinApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'CancelPinApiError';
  }
}

function noStoreJson(data: Record<string, unknown>, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function bearerToken(request: Request): string {
  const match = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]?.trim()) throw new CancelPinApiError(401, 'Sessão expirada. Faça login novamente.');
  return match[1].trim();
}

/** Descobre a loja de quem chama: dono (roles_admin) ou funcionário ativo. */
async function requireStoreUser(request: Request) {
  const auth = getOptionalAdminAuth();
  const db = getOptionalAdminDb();
  if (!auth || !db) throw new CancelPinApiError(503, 'Servidor sem acesso ao banco de dados.');

  let uid: string;
  try {
    uid = (await auth.verifyIdToken(bearerToken(request), true)).uid;
  } catch (error) {
    if (error instanceof CancelPinApiError) throw error;
    throw new CancelPinApiError(401, 'Não foi possível validar a sessão do usuário.');
  }

  if ((await db.collection(OWNER_COLLECTION).doc(uid).get()).exists) {
    return { db, ownerUid: uid, isOwner: true };
  }
  const role = (await db.collection(OPERATOR_COLLECTION).doc(uid).get()).data();
  if (role?.active !== true || typeof role.ownerId !== 'string' || !role.ownerId) {
    throw new CancelPinApiError(403, 'Este acesso não pertence a uma loja ativa.');
  }
  return { db, ownerUid: role.ownerId as string, isOwner: false };
}

export async function POST(request: Request) {
  try {
    const { db, ownerUid, isOwner } = await requireStoreUser(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') throw new CancelPinApiError(400, 'Corpo JSON inválido.');
    const { action, pin } = body as { action?: unknown; pin?: unknown };
    const ref = db.collection(SECRETS_COLLECTION).doc(ownerUid);

    if (action === 'status') {
      const registro = (await ref.get()).data()?.cancelPin;
      return noStoreJson({ configured: !!registro?.hash });
    }

    if (action === 'set' || action === 'clear') {
      if (!isOwner) throw new CancelPinApiError(403, 'Só o dono pode definir a senha de cancelamento.');
      if (action === 'clear') {
        await ref.set({ cancelPin: FieldValue.delete() }, { merge: true });
        return noStoreJson({ configured: false });
      }
      const problema = problemaNaSenha(pin);
      if (problema) throw new CancelPinApiError(400, problema);
      const { hash, salt } = gerarHashDaSenha(pin as string);
      await ref.set(
        { cancelPin: { hash, salt, failedAttempts: 0, lockedUntil: 0, updatedAt: FieldValue.serverTimestamp() } },
        { merge: true },
      );
      return noStoreJson({ configured: true });
    }

    if (action === 'verify') {
      // Transação: tentativas simultâneas não furam a contagem de erros.
      const resultado = await db.runTransaction(async (tx) => {
        const registro = (await tx.get(ref)).data()?.cancelPin;
        if (!registro?.hash) return { configured: false, ok: true as const, trava: 0 };

        const agora = Date.now();
        const trava = restoDaTrava(registro, agora);
        if (trava > 0) return { configured: true, ok: false as const, trava };

        const acertou = conferirSenha(pin, registro);
        const proximo = aposTentativa(registro, acertou, agora);
        tx.update(ref, {
          'cancelPin.failedAttempts': proximo.failedAttempts,
          'cancelPin.lockedUntil': proximo.lockedUntil,
        });
        return { configured: true, ok: acertou, trava: restoDaTrava(proximo, agora) };
      });

      if (resultado.ok) return noStoreJson({ ok: true, configured: resultado.configured });
      if (resultado.trava > 0) {
        return noStoreJson({ ok: false, configured: true, locked: true, error: mensagemDeTrava(resultado.trava) }, 429);
      }
      return noStoreJson({ ok: false, configured: true, error: 'Senha incorreta' }, 403);
    }

    throw new CancelPinApiError(400, 'Ação inválida.');
  } catch (error) {
    if (error instanceof CancelPinApiError) return noStoreJson({ error: error.message }, error.status);
    console.error('[cancel-pin]', error);
    return noStoreJson({ error: 'Não foi possível concluir a operação.' }, 500);
  }
}
