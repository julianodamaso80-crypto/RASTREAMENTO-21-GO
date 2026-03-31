import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class FilterChipsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filtrar por operadora' })
  @IsOptional()
  @IsString()
  operator?: string;

  @ApiPropertyOptional({ description: 'Filtrar por status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Buscar por ICCID' })
  @IsOptional()
  @IsString()
  search?: string;
}
