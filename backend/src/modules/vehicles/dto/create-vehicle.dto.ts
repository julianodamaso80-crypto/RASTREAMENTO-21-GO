import {
  IsString,
  IsOptional,
  IsInt,
  IsUUID,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVehicleDto {
  @ApiProperty({ example: 'ABC1D23', description: 'Placa (formato Mercosul ou antigo)' })
  @IsString()
  @Matches(/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/, {
    message: 'Placa deve estar no formato correto (ex: ABC1D23)',
  })
  plate: string;

  @ApiProperty({ example: '123456789012345', description: 'IMEI ou identificador do rastreador' })
  @IsString()
  uniqueId: string;

  @ApiPropertyOptional({ example: 'Chevrolet' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({ example: 'Onix' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ example: 2024 })
  @IsOptional()
  @IsInt()
  year?: number;

  @ApiPropertyOptional({ example: 'Prata' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({ example: '9BGRD08X04G123456' })
  @IsOptional()
  @IsString()
  chassi?: string;

  @ApiPropertyOptional({ example: '00123456789' })
  @IsOptional()
  @IsString()
  renavam?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  associateId?: string;
}
