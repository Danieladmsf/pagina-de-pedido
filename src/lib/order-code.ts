const ORDER_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const ORDER_CODE_LENGTH = 8;

/**
 * Cria o código curto que o cliente lê. Ele nunca é a identidade do
 * documento: o pedido continua sendo vinculado pelo id gerado pelo Firestore.
 *
 * `bytes` existe para o teste ser determinístico. Em produção a entropia vem
 * de `crypto.getRandomValues`.
 */
export function generateOrderCode(bytes?: Uint8Array): string {
  const randomBytes = bytes ?? crypto.getRandomValues(new Uint8Array(ORDER_CODE_LENGTH));
  if (randomBytes.length < ORDER_CODE_LENGTH) {
    throw new Error(`generateOrderCode precisa de ${ORDER_CODE_LENGTH} bytes`);
  }

  return Array.from(
    randomBytes.slice(0, ORDER_CODE_LENGTH),
    (byte) => ORDER_CODE_ALPHABET[byte % ORDER_CODE_ALPHABET.length],
  ).join('');
}

/**
 * Código humano de um pedido. O fallback preserva todo o histórico criado
 * antes de `orderCode`, sem reescrever ids antigos.
 */
export function getOrderCode(order?: { id?: unknown; orderCode?: unknown } | null): string {
  const explicit = String(order?.orderCode ?? '').trim();
  return explicit || String(order?.id ?? '');
}

/** Forma curta usada em listas, títulos do caixa e cupom térmico. */
export function getOrderCodePrefix(
  order?: { id?: unknown; orderCode?: unknown } | null,
  length = 5,
): string {
  return getOrderCode(order).substring(0, length);
}
