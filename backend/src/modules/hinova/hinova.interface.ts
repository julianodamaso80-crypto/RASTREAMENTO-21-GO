import type { HinovaVehicleDto, HinovaListResponse } from './dto/hinova-vehicle.dto';

export const HINOVA_CLIENT = 'HINOVA_CLIENT';

export interface IHinovaClient {
  authenticate(): Promise<void>;
  listVehicles(page: number, perPage: number): Promise<HinovaListResponse>;
  searchByPlate(plate: string): Promise<HinovaVehicleDto | null>;
  searchByCpf(cpf: string): Promise<HinovaVehicleDto[]>;
}
