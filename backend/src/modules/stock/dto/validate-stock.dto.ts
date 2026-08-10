import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ValidateStockDto {
  @ApiProperty({
    description: 'true = instalação aprovada; false = reprovada',
    example: true,
  })
  @IsBoolean()
  approved!: boolean;

  @ApiPropertyOptional({
    description: 'Observação do operador (motivo da reprovação, por exemplo)',
    example: 'Voltagem oscilando, técnico vai refazer o ponto de alimentação',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
