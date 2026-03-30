import { LoginForm } from '@/components/auth/login-form';

export default function LoginPage() {
  return (
    <div className="glass rounded-2xl p-8 w-full max-w-md mx-4 shadow-2xl">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-emerald-500/10 border border-emerald-500/20 mb-4">
          <span className="text-2xl font-bold text-emerald-400">21</span>
        </div>
        <h1 className="text-2xl font-bold text-foreground">
          21 GO Rastreamento
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Plataforma de rastreamento veicular
        </p>
      </div>
      <LoginForm />
    </div>
  );
}
