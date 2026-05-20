import { LoginForm } from '@/components/auth/login-form';

export default function LoginPage() {
  return (
    <div>
      {/* Logo só aparece em mobile (hero some) */}
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

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Entrar na plataforma</h1>
        <p className="mt-2 text-sm text-slate-500">
          Acesse o painel de gestão da sua frota.
        </p>
      </div>

      <LoginForm />
    </div>
  );
}
