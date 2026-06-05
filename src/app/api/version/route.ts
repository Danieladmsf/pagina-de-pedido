import { NextResponse } from 'next/server';

// deploy-test: validar fluxo de auth pós-deploy (App Hosting rollout).
// Sempre dinâmico e sem cache: precisa refletir a versão do deploy atual em tempo
// real para que clientes abertos há muito tempo percebam que há uma versão nova.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const version = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';
  return NextResponse.json(
    { version },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    },
  );
}
