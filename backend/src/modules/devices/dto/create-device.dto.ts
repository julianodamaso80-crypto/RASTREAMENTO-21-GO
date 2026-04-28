import { IsString, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const BLE_MODELS = ['BLE_KTAG', 'BLE_REDTAG', 'BLE_AIRTAG_GENERIC'];

// Luhn check for IMEI validation (rastreadores GPS)
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
        validate(value: unknown, args) {
          // BLE TAGs não usam IMEI Luhn — qualquer string identificadora vale
          const obj = args?.object as { model?: string };
          if (obj?.model && BLE_MODELS.includes(obj.model)) {
            return typeof value === 'string' && value.length > 0;
          }
          return typeof value === 'string' && isValidImei(value);
        },
        defaultMessage(args) {
          const obj = args?.object as { model?: string };
          if (obj?.model && BLE_MODELS.includes(obj.model)) {
            return 'Identificador da TAG é obrigatório';
          }
          return 'IMEI inválido (deve ter 15 dígitos e passar na validação Luhn)';
        },
      },
    });
  };
}

export class CreateDeviceDto {
  @ApiProperty({
    example: '123456789012345',
    description:
      'Para GPS: IMEI do rastreador (15 dígitos com Luhn). Para BLE TAG: identificador único (ex: serial da K-Tag).',
  })
  @IsString()
  @IsValidImei()
  imei: string;

  @ApiProperty({
    enum: [
      'GT06N',
      'GT06',
      'ST310U',
      'ST340',
      'ST350',
      'J16',
      'J16_PRO',
      'CRX3',
      'CRX3_NANO',
      'CRX_PRO_4G',
      'TK103',
      'TK303',
      'FMB920',
      'FMB120',
      'COBAN_GPS103',
      'CONCOX_GT06N',
      'SINOTRACK_ST901',
      'SINOTRACK_ST905',
      'BLE_KTAG',
      'BLE_REDTAG',
      'BLE_AIRTAG_GENERIC',
      'OTHER',
    ],
  })
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
