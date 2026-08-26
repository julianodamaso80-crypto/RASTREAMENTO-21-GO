import { IsOptional, IsInt, IsIn, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class FilterActiveTagsDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  perPage: number = 20;

  @ApiPropertyOptional({ description: 'Placa, chassi, nome ou CPF' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['RASTREADOR_E_TAG', 'SO_TAG'] })
  @IsOptional()
  @IsIn(['RASTREADOR_E_TAG', 'SO_TAG'])
  tipo?: 'RASTREADOR_E_TAG' | 'SO_TAG';
}
