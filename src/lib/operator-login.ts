/**
 * Login do funcionário: apelido ou e-mail, escolhido pelo dono na tela.
 *
 * O Firebase Auth só sabe autenticar por e-mail. Funcionário de loja quase
 * nunca tem um; por isso o dono digita um apelido ("maria") e o app monta um
 * endereço interno determinístico ("maria@usuarios.polarispdv.app") que existe
 * só para o Auth ter o que guardar. Quem digita "maria" na tela de login cai no
 * mesmo endereço — é a razão de o apelido ser único na plataforma inteira e não
 * por loja: sem sufixo de loja, o /login não teria como saber de qual loja é o
 * "maria" que está entrando.
 *
 * Endereço interno não recebe e-mail. Quem tem apelido só recupera a senha com
 * o dono trocando na tela de Usuários.
 */

export const OPERATOR_LOGIN_DOMAIN = 'usuarios.polarispdv.app';

/** O Firebase Auth recusa senha com menos de 6 caracteres. */
export const OPERATOR_PASSWORD_MIN_LENGTH = 6;
export const OPERATOR_PASSWORD_MAX_LENGTH = 128;

const HANDLE_MIN_LENGTH = 3;
const HANDLE_MAX_LENGTH = 32;
const HANDLE_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function isEmailLogin(value: string): boolean {
  return value.includes('@');
}

/** Tira acento, espaço e maiúscula: o que sobra é o que vira endereço. */
export function normalizeOperatorHandle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '.')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+/, '')
    .replace(/[._-]+$/, '');
}

export function isValidOperatorHandle(handle: string): boolean {
  return handle.length >= HANDLE_MIN_LENGTH
    && handle.length <= HANDLE_MAX_LENGTH
    && HANDLE_PATTERN.test(handle);
}

export function operatorHandleToEmail(handle: string): string {
  return `${handle}@${OPERATOR_LOGIN_DOMAIN}`;
}

export function isInternalOperatorEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${OPERATOR_LOGIN_DOMAIN}`);
}

/**
 * O que a tela mostra de volta: apelido puro para login interno, e-mail
 * completo para quem entra com endereço de verdade.
 */
export function getOperatorDisplayLogin(email: string): string {
  const normalized = email.trim().toLowerCase();
  return isInternalOperatorEmail(normalized)
    ? normalized.slice(0, -(OPERATOR_LOGIN_DOMAIN.length + 1))
    : normalized;
}

export interface ResolvedLogin {
  /** Endereço que vai para o Firebase Auth. */
  email: string;
  /** Como o dono digitou, já normalizado (apelido ou e-mail). */
  login: string;
  kind: 'handle' | 'email';
}

/**
 * Resolve o que foi digitado — na criação do usuário e também no /login, para
 * que os dois cheguem exatamente ao mesmo endereço.
 */
export function resolveOperatorLogin(value: unknown): ResolvedLogin | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  if (isEmailLogin(raw)) {
    const email = raw.toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    // Alguém pode digitar o endereço interno inteiro; continua sendo apelido.
    return isInternalOperatorEmail(email)
      ? { email, login: getOperatorDisplayLogin(email), kind: 'handle' }
      : { email, login: email, kind: 'email' };
  }

  const handle = normalizeOperatorHandle(raw);
  if (!isValidOperatorHandle(handle)) return null;
  return { email: operatorHandleToEmail(handle), login: handle, kind: 'handle' };
}

/** Mensagem pronta para a tela, ou `null` quando a senha serve. */
export function validateOperatorPassword(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return 'Escolha uma senha para o funcionário.';
  if (value.length < OPERATOR_PASSWORD_MIN_LENGTH) {
    return `A senha precisa de pelo menos ${OPERATOR_PASSWORD_MIN_LENGTH} caracteres.`;
  }
  if (value.length > OPERATOR_PASSWORD_MAX_LENGTH) return 'A senha é longa demais.';
  if (value.trim() !== value) return 'A senha não pode começar nem terminar com espaço.';
  return null;
}

/** Primeiro palpite de apelido a partir do nome, para o dono só confirmar. */
export function suggestOperatorHandle(name: string): string {
  const parts = normalizeOperatorHandle(name).split('.').filter(Boolean);
  if (parts.length === 0) return '';
  const primeiro = parts[0];
  if (primeiro.length >= HANDLE_MIN_LENGTH) return primeiro.slice(0, HANDLE_MAX_LENGTH);
  return parts.slice(0, 2).join('.').slice(0, HANDLE_MAX_LENGTH);
}

/** Sugestões de saída quando o apelido escolhido já pertence a outra pessoa. */
export function suggestAlternativeHandles(handle: string, hint = ''): string[] {
  const base = normalizeOperatorHandle(handle);
  if (!base) return [];
  const sufixoLoja = normalizeOperatorHandle(hint).split('.').filter(Boolean)[0] || '';
  const candidatos = [
    sufixoLoja ? `${base}.${sufixoLoja}` : '',
    `${base}2`,
    `${base}.pdv`,
  ];
  return candidatos
    .filter(Boolean)
    .map((candidato) => candidato.slice(0, HANDLE_MAX_LENGTH))
    .filter((candidato) => isValidOperatorHandle(candidato) && candidato !== base);
}

/** Senha sugerida: fácil de ditar no balcão, sem caractere ambíguo. */
export function generateOperatorPassword(): string {
  const alfabeto = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(8);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => alfabeto[byte % alfabeto.length]).join('');
}
