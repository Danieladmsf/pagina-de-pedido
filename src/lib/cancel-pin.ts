/**
 * Senha de cancelamento de venda — a regra pura (hash, conferência e trava).
 *
 * Só o SERVIDOR importa este arquivo (`/api/cancel-pin`). A senha nunca vai para
 * o código, para o git nem para `store_profiles` (leitura pública): o que se
 * guarda é o hash scrypt com salt aleatório, em `store_secrets/{ownerId}`, que
 * as regras do Firestore fecham para qualquer cliente.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export type CancelPinRegistro = {
  /** scrypt da senha, em hexadecimal. */
  hash: string;
  /** Salt aleatório, em hexadecimal. */
  salt: string;
};

/** Tentativas seguidas erradas antes de travar, e por quanto tempo. */
export const MAX_TENTATIVAS = 5;
export const TRAVA_MS = 5 * 60 * 1000;

const TAMANHO_HASH = 64;

/** 4 a 8 dígitos. Devolve o motivo da recusa, ou null se a senha serve. */
export function problemaNaSenha(pin: unknown): string | null {
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) {
    return 'A senha deve ter de 4 a 8 números.';
  }
  return null;
}

export function gerarHashDaSenha(pin: string, salt: string = randomBytes(16).toString('hex')): CancelPinRegistro {
  const hash = scryptSync(pin, Buffer.from(salt, 'hex'), TAMANHO_HASH).toString('hex');
  return { hash, salt };
}

export function conferirSenha(pin: unknown, registro: CancelPinRegistro): boolean {
  if (typeof pin !== 'string' || !registro?.hash || !registro?.salt) return false;
  const esperado = Buffer.from(registro.hash, 'hex');
  const calculado = scryptSync(pin, Buffer.from(registro.salt, 'hex'), esperado.length || TAMANHO_HASH);
  return esperado.length === calculado.length && timingSafeEqual(esperado, calculado);
}

export type EstadoDeTentativas = {
  failedAttempts: number;
  /** Instante (ms) até o qual novas tentativas são recusadas; 0 se livre. */
  lockedUntil: number;
};

export const SEM_TENTATIVAS: EstadoDeTentativas = { failedAttempts: 0, lockedUntil: 0 };

/** Milissegundos que faltam para destravar, ou 0 se pode tentar. */
export function restoDaTrava(estado: Partial<EstadoDeTentativas> | undefined, agora: number): number {
  const ate = Number(estado?.lockedUntil) || 0;
  return ate > agora ? ate - agora : 0;
}

/**
 * Estado depois de uma tentativa. Acerto zera o contador; o 5º erro seguido
 * trava por 5 minutos (e o contador recomeça do zero ao destravar).
 */
export function aposTentativa(
  estado: Partial<EstadoDeTentativas> | undefined,
  acertou: boolean,
  agora: number,
): EstadoDeTentativas {
  if (acertou) return { ...SEM_TENTATIVAS };
  // Ao travar o contador já foi zerado, então depois do prazo a pessoa volta a
  // ter as 5 chances.
  const falhas = (Number(estado?.failedAttempts) || 0) + 1;
  return falhas >= MAX_TENTATIVAS
    ? { failedAttempts: 0, lockedUntil: agora + TRAVA_MS }
    : { failedAttempts: falhas, lockedUntil: 0 };
}

export function mensagemDeTrava(restoMs: number): string {
  const min = Math.max(1, Math.ceil(restoMs / 60000));
  return `Muitas tentativas erradas. Tente de novo em ${min} ${min === 1 ? 'minuto' : 'minutos'}.`;
}
