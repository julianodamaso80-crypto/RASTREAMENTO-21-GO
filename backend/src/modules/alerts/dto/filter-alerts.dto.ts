import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { AlertStatus, AlertType } from '.prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class FilterAlertsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AlertType })
  @IsOptional()
  @IsEnum(AlertType)
  type?: AlertType;

  @ApiPropertyOptional({ enum: AlertStatus })
  @IsOptional()
  @IsEnum(AlertStatus)
  status?: AlertStatus;

  @ApiPropertyOptional({ description: 'UUID do usuário responsável' })
  @IsOptional()
  @IsUUID('4')
  assignedToId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  vehicleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  read?: boolean;

  @ApiPropertyOptional({ description: 'Data início (ISO 8601)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'Data fim (ISO 8601)' })
  @IsOptional()
  @IsString()
  to?: string;
}
