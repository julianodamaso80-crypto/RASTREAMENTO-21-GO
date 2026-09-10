import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { WhatsappService } from '../notifications/whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { TraccarService } from '../traccar/traccar.service';

describe('Recuperação de senha do painel por WhatsApp', () => {
  let service: AuthService;
  let usuario: Record<string, unknown>;
  let enviados: string[];
  let gravado: Record<string, unknown> | null;

  beforeEach(async () => {
    enviados = [];
    gravado = null;
    usuario = {
      id: 'u-1',
      email: 'operador@21go.com.br',
      phone: '21977776666',
      resetCodeHash: null,
      resetCodeExpiresAt: null,
      resetCodeAttempts: 0,
      resetCodeSentAt: null,
    };
    const prisma = {
      user: {
        findFirst: jest.fn(async () => usuario),
        findUnique: jest.fn(async () => usuario),
        findMany: jest.fn(async () => [usuario]),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const aplicado: Record<string, unknown> = { ...data };
          if (
            aplicado.resetCodeAttempts &&
            typeof aplicado.resetCodeAttempts === 'object'
          ) {
            aplicado.resetCodeAttempts =
              (usuario.resetCodeAttempts as number) + 1;
          }
          usuario = { ...usuario, ...aplicado };
          // Só a escrita da senha interessa: o motor limpa o código depois.
          if (data.password) gravado = data;
          return usuario;
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
        AuthService,
        PasswordResetService,
        { provide: PrismaService, useValue: prisma },
        { provide: WhatsappService, useValue: whatsapp },
        { provide: EmailService, useValue: { sendPasswordReset: jest.fn() } },
        { provide: TraccarService, useValue: {} },
        { provide: JwtService, useValue: { sign: () => 'jwt' } },
      ],
    }).compile();
    service = mod.get(AuthService);
  });

  it('envia o código pro WhatsApp do usuário do painel', async () => {
    const res = await service.forgotPasswordWhatsapp('operador@21go.com.br');

    expect(enviados[0]).toMatch(/^\d{6}$/);
    expect(res.sentTo).toBe('*****-6666');
  });

  it('responde igual quando o e-mail não existe', async () => {
    const res = await service.forgotPasswordWhatsapp('naoexiste@21go.com.br');
    expect(res.message).toContain('Se esse e-mail estiver cadastrado');
  });

  it('grava a senha nova com o código certo', async () => {
    await service.forgotPasswordWhatsapp('operador@21go.com.br');
    const res = await service.resetPasswordWhatsapp(
      'operador@21go.com.br',
      enviados[0],
      'senhaDoPainel1',
    );

    expect(res).toEqual({ ok: true });
    expect(
      await bcrypt.compare('senhaDoPainel1', gravado!.password as string),
    ).toBe(true);
  });

  it('recusa código errado', async () => {
    await service.forgotPasswordWhatsapp('operador@21go.com.br');

    await expect(
      service.resetPasswordWhatsapp(
        'operador@21go.com.br',
        '000000',
        'senhaDoPainel1',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
