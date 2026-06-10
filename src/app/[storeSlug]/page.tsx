import React, { Suspense } from 'react';
import { MenuPageClient } from '@/components/MenuPageClient';
import { Loader2 } from 'lucide-react';
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
    ...(logoUrl ? { icons: { apple: logoUrl } } : {}),
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
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF7]">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    }>
      <MenuPageClient storeSlug={storeSlug} />
    </Suspense>
  );
}
