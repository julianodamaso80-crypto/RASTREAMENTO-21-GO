import type { Vehicle } from '@/types/vehicle';
import type { TraccarDevice, TraccarPosition } from '@/types/traccar';

const TENANT_ID = 'mock-tenant-001';

const goianiaCoords: [number, number][] = [
  [-49.2550, -16.6799],  // Praça Cívica
  [-49.2378, -16.7045],  // Parque Flamboyant
  [-49.2630, -16.7010],  // Goiânia Shopping
  [-49.2920, -16.6850],  // Setor Oeste
  [-49.2340, -16.6620],  // Setor Marista
  [-49.2700, -16.6650],  // Setor Bueno
  [-49.2480, -16.6920],  // Jardim Goiás
  [-49.3100, -16.6780],  // Setor Universitário
  [-49.2200, -16.6750],  // Jardim América
  [-49.2850, -16.7200],  // Aparecida de Goiânia
  [-49.2600, -16.6500],  // Setor Norte
  [-49.2430, -16.7150],  // Parque Areião
  [-49.2750, -16.6950],  // Setor Campinas
  [-49.3000, -16.6600],  // Setor Leste
  [-49.2550, -16.6400],  // Setor Criméia
  [-49.2900, -16.7100],  // Vila Aurora
  [-49.2350, -16.6850],  // Setor Pedro Ludovico
  [-49.2680, -16.6750],  // Setor Central
];

interface MockVehicleData {
  plate: string;
  brand: string;
  model: string;
  year: number;
  color: string;
  speed: number;
  course: number;
  status: 'online' | 'offline';
  associateName: string;
  associateCpf: string;
}

const vehicleData: MockVehicleData[] = [
  { plate: 'ABC1D23', brand: 'Chevrolet', model: 'Onix', year: 2024, color: 'Prata', speed: 45, course: 90, status: 'online', associateName: 'João Silva', associateCpf: '12345678901' },
  { plate: 'DEF2G45', brand: 'Hyundai', model: 'HB20', year: 2023, color: 'Branco', speed: 62, course: 180, status: 'online', associateName: 'Maria Santos', associateCpf: '23456789012' },
  { plate: 'GHI3J67', brand: 'Fiat', model: 'Strada', year: 2024, color: 'Vermelho', speed: 35, course: 270, status: 'online', associateName: 'Pedro Oliveira', associateCpf: '34567890123' },
  { plate: 'JKL4M89', brand: 'Toyota', model: 'Hilux', year: 2023, color: 'Preto', speed: 78, course: 45, status: 'online', associateName: 'Ana Costa', associateCpf: '45678901234' },
  { plate: 'MNO5P01', brand: 'VW', model: 'Gol', year: 2022, color: 'Cinza', speed: 28, course: 135, status: 'online', associateName: 'Carlos Souza', associateCpf: '56789012345' },
  { plate: 'PQR6S23', brand: 'Honda', model: 'Civic', year: 2024, color: 'Azul', speed: 55, course: 0, status: 'online', associateName: 'Lucia Ferreira', associateCpf: '67890123456' },
  { plate: 'STU7V45', brand: 'Fiat', model: 'Argo', year: 2023, color: 'Branco', speed: 41, course: 225, status: 'online', associateName: 'Roberto Lima', associateCpf: '78901234567' },
  { plate: 'VWX8Y67', brand: 'Renault', model: 'Kwid', year: 2023, color: 'Vermelho', speed: 90, course: 315, status: 'online', associateName: 'Fernanda Alves', associateCpf: '89012345678' },
  { plate: 'YZA9B01', brand: 'Chevrolet', model: 'Tracker', year: 2024, color: 'Prata', speed: 0, course: 90, status: 'online', associateName: 'Marcos Ribeiro', associateCpf: '90123456789' },
  { plate: 'BCD1E23', brand: 'Hyundai', model: 'Creta', year: 2023, color: 'Branco', speed: 0, course: 180, status: 'online', associateName: 'Patricia Nunes', associateCpf: '01234567890' },
  { plate: 'EFG2H45', brand: 'Fiat', model: 'Mobi', year: 2022, color: 'Prata', speed: 0, course: 0, status: 'online', associateName: 'Thiago Pereira', associateCpf: '11234567890' },
  { plate: 'HIJ3K67', brand: 'VW', model: 'T-Cross', year: 2024, color: 'Preto', speed: 0, course: 45, status: 'online', associateName: 'Camila Martins', associateCpf: '22345678901' },
  { plate: 'KLM4N89', brand: 'Toyota', model: 'Corolla', year: 2023, color: 'Cinza', speed: 0, course: 270, status: 'online', associateName: 'Rafael Rocha', associateCpf: '33456789012' },
  { plate: 'NOP5Q01', brand: 'Fiat', model: 'Toro', year: 2024, color: 'Marrom', speed: 15, course: 90, status: 'online', associateName: 'Juliana Dias', associateCpf: '44567890123' },
  { plate: 'QRS6T23', brand: 'Chevrolet', model: 'S10', year: 2022, color: 'Branco', speed: 22, course: 180, status: 'online', associateName: 'Bruno Gomes', associateCpf: '55678901234' },
  { plate: 'TUV7W45', brand: 'Honda', model: 'HR-V', year: 2023, color: 'Azul', speed: 0, course: 0, status: 'offline', associateName: 'Aline Barbosa', associateCpf: '66789012345' },
  { plate: 'WXY8Z67', brand: 'Nissan', model: 'Kicks', year: 2022, color: 'Prata', speed: 0, course: 0, status: 'offline', associateName: 'Diego Cardoso', associateCpf: '77890123456' },
  { plate: 'ZAB9C01', brand: 'Jeep', model: 'Renegade', year: 2023, color: 'Verde', speed: 0, course: 0, status: 'offline', associateName: 'Vanessa Freitas', associateCpf: '88901234567' },
];

