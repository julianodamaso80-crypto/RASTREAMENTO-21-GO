export interface Trip {
  startTime: string;
  endTime: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  startAddress: string;
  endAddress: string;
  distance: number;
  duration: number;
  maxSpeed: number;
  avgSpeed: number;
}

export interface Stop {
  latitude: number;
  longitude: number;
  address: string;
  startTime: string;
  endTime: string;
  duration: number;
}
