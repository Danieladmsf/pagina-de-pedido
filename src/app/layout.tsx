import React from 'react';
import './globals.css';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { AuthInit } from '@/components/providers/AuthInit';
import { CartProvider } from '@/components/providers/CartProvider';
import { PWARegister } from '@/components/providers/PWARegister';
import { Toaster } from '@/components/ui/toaster';
import { SITE_URL } from '@/lib/site';


export const metadata = {
  // Base para as URLs relativas de metadata (canonical, og:image). Sem ela o
  // Next avisa no build e o og:image sai como caminho relativo, que rede social
  // e buscador não conseguem baixar.
  metadataBase: new URL(SITE_URL),
  title: 'Cardápio Digital',
  description: 'Cardápio digital e gestão de pedidos',
  manifest: '/manifest.json',
  // Prova de posse do site para o Google Search Console. Fica no layout raiz
  // porque a verificação lê a página inicial. Não remover: tirar a marca faz o
  // Google desverificar a propriedade e o relatório de busca some.
  verification: {
    google: 'SND8-Ve5zy5REYoCY2W6xA3Xp6AoClj8cJJzfdO2lIA',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Cardápio Digital',
  },
};

export const viewport = {
  themeColor: '#ffffff',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased bg-[#FAFAF7]">
        <FirebaseClientProvider>
          <AuthInit>
            <CartProvider>
              {children}
            </CartProvider>
          </AuthInit>
        </FirebaseClientProvider>
        <PWARegister />
        <Toaster />
      </body>
    </html>
  );
}
