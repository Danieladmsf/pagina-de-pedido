import { firebaseConfig } from '@/firebase/config';

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export interface AuthenticatedFirebaseUser {
  uid: string;
  email?: string | null;
  idToken: string;
}

export async function requireFirebaseUser(request: Request): Promise<AuthenticatedFirebaseUser> {
  const authHeader = request.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    throw new ApiError(401, 'Sessao expirada. Faca login novamente.');
  }

  const idToken = match[1].trim();
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.users?.[0]?.localId) {
    throw new ApiError(401, 'Nao foi possivel validar a sessao do usuario.', data);
  }

  return {
    uid: data.users[0].localId,
    email: data.users[0].email || null,
    idToken,
  };
}

export function jsonError(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message, details: error.details }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : 'Erro interno.';
  return Response.json({ error: message }, { status: 500 });
}
