export type GeofenceType = 'POLYGON' | 'CIRCLE';

export interface CircleCoordinates {
  latitude: number;
  longitude: number;
  radius: number; // metros
}

export type PolygonCoordinates = number[][]; // [[lng, lat], ...]

export interface Geofence {
  id: string;
  name: string;
  description: string | null;
  type: GeofenceType;
  coordinates: CircleCoordinates | PolygonCoordinates;
  color: string;
  active: boolean;
  traccarGeofenceId: number | null;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  geofenceVehicles?: Array<{
    vehicle: {
      id: string;
      plate: string;
      brand: string | null;
      model: string | null;
    };
  }>;
}

export interface CreateGeofencePayload {
  name: string;
  description?: string;
  type: GeofenceType;
  coordinates: CircleCoordinates | PolygonCoordinates;
  color?: string;
}
