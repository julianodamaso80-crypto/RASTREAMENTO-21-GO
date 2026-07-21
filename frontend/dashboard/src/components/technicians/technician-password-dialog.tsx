'use client';

import { useState } from 'react';
import { Copy, Check, KeyRound, MessageCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import type { TechnicianWithPassword } from '@/types/technician';

type Props = {
  data: TechnicianWithPassword | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function formatCpf(cpf: string): string {
  const d = (cpf || '').replace(/\D/g, '');
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/**
 * Mostra a senha provisória do técnico. Aparece uma única vez — o backend só
 * guarda o hash. O botão de WhatsApp entrega o acesso sem digitar nada.
 */
export function TechnicianPasswordDialog({ data, open, onOpenChange }: Props) {
  const [copied, setCopied] = useState<'senha' | 'mensagem' | null>(null);

  if (!data) return null;

  const cpf = formatCpf(data.technician.cpf);
  const url =
    typeof window !== 'undefined' ? `${window.location.origin}/tecnico` : '/tecnico';

  const mensagem = [
    `Olá ${data.technician.name}! Seu acesso ao 21 GO:`,
    url,
    `CPF: ${cpf}`,
    `Senha: ${data.tempPassword}`,
    'Troque a senha no primeiro acesso.',
  ].join('\n');

  const copy = async (texto: string, tipo: 'senha' | 'mensagem') => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopied(tipo);
      setTimeout(() => setCopied(null), 2000);
      toast.success(
        tipo === 'senha' ? 'Senha copiada' : 'Mensagem copiada — cole no WhatsApp do técnico',
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
            Acesso de {data.technician.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                CPF (usuário)
              </p>
              <p className="font-mono text-lg font-semibold">{cpf}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Senha provisória
              </p>
              <p className="font-mono text-2xl font-bold tracking-[0.2em]">
                {data.tempPassword}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-200">
              Esta senha aparece só agora. Se perder, gere outra em{' '}
              <strong>Resetar senha</strong>.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => copy(data.tempPassword, 'senha')}>
              {copied === 'senha' ? (
                <Check className="h-4 w-4 mr-1" />
              ) : (
                <Copy className="h-4 w-4 mr-1" />
              )}
              Copiar senha
            </Button>
            <Button onClick={() => copy(mensagem, 'mensagem')}>
              {copied === 'mensagem' ? (
                <Check className="h-4 w-4 mr-1" />
              ) : (
                <MessageCircle className="h-4 w-4 mr-1" />
              )}
              Copiar p/ WhatsApp
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
