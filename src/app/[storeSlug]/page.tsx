import React, { Suspense } from 'react';
import { MenuPageClient } from '@/components/MenuPageClient';
import { StoreSplash } from '@/components/StoreSplash';
import { Metadata, Viewport } from 'next';
import { getTheme } from '@/lib/themes';
import { fetchStoreProfile, fetchStoreName, resolveStoreIdFromSlugParam } from '@/lib/store-profile-server';

export async function generateMetadata({ params }: { params: Promise<{ storeSlug: string }> }): Promise<Metadata> {
  const { storeSlug } = await params;

  const defaults: Metadata = {
    title: 'Cardápio Digital',
    description: 'Faça seu pedido online!',
  };

  const storeId = await resolveStoreIdFromSlugParam(storeSlug);
  if (!storeId) return defaults;

  const [profile, roleName] = await Promise.all([
    fetchStoreProfile(storeId),
    fetchStoreName(storeId),
  ]);

  const storeName = profile?.general?.name || roleName || 'Cardápio Digital';
  const description = profile?.general?.description || `Peça online no ${storeName}`;
  const bannerUrl = profile?.general?.bannerDesktopUrl || profile?.general?.bannerMobileUrl || profile?.general?.bannerImageUrl || '';
  const logoUrl = profile?.general?.logoUrl || '';
  const ogImageUrl = profile?.general?.ogImageUrl || '';
  const ogImage = ogImageUrl || bannerUrl || logoUrl || '';

  return {
    title: `${storeName} | Cardápio Digital`,
    description,
    // Manifest por loja: splash do PWA com o logo e nome da loja
    manifest: `/api/manifest/${storeSlug}`,
    // Logo da loja como favicon da aba e icone apple (iOS)
    ...(logoUrl ? { icons: { icon: logoUrl, shortcut: logoUrl, apple: logoUrl } } : {}),
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default' as const,
      title: storeName,
    },
    openGraph: {
      title: storeName,
      description,
      type: 'website',
      siteName: 'Cardápio Digital',
      ...(ogImage ? {
        images: [{
          url: ogImage,
          width: 1200,
          height: 630,
          alt: storeName,
        }],
      } : {}),
    },
    twitter: {
      card: ogImage ? 'summary_large_image' : 'summary',
      title: storeName,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

export async function generateViewport({ params }: { params: Promise<{ storeSlug: string }> }): Promise<Viewport> {
  const defaults: Viewport = { themeColor: '#ffffff' };
  const { storeSlug } = await params;
  if (!storeSlug) return defaults;

  const storeId = await resolveStoreIdFromSlugParam(storeSlug);
  if (!storeId) return defaults;

  const profile = await fetchStoreProfile(storeId);
  const themeId = profile?.general?.theme || 'light';
  const theme = getTheme(themeId);

  return {
    themeColor: theme.colors.bg || '#ffffff',
  };
}

export default async function StorePage({ params }: { params: Promise<{ storeSlug: string }> }) {
  const { storeSlug } = await params;

  // Mesmos fetches do generateMetadata (cacheados 5min), então sem custo extra:
  // o logo/nome/tema alimentam a splash de abertura com a marca da loja.
  const storeId = await resolveStoreIdFromSlugParam(storeSlug);
  const profile = storeId ? await fetchStoreProfile(storeId) : null;
  const splashLogoUrl = profile?.general?.logoUrl || '';
  const splashStoreName = profile?.general?.name || '';
  const splashBg = getTheme(profile?.general?.theme || 'light').colors.bg || '#FAFAF7';

  return (
    <Suspense fallback={<StoreSplash logoUrl={splashLogoUrl} storeName={splashStoreName} bgColor={splashBg} />}>
      <MenuPageClient
        storeSlug={storeSlug}
        splashLogoUrl={splashLogoUrl}
        splashStoreName={splashStoreName}
        splashBg={splashBg}
      />
    </Suspense>
  );
}
