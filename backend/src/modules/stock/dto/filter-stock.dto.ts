import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class FilterStockDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Busca por IMEI, ICCID, linha ou operadora' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filtro por status (ex.: ATIVO)' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filtro por operadora (ex.: MULTI)' })
  @IsOptional()
  @IsString()
  operator?: string;

  @ApiPropertyOptional({
    enum: ['free', 'assigned'],
    description: 'free = sem técnico; assigned = reservado pra algum técnico',
  })
  @IsOptional()
  @IsIn(['free', 'assigned'])
  assignment?: 'free' | 'assigned';
}
