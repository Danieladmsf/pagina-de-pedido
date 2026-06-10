import { NextResponse } from 'next/server';
import { fetchStoreProfile, fetchStoreName, resolveStoreIdFromSlugParam } from '@/lib/store-profile-server';
import { getTheme } from '@/lib/themes';

// Manifest PWA por loja: o Android gera a splash screen a partir do icone
// 512px, do name e do background_color declarados aqui.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ storeSlug: string }> }
) {
  const { storeSlug } = await params;
  const slug = decodeURIComponent(storeSlug);

  const storeId = await resolveStoreIdFromSlugParam(storeSlug);
  const [profile, roleName] = storeId
    ? await Promise.all([fetchStoreProfile(storeId), fetchStoreName(storeId)])
    : [null, null];

  const storeName = profile?.general?.name || roleName || 'Cardápio Digital';
  const logoUrl = profile?.general?.logoUrl || '';
  const theme = getTheme(profile?.general?.theme || 'light');

  // Sem logo cadastrado, mantém os icones padrao do app
  const icons = logoUrl
    ? [
        { src: logoUrl, sizes: '192x192', purpose: 'any' },
        { src: logoUrl, sizes: '512x512', purpose: 'any' },
      ]
    : [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ];

  const manifest = {
    // id unico por loja: permite instalar lojas diferentes como apps separados
    id: `/${slug}`,
    name: storeName,
    short_name: storeName.slice(0, 12),
    description: profile?.general?.description || `Peça online no ${storeName}`,
    start_url: `/${storeSlug}`,
    scope: '/',
    display: 'standalone',
    background_color: theme.colors.bg || '#FAFAF7',
    theme_color: theme.colors.bg || '#ffffff',
    orientation: 'portrait',
    icons,
  };

  return NextResponse.json(manifest, {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
