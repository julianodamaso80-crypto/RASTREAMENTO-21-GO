import { LoginForm } from '@/components/auth/login-form';

export default function LoginPage() {
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
