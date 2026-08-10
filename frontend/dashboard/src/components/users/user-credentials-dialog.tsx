'use client';

import { useState } from 'react';
import { Copy, Check, KeyRound, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import type { UserWithPassword } from '@/types/user';

type Props = {
  data: UserWithPassword | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Cartão de credenciais. A senha aparece uma única vez — o banco só guarda o
 * hash. O botão copia o texto pronto pra mandar pra pessoa.
 */
export function UserCredentialsDialog({ data, open, onOpenChange }: Props) {
  const [copied, setCopied] = useState<'senha' | 'acesso' | null>(null);

  if (!data) return null;

  const url =
    typeof window !== 'undefined' ? window.location.origin : 'https://trackgo.site';

  const texto = [
    'Acesso ao painel 21Go Rastreamento',
    `Link: ${url}`,
    `Login: ${data.user.email}`,
    `Senha: ${data.password}`,
  ].join('\n');

  const copy = async (conteudo: string, tipo: 'senha' | 'acesso') => {
    try {
      await navigator.clipboard.writeText(conteudo);
      setCopied(tipo);
      setTimeout(() => setCopied(null), 2000);
      toast.success(
        tipo === 'senha' ? 'Senha copiada' : 'Acesso copiado — é só colar e enviar',
      );
    } catch {
      toast.error('Não consegui copiar. Selecione o texto manualmente.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-brand-orange-500" />
            Acesso de {data.user.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Endereço
              </p>
              <p className="font-mono text-sm font-semibold break-all">{url}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Login
              </p>
              <p className="font-mono text-sm font-semibold break-all">
                {data.user.email}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Senha
              </p>
              <p className="font-mono text-xl font-bold tracking-[0.12em]">
                {data.password}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-200">
              Esta senha aparece só agora. Se perder, use{' '}
              <strong>Gerar nova senha</strong> na lista de usuários.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => copy(data.password, 'senha')}>
              {copied === 'senha' ? (
                <Check className="h-4 w-4 mr-1" />
              ) : (
                <Copy className="h-4 w-4 mr-1" />
              )}
              Copiar senha
            </Button>
            <Button onClick={() => copy(texto, 'acesso')}>
              {copied === 'acesso' ? (
                <Check className="h-4 w-4 mr-1" />
              ) : (
                <Copy className="h-4 w-4 mr-1" />
              )}
              Copiar acesso
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
