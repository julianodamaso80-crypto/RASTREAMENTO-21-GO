import type { ReactNode } from 'react';
import { Activity, MapPin, Shield, Zap } from 'lucide-react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white">
      {/* Form panel (esquerda) — fundo claro */}
      <div className="flex items-center justify-center px-4 py-8 lg:px-12 bg-white">
        <div className="w-full max-w-md">{children}</div>
      </div>

      {/* Hero panel (direita) — Azul Institucional do manual (#293c82) */}
      <div className="hidden lg:flex relative flex-col justify-between p-12 overflow-hidden text-white"
           style={{ background: 'linear-gradient(135deg, #293c82 0%, #1f2d63 60%, #1f2d63 100%)' }}>
        {/* Grid decorativo sutil */}
        <div
          className="absolute inset-0 opacity-15"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.18) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            maskImage: 'radial-gradient(circle at center, black 30%, transparent 70%)',
          }}
        />
        {/* Glow laranja brand */}
        <div
          className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full opacity-25"
          style={{
            background: 'radial-gradient(circle, rgba(242,145,29,0.6) 0%, transparent 70%)',
          }}
        />
        {/* Glow verde brand */}
        <div
          className="absolute top-0 left-1/3 w-[300px] h-[300px] rounded-full opacity-15"
          style={{
            background: 'radial-gradient(circle, rgba(199,211,1,0.5) 0%, transparent 70%)',
          }}
        />

        {/* Header com logo */}
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/10 backdrop-blur-sm border border-white/15">
              <BrandIcon />
            </div>
            <div>
              <div className="text-lg font-extrabold tracking-tight">
                21<span style={{ color: '#f2911d' }}>Go!</span>
              </div>
              <div className="text-[10px] font-semibold tracking-[0.15em] text-white/70 uppercase">Proteção Veicular</div>
            </div>
          </div>
        </div>

        {/* Corpo */}
        <div className="relative space-y-8">
          <div>
            <h2 className="text-4xl font-bold leading-tight">
              Sua frota sob controle,
              <br />
              <span style={{ color: '#f2911d' }}>em tempo real.</span>
            </h2>
            <p className="mt-4 text-white/75 text-base leading-relaxed max-w-md">
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
              desc="Dashboard com métricas em tempo real e alertas por tipo."
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
          <p className="text-xs text-white/60">© {new Date().getFullYear()} 21Go! Proteção Veicular · trackgo.site</p>
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
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  title: string;
  desc: string;
}) {
  return (
    <li className="flex gap-3">
      <div className="flex items-center justify-center w-10 h-10 shrink-0 rounded-lg" style={{ background: 'rgba(242,145,29,0.15)', border: '1px solid rgba(242,145,29,0.3)' }}>
        <Icon className="h-5 w-5" style={{ color: '#f2911d' }} />
      </div>
      <div>
        <p className="font-semibold text-white text-sm">{title}</p>
        <p className="text-xs text-white/70 leading-relaxed">{desc}</p>
      </div>
    </li>
  );
}

function BrandIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <circle cx="32" cy="32" r="22" fill="none" stroke="#f2911d" strokeWidth="8" strokeLinecap="round" strokeDasharray="115 6" transform="rotate(-30 32 32)" />
      <path d="M22 36c0-4.4 3.6-8 8-8s8 3.6 8 8c0 6-8 14-8 14s-8-8-8-14z" fill="#c7d301" />
      <circle cx="30" cy="36" r="3" fill="#ffffff" />
    </svg>
  );
}
