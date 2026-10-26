/** Link "compartilhar localização" como o backend devolve (painel e associado). */
export interface LinkLocalizacao {
  id: string;
  plate: string;
  hours: number;
  source: 'PAINEL' | 'APP' | string;
  /** Só o painel recebe quem gerou. */
  requestedByName: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  active: boolean;
  url: string;
}

/** O que a página pública recebe — nada de dono, IMEI ou empresa. */
export interface LocalizacaoPublica {
  plate: string;
  brand: string | null;
  model: string | null;
  color: string | null;
  vehicleType: 'CAR' | 'MOTORCYCLE' | string;
  expiresAt: string;
  lastUpdate: string | null;
  position: {
    latitude: number;
    longitude: number;
    speed: number;
    course: number;
    fixTime: string;
    ignition: boolean | null;
    address: string | null;
  } | null;
}

export const DURACOES_HORAS = [1, 8, 24, 48] as const;

export function linkGoogleMaps(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
