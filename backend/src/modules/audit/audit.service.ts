import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditInput {
  tenantId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  action: AuditAction;
  entity?: string | null;
  entityId?: string | null;
  method: string;
  path: string;
  statusCode: number;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Fire-and-forget. Falha em audit não pode quebrar fluxo principal.
  log(input: AuditInput): void {
    this.persist(input).catch((err: unknown) => {
      this.logger.error(
        { err, input },
        'Falha ao gravar audit log — requisição segue normal',
      );
    });
  }

  private async persist(input: AuditInput) {
    await this.prisma.auditLog.create({
      data: {
        tenantId: input.tenantId ?? null,
        userId: input.userId ?? null,
        userEmail: input.userEmail ?? null,
        action: input.action,
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        method: input.method,
        path: input.path,
        statusCode: input.statusCode,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        metadata:
          input.metadata == null
            ? Prisma.JsonNull
            : (input.metadata as Prisma.InputJsonValue),
      },
    });
  }
}
