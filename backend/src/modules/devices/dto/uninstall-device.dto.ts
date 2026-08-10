import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Retirada do rastreador do veículo — o aparelho volta ao estoque. */
export class UninstallDeviceDto {
  @ApiPropertyOptional({
    example: 'Cliente cancelou o plano',
    description: 'Por que o rastreador foi retirado (fica no histórico)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
