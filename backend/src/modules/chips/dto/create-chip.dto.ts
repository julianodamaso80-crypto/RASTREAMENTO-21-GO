import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  IsDateString,
  Matches,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateChipDto {
  @ApiProperty({
    example: '8955011234567890123',
    description: 'ICCID do chip (19-20 dígitos)',
  })
  @IsString()
  @Matches(/^\d{19,20}$/, { message: 'ICCID deve conter 19 ou 20 dígitos' })
  iccid: string;

  @ApiPropertyOptional({ example: '11999998888' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiProperty({ enum: ['VIVO', 'CLARO', 'TIM', 'OI', 'MULTI_OPERATOR'] })
  @IsEnum(['VIVO', 'CLARO', 'TIM', 'OI', 'MULTI_OPERATOR'])
  operator: string;

  @ApiProperty({ example: 'smart.m2m.vivo.com.br' })
  @IsString()
  apn: string;

  @ApiPropertyOptional({ example: 'vivo' })
  @IsOptional()
  @IsString()
  apnUser?: string;

  @ApiPropertyOptional({ example: 'vivo' })
  @IsOptional()
  @IsString()
  apnPassword?: string;

  @ApiPropertyOptional({ enum: ['PUBLIC', 'PRIVATE'], default: 'PRIVATE' })
  @IsOptional()
  @IsEnum(['PUBLIC', 'PRIVATE'])
  apnType?: string;

  @ApiPropertyOptional({ example: 50, description: 'Plano de dados em MB' })
  @IsOptional()
  @IsInt()
  @Min(1)
  dataPlanMb?: number;

  @ApiPropertyOptional({ example: 'Voxter' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  activatedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
