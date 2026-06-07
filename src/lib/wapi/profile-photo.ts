'use client';

/**
 * Carregador de foto de perfil do WhatsApp (via /wapi/profile-pic).
 *
 * Cache e dedupe em nível de MÓDULO: a foto de um número é buscada uma única vez
 * e reaproveitada em qualquer tela (Campanhas, Clientes, etc.) na mesma sessão.
 * Foto é cosmética — qualquer erro vira null (a UI cai no avatar de iniciais).
 */
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

export function makeProfilePhotoLoader(user: any) {
  return async (phone: string): Promise<string | null> => {
    const key = (phone || '').replace(/\D/g, '');
    if (!key || !user) return null;
    if (cache.has(key)) return cache.get(key)!;
    if (inflight.has(key)) return inflight.get(key)!;

    const p = (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/wapi/profile-pic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ empresaId: user.uid, phone: key }),
        });
        const data = await res.json().catch(() => null);
        const link = res.ok && data?.link ? (data.link as string) : null;
        cache.set(key, link);
        return link;
      } catch {
        cache.set(key, null);
        return null;
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, p);
    return p;
  };
}
