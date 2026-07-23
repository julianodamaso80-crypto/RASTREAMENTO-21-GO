export interface InstallationCluster {
  id: string;
  count: number;
  tracker: number;
  tag: number;
  radiusKm: number;
  center: { lat: number; lng: number };
  neighborhood: string | null;
  city: string | null;
  /** Patrimônio protegido somado no bolsão. */
  totalValue: number;
  /** IDs ordenados por valor (maior primeiro); a rota reordena por distância. */
  pendingIds: string[];
}

export interface RouteFilters {
  days: number;
  type?: 'TRACKER' | 'TAG';
  minValue?: number;
  minDaysPending?: number;
  city?: string;
}

export interface RouteStop {
  id: string;
  order: number;
  status: 'PENDING' | 'DONE';
  doneAt: string | null;
  plate: string;
  pendingType: 'TRACKER' | 'TAG';
  associateName: string;
  phone: string | null;
  brandModel: string;
  street: string | null;
  number: string | null;
  neighborhood: string | null;
  city: string | null;
  cep: string | null;
  lat: number | null;
  lng: number | null;
}

export interface InstallationRoute {
  id: string;
  status: 'PENDING' | 'DONE' | 'CANCELLED';
  createdAt: string;
  technician?: { id: string; name: string };
  stops: RouteStop[];
}
