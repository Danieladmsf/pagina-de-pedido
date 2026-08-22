import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// Lista as páginas públicas do produto. Os cardápios das lojas ficam de fora de
// propósito: cada loja divulga o próprio link e a decisão de aparecer no Google
// é do dono dela, não da plataforma.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];
}
