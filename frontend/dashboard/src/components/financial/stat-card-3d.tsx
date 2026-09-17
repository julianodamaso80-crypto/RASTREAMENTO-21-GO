'use client';

import type { LucideIcon } from 'lucide-react';

/** Cartão com profundidade: sombra em camadas, borda de luz e inclinação no hover. */
export function StatCard3D({
  label,
  value,
  hint,
  icon: Icon,
  from,
  to,
  edge,
  active,
  onClick,
}: {
  label: string;
  value: number;
  hint: string;
  icon: LucideIcon;
  from: string;
  to: string;
  edge: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className="[perspective:900px]">
      <button
        type="button"
        onClick={onClick}
        className="group relative w-full overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-slate-800/90 to-slate-900 p-4 text-left transition-transform duration-300 ease-out [transform-style:preserve-3d] hover:[transform:rotateX(6deg)_rotateY(-6deg)_translateY(-4px)]"
        style={{
          boxShadow: active
            ? `0 0 0 2px ${to}, 0 1px 0 rgba(255,255,255,.08) inset, 0 10px 0 -4px ${edge}, 0 22px 40px -12px ${edge}`
            : `0 1px 0 rgba(255,255,255,.08) inset, 0 8px 0 -4px rgba(2,6,23,.9), 0 20px 36px -14px rgba(0,0,0,.8)`,
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-25 blur-2xl transition-opacity duration-300 group-hover:opacity-50"
          style={{ background: to }}
        />
        <div className="relative flex items-center gap-3 [transform:translateZ(30px)]">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{
              background: `linear-gradient(145deg, ${from}, ${to})`,
              boxShadow: `inset 0 1px 0 rgba(255,255,255,.5), 0 4px 0 ${edge}, 0 8px 16px -6px ${edge}`,
            }}
          >
            <Icon className="h-5 w-5 text-white drop-shadow" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {label}
            </p>
            <p className="text-3xl font-black leading-tight text-white [text-shadow:0_2px_0_rgba(0,0,0,.45)]">
              {value.toLocaleString('pt-BR')}
            </p>
            <p className="truncate text-[11px] text-slate-500">{hint}</p>
          </div>
        </div>
      </button>
    </div>
  );
}
