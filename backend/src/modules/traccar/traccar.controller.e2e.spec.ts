import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { TraccarController } from './traccar.controller';
import { TraccarService } from './traccar.service';
import { FrotaPainelService } from './frota-painel.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';

/**
 * Prova no Express de verdade (não em mock de `res`): com o etag igual o
 * navegador recebe 304 sem corpo, mesmo com o `TransformInterceptor`
 * envelopando o retorno em `{ data }`. Os guards globais não sobem aqui; um
 * middleware põe o `tenantId` que o `TenantGuard` poria.
 */

const veiculos: Record<string, Array<{ traccarDeviceId: number }>> = {
  'tenant-a': [{ traccarDeviceId: 1 }],
  'tenant-b': [{ traccarDeviceId: 2 }],
};

async function subir(flag: string | undefined) {
  if (flag === undefined) delete process.env.FROTA_PAINEL_CACHE_MS;
  else process.env.FROTA_PAINEL_CACHE_MS = flag;

  const prisma = {
    vehicle: {
      findMany: jest.fn((args: { where: { tenantId: string } }) =>
        Promise.resolve(veiculos[args.where.tenantId] ?? []),
      ),
    },
  };
  const traccar = {
    getDevices: jest.fn().mockResolvedValue([
      { id: 1, name: 'um' },
      { id: 2, name: 'dois' },
    ]),
    getPositions: jest.fn().mockResolvedValue([
      { id: 20, deviceId: 2 },
      { id: 10, deviceId: 1 },
    ]),
  };
  const modulo = await Test.createTestingModule({
    controllers: [TraccarController],
    providers: [
      FrotaPainelService,
      { provide: PrismaService, useValue: prisma },
      { provide: TraccarService, useValue: traccar },
    ],
  }).compile();
  const app = modulo.createNestApplication<INestApplication<App>>();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { tenantId: string }).tenantId = String(
      req.headers['x-tenant'],
    );
    next();
  });
  app.useGlobalInterceptors(new TransformInterceptor());
  await app.init();
  return { app, prisma, traccar };
}

describe('TraccarController — 304 pelo Express (supertest)', () => {
  const envOriginal = process.env.FROTA_PAINEL_CACHE_MS;
  let app: INestApplication<App> | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (envOriginal === undefined) delete process.env.FROTA_PAINEL_CACHE_MS;
    else process.env.FROTA_PAINEL_CACHE_MS = envOriginal;
  });

  describe.each([
    ['/traccar/devices', [{ id: 1, name: 'um' }]],
    ['/traccar/positions', [{ id: 10, deviceId: 1 }]],
  ])('%s com a flag ligada', (rota, esperado) => {
    it('200 com envelope, ETag weak e Cache-Control; depois 304 sem corpo', async () => {
      const s = await subir('2000');
      app = s.app;

      const r1 = await request(app.getHttpServer())
        .get(rota)
        .set('x-tenant', 'tenant-a');
      expect(r1.status).toBe(200);
      expect(r1.body).toEqual({ data: esperado });
      expect(r1.headers.etag).toMatch(/^W\/"[0-9a-f]{20}"$/);
      expect(r1.headers['cache-control']).toBe('private, no-cache');

      const r2 = await request(app.getHttpServer())
        .get(rota)
        .set('x-tenant', 'tenant-a')
        .set('If-None-Match', r1.headers.etag);
      expect(r2.status).toBe(304);
      expect(r2.text ?? '').toBe('');
      expect(r2.body).toEqual({});
      expect(Number(r2.headers['content-length'] ?? 0)).toBe(0);
      expect(r2.headers.etag).toBe(r1.headers.etag);

      // Lista com vários etags e um deles o nosso também casa.
      const r3 = await request(app.getHttpServer())
        .get(rota)
        .set('x-tenant', 'tenant-a')
        .set('If-None-Match', `W/"outro", ${r1.headers.etag}`);
      expect(r3.status).toBe(304);
    });

    it('etag de outro tenant → 200 com a lista do próprio tenant', async () => {
      const s = await subir('2000');
      app = s.app;
      const a = await request(app.getHttpServer())
        .get(rota)
        .set('x-tenant', 'tenant-a');
      const b = await request(app.getHttpServer())
        .get(rota)
        .set('x-tenant', 'tenant-b')
        .set('If-None-Match', a.headers.etag);
      expect(b.status).toBe(200);
      expect(b.headers.etag).not.toBe(a.headers.etag);
      expect(
        (b.body as { data: Array<{ id: number }> }).data.map((x) => x.id),
      ).toEqual(rota.endsWith('devices') ? [2] : [20]);
    });
  });

  it('flag desligada: corpo de hoje, sem Cache-Control novo (ETag continua o do Express)', async () => {
    const s = await subir(undefined);
    app = s.app;
    const r = await request(app.getHttpServer())
      .get('/traccar/devices')
      .set('x-tenant', 'tenant-a');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ data: [{ id: 1, name: 'um' }] });
    expect(r.headers['cache-control']).toBeUndefined();
    // ETag padrão do Express (weak, base64 do corpo serializado), não o nosso.
    expect(r.headers.etag).not.toMatch(/^W\/"[0-9a-f]{20}"$/);
    expect(s.prisma.vehicle.findMany).toHaveBeenCalledTimes(1);
  });
});
