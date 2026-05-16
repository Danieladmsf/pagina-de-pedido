import React from 'react';
import './globals.css';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { AuthInit } from '@/components/providers/AuthInit';
import { CartProvider } from '@/components/providers/CartProvider';
import { PWARegister } from '@/components/providers/PWARegister';
import { Toaster } from '@/components/ui/toaster';


export const metadata = {
  title: 'Cardápio Digital',
  description: 'Cardápio digital e gestão de pedidos',
  manifest: '/manifest.json',
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
