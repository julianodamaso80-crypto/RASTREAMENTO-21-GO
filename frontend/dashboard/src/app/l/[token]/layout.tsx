import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Localização do veículo — 21Go!',
  robots: { index: false, follow: false },
};

/** Página aberta por quem recebeu o link: sem login, sem sidebar, sem guard. */
export default function LocalizacaoLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-background">{children}</div>;
}
