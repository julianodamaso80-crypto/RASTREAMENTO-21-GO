'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@/contexts/auth-context';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <TooltipProvider>
        {children}
      </TooltipProvider>
      <Toaster position="top-right" richColors />
    </AuthProvider>
  );
}
