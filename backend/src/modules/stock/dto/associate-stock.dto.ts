import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Payload do "Associar cliente e ativo": vincula um rastreador do estoque a uma
 * placa/cliente do SGA. Técnico e local de instalação são obrigatórios — sem os
 * dois, o vínculo não é ativado.
 */
export class AssociateStockDto {
  @ApiProperty({
    example: 'ABC1D23',
    description:
      'Placa (7) ou chassi (17) a consultar no SGA. Moto nova ainda sem placa é vinculada pelo chassi.',
  })
  @IsString()
  @IsNotEmpty({ message: 'Informe a placa ou o chassi.' })
  @MinLength(7, { message: 'Placa ou chassi inválido.' })
  @MaxLength(17)
  placa!: string;

  @ApiProperty({ description: 'Nome do técnico que instalou o rastreador' })
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do técnico que instalou.' })
  @MaxLength(120)
  technicianName!: string;

  @ApiPropertyOptional({
    description:
      'Técnico cadastrado que executou. Preenchido pelo PWA /tecnico; ' +
      'no painel o campo é livre e este id fica vazio.',
  })
  @IsOptional()
  @IsUUID()
  technicianId?: string;

  @ApiPropertyOptional({
    description:
      'Libera o vínculo mesmo com o veículo/associado INATIVO no SGA. ' +
      'Só ADMIN/SUPER_ADMIN pode enviar — de qualquer outra origem o vínculo é recusado.',
  })
  @IsOptional()
  @IsBoolean()
  allowInactive?: boolean;

  @ApiProperty({ description: 'Local onde o rastreador foi instalado' })
  @IsString()
  @IsNotEmpty({ message: 'Informe o local de instalação do rastreador.' })
  @MaxLength(160)
  installLocation!: string;
}
