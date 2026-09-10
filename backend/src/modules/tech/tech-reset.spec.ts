import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { TechAuthService } from './tech-auth.service';
import { PasswordResetService } from '../auth/password-reset.service';
import { WhatsappService } from '../notifications/whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';

describe('Recuperação de senha do técnico', () => {
  let service: TechAuthService;
  let tecnico: Record<string, unknown>;
  let enviados: string[];
  let gravado: Record<string, unknown> | null;

  beforeEach(async () => {
    enviados = [];
    gravado = null;
    tecnico = {
      id: 't-1',
      name: 'Marcos',
      phone: '21988887777',
      resetCodeHash: null,
      resetCodeExpiresAt: null,
      resetCodeAttempts: 0,
      resetCodeSentAt: null,
    };
    const prisma = {
      technician: {
        findFirst: jest.fn(async () => tecnico),
        findMany: jest.fn(async () => [tecnico]),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const aplicado: Record<string, unknown> = { ...data };
          // Emula o `{ increment: 1 }` do Prisma.
          if (
            aplicado.resetCodeAttempts &&
            typeof aplicado.resetCodeAttempts === 'object'
          ) {
            aplicado.resetCodeAttempts =
              (tecnico.resetCodeAttempts as number) + 1;
          }
          tecnico = { ...tecnico, ...aplicado };
          // Guarda só a escrita da senha: depois dela o motor ainda limpa o
          // código, e o último update sobrescreveria o que queremos conferir.
          if (data.password) gravado = data;
          return tecnico;
        }),
      },
    };
    const whatsapp = {
      habilitado: true,
      enviarCodigo: jest.fn(async (_tel: string, codigo: string) => {
        enviados.push(codigo);
        return { enviado: true };
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        TechAuthService,
        PasswordResetService,
        { provide: PrismaService, useValue: prisma },
        { provide: WhatsappService, useValue: whatsapp },
        { provide: JwtService, useValue: { sign: () => 'jwt' } },
      ],
    }).compile();
    service = mod.get(TechAuthService);
  });

  it('envia o código pro WhatsApp do técnico', async () => {
    const res = await service.forgotPassword('12345678901');

    expect(enviados[0]).toMatch(/^\d{6}$/);
    expect(res.sentTo).toBe('*****-7777');
  });

  it('grava a senha nova e libera o mustChangePassword', async () => {
    await service.forgotPassword('12345678901');
    const res = await service.resetPasswordWithCode(
      '12345678901',
      enviados[0],
      'senhaDoTecnico1',
    );

    expect(res).toEqual({ ok: true });
    expect(
      await bcrypt.compare('senhaDoTecnico1', gravado!.password as string),
    ).toBe(true);
    expect(gravado!.mustChangePassword).toBe(false);
  });

  it('recusa código errado', async () => {
    await service.forgotPassword('12345678901');

    await expect(
      service.resetPasswordWithCode('12345678901', '000000', 'senhaDoTecnico1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa senha igual ao CPF', async () => {
    await service.forgotPassword('12345678901');

    await expect(
      service.resetPasswordWithCode('12345678901', enviados[0], '12345678901'),
    ).rejects.toThrow('A nova senha não pode ser o seu CPF. Escolha outra.');
  });
});
