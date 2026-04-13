import type { ReactNode } from 'react';
import { Activity, MapPin, Shield, Zap } from 'lucide-react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-slate-950">
      {/* Form panel (esquerda) */}
      <div className="flex items-center justify-center px-4 py-8 lg:px-12 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <div className="w-full max-w-md">{children}</div>
      </div>

      {/* Hero panel (direita) — hidden em mobile */}
      <div className="hidden lg:flex relative flex-col justify-between p-12 bg-gradient-to-br from-[#375191]/40 via-slate-900 to-slate-950 overflow-hidden">
        {/* Grid decorativo */}
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'linear-gradient(rgba(91,122,196,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(91,122,196,0.18) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            maskImage: 'radial-gradient(circle at center, black 30%, transparent 70%)',
          }}
        />
        {/* Glow azul brand */}
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-30"
          style={{
            background: 'radial-gradient(circle, rgba(55,81,145,0.55) 0%, transparent 70%)',
          }}
        />
        {/* Glow laranja secundário */}
        <div
          className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full opacity-20"
          style={{
            background: 'radial-gradient(circle, rgba(247,150,61,0.5) 0%, transparent 70%)',
          }}
        />

        {/* Header */}
        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center justify-center px-3 h-10 rounded-xl bg-[#375191] border border-brand-orange-500/30">
              <span className="text-lg font-extrabold tracking-tight text-slate-50">
                21<span className="text-brand-orange-500">Go!</span>
              </span>
            </div>
            <span className="text-xs font-semibold tracking-[0.15em] text-slate-300 uppercase">Proteção Veicular</span>
          </div>
        </div>

        {/* Corpo — headline + features */}
        <div className="relative space-y-8">
          <div>
            <h2 className="text-4xl font-bold text-slate-50 leading-tight">
              Sua frota sob controle,
              <br />
              <span className="text-brand-orange-500">em tempo real.</span>
            </h2>
            <p className="mt-4 text-slate-400 text-base leading-relaxed max-w-md">
              Plataforma completa de gestão e rastreamento veicular com integração Traccar,
              alertas inteligentes e comandos remotos.
            </p>
          </div>

          <ul className="space-y-4 max-w-md">
            <FeatureItem
              icon={MapPin}
              title="Mapa ao vivo"
              desc="Posição atualizada via WebSocket, histórico completo e geofencing."
            />
            <FeatureItem
              icon={Activity}
              title="KPIs e alertas"
              desc="Dashboard com 8 métricas em tempo real e alertas por tipo."
            />
            <FeatureItem
              icon={Shield}
              title="Multi-tenant seguro"
              desc="Isolamento por tenant, JWT com rotação de secret, rate limit em endpoints críticos."
            />
            <FeatureItem
              icon={Zap}
              title="Comandos remotos"
              desc="Bloqueio, desbloqueio e configuração SMS de rastreadores GT06, Suntech, Teltonika."
            />
          </ul>
        </div>

        {/* Footer */}
        <div className="relative">
          <p className="text-xs text-slate-500">© {new Date().getFullYear()} 21Go! Proteção Veicular · trackgo.site</p>
        </div>
      </div>
    </div>
  );
}

function FeatureItem({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <li className="flex gap-3">
      <div className="flex items-center justify-center w-10 h-10 shrink-0 rounded-lg bg-brand-orange-500/10 border border-brand-orange-500/20">
        <Icon className="h-5 w-5 text-brand-orange-500" />
      </div>
      <div>
        <p className="font-semibold text-slate-100 text-sm">{title}</p>
        <p className="text-xs text-slate-400 leading-relaxed">{desc}</p>
      </div>
    </li>
  );
}
