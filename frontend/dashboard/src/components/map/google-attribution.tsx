'use client';

/**
 * Atribuição obrigatória da Map Tiles API do Google (política oficial):
 * logo do Google visível, sem outro logo sobreposto, mais a string de
 * copyright do viewport atual.
 *
 * Fica acima do AttributionControl do MapLibre pra não encostar em outro
 * logo — a política pede distância razoável entre eles.
 */
export function GoogleMapsAttribution({ copyright }: { copyright: string }) {
  return (
    <div className="pointer-events-none absolute bottom-8 left-2 z-10 flex items-center gap-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/google/google_on_non_white.png"
        alt="Google"
        // A política fixa a altura do logo entre 16dp e 19dp.
        className="h-[17px] w-auto drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
      />
      {copyright ? (
        <span className="text-[10px] leading-none text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
          {copyright}
        </span>
      ) : null}
    </div>
  );
}
