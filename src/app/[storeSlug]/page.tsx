import React, { Suspense } from 'react';
import { MenuPageClient } from '@/components/MenuPageClient';
import { Loader2 } from 'lucide-react';
import { Metadata, Viewport } from 'next';
import { getTheme } from '@/lib/themes';

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

async function fetchStoreIdFromSlug(shortSlug: string) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents:runQuery`;
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'store_profiles' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'shortSlug' },
            op: 'EQUAL',
            value: { stringValue: shortSlug }
          }
        },
        limit: 1
      }
    };
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      next: { revalidate: 3600 }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data[0] && data[0].document) {
      const docPath = data[0].document.name;
      const parts = docPath.split('/');
      return parts[parts.length - 1];
    }
    return null;
  } catch (err) {
    console.error('Error in fetchStoreIdFromSlug:', err);
    return null;
  }
}

export async function generateMetadata({ params }: { params: { storeSlug: string } }): Promise<Metadata> {
  const slug = decodeURIComponent(params.storeSlug);
  const parts = slug.split('-');
  const rawStoreId = parts.pop() || '';

  const defaults: Metadata = {
    title: 'Cardápio Digital',
    description: 'Faça seu pedido online!',
  };

  if (!rawStoreId) return defaults;

  // Resolve short slug to full storeId
  let storeId = rawStoreId;
  if (rawStoreId.length <= 8) {
    const resolved = await fetchStoreIdFromSlug(rawStoreId);
    if (resolved) storeId = resolved;
  }

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

export async function generateViewport({ params }: { params: { storeSlug: string } }): Promise<Viewport> {
  const defaults: Viewport = { themeColor: '#ffffff' };
  if (!params?.storeSlug) return defaults;

  let storeId = params.storeSlug;
  if (storeId.length <= 8) {
    const resolved = await fetchStoreIdFromSlug(storeId);
    if (resolved) storeId = resolved;
  }

  const profile = await fetchStoreProfile(storeId);
  const themeId = profile?.general?.theme || 'light';
  const theme = getTheme(themeId);

  return {
    themeColor: theme.colors.bg || '#ffffff',
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
