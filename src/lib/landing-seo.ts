import type { Metadata } from 'next';
import { SITE_URL, SITE_NAME } from './site';

// Metadata da vitrine. A mesma tela responde em duas URLs (a raiz e /polaris),
// então o canônico é sempre a raiz: assim o Google trata as duas como uma só
// página em vez de conteúdo repetido.
export function metadataDaLanding(canonical: string): Metadata {
  return {
    metadataBase: new URL(SITE_URL),
    title: 'Polaris PDV — Sistema de cardápio digital, delivery e PDV para restaurantes',
    description:
      'Polaris PDV reúne cardápio digital com link próprio, delivery com taxa por raio, mesas e comandas, caixa, dashboard e impressão de cupom térmico em uma só plataforma. Funciona em qualquer aparelho com navegador.',
    keywords: [
      'polaris pdv',
      'cardápio digital',
      'sistema para restaurante',
      'pdv para lanchonete',
      'sistema de delivery',
      'comanda digital',
      'controle de caixa restaurante',
      'cardápio online com link',
    ],
    applicationName: SITE_NAME,
    authors: [{ name: SITE_NAME }],
    alternates: {
      canonical,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    openGraph: {
      type: 'website',
      url: SITE_URL,
      siteName: SITE_NAME,
      locale: 'pt_BR',
      title: 'Polaris PDV — o sistema que guia seu restaurante',
      description:
        'Cardápio digital, delivery, mesas, caixa e dashboard em uma única plataforma. Crie sua conta e configure a loja em minutos.',
      images: [{ url: '/icon-512.png', width: 512, height: 512, alt: 'Polaris PDV' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Polaris PDV — o sistema que guia seu restaurante',
      description: 'Cardápio digital, delivery, mesas, caixa e dashboard em uma única plataforma.',
      images: ['/icon-512.png'],
    },
  };
}
