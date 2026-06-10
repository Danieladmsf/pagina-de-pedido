import { NextRequest, NextResponse } from 'next/server';

// Proteção compartilhada das rotas públicas que fazem proxy para APIs
// externas (Google Maps, ViaCEP): checagem de origem + rate-limit por IP.
//
// O rate-limit é em memória, por instância do servidor — freia rajadas e
// scripts simples, não substitui um rate-limit distribuído.
const rateLimitHits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;

function isRateLimited(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const entry = rateLimitHits.get(key);
  if (!entry || now > entry.resetAt) {
    // Limpeza oportunista para o Map não crescer sem limite
    if (rateLimitHits.size > 5000) rateLimitHits.clear();
    rateLimitHits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > maxPerMinute;
}

/**
 * Retorna uma resposta de bloqueio (403/429) ou null se a requisição pode
 * prosseguir. Uso: `const blocked = guardPublicApi(req); if (blocked) return blocked;`
 */
export function guardPublicApi(
  req: NextRequest,
  options?: { maxPerMinute?: number }
): NextResponse | null {
  // Só o próprio app (mesma origem) pode usar estes proxies pelo navegador;
  // bloqueia outros sites de consumirem a cota via navegador dos visitantes.
  // Requisições same-origin de navegador podem nem enviar Origin — aí passa.
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return NextResponse.json({ error: 'Origem não autorizada.' }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: 'Origem não autorizada.' }, { status: 403 });
    }
  }

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const key = `${req.nextUrl.pathname}:${ip}`;
  if (isRateLimited(key, options?.maxPerMinute ?? 30)) {
    return NextResponse.json(
      { error: 'Muitas requisições. Tente novamente em instantes.' },
      { status: 429 }
    );
  }

  return null;
}
