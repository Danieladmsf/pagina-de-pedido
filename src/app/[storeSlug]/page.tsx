import React, { Suspense } from 'react';
import { MenuPageClient } from '@/components/MenuPageClient';
import { Loader2 } from 'lucide-react';
import { Metadata } from 'next';

const FIRESTORE_PROJECT = 'studio-2243391254-75492';

async function fetchStoreProfile(storeId: string) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/store_profiles/${storeId}`;
    const res = await fetch(url, { next: { revalidate: 300 } }); // cache 5min
    if (!res.ok) return null;
    const doc = await res.json();
    if (!doc.fields) return null;

    // Parse Firestore REST format into simple object
    const parse = (val: any): any => {
      if (!val) return null;
      if (val.stringValue !== undefined) return val.stringValue;
      if (val.integerValue !== undefined) return Number(val.integerValue);
      if (val.doubleValue !== undefined) return val.doubleValue;
      if (val.booleanValue !== undefined) return val.booleanValue;
      if (val.mapValue) {
        const obj: any = {};
        for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
          obj[k] = parse(v);
        }
        return obj;
      }
      return null;
    };

    const fields: any = {};
    for (const [k, v] of Object.entries(doc.fields)) {
      fields[k] = parse(v);
    }
    return fields;
  } catch {
    return null;
  }
}

async function fetchStoreName(storeId: string) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/roles_admin/${storeId}`;
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const doc = await res.json();
    return doc.fields?.storeName?.stringValue || null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: { storeSlug: string } }): Promise<Metadata> {
  const slug = decodeURIComponent(params.storeSlug);
  const parts = slug.split('-');
  const storeId = parts.pop() || '';

  const defaults: Metadata = {
    title: 'Cardápio Digital',
    description: 'Faça seu pedido online!',
  };

  if (!storeId) return defaults;

  const [profile, roleName] = await Promise.all([
    fetchStoreProfile(storeId),
    fetchStoreName(storeId),
  ]);

  const storeName = profile?.general?.name || roleName || 'Cardápio Digital';
  const description = profile?.general?.description || `Peça online no ${storeName}`;
  const bannerUrl = profile?.general?.bannerDesktopUrl || profile?.general?.bannerMobileUrl || profile?.general?.bannerImageUrl || '';
  const logoUrl = profile?.general?.logoUrl || '';
  const ogImage = bannerUrl || logoUrl || '';

  return {
    title: `${storeName} | Cardápio Digital`,
    description,
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
