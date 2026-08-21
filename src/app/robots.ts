import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// Sem este arquivo, /robots.txt caía na rota curinga [storeSlug] e devolvia o
// HTML de um cardápio com status 200 — o buscador pedia as regras e recebia uma
// página. As rotas de arquivo do Next (robots.txt/sitemap.xml) têm precedência
// sobre a rota dinâmica, então elas passam a responder texto de verdade.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Telas de trabalho e endpoints: nada aqui serve como resultado de busca.
        disallow: [
          '/login',
          '/register',
          '/pdv',
          '/gestao',
          '/visitantes',
          '/admin',
          '/my-orders',
          '/my-encomendas',
          '/api/',
          '/wapi/',
          '/webhooks/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
