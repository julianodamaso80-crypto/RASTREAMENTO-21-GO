import { Injectable, Logger } from '@nestjs/common';
import type { IHinovaClient } from './hinova.interface';
import type {
  HinovaVehicleDto,
  HinovaListResponse,
} from './dto/hinova-vehicle.dto';

const BRANDS = [
  'Chevrolet',
  'Fiat',
  'VW',
  'Hyundai',
  'Toyota',
  'Honda',
  'Renault',
  'Nissan',
  'Jeep',
  'Ford',
];
const MODELS: Record<string, string[]> = {
  Chevrolet: ['Onix', 'Tracker', 'S10', 'Spin', 'Montana'],
  Fiat: ['Strada', 'Argo', 'Mobi', 'Toro', 'Pulse'],
  VW: ['Gol', 'T-Cross', 'Polo', 'Saveiro', 'Nivus'],
  Hyundai: ['HB20', 'Creta', 'Tucson', 'HB20S'],
  Toyota: ['Hilux', 'Corolla', 'Yaris', 'SW4'],
  Honda: ['Civic', 'HR-V', 'City', 'Fit'],
  Renault: ['Kwid', 'Duster', 'Sandero', 'Oroch'],
  Nissan: ['Kicks', 'Versa', 'Frontier'],
  Jeep: ['Renegade', 'Compass', 'Commander'],
  Ford: ['Ranger', 'Territory', 'Bronco Sport'],
};
const COLORS = [
  'Branco',
  'Prata',
  'Preto',
  'Cinza',
  'Vermelho',
  'Azul',
  'Marrom',
  'Verde',
];
const FIRST_NAMES = [
  'João',
  'Maria',
  'Pedro',
  'Ana',
  'Carlos',
  'Lucia',
  'Roberto',
  'Fernanda',
  'Marcos',
  'Patricia',
  'Thiago',
  'Camila',
  'Rafael',
  'Juliana',
  'Bruno',
  'Aline',
  'Diego',
  'Vanessa',
  'Lucas',
  'Bruna',
  'Gabriel',
  'Larissa',
  'Felipe',
  'Amanda',
  'Gustavo',
  'Beatriz',
  'Leonardo',
  'Isabela',
  'Matheus',
  'Carolina',
  'Rodrigo',
  'Leticia',
  'André',
  'Mariana',
  'Vinícius',
  'Natália',
  'Eduardo',
  'Gabriela',
  'Henrique',
  'Tatiana',
  'Daniel',
  'Priscila',
  'Fabio',
  'Renata',
  'Ricardo',
  'Sandra',
  'Paulo',
  'Cristina',
  'Marcelo',
  'Simone',
];
const LAST_NAMES = [
  'Silva',
  'Santos',
  'Oliveira',
  'Souza',
  'Rodrigues',
  'Ferreira',
  'Alves',
  'Lima',
  'Pereira',
  'Costa',
  'Ribeiro',
  'Nunes',
  'Martins',
  'Gomes',
  'Barbosa',
  'Cardoso',
  'Rocha',
  'Dias',
  'Freitas',
  'Moreira',
];

function generatePlate(index: number): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const l1 = letters[Math.floor(index / 676) % 26];
  const l2 = letters[Math.floor(index / 26) % 26];
  const l3 = letters[index % 26];
  const d1 = Math.floor(Math.random() * 10);
  const l4 = letters[Math.floor(Math.random() * 26)];
  const d2 = Math.floor(Math.random() * 10);
  const d3 = Math.floor(Math.random() * 10);
  return `${l1}${l2}${l3}${d1}${l4}${d2}${d3}`;
}

function generateCpf(): string {
  const digits = Array.from({ length: 11 }, () =>
    Math.floor(Math.random() * 10),
  );
  return digits.join('');
}

function generateMockVehicles(): HinovaVehicleDto[] {
  return Array.from({ length: 50 }, (_, i) => {
    const brand = BRANDS[i % BRANDS.length];
    const models = MODELS[brand];
    const model = models[i % models.length];
    const statusOptions: Array<'ATIVO' | 'INATIVO' | 'INADIMPLENTE'> = [
      'ATIVO',
      'ATIVO',
      'ATIVO',
      'ATIVO',
      'ATIVO',
      'ATIVO',
      'ATIVO',
      'INATIVO',
      'INADIMPLENTE',
      'ATIVO',
    ];

    return {
      codigoVeiculo: `HNV${String(i + 1).padStart(6, '0')}`,
      placa: generatePlate(i + 100),
      chassi: `9BG${String(Math.random()).slice(2, 16)}`,
      renavam: String(Math.floor(10000000000 + Math.random() * 90000000000)),
      marca: brand,
      modelo: model,
      cor: COLORS[i % COLORS.length],
      anoFabricacao: 2020 + (i % 5),
      anoModelo: 2021 + (i % 5),
      status: statusOptions[i % statusOptions.length],
      associado: {
        codigoAssociado: `ASS${String(i + 1).padStart(6, '0')}`,
        nome: `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[i % LAST_NAMES.length]}`,
        cpf: generateCpf(),
        rg: `${Math.floor(1000000 + Math.random() * 9000000)}`,
        dataNascimento: `${1970 + (i % 30)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
        telefone: `(62) 9${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`,
        email: `${FIRST_NAMES[i % FIRST_NAMES.length].toLowerCase()}.${LAST_NAMES[i % LAST_NAMES.length].toLowerCase()}@email.com`,
      },
    };
  });
}

@Injectable()
export class HinovaMockService implements IHinovaClient {
  private readonly logger = new Logger(HinovaMockService.name);
  private readonly vehicles: HinovaVehicleDto[];

  constructor() {
    this.vehicles = generateMockVehicles();
    this.logger.log(
      `Mock Hinova inicializado com ${this.vehicles.length} veículos`,
    );
  }

  private async simulateLatency(): Promise<void> {
    const delay = 200 + Math.random() * 600;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private simulateError(): void {
    if (Math.random() < 0.05) {
      throw new Error('Hinova API mock error: simulação de falha');
    }
  }

  async authenticate(): Promise<void> {
    await this.simulateLatency();
    this.logger.debug('Mock: autenticação simulada');
  }

  async listVehicles(
    page: number,
    perPage: number,
  ): Promise<HinovaListResponse> {
    await this.simulateLatency();
    this.simulateError();

    const start = (page - 1) * perPage;
    const data = this.vehicles.slice(start, start + perPage);

    return {
      data,
      total: this.vehicles.length,
      pagina: page,
      porPagina: perPage,
    };
  }

  async searchByPlate(plate: string): Promise<HinovaVehicleDto | null> {
    await this.simulateLatency();
    this.simulateError();
    return this.vehicles.find((v) => v.placa === plate) || null;
  }

  async searchByCpf(cpf: string): Promise<HinovaVehicleDto[]> {
    await this.simulateLatency();
    this.simulateError();
    return this.vehicles.filter((v) => v.associado.cpf === cpf);
  }
}
