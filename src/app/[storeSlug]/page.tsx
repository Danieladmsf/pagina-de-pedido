import React, { Suspense } from 'react';
import { MenuPageClient } from '@/components/MenuPageClient';
import { Loader2 } from 'lucide-react';
import { Metadata } from 'next';
import { getOptionalAdminDb } from '@/lib/firebase-admin';

// Dynamic OG metadata so WhatsApp/social media shows store banner + name
export async function generateMetadata({ params }: { params: { storeSlug: string } }): Promise<Metadata> {
  const slug = params.storeSlug;
  // Extract storeId from the slug (last segment after last dash)
  const parts = decodeURIComponent(slug).split('-');
  const storeId = parts.pop() || '';

  const defaults: Metadata = {
    title: 'Cardápio Digital',
    description: 'Faça seu pedido online!',
    openGraph: {
      title: 'Cardápio Digital',
      description: 'Faça seu pedido online!',
      type: 'website',
    },
  };

  if (!storeId) return defaults;

  try {
    const db = getOptionalAdminDb();
    if (!db) return defaults;

    const profileDoc = await db.collection('store_profiles').doc(storeId).get();
    const roleDoc = await db.collection('roles_admin').doc(storeId).get();

    const profile = profileDoc.exists ? profileDoc.data() : null;
    const role = roleDoc.exists ? roleDoc.data() : null;

    const storeName = profile?.general?.name || role?.storeName || 'Cardápio Digital';
    const description = profile?.general?.description || `Peça online no ${storeName}`;
    const bannerUrl = profile?.general?.bannerDesktopUrl || profile?.general?.bannerMobileUrl || profile?.general?.bannerImageUrl || '';
    const logoUrl = profile?.general?.logoUrl || '';

    // Prefer banner for OG image, fallback to logo
    const ogImage = bannerUrl || logoUrl || '';

    return {
      title: `${storeName} | Cardápio Digital`,
      description,
      openGraph: {
        title: `${storeName} | Cardápio Digital`,
        description,
        type: 'website',
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
        title: `${storeName} | Cardápio Digital`,
        description,
        ...(ogImage ? { images: [ogImage] } : {}),
      },
    };
  } catch (error) {
    console.warn('[generateMetadata] Error fetching store data:', error);
    return defaults;
  }
}

export default function StorePage({ params }: { params: { storeSlug: string } }) {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF7]">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    }>
      <MenuPageClient storeSlug={params.storeSlug} />
    </Suspense>
  );
}
