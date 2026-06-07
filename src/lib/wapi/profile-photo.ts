'use client';

/**
 * Carregador de foto de perfil do WhatsApp (via /wapi/profile-pic).
 *
 * - Cache em MÓDULO (compartilhado entre telas) + persistência em localStorage,
 *   então foto já vista aparece INSTANTÂNEA (sem rede) ao reabrir/rolar.
 * - `peekProfilePhoto` lê o cache de forma síncrona (na 1ª renderização), para o
 *   avatar já mostrar a foto sem esperar — comportamento parecido com o WhatsApp.
 * - Foto é cosmética: qualquer erro vira null (a UI cai no avatar de iniciais).
 *
 * O link real expira em ~48h; guardamos por 24h e, depois, buscamos de novo.
 */
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();
const TTL = 24 * 60 * 60 * 1000; // 24h

const digits = (phone: string) => (phone || '').replace(/\D/g, '');
const lsKey = (key: string) => `pdvpic:${key}`;

function hydrate(key: string) {
  if (cache.has(key) || typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(lsKey(key));
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (obj && typeof obj.ts === 'number' && Date.now() - obj.ts < TTL) {
      cache.set(key, obj.url ?? null);
    }
  } catch { /* ignore */ }
}

function persist(key: string, url: string | null) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(lsKey(key), JSON.stringify({ url, ts: Date.now() }));
  } catch { /* quota/indisponível: ignora */ }
}

/** Lê o cache (módulo + localStorage) de forma síncrona. undefined = desconhecido. */
export function peekProfilePhoto(phone: string): string | null | undefined {
  const key = digits(phone);
  if (!key) return undefined;
  hydrate(key);
  return cache.has(key) ? cache.get(key) : undefined;
}

export function makeProfilePhotoLoader(user: any) {
  return async (phone: string): Promise<string | null> => {
    const key = digits(phone);
    if (!key || !user) return null;
    hydrate(key);
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
        persist(key, link);
        return link;
      } catch {
        cache.set(key, null);
        persist(key, null);
        return null;
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, p);
    return p;
  };
}
