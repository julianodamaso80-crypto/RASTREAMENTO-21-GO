'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

/** Alterna Claro/Escuro; a escolha fica salva no navegador. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // O tema só é conhecido no cliente; antes disso o botão fica neutro.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  const escuro = montado && resolvedTheme === 'dark';
  const rotulo = escuro ? 'Mudar para o tema claro' : 'Mudar para o tema escuro';

  return (
    <button
      type="button"
      onClick={() => setTheme(escuro ? 'light' : 'dark')}
      aria-label={rotulo}
      title={rotulo}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-100 transition-colors hover:bg-white/10"
    >
      {escuro ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
