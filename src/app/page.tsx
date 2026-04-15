
import React, { Suspense } from 'react';
import { MenuPageClient } from '@/components/MenuPageClient';
import { Loader2 } from 'lucide-react';

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF7]">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    }>
      <MenuPageClient />
    </Suspense>
  );
}
