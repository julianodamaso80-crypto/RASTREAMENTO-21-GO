import { BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  corBateria,
  dicaBateria,
  rotuloBateria,
  textoStatusCru,
  type NivelBateria,
} from '@/lib/bateria-tag';

const ICONES: Record<NivelBateria, LucideIcon> = {
  CHEIA: BatteryFull,
  MEDIA: BatteryMedium,
  BAIXA: BatteryLow,
  CRITICA: BatteryWarning,
};

/**
 * Bateria da TAG: ícone + rótulo, na cor do nível. Desconhecida mostra
 * "—" com a explicação no tooltip. `statusByte` só deve ser passado para a
 * equipe (calibração); o cliente final recebe apenas o nível.
 */
export function BateriaTag({
  nivel,
  statusByte,
  compacto = false,
  className,
}: {
  nivel: NivelBateria | null | undefined;
  statusByte?: number | null;
  compacto?: boolean;
  className?: string;
}) {
  const Icone = nivel ? ICONES[nivel] : BatteryFull;
  const cru = textoStatusCru(statusByte);
  const dica = cru ? `${dicaBateria(nivel)} (${cru})` : dicaBateria(nivel);
  return (
    <span
      title={dica}
      aria-label={`Bateria: ${rotuloBateria(nivel)}`}
      className={cn('inline-flex items-center gap-1 font-medium', corBateria(nivel), className)}
    >
      <Icone className={compacto ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      {rotuloBateria(nivel)}
    </span>
  );
}
