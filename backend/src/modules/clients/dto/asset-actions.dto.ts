import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SetAppAccessDto {
  @ApiProperty({ description: 'true corta o acesso do cliente a este ativo' })
  @IsBoolean()
  blocked!: boolean;
}

export class SetBlockerAccessDto {
  @ApiProperty({ description: 'true libera o associado a bloquear este ativo pelo app' })
  @IsBoolean()
  allowed!: boolean;
}

export class SetFinancialStatusDto {
  @ApiProperty({ enum: ['ADIMPLENTE', 'INADIMPLENTE'] })
  @IsIn(['ADIMPLENTE', 'INADIMPLENTE'])
  status!: 'ADIMPLENTE' | 'INADIMPLENTE';
}

export class SetTechnicianDto {
  @ApiProperty({ description: 'Técnico que executou a instalação' })
  @IsUUID()
  technicianId!: string;
}

export class SetInstallLocationDto {
  @ApiProperty({
    description: 'Onde o rastreador foi escondido no veículo. Vazio limpa o campo.',
    example: 'Embaixo do tanque',
  })
  @IsString()
  @MaxLength(160)
  installLocation!: string;
}

/**
 * Troca de titularidade: o veículo (e o rastreador que está nele) passa para o
 * associado que o SGA devolve para a placa. Mesma consulta do "Associar (SGA)".
 */
export class TransferOwnershipDto {
  @ApiProperty({
    example: 'ABC1D23',
    description: 'Placa (7) ou chassi (17) a consultar no SGA.',
  })
  @IsString()
  @IsNotEmpty({ message: 'Informe a placa ou o chassi.' })
  @MinLength(7, { message: 'Placa ou chassi inválido.' })
  @MaxLength(17)
  placa!: string;

  @ApiPropertyOptional({
    description:
      'Libera a troca mesmo com o veículo INATIVO no SGA. Só ADMIN/SUPER_ADMIN.',
  })
  @IsOptional()
  @IsBoolean()
  allowInactive?: boolean;
}
