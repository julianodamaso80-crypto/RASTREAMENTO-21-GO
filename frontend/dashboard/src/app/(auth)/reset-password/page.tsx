'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, ArrowLeft, CheckCircle2, KeyRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authApi } from '@/lib/api';
import { toast } from 'sonner';

const schema = z
  .object({
    password: z.string().min(8, { message: 'Senha deve ter ao menos 8 caracteres' }),
    confirm: z.string().min(8, { message: 'Confirme a senha' }),
  })
  .refine((data) => data.password === data.confirm, {
    message: 'As senhas não coincidem',
    path: ['confirm'],
  });

type FormValues = z.infer<typeof schema>;

function ResetPasswordInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = async (values: FormValues) => {
    if (!token) return;
    setSubmitting(true);
    try {
      await authApi.resetPassword(token, values.password);
      setDone(true);
      setTimeout(() => router.push('/login'), 2500);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Token inválido ou expirado');
    } finally {
      setSubmitting(false);
    }
  };

  // Estado 1: sem token na URL (erro)
  if (hydrated && !token) {
    return (
      <div>
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 mb-6">
          <AlertTriangle className="h-6 w-6 text-red-400" />
        </div>
        <h1 className="text-2xl font-bold text-slate-50">Link inválido</h1>
        <p className="mt-2 text-sm text-slate-400">
          Este link de redefinição não é válido ou está incompleto. Solicite um novo pela página
          de recuperação.
        </p>
        <Link
          href="/forgot-password"
          className="mt-6 inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Solicitar novo link
        </Link>
      </div>
    );
  }

  // Estado 2: sucesso
  if (done) {
    return (
      <div>
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 mb-6">
          <CheckCircle2 className="h-6 w-6 text-emerald-400" />
        </div>
        <h1 className="text-2xl font-bold text-slate-50">Senha redefinida!</h1>
        <p className="mt-2 text-sm text-slate-400">
          Sua nova senha está ativa. Você será redirecionado para o login em instantes.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Ir para o login
        </Link>
      </div>
    );
  }

  // Estado 3: form
  return (
    <div>
      <div className="mb-8 lg:hidden">
        <div className="inline-flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <span className="text-lg font-bold text-emerald-400">21</span>
          </div>
          <span className="text-lg font-semibold text-slate-100">Rastreamento 21 GO</span>
        </div>
      </div>

      <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 mb-6">
        <KeyRound className="h-6 w-6 text-emerald-400" />
      </div>

      <h1 className="text-2xl font-bold text-slate-50">Defina sua nova senha</h1>
      <p className="mt-2 text-sm text-slate-400">
        Escolha uma senha com pelo menos 8 caracteres.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5" noValidate>
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium text-slate-200">
            Nova senha
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            autoFocus
            placeholder="••••••••"
            aria-invalid={!!errors.password}
            className="bg-slate-900/50 border-slate-800 focus:border-emerald-500"
            {...register('password')}
          />
          {errors.password && <p className="text-xs text-red-400">{errors.password.message}</p>}
        </div>

        <div className="space-y-2">
          <label htmlFor="confirm" className="text-sm font-medium text-slate-200">
            Confirme a senha
          </label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            aria-invalid={!!errors.confirm}
            className="bg-slate-900/50 border-slate-800 focus:border-emerald-500"
            {...register('confirm')}
          />
          {errors.confirm && <p className="text-xs text-red-400">{errors.confirm.message}</p>}
        </div>

        <Button
          type="submit"
          disabled={submitting}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Redefinindo...
            </>
          ) : (
            'Redefinir senha'
          )}
        </Button>
      </form>

      <Link
        href="/login"
        className="mt-6 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-300 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Cancelar
      </Link>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-400">Carregando...</div>}>
      <ResetPasswordInner />
    </Suspense>
  );
}
