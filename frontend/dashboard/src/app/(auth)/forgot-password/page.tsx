'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, CheckCircle2, Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authApi } from '@/lib/api';
import { toast } from 'sonner';

const schema = z.object({
  email: z.string().email({ message: 'Email inválido' }),
});

type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [lastEmail, setLastEmail] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      await authApi.forgotPassword(values.email);
      setLastEmail(values.email);
      setSent(true);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number } };
      if (e.response?.status === 429) {
        toast.error('Muitas tentativas. Tente novamente em 1 hora.');
      } else {
        // Em caso de erro genérico, ainda mostra sucesso pra não revelar enumeração
        setLastEmail(values.email);
        setSent(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
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
          <CheckCircle2 className="h-6 w-6 text-emerald-400" />
        </div>

        <h1 className="text-2xl font-bold text-slate-50">Verifique seu email</h1>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
          Se <span className="text-slate-200 font-medium">{lastEmail}</span> estiver cadastrado,
          você receberá um link de redefinição em instantes. O link expira em 60 minutos e só
          pode ser usado uma vez.
        </p>

        <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <p className="text-xs text-slate-400">
            Não recebeu? Verifique a caixa de spam ou aguarde alguns minutos antes de tentar
            novamente. Você pode solicitar até 3 emails por hora.
          </p>
        </div>

        <Link
          href="/login"
          className="mt-6 inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para o login
        </Link>
      </div>
    );
  }

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
        <Mail className="h-6 w-6 text-emerald-400" />
      </div>

      <h1 className="text-2xl font-bold text-slate-50">Esqueceu sua senha?</h1>
      <p className="mt-2 text-sm text-slate-400">
        Informe seu email e enviaremos um link para redefinir sua senha.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5" noValidate>
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium text-slate-200">
            Email
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="seu@email.com"
            aria-invalid={!!errors.email}
            className="bg-slate-900/50 border-slate-800 focus:border-emerald-500"
            {...register('email')}
          />
          {errors.email && <p className="text-xs text-red-400">{errors.email.message}</p>}
        </div>

        <Button
          type="submit"
          disabled={submitting}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Enviando...
            </>
          ) : (
            'Enviar link de redefinição'
          )}
        </Button>
      </form>

      <Link
        href="/login"
        className="mt-6 inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para o login
      </Link>
    </div>
  );
}
