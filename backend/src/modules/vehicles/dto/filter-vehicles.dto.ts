import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { VehicleStatus } from '.prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class FilterVehiclesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: VehicleStatus })
  @IsOptional()
  @IsEnum(VehicleStatus)
  status?: VehicleStatus;

  @ApiPropertyOptional({ description: 'Busca por placa' })
  @IsOptional()
  @IsString()
  plate?: string;

  @ApiPropertyOptional({ description: 'Busca geral (placa, modelo, marca)' })
  @IsOptional()
  @IsString()
  search?: string;
}
