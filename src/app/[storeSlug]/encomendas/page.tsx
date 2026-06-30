import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { fetchStoreProfile, fetchStoreName, resolveStoreIdFromSlugParam } from '@/lib/store-profile-server';
import { buildEncomendaConfig } from '@/lib/encomendas/config';
import { EncomendasClient } from '@/components/encomendas/EncomendasClient';

export async function generateMetadata({ params }: { params: Promise<{ storeSlug: string }> }): Promise<Metadata> {
  const { storeSlug } = await params;
  const storeId = await resolveStoreIdFromSlugParam(storeSlug);
  if (!storeId) return { title: 'Encomendas' };

  const [profile, roleName] = await Promise.all([fetchStoreProfile(storeId), fetchStoreName(storeId)]);
  const storeName = profile?.general?.name || roleName || 'Confeitaria';
  const logoUrl = profile?.general?.logoUrl || '';

  return {
    title: `Encomendas | ${storeName}`,
    description: `Monte sua encomenda de bolos, tortas e docinhos no ${storeName}.`,
    ...(logoUrl ? { icons: { icon: logoUrl, shortcut: logoUrl, apple: logoUrl } } : {}),
  };
}

export default async function EncomendasPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  const { storeSlug } = await params;

  const storeId = await resolveStoreIdFromSlugParam(storeSlug);
  if (!storeId) notFound();

  const profile = await fetchStoreProfile(storeId);
  // A página de encomendas é exclusiva da modalidade confeitaria.
  if (profile?.general?.theme !== 'confeitaria') notFound();

  const config = buildEncomendaConfig(profile);
  return <EncomendasClient config={config} />;
}
