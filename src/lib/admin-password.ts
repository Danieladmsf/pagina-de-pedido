export interface AdminSecret {
  salt: string;
  passwordHash: string;
  algorithm?: 'SHA-256';
  version?: number;
}

const ADMIN_UNLOCK_KEY_PREFIX = 'pdv-admin-unlocked:';
const memoryUnlocks = new Map<string, AdminUnlockSession>();
export const ADMIN_SESSION_UPDATED_EVENT = 'pdv-admin-session-updated';
export const ADMIN_UNLOCK_DURATION_MS = 30 * 60 * 1000;
export const OWNER_MODE_IDLE_MS = 10 * 60 * 1000;

interface AdminUnlockSession {
  expiresAt: number;
  secretFingerprint: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function digestPassword(password: string, salt: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Este navegador não oferece suporte à proteção da senha.');
  }

  const passwordBytes = new TextEncoder().encode(password);
  const payload = new Uint8Array(salt.length + passwordBytes.length);
  payload.set(salt);
  payload.set(passwordBytes, salt.length);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', payload);
  return bytesToBase64(new Uint8Array(digest));
}

export async function createAdminSecret(password: string): Promise<AdminSecret> {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Este navegador não oferece suporte à criação segura da senha.');
  }

  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return {
    salt: bytesToBase64(salt),
    passwordHash: await digestPassword(password, salt),
    algorithm: 'SHA-256',
    version: 1,
  };
}

export async function verifyAdminPassword(password: string, secret: AdminSecret): Promise<boolean> {
  if (!secret?.salt || !secret?.passwordHash) return false;

  try {
    const salt = base64ToBytes(secret.salt);
    const candidate = await digestPassword(password, salt);
    if (candidate.length !== secret.passwordHash.length) return false;

    // Compara todos os caracteres para não encerrar no primeiro caractere diferente.
    let difference = 0;
    for (let index = 0; index < candidate.length; index += 1) {
      difference |= candidate.charCodeAt(index) ^ secret.passwordHash.charCodeAt(index);
    }
    return difference === 0;
  } catch (error) {
    if (!globalThis.crypto?.subtle) {
      throw new Error('A verificação de senha exige HTTPS e um navegador compatível.');
    }
    // Base64/hash corrompido nunca autentica, mas não é confundido com falta de Web Crypto.
    if (error instanceof DOMException && error.name === 'InvalidCharacterError') return false;
    throw error;
  }
}

function getAdminUnlockKey(userId: string): string {
  return `${ADMIN_UNLOCK_KEY_PREFIX}${userId}`;
}

function fingerprintSecret(secret: AdminSecret): string {
  return `${secret.version ?? 1}:${secret.salt}:${secret.passwordHash}`;
}

function readAdminUnlock(userId: string): AdminUnlockSession | null {
  const memoryValue = memoryUnlocks.get(userId) || null;
  if (typeof window === 'undefined') return memoryValue;
  try {
    const raw = window.sessionStorage.getItem(getAdminUnlockKey(userId));
    if (!raw) return memoryValue;
    const parsed = JSON.parse(raw) as Partial<AdminUnlockSession>;
    if (typeof parsed.expiresAt !== 'number' || typeof parsed.secretFingerprint !== 'string') {
      return memoryValue;
    }
    return { expiresAt: parsed.expiresAt, secretFingerprint: parsed.secretFingerprint };
  } catch {
    return memoryValue;
  }
}

export function unlockAdminSession(userId: string, secret: AdminSecret, now = Date.now()): void {
  if (typeof window === 'undefined') return;
  const session: AdminUnlockSession = {
    expiresAt: now + ADMIN_UNLOCK_DURATION_MS,
    secretFingerprint: fingerprintSecret(secret),
  };
  memoryUnlocks.set(userId, session);
  try {
    window.sessionStorage.setItem(getAdminUnlockKey(userId), JSON.stringify(session));
  } catch {
    // Ambientes que bloqueiam sessionStorage continuam funcionando nesta aba,
    // somente em memória, e perdem o desbloqueio ao recarregar.
  }
  window.dispatchEvent(new CustomEvent(ADMIN_SESSION_UPDATED_EVENT, { detail: { userId } }));
}

export function isAdminSessionUnlocked(userId: string, secret: AdminSecret, now = Date.now()): boolean {
  if (typeof window === 'undefined') return false;
  const session = readAdminUnlock(userId);
  if (!session || session.expiresAt <= now || session.secretFingerprint !== fingerprintSecret(secret)) {
    return false;
  }
  return true;
}

export function getAdminSessionRemainingMs(userId: string, secret: AdminSecret, now = Date.now()): number {
  if (typeof window === 'undefined') return 0;
  const session = readAdminUnlock(userId);
  if (!session || session.secretFingerprint !== fingerprintSecret(secret)) return 0;
  return Math.max(0, session.expiresAt - now);
}

export function clearAdminSession(userId: string): void {
  if (typeof window === 'undefined') return;
  memoryUnlocks.delete(userId);
  try {
    window.sessionStorage.removeItem(getAdminUnlockKey(userId));
  } catch {
    // O fallback em memória já foi limpo.
  }
  window.dispatchEvent(new CustomEvent(ADMIN_SESSION_UPDATED_EVENT, { detail: { userId } }));
}
