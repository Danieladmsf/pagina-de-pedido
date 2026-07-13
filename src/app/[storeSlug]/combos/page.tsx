import React, { Suspense } from 'react';
import type { Metadata } from 'next';
import { ShowcasePageClient } from '@/components/menu/ShowcasePageClient';
import { StoreSplash } from '@/components/StoreSplash';
import { getTheme } from '@/lib/themes';
import { fetchStoreProfile, fetchStoreName, resolveStoreIdFromSlugParam } from '@/lib/store-profile-server';

export async function generateMetadata({ params }: { params: Promise<{ storeSlug: string }> }): Promise<Metadata> {
  const { storeSlug } = await params;
  const storeId = await resolveStoreIdFromSlugParam(storeSlug);
  if (!storeId) return { title: 'Combos' };

  const [profile, roleName] = await Promise.all([fetchStoreProfile(storeId), fetchStoreName(storeId)]);
  const storeName = profile?.general?.name || roleName || 'Cardápio';
  const logoUrl = profile?.general?.logoUrl || '';

  return {
    title: `Combos | ${storeName}`,
    description: `Combos exclusivos do ${storeName}. Peça pagando menos.`,
    ...(logoUrl ? { icons: { icon: logoUrl, shortcut: logoUrl, apple: logoUrl } } : {}),
  };
}

export default async function CombosPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  const { storeSlug } = await params;

  const storeId = await resolveStoreIdFromSlugParam(storeSlug);
  const profile = storeId ? await fetchStoreProfile(storeId) : null;
  const splashLogoUrl = profile?.general?.logoUrl || '';
  const splashStoreName = profile?.general?.name || '';
  const splashBg = getTheme(profile?.general?.theme || 'light').colors.bg || '#FAFAF7';

  return (
    <Suspense fallback={<StoreSplash logoUrl={splashLogoUrl} storeName={splashStoreName} bgColor={splashBg} />}>
      <ShowcasePageClient
        storeSlug={storeSlug}
        mode="combos"
        splashLogoUrl={splashLogoUrl}
        splashStoreName={splashStoreName}
        splashBg={splashBg}
      />
    </Suspense>
  );
}
