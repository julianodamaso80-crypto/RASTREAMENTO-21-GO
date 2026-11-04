import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

// Fonte oficial da marca é DIN Next LT Pro. Inter é a alternativa
// autorizada pelo manual quando DIN não está disponível (web/digital).
const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: '21Go! Proteção Patrimonial',
  description: 'Plataforma de rastreamento e proteção patrimonial 21Go!',
};

// Celular e app (WebView) não dão zoom na página: pinça e o zoom automático
// do iPhone ao tocar num campo bagunçavam a tela. O mapa continua com zoom —
// o MapLibre trata o gesto por conta própria, não depende do navegador.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
