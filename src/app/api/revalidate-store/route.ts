// Invalida o cache das páginas públicas de uma loja (tag `store-{id}` nos
// fetches de store-profile-server.ts). Chamado pelos editores do admin logo
// após salvar, para a página de encomendas refletir na hora em vez de esperar
// os 5 minutos do revalidate. Só derruba cache — não expõe nem altera dados.
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

export async function POST(req: Request) {
  try {
    const { storeId } = await req.json();
    if (typeof storeId !== 'string' || !storeId.trim() || storeId.length > 128) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    revalidateTag(`store-${storeId.trim()}`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
