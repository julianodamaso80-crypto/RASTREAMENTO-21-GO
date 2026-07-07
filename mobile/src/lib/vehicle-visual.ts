import { ImageSourcePropType } from 'react-native';
import { Vehicle, VehicleType, Position } from './api';
import { colors } from './theme';

/**
 * Desenho realista (vista de cima) por tipo — os MESMOS PNGs do dashboard web
 * (frontend/dashboard/public/markers). Ambos apontam pro norte (course 0), então
 * basta girar pela direção real do GPS pra alinhar com o rumo do veículo.
 * `require` precisa ser estático no React Native — por isso o mapa fixo.
 */
const MARKERS: Record<VehicleType, ImageSourcePropType> = {
  CAR: require('../../assets/markers/car-top.png'),
  MOTORCYCLE: require('../../assets/markers/moto-top.png'),
};

/** PNG do marcador pro tipo do veículo (fallback carro, igual ao dashboard). */
export function markerSource(type?: VehicleType | null): ImageSourcePropType {
  return MARKERS[type ?? 'CAR'] ?? MARKERS.CAR;
}

/** Nome do tipo em PT-BR pra rótulos da UI. */
export function vehicleTypeLabel(type?: VehicleType | null): string {
  return type === 'MOTORCYCLE' ? 'Moto' : 'Carro';
}

export interface VehicleStatus {
  color: string;
  label: string;
  moving: boolean;
}

/**
 * Status derivado da POSIÇÃO GPS real (nunca do heartbeat de conexão) —
 * mesma regra de segurança do dashboard: verde em movimento, âmbar ligado
 * parado, vermelho desligado, cinza sem sinal.
 */
export function vehicleStatus(v: Vehicle): VehicleStatus {
  const p: Position | null = v.position;
  if (!p) return { color: colors.textFaint, label: 'Sem sinal', moving: false };
  if (p.motion) return { color: colors.green, label: 'Em movimento', moving: true };
  if (p.ignition === true) return { color: colors.amber, label: 'Ligado · parado', moving: false };
  if (p.ignition === false) return { color: colors.red, label: 'Desligado', moving: false };
  return { color: colors.amber, label: 'Em repouso', moving: false };
}
