import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '.prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Models com deletedAt no schema. Fonte única da verdade pra extension.
const SOFT_DELETE_MODELS = new Set([
  'Tenant',
  'User',
  'Vehicle',
  'Associate',
  'Alert',
  'Geofence',
  'Device',
  'Chip',
  'StockItem',
  'MaintenancePlan',
  'Technician',
]);

const READ_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

// Sobrescreve delete/deleteMany pra fazer soft delete (update com deletedAt = now).
// Aplicado por model — Prisma client extension não permite $allModels sobrescrever métodos nativos.
const softDeleteModel = {
  async delete<T, A>(this: T, args: A) {
    const ctx = Prisma.getExtensionContext(this) as unknown as {
      update: (input: unknown) => Promise<unknown>;
    };
    return ctx.update({
      where: (args as { where: unknown }).where,
      data: { deletedAt: new Date() },
    });
  },
  async deleteMany<T, A>(this: T, args?: A) {
    const ctx = Prisma.getExtensionContext(this) as unknown as {
      updateMany: (input: unknown) => Promise<unknown>;
    };
    return ctx.updateMany({
      where: (args as { where?: unknown } | undefined)?.where,
      data: { deletedAt: new Date() },
    });
  },
};

function createExtendedClient(base: PrismaClient) {
  return base.$extends({
    name: 'softDelete',
    model: {
      tenant: softDeleteModel,
      user: softDeleteModel,
      vehicle: softDeleteModel,
      associate: softDeleteModel,
      alert: softDeleteModel,
      geofence: softDeleteModel,
      device: softDeleteModel,
      chip: softDeleteModel,
      stockItem: softDeleteModel,
      maintenancePlan: softDeleteModel,
      technician: softDeleteModel,
    },
    query: {
      $allModels: {
        // Injeta where.deletedAt = null em reads, exceto quando caller passa deletedAt explícito.
        // Limitação conhecida: só olha top-level where.deletedAt — where.OR.[...deletedAt] não é detectado.
        async $allOperations({ model, operation, args, query }) {
          if (SOFT_DELETE_MODELS.has(model) && READ_OPERATIONS.has(operation)) {
            const a = (args ?? {}) as { where?: Record<string, unknown> };
            a.where = a.where ?? {};
            if (a.where.deletedAt === undefined) {
              a.where.deletedAt = null;
            }
            return query(a);
          }
          return query(args);
        },
      },
    },
  });
}

type ExtendedPrismaClient = ReturnType<typeof createExtendedClient>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly base: PrismaClient;
  private readonly ext: ExtendedPrismaClient;

  constructor() {
    // Pool size 20 (default 10) suporta ~5-10 operadores simultâneos +
    // jobs de cron + crud sem saturar. Acima disso (Fase 3, 5k+ ativos)
    // mover pra Postgres gerenciado com pool externo (PgBouncer).
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
    });
    const adapter = new PrismaPg(pool);
    this.base = new PrismaClient({ adapter });
    this.ext = createExtendedClient(this.base);
  }

  async onModuleInit() {
    await this.base.$connect();
  }

  async onModuleDestroy() {
    await this.base.$disconnect();
  }

  // Models com soft delete — delegam ao cliente estendido
  get tenant() {
    return this.ext.tenant;
  }
  get user() {
    return this.ext.user;
  }
  get vehicle() {
    return this.ext.vehicle;
  }
  get associate() {
    return this.ext.associate;
  }
  get alert() {
    return this.ext.alert;
  }
  get geofence() {
    return this.ext.geofence;
  }
  get device() {
    return this.ext.device;
  }
  get chip() {
    return this.ext.chip;
  }
  get stockItem() {
    return this.ext.stockItem;
  }
  get maintenancePlan() {
    return this.ext.maintenancePlan;
  }
  get technician() {
    return this.ext.technician;
  }

  // Models sem soft delete — usam cliente base (tabela de junção / log de comandos / audit)
  get geofenceVehicle() {
    return this.base.geofenceVehicle;
  }
  get smsCommand() {
    return this.base.smsCommand;
  }
  get auditLog() {
    return this.base.auditLog;
  }
  get alertHistory() {
    return this.base.alertHistory;
  }
  get bleSighting() {
    return this.base.bleSighting;
  }
  get userVehicleAccess() {
    return this.base.userVehicleAccess;
  }
  get position() {
    return this.base.position;
  }
  get tenantSettings() {
    return this.base.tenantSettings;
  }
  get vehicleScore() {
    return this.base.vehicleScore;
  }
  get assistantConversation() {
    return this.base.assistantConversation;
  }
  get assistantMessage() {
    return this.base.assistantMessage;
  }

  // Raw queries — sempre pelo base (extension não afeta raw)
  $queryRaw<T = unknown>(
    query: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ) {
    return this.base.$queryRaw<T>(query as TemplateStringsArray, ...values);
  }
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]) {
    return this.base.$queryRawUnsafe<T>(query, ...values);
  }
  $executeRaw(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) {
    return this.base.$executeRaw(query as TemplateStringsArray, ...values);
  }
  $executeRawUnsafe(query: string, ...values: unknown[]) {
    return this.base.$executeRawUnsafe(query, ...values);
  }

  // Transaction — delegado ao estendido pra que as operações dentro da tx respeitem soft delete
  $transaction: ExtendedPrismaClient['$transaction'] = ((
    ...args: unknown[]
  ) => {
    return (this.ext.$transaction as unknown as (...a: unknown[]) => unknown)(
      ...args,
    );
  }) as ExtendedPrismaClient['$transaction'];
}
