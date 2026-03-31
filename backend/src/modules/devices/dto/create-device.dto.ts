import {
  IsString,
  IsOptional,
  IsEnum,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Luhn check for IMEI validation
function isValidImei(imei: string): boolean {
  if (!/^\d{15}$/.test(imei)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let digit = parseInt(imei[i], 10);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

import { registerDecorator, ValidationOptions } from 'class-validator';

function IsValidImei(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidImei',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && isValidImei(value);
        },
        defaultMessage() {
          return 'IMEI inválido (deve ter 15 dígitos e passar na validação Luhn)';
        },
      },
    });
  };
}

export class CreateDeviceDto {
  @ApiProperty({ example: '123456789012345', description: 'IMEI do rastreador (15 dígitos)' })
  @IsString()
  @Length(15, 15)
  @Matches(/^\d{15}$/, { message: 'IMEI deve conter exatamente 15 dígitos' })
  @IsValidImei()
  imei: string;

  @ApiProperty({ enum: ['GT06N', 'GT06', 'ST310U', 'ST340', 'ST350', 'J16', 'J16_PRO', 'CRX3', 'CRX3_NANO', 'CRX_PRO_4G', 'TK103', 'TK303', 'FMB920', 'FMB120', 'COBAN_GPS103', 'CONCOX_GT06N', 'SINOTRACK_ST901', 'SINOTRACK_ST905', 'OTHER'] })
  @IsString()
  model: string;

  @ApiPropertyOptional({ example: 'Concox' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  firmwareVersion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  vehicleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  chipId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  installedBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
