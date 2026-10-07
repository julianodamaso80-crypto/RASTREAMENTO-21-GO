'use client';

import type { ReactNode } from 'react';
import { ThemeProvider } from 'next-themes';
import { AuthProvider } from '@/contexts/auth-context';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      storageKey="21go-tema"
      disableTransitionOnChange
    >
      <AuthProvider>
      <TooltipProvider>
        {children}
      </TooltipProvider>
      <Toaster position="top-right" richColors />
      </AuthProvider>
    </ThemeProvider>
  );
}
