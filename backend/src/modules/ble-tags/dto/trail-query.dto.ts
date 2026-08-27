import { IsOptional, IsISO8601, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class TrailQueryDto {
  @ApiPropertyOptional({
    example: '2026-08-20T00:00:00.000Z',
    description: 'Início da janela. Sem ela, devolve toda a história guardada.',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-08-27T00:00:00.000Z',
    description: 'Fim da janela.',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class InsightsQueryDto {
  @ApiPropertyOptional({
    default: 7,
    maximum: 30,
    description:
      'Dias analisados. O padrão é 7 porque é o que a rede Find My guarda.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  days?: number;
}
