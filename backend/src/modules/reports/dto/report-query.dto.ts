import { IsInt, IsString, IsOptional, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReportQueryDto {
  @ApiProperty({ description: 'ID do dispositivo Traccar' })
  @IsInt()
  @Type(() => Number)
  deviceId: number;

  @ApiProperty({ description: 'Data início (ISO 8601)', example: '2026-03-30T00:00:00Z' })
  @IsString()
  from: string;

  @ApiProperty({ description: 'Data fim (ISO 8601)', example: '2026-03-30T23:59:59Z' })
  @IsString()
  to: string;
}

export class ExportQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({ enum: ['positions', 'trips', 'stops'], default: 'positions' })
  @IsOptional()
  @IsEnum(['positions', 'trips', 'stops'])
  type: string = 'positions';

  @ApiPropertyOptional({ enum: ['xlsx', 'csv'], default: 'xlsx' })
  @IsOptional()
  @IsEnum(['xlsx', 'csv'])
  format: string = 'xlsx';
}
