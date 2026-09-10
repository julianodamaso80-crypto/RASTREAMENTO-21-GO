'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Loader2, MessageCircle, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authApi } from '@/lib/api';
import { toast } from 'sonner';

const whatsappSchema = z.object({
  phone: z
    .string()
    .refine((v) => v.replace(/\D/g, '').length >= 10, {
      message: 'Informe o WhatsApp com DDD',
    }),
});

const codigoSchema = z.object({
  code: z.string().regex(/^\d{6}$/, { message: 'O código tem 6 números' }),
  newPassword: z
    .string()
    .min(6, { message: 'A nova senha precisa ter ao menos 6 caracteres' }),
});

type WhatsappValues = z.infer<typeof whatsappSchema>;
type CodigoValues = z.infer<typeof codigoSchema>;

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

/**
 * Recuperação de senha em duas etapas: informa o WhatsApp cadastrado, recebe
 * nele um código de 6 dígitos e escolhe ali mesmo a senha nova.
 *
 * O código nunca é a senha, e não vai link nenhum na mensagem — link em
 * WhatsApp é o formato do golpe, e a plataforma não treina o usuário a clicar.
 */
export default function ForgotPasswordPage() {
  const router = useRouter();
  const [etapa, setEtapa] = useState<'whatsapp' | 'codigo'>('whatsapp');
  const [whatsapp, setWhatsapp] = useState('');
  const [enviadoPara, setEnviadoPara] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const formWhatsapp = useForm<WhatsappValues>({
    resolver: zodResolver(whatsappSchema),
    defaultValues: { phone: '' },
  });

  const formCodigo = useForm<CodigoValues>({
    resolver: zodResolver(codigoSchema),
    defaultValues: { code: '', newPassword: '' },
  });

  const pedirCodigo = async (values: WhatsappValues) => {
    setSubmitting(true);
    try {
      const res = await authApi.forgotPasswordWhatsapp(values.phone);
      setWhatsapp(values.phone);
      setEnviadoPara(res.sentTo);
      toast.success(res.message);
      setEtapa('codigo');
    } catch (err: unknown) {
      const e = err as { response?: { status?: number } };
      if (e.response?.status === 429) {
        toast.error('Muitas tentativas. Tente novamente mais tarde.');
      } else {
        // Erro genérico segue pra etapa do código: revelar falha aqui entregaria
        // quais números estão cadastrados.
        setWhatsapp(values.phone);
        setEtapa('codigo');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const salvarSenha = async (values: CodigoValues) => {
    setSubmitting(true);
    try {
      await authApi.resetPasswordWhatsapp(whatsapp, values.code, values.newPassword);
      toast.success('Senha alterada. Entre com a senha nova.');
      router.push('/login');
    } catch {
      toast.error('Código inválido ou expirado. Peça um novo código.');
    } finally {
      setSubmitting(false);
    }
  };

  if (etapa === 'codigo') {
    return (
      <div>
        <BrandHeader />

        <div className="flex items-center justify-center w-12 h-12 rounded-xl mb-6" style={{ background: 'rgba(199,211,1,0.15)', border: '1px solid rgba(199,211,1,0.3)' }}>
          <ShieldCheck className="h-6 w-6" style={{ color: '#9fab01' }} />
        </div>

        <h1 className="text-2xl font-bold text-slate-900">Digite o código</h1>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">
          Enviamos um código de 6 números para o WhatsApp{' '}
          <span className="text-slate-900 font-medium">{enviadoPara ?? 'cadastrado'}</span>.
          Ele vale 15 minutos.
        </p>

        <form onSubmit={formCodigo.handleSubmit(salvarSenha)} className="mt-8 space-y-5" noValidate>
          <div className="space-y-2">
            <label htmlFor="code" className="text-sm font-medium text-slate-700">
              Código
            </label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              placeholder="000000"
              aria-invalid={!!formCodigo.formState.errors.code}
              className="bg-white border-slate-300 focus:border-brand-orange-500 text-slate-900 text-center text-2xl tracking-[0.4em]"
              {...formCodigo.register('code')}
            />
            {formCodigo.formState.errors.code && (
              <p className="text-xs text-red-600">{formCodigo.formState.errors.code.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="newPassword" className="text-sm font-medium text-slate-700">
              Nova senha
            </label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              placeholder="Mínimo de 6 caracteres"
              aria-invalid={!!formCodigo.formState.errors.newPassword}
              className="bg-white border-slate-300 focus:border-brand-orange-500 text-slate-900"
              {...formCodigo.register('newPassword')}
            />
            {formCodigo.formState.errors.newPassword && (
              <p className="text-xs text-red-600">
                {formCodigo.formState.errors.newPassword.message}
              </p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar nova senha
          </Button>
        </form>

        <button
          type="button"
          onClick={() => setEtapa('whatsapp')}
          className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-brand-orange-600 hover:text-brand-orange-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Usar outro número
        </button>
      </div>
    );
  }

  return (
    <div>
      <BrandHeader />

      <div className="flex items-center justify-center w-12 h-12 rounded-xl mb-6" style={{ background: 'rgba(242,145,29,0.12)', border: '1px solid rgba(242,145,29,0.3)' }}>
        <MessageCircle className="h-6 w-6" style={{ color: '#f2911d' }} />
      </div>

      <h1 className="text-2xl font-bold text-slate-900">Esqueceu sua senha?</h1>
      <p className="mt-2 text-sm text-slate-600">
        Digite o seu WhatsApp cadastrado e enviaremos um código nele.
      </p>

      <form onSubmit={formWhatsapp.handleSubmit(pedirCodigo)} className="mt-8 space-y-5" noValidate>
        <div className="space-y-2">
          <label htmlFor="phone" className="text-sm font-medium text-slate-700">
            WhatsApp com DDD
          </label>
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            autoFocus
            placeholder="(21) 99999-8888"
            aria-invalid={!!formWhatsapp.formState.errors.phone}
            className="bg-white border-slate-300 focus:border-brand-orange-500 text-slate-900"
            {...formWhatsapp.register('phone')}
          />
          {formWhatsapp.formState.errors.phone && (
            <p className="text-xs text-red-600">{formWhatsapp.formState.errors.phone.message}</p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Enviar código
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
