import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/contexts/auth-context';
import './globals.css';

const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Rastreamento 21 GO',
  description: 'Plataforma de rastreamento veicular',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">
        <AuthProvider>
          <TooltipProvider>
            {children}
          </TooltipProvider>
          <Toaster position="top-right" richColors />
        </AuthProvider>
      </body>
    </html>
  );
}
