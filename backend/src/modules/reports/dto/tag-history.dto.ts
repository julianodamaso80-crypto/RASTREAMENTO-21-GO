import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsISO8601, Matches } from 'class-validator';

/** Número da TAG: 10 ou 11 dígitos (ID do fabricante) ou 15 (série com IMEI). */
const SERIAL_TAG = /^\d{10,15}$/;

export class TagHistorySerialDto {
  @ApiProperty({ example: '808092604070640' })
  @Matches(SERIAL_TAG, { message: 'Número da TAG inválido' })
  serial!: string;
}

export class TagHistoryQueryDto extends TagHistorySerialDto {
  @ApiProperty({ example: '2026-10-20T00:00:00.000Z' })
  @IsISO8601()
  from!: string;

  @ApiProperty({ example: '2026-10-24T00:00:00.000Z' })
  @IsISO8601()
  to!: string;

  @ApiProperty({ enum: ['basico', 'avancado', 'consolidado'] })
  @IsIn(['basico', 'avancado', 'consolidado'], { message: 'Tipo de relatório inválido' })
  type!: string;
}
