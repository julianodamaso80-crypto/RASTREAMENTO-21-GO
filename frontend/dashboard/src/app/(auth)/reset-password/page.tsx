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

function BrandHeader() {
  return (
    <div className="mb-8 lg:hidden">
      <div className="inline-flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl" style={{ background: '#293c82' }}>
          <svg width="22" height="22" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
            <circle cx="32" cy="32" r="22" fill="none" stroke="#f2911d" strokeWidth="8" strokeLinecap="round" strokeDasharray="115 6" transform="rotate(-30 32 32)" />
            <path d="M22 36c0-4.4 3.6-8 8-8s8 3.6 8 8c0 6-8 14-8 14s-8-8-8-14z" fill="#c7d301" />
            <circle cx="30" cy="36" r="3" fill="#ffffff" />
          </svg>
        </div>
        <div>
          <div className="text-lg font-extrabold tracking-tight text-slate-900">
            21<span style={{ color: '#f2911d' }}>Go!</span>
          </div>
          <div className="text-[10px] font-semibold tracking-[0.15em] text-slate-500 uppercase">Proteção Veicular</div>
        </div>
      </div>
    </div>
  );
}

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

  if (hydrated && !token) {
    return (
      <div>
        <BrandHeader />
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-red-50 border border-red-200 mb-6">
          <AlertTriangle className="h-6 w-6 text-red-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Link inválido</h1>
        <p className="mt-2 text-sm text-slate-600">
          Este link de redefinição não é válido ou está incompleto. Solicite um novo pela página
          de recuperação.
        </p>
        <Link
          href="/forgot-password"
          className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-brand-orange-600 hover:text-brand-orange-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Solicitar novo link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div>
        <BrandHeader />
        <div className="flex items-center justify-center w-12 h-12 rounded-xl mb-6" style={{ background: 'rgba(199,211,1,0.15)', border: '1px solid rgba(199,211,1,0.3)' }}>
          <CheckCircle2 className="h-6 w-6" style={{ color: '#9fab01' }} />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Senha redefinida!</h1>
        <p className="mt-2 text-sm text-slate-600">
          Sua nova senha está ativa. Você será redirecionado para o login em instantes.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-brand-orange-600 hover:text-brand-orange-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Ir para o login
        </Link>
      </div>
    );
  }

  return (
    <div>
      <BrandHeader />

      <div className="flex items-center justify-center w-12 h-12 rounded-xl mb-6" style={{ background: 'rgba(242,145,29,0.12)', border: '1px solid rgba(242,145,29,0.3)' }}>
        <KeyRound className="h-6 w-6" style={{ color: '#f2911d' }} />
      </div>

      <h1 className="text-2xl font-bold text-slate-900">Defina sua nova senha</h1>
      <p className="mt-2 text-sm text-slate-600">
        Escolha uma senha com pelo menos 8 caracteres.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5" noValidate>
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium text-slate-700">
            Nova senha
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            autoFocus
            placeholder="••••••••"
            aria-invalid={!!errors.password}
            className="bg-white border-slate-300 focus:border-brand-orange-500 text-slate-900"
            {...register('password')}
          />
          {errors.password && <p className="text-xs text-red-600">{errors.password.message}</p>}
        </div>

        <div className="space-y-2">
          <label htmlFor="confirm" className="text-sm font-medium text-slate-700">
            Confirme a senha
          </label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            aria-invalid={!!errors.confirm}
            className="bg-white border-slate-300 focus:border-brand-orange-500 text-slate-900"
            {...register('confirm')}
          />
          {errors.confirm && <p className="text-xs text-red-600">{errors.confirm.message}</p>}
        </div>

        <Button
          type="submit"
          disabled={submitting}
          className="w-full bg-brand-orange-500 hover:bg-brand-orange-600 text-white font-semibold"
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
        className="mt-6 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Cancelar
      </Link>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-500">Carregando...</div>}>
      <ResetPasswordInner />
    </Suspense>
  );
}
