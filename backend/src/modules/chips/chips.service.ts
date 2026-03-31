import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChipDto } from './dto/create-chip.dto';
import { UpdateChipDto } from './dto/update-chip.dto';
import { FilterChipsDto } from './dto/filter-chips.dto';

// APNs padrão das operadoras M2M brasileiras
export const DEFAULT_APNS: Record<string, { apn: string; user: string; pass: string }[]> = {
  VIVO: [
    { apn: 'smart.m2m.vivo.com.br', user: 'vivo', pass: 'vivo' },
    { apn: 'allcom.vivo.com.br', user: 'allcom', pass: 'allcom' },
  ],
  CLARO: [{ apn: 'claro.com.br', user: 'claro', pass: 'claro' }],
  TIM: [{ apn: 'tim.m2m.br', user: 'tim', pass: 'tim' }],
  OI: [{ apn: 'gprs.oi.com.br', user: 'oi', pass: 'oi' }],
  MULTI_OPERATOR: [
    { apn: 'smart.m2m.vivo.com.br', user: 'vivo', pass: 'vivo' },
    { apn: 'claro.com.br', user: 'claro', pass: 'claro' },
  ],
};

export const KNOWN_PROVIDERS = [
  'Voxter',
  'Datatem',
  'Allcom',
  'TrackPlus',
  'Sigmais',
  'Arqia',
  'LinkField',
  'Outro',
];

@Injectable()
export class ChipsService {
  private get chipModel() {
    return (this.prisma as any).chip;
  }

  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, filters: FilterChipsDto) {
    const { page, perPage, operator, status, search } = filters;
    const where: any = { tenantId, deletedAt: null };

    if (operator) where.operator = operator;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { iccid: { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.chipModel.findMany({
        where,
        include: {
          device: { select: { id: true, imei: true, model: true, status: true } },
        },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.chipModel.count({ where }),
    ]);

    return { data, meta: { total, page, perPage } };
  }

  async findOne(id: string, tenantId: string) {
    const chip = await this.chipModel.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        device: { select: { id: true, imei: true, model: true, status: true, vehicle: { select: { id: true, plate: true } } } },
      },
    });
    if (!chip) throw new NotFoundException('Chip não encontrado');
    return chip;
  }

  async create(dto: CreateChipDto, tenantId: string) {
    const existing = await this.chipModel.findFirst({ where: { iccid: dto.iccid } });
    if (existing) throw new ConflictException('ICCID já cadastrado');

    const chip = await this.chipModel.create({
      data: {
        iccid: dto.iccid,
        phoneNumber: dto.phoneNumber,
        operator: dto.operator,
        apn: dto.apn,
        apnUser: dto.apnUser,
        apnPassword: dto.apnPassword,
        apnType: dto.apnType || 'PRIVATE',
        dataPlanMb: dto.dataPlanMb || 50,
        provider: dto.provider,
        activatedAt: dto.activatedAt ? new Date(dto.activatedAt) : null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        tenantId,
      },
    });

    return this.findOne(chip.id, tenantId);
  }

  async update(id: string, dto: UpdateChipDto, tenantId: string) {
    await this.findOne(id, tenantId);

    const data: any = {};
    if (dto.phoneNumber !== undefined) data.phoneNumber = dto.phoneNumber;
    if (dto.operator !== undefined) data.operator = dto.operator;
    if (dto.apn !== undefined) data.apn = dto.apn;
    if (dto.apnUser !== undefined) data.apnUser = dto.apnUser;
    if (dto.apnPassword !== undefined) data.apnPassword = dto.apnPassword;
    if (dto.apnType !== undefined) data.apnType = dto.apnType;
    if (dto.dataPlanMb !== undefined) data.dataPlanMb = dto.dataPlanMb;
    if (dto.provider !== undefined) data.provider = dto.provider;
    if (dto.activatedAt !== undefined) data.activatedAt = new Date(dto.activatedAt);
    if (dto.expiresAt !== undefined) data.expiresAt = new Date(dto.expiresAt);

    await this.chipModel.update({ where: { id }, data });
    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.chipModel.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  getOperatorsWithApns() {
    return Object.entries(DEFAULT_APNS).map(([operator, apns]) => ({
      operator,
      apns,
    }));
  }

  getProviders() {
    return KNOWN_PROVIDERS;
  }
}
