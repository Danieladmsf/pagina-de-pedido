/**
 * Lado do navegador da senha de cancelamento: só conversa com `/api/cancel-pin`.
 * A conferência de verdade acontece no servidor; aqui nada é guardado.
 */

type UsuarioComToken = { getIdToken: () => Promise<string> };

export type RespostaSenha = {
  ok: boolean;
  configured: boolean;
  /** Mensagem pronta para mostrar ao operador quando `ok` é false. */
  mensagem?: string;
};

async function chamar(
  user: UsuarioComToken,
  action: 'status' | 'verify' | 'set' | 'clear',
  pin?: string,
): Promise<RespostaSenha> {
  const token = await user.getIdToken();
  const response = await fetch('/api/cancel-pin', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...(pin === undefined ? {} : { pin }) }),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (response.ok) return { ok: data?.ok !== false, configured: data?.configured === true };
  return {
    ok: false,
    configured: data?.configured === true,
    mensagem: typeof data?.error === 'string' ? data.error : 'Não foi possível conferir a senha.',
  };
}

export const consultarSenhaDeCancelamento = (user: UsuarioComToken) => chamar(user, 'status');
export const conferirSenhaDeCancelamento = (user: UsuarioComToken, pin: string) => chamar(user, 'verify', pin);
export const definirSenhaDeCancelamento = (user: UsuarioComToken, pin: string) => chamar(user, 'set', pin);
export const removerSenhaDeCancelamento = (user: UsuarioComToken) => chamar(user, 'clear');
