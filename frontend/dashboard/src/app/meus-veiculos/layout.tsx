import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Meus veículos — 21Go!',
};

/** Área do associado — fora do dashboard: sem sidebar e sem o guard do painel. */
export default function MeusVeiculosLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-background">{children}</div>;
}
