import { Test } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PhoneVerificationService } from './phone-verification.service';
import { WhatsappService } from '../notifications/whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';

describe('Verificação de WhatsApp no login', () => {
  let service: PhoneVerificationService;
  let registro: Record<string, unknown>;
  let enviados: string[];

  beforeEach(async () => {
    enviados = [];
    registro = {
      id: 'u-1',
      phone: null,
      pendingPhone: null,
      phoneVerifiedAt: null,
      resetCodeHash: null,
      resetCodeExpiresAt: null,
      resetCodeAttempts: 0,
      resetCodeSentAt: null,
    };
    const tabela = {
      findFirst: jest.fn(async () => registro),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const aplicado: Record<string, unknown> = { ...data };
        if (
          aplicado.resetCodeAttempts &&
          typeof aplicado.resetCodeAttempts === 'object'
        ) {
          aplicado.resetCodeAttempts = (registro.resetCodeAttempts as number) + 1;
        }
        registro = { ...registro, ...aplicado };
        return registro;
      }),
    };
    const prisma = { user: tabela, technician: tabela };
    const whatsapp = {
      habilitado: true,
      enviarCodigo: jest.fn(async (_tel: string, codigo: string) => {
        enviados.push(codigo);
        return { enviado: true };
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        PhoneVerificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: WhatsappService, useValue: whatsapp },
      ],
    }).compile();
    service = mod.get(PhoneVerificationService);
  });

  it('envia código pro número informado e guarda como pendente', async () => {
    const res = await service.iniciar('user', 'u-1', '(21) 97777-6666');

    expect(enviados[0]).toMatch(/^\d{6}$/);
    expect(res.sentTo).toBe('*****-6666');
    expect(registro.pendingPhone).toBe('5521977776666');
    // Só vira telefone de verdade depois de confirmado.
    expect(registro.phone).toBeNull();
    expect(registro.phoneVerifiedAt).toBeNull();
  });

  it('recusa número curto sem enviar nada', async () => {
    await expect(service.iniciar('user', 'u-1', '123')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(enviados).toHaveLength(0);
  });

  it('promove o pendente a verificado quando o código confere', async () => {
    await service.iniciar('user', 'u-1', '21977776666');
    const res = await service.confirmar('user', 'u-1', enviados[0]);

    expect(res).toEqual({ ok: true });
    expect(registro.phone).toBe('5521977776666');
    expect(registro.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(registro.pendingPhone).toBeNull();
  });

  it('não verifica nada com código errado', async () => {
    await service.iniciar('user', 'u-1', '21977776666');

    await expect(
      service.confirmar('user', 'u-1', '000000'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(registro.phoneVerifiedAt).toBeNull();
  });

  it('funciona igual para o técnico', async () => {
    await service.iniciar('technician', 't-1', '21977776666');
    const res = await service.confirmar('technician', 't-1', enviados[0]);

    expect(res).toEqual({ ok: true });
    expect(registro.phoneVerifiedAt).toBeInstanceOf(Date);
  });
});
