import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '.prisma/client';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const BCRYPT_ROUNDS = 10;
// Sem 0/O e 1/I/L: a senha vai ser lida em voz alta ou colada no WhatsApp.
const PASSWORD_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  allowedRoutes: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Senha de 12 caracteres em 3 blocos (`K7MQ-P29T-ZVXB`). */
export function generateAccessPassword(): string {
  const block = () =>
    Array.from(
      { length: 4 },
      () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)],
    ).join('');
  return `${block()}-${block()}-${block()}`;
}

interface Actor {
  id: string;
  role: Role;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, search?: string) {
    const where: Record<string, unknown> = { tenantId, deletedAt: null };
    if (search?.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { email: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    return this.prisma.user.findMany({
      where,
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: USER_SELECT,
    });
  }

  async create(tenantId: string, actor: Actor, dto: CreateUserDto) {
    this.assertCanGrantRole(actor, dto.role);

    const email = dto.email.trim().toLowerCase();
    const password = generateAccessPassword();

    const active = await this.prisma.user.findUnique({ where: { email } });
    if (active) {
      throw new ConflictException(`Já existe um acesso com o e-mail ${email}.`);
    }

    // A extension de soft delete injeta `deletedAt: null` em toda leitura, então
    // o excluído só aparece com o filtro explícito. E-mail é unique global: sem
    // ressuscitar o registro, o endereço ficaria queimado pra sempre.
    const deleted = await this.prisma.user.findFirst({
      where: { email, deletedAt: { not: null } },
      select: { id: true, tenantId: true },
    });

    if (deleted) {
      if (deleted.tenantId !== tenantId) {
        throw new ConflictException(
          `O e-mail ${email} já pertence a outra empresa.`,
        );
      }
      const revived = await this.prisma.user.update({
        where: { id: deleted.id },
        data: {
          name: dto.name.trim(),
          role: dto.role,
          allowedRoutes: dto.allowedRoutes ?? [],
          password: await bcrypt.hash(password, BCRYPT_ROUNDS),
          active: true,
          deletedAt: null,
          resetTokenHash: null,
          resetTokenExpiresAt: null,
        },
        select: USER_SELECT,
      });
      this.logger.log(`Acesso reativado: ${revived.email} por=${actor.id}`);
      return { user: revived, password };
    }

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        email,
        role: dto.role,
        allowedRoutes: dto.allowedRoutes ?? [],
        password: await bcrypt.hash(password, BCRYPT_ROUNDS),
      },
      select: USER_SELECT,
    });

    this.logger.log(
      `Acesso criado: ${user.email} role=${user.role} tenant=${tenantId} por=${actor.id}`,
    );
    // A senha em claro sai só nesta resposta — no banco fica apenas o hash.
    return { user, password };
  }

  async update(
    id: string,
    tenantId: string,
    actor: Actor,
    dto: UpdateUserDto,
  ) {
    const target = await this.findOneOrFail(id, tenantId);
    this.assertNotSelf(actor, id, 'alterar o próprio acesso');
    this.assertCanTouchTarget(actor, target.role);
    if (dto.role) {
      this.assertCanGrantRole(actor, dto.role);
    }

    return this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.allowedRoutes !== undefined && {
          allowedRoutes: dto.allowedRoutes,
        }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
      select: USER_SELECT,
    });
  }

  async resetPassword(id: string, tenantId: string, actor: Actor) {
    const target = await this.findOneOrFail(id, tenantId);
    this.assertNotSelf(actor, id, 'gerar a própria senha');
    this.assertCanTouchTarget(actor, target.role);

    const password = generateAccessPassword();
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        password: await bcrypt.hash(password, BCRYPT_ROUNDS),
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      },
      select: USER_SELECT,
    });

    this.logger.log(`Senha regerada: ${user.email} por=${actor.id}`);
    return { user, password };
  }

  async remove(id: string, tenantId: string, actor: Actor) {
    const target = await this.findOneOrFail(id, tenantId);
    this.assertNotSelf(actor, id, 'excluir o próprio acesso');
    this.assertCanTouchTarget(actor, target.role);

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), active: false },
    });
    this.logger.log(`Acesso removido: ${target.email} por=${actor.id}`);
    return { id };
  }

  private async findOneOrFail(id: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, email: true, role: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    return user;
  }

  /** Ninguém se tranca pra fora nem se auto-promove. */
  private assertNotSelf(actor: Actor, targetId: string, action: string) {
    if (actor.id === targetId) {
      throw new BadRequestException(
        `Não é possível ${action}. Peça a outro administrador.`,
      );
    }
  }

  private assertCanGrantRole(actor: Actor, role: Role) {
    if (role === Role.SUPER_ADMIN && actor.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Somente um Super Admin pode conceder o perfil Super Admin.',
      );
    }
  }

  private assertCanTouchTarget(actor: Actor, targetRole: Role) {
    if (targetRole === Role.SUPER_ADMIN && actor.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Somente um Super Admin pode alterar outro Super Admin.',
      );
    }
  }
}
