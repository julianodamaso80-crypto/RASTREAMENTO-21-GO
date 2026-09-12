import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegistrarDispositivoDto } from './registrar-dispositivo.dto';

// Achado M5: POST /app/boletos/dispositivo aceitava corpo sem validação —
// corpo vazio virava 500. O DTO + ValidationPipe global agora barram antes.
describe('RegistrarDispositivoDto', () => {
  it('corpo vazio falha a validacao', async () => {
    const dto = plainToInstance(RegistrarDispositivoDto, {});
    const erros = await validate(dto);
    expect(erros.length).toBeGreaterThan(0);
  });

  it('corpo valido nao gera erro nenhum', async () => {
    const dto = plainToInstance(RegistrarDispositivoDto, {
      expoToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
      platform: 'ios',
    });
    const erros = await validate(dto);
    expect(erros).toHaveLength(0);
  });

  it('expoToken curto demais falha', async () => {
    const dto = plainToInstance(RegistrarDispositivoDto, { expoToken: 'x', platform: 'ios' });
    const erros = await validate(dto);
    expect(erros.some((e) => e.property === 'expoToken')).toBe(true);
  });

  it('platform vazia falha', async () => {
    const dto = plainToInstance(RegistrarDispositivoDto, {
      expoToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
      platform: '',
    });
    const erros = await validate(dto);
    expect(erros.some((e) => e.property === 'platform')).toBe(true);
  });
});