export const mockVehicles: Vehicle[] = vehicleData.map((v, i) => ({
  id: `mock-vehicle-${String(i + 1).padStart(3, '0')}`,
  plate: v.plate,
  brand: v.brand,
  model: v.model,
  year: v.year,
  color: v.color,
  chassi: null,
  renavam: null,
  uniqueId: `MOCK${String(i + 1).padStart(10, '0')}`,
  traccarDeviceId: i + 1,
  status: i === 13 || i === 14 ? 'BLOCKED' as const : 'ACTIVE' as const,
  tenantId: TENANT_ID,
  associateId: `mock-associate-${String(i + 1).padStart(3, '0')}`,
  hinovaCode: null,
  lastSync: null,
  deletedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  associate: {
    id: `mock-associate-${String(i + 1).padStart(3, '0')}`,
    name: v.associateName,
    cpf: v.associateCpf,
    phone: `(62) 9${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`,
  },
}));

export const mockDevices: TraccarDevice[] = vehicleData.map((v, i) => ({
  id: i + 1,
  name: v.plate,
  uniqueId: `MOCK${String(i + 1).padStart(10, '0')}`,
  status: v.status,
  lastUpdate: v.status === 'offline'
    ? new Date(Date.now() - 30 * 60 * 1000).toISOString()
    : new Date(Date.now() - Math.random() * 120000).toISOString(),
  positionId: i + 1,
  groupId: 0,
  phone: '',
  model: '',
  contact: '',
  category: 'car',
  disabled: false,
  attributes: {},
}));

export const mockPositions: TraccarPosition[] = vehicleData.map((v, i) => ({
  id: i + 1,
  deviceId: i + 1,
  protocol: 'osmand',
  deviceTime: new Date().toISOString(),
  fixTime: new Date().toISOString(),
  serverTime: new Date().toISOString(),
  outdated: false,
  valid: true,
  latitude: goianiaCoords[i][1],
  longitude: goianiaCoords[i][0],
  altitude: 749,
  speed: v.speed,
  course: v.course,
  address: `Goiânia, GO`,
  accuracy: 10,
  attributes: {
    ignition: v.speed > 0,
    sat: Math.floor(8 + Math.random() * 8),
    batteryLevel: Math.floor(40 + Math.random() * 60),
  },
}));
