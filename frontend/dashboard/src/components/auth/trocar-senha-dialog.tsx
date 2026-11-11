'use client';

import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Senha provisória (criada ou trocada pelo administrador): ocupa a tela até a
 * pessoa criar a própria senha. Mesmo visual do cadastro obrigatório do
 * WhatsApp.
 */
export function TrocarSenhaDialog({
  nome,
  trocar,
  onTrocada,
  onSair,
}: {
  nome?: string;
  trocar: (novaSenha: string) => Promise<void>;
  onTrocada: () => void;
  onSair?: () => void;
}) {
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [loading, setLoading] = useState(false);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (senha.length < 6) {
      toast.error('A senha precisa ter ao menos 6 caracteres.');
      return;
    }
    if (senha !== confirmacao) {
      toast.error('As duas senhas não são iguais.');
      return;
    }
    setLoading(true);
    try {
      await trocar(senha);
      toast.success('Senha criada. Use ela nos próximos acessos.');
      onTrocada();
    } catch (err) {
      const mensagem =
        (err as { response?: { data?: { message?: string } } }).response?.data
          ?.message ?? 'Não consegui salvar a senha. Tente de novo.';
      toast.error(mensagem);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50">
          <KeyRound className="h-6 w-6 text-orange-500" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">
          {nome ? `${nome}, crie a sua senha` : 'Crie a sua senha'}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Você entrou com uma senha provisória. Escolha uma senha nova para
          continuar.
        </p>
        <form onSubmit={salvar} className="mt-5 space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="nova-senha">Senha nova</Label>
            <Input
              id="nova-senha"
              type="password"
              autoComplete="new-password"
              autoFocus
              placeholder="Mínimo de 6 caracteres"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirma-senha">Repita a senha nova</Label>
            <Input
              id="confirma-senha"
              type="password"
              autoComplete="new-password"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar senha
          </Button>
        </form>
        {onSair && (
          <button
            type="button"
            onClick={onSair}
            className="mt-4 w-full text-center text-sm text-slate-500 hover:text-slate-700"
          >
            Sair
          </button>
        )}
      </div>
    </div>
  );
}
