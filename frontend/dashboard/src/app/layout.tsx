import type { Metadata } from 'next';
import { Barlow } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

const barlow = Barlow({
  variable: '--font-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: '21Go! Proteção Veicular',
  description: 'Plataforma de rastreamento e proteção veicular 21Go!',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`${barlow.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
