import {
  IsString,
  IsInt,
  IsOptional,
  IsNumber,
  IsISO8601,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSightingDto {
  @ApiProperty({
    example: '92603008494',
    description: 'IMEI/ID da TAG (campo imei do Device)',
  })
  @IsString()
  deviceImei: string;

  @ApiProperty({
    example: 'EB:25:02:3C:02:0E',
    description: 'MAC observado no pacote BLE (formato little-endian do scanner)',
  })
  @IsString()
  macAddress: string;

  @ApiPropertyOptional({
    example: -55,
    description:
      'RSSI em dBm. Ausente em relatório da rede Apple, que não expõe potência de sinal.',
  })
  @IsOptional()
  @IsInt()
  @Min(-127)
  @Max(20)
  rssi?: number;

  @ApiPropertyOptional({
    example: '2026-08-20T10:00:00.000Z',
    description:
      'Momento em que a TAG foi vista. Ausente no scanner local, que reporta na hora.',
  })
  @IsOptional()
  @IsISO8601()
  seenAt?: string;

  @ApiPropertyOptional({
    example: 40,
    description: 'Raio de confiança em metros informado pela rede Find My.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50000)
  accuracy?: number;

  @ApiPropertyOptional({
    example: 'ub1FoLtdoAnRgH1/u9qjYETb5SNN1pJ/gXdWR1QNsUY=',
    description: 'SHA-256 da advertisement key reconstruída (base64)',
  })
  @IsOptional()
  @IsString()
  hashedAdvKey?: string;

  @ApiPropertyOptional({
    example: 0,
    description: 'Crypto counter byte (último byte do payload Find My)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(255)
  counterByte?: number;

  @ApiPropertyOptional({
    example: -23.55052,
    description: 'Latitude conhecida do scanner que detectou a TAG',
  })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  scannerLat?: number;

  @ApiPropertyOptional({
    example: -46.633308,
    description: 'Longitude conhecida do scanner que detectou a TAG',
  })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  scannerLng?: number;

  @ApiPropertyOptional({
    example: 'pc-juliano',
    description: 'Identificador do scanner que detectou (free-form)',
  })
  @IsOptional()
  @IsString()
  scannerSource?: string;
}
