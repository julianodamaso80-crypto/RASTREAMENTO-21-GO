'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Sem este arquivo, qualquer erro de tela caía na página padrão do Next
// ("This page couldn't load") e ninguém sabia o que tinha quebrado. A mensagem
// fica visível de propósito: o print que a equipe manda já traz a causa.
export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const pathname = usePathname();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="max-w-md w-full text-center space-y-4">
        <AlertTriangle className="h-10 w-10 mx-auto text-orange-500" />
        <h1 className="text-xl font-semibold">Esta tela encontrou um erro</h1>
        <p className="text-sm text-muted-foreground">
          Tente de novo. Se continuar, mande um print desta tela para o suporte.
        </p>
        <div className="flex gap-2 justify-center">
          <Button onClick={() => unstable_retry()}>Tentar de novo</Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Recarregar página
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground break-words font-mono">
          {pathname} · {error.message || 'sem mensagem'}
          {error.digest ? ` · ${error.digest}` : ''}
        </p>
      </div>
    </div>
  );
}
