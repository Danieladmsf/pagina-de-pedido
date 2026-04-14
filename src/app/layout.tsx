
'use client';

import React, { useEffect } from 'react';
import './globals.css';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { useAuth } from '@/firebase';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';

function AuthInit({ children }: { children: React.ReactNode }) {
  const auth = useAuth();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        signInAnonymously(auth).catch(console.error);
      }
    });
    return () => unsubscribe();
  }, [auth]);

  return <>{children}</>;
}

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
            {children}
          </AuthInit>
        </FirebaseClientProvider>
      </body>
    </html>
  );
}
