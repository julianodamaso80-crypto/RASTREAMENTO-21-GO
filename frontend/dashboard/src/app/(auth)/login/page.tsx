import { LoginForm } from '@/components/auth/login-form';

export default function LoginPage() {
  return (
    <div>
      <div className="mb-8 lg:hidden">
        <div className="inline-flex items-center gap-3">
          <div className="flex items-center justify-center px-3 h-10 rounded-xl bg-[#375191] border border-brand-orange-500/30">
            <span className="text-lg font-extrabold tracking-tight text-slate-50">
              21<span className="text-brand-orange-500">Go!</span>
            </span>
          </div>
          <span className="text-xs font-semibold tracking-[0.15em] text-slate-300 uppercase">Proteção Veicular</span>
        </div>
      </div>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-50">Entrar na plataforma</h1>
        <p className="mt-2 text-sm text-slate-400">
          Acesse o painel de gestão da sua frota.
        </p>
      </div>

      <LoginForm />
    </div>
  );
}
