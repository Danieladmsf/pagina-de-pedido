// URL pública do site, usada por metadata, robots.txt e sitemap.xml.
// Em produção a Vercel define NEXT_PUBLIC_APP_URL; o fallback é o domínio atual
// para que o build local e as prévias não gerem links quebrados.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_APP_URL || 'https://polarispdv.vercel.app'
).replace(/\/$/, '');

export const SITE_NAME = 'Polaris PDV';
