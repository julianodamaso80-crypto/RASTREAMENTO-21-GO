import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

/** Corpo de POST /app/boletos/dispositivo. Sem validação, corpo vazio virava 500 (achado M5). */
export class RegistrarDispositivoDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' })
  @IsString()
  @MinLength(10, { message: 'Token de push inválido.' })
  expoToken!: string;

  @ApiProperty({ example: 'ios' })
  @IsString()
  @IsNotEmpty({ message: 'Informe a plataforma do aparelho.' })
  platform!: string;
}
