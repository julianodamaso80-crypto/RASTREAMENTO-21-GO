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
        <BrandHeader />

        <div className="flex items-center justify-center w-12 h-12 rounded-xl mb-6" style={{ background: 'rgba(199,211,1,0.15)', border: '1px solid rgba(199,211,1,0.3)' }}>
          <CheckCircle2 className="h-6 w-6" style={{ color: '#9fab01' }} />
        </div>

        <h1 className="text-2xl font-bold text-slate-900">Verifique seu email</h1>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">
          Se <span className="text-slate-900 font-medium">{lastEmail}</span> estiver cadastrado,
          você receberá um link de redefinição em instantes. O link expira em 60 minutos e só
          pode ser usado uma vez.
        </p>

        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs text-slate-600">
            Não recebeu? Verifique a caixa de spam ou aguarde alguns minutos antes de tentar
            novamente. Você pode solicitar até 3 emails por hora.
          </p>
        </div>

        <Link
          href="/login"
          className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-brand-orange-600 hover:text-brand-orange-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <div>
      <BrandHeader />

      <div className="flex items-center justify-center w-12 h-12 rounded-xl mb-6" style={{ background: 'rgba(242,145,29,0.12)', border: '1px solid rgba(242,145,29,0.3)' }}>
        <Mail className="h-6 w-6" style={{ color: '#f2911d' }} />
      </div>

      <h1 className="text-2xl font-bold text-slate-900">Esqueceu sua senha?</h1>
      <p className="mt-2 text-sm text-slate-600">
        Informe seu email e enviaremos um link para redefinir sua senha.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5" noValidate>
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium text-slate-700">
            Email
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="seu@email.com"
            aria-invalid={!!errors.email}
            className="bg-white border-slate-300 focus:border-brand-orange-500 text-slate-900"
            {...register('email')}
          />
          {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
        </div>

        <Button
          type="submit"
          disabled={submitting}
          className="w-full bg-brand-orange-500 hover:bg-brand-orange-600 text-white font-semibold"
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
        className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-brand-orange-600 hover:text-brand-orange-700 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para o login
      </Link>
    </div>
  );
}
