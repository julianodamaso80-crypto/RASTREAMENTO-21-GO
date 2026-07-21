import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Técnico — 21Go!',
  description: 'App de campo do técnico instalador 21Go!',
};

// Alvo é celular em campo: sem zoom acidental, área útil até as bordas.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0b1b33',
};

/** Área do técnico — fora do dashboard: sem sidebar, sem header, sem guard do painel. */
export default function TecnicoLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto w-full max-w-md px-4 pb-10 pt-6">{children}</div>
    </div>
  );
}
