import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
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
  @ApiProperty({ example: 'ABC1D23', description: 'Placa a consultar no SGA' })
  @IsString()
  @IsNotEmpty({ message: 'Informe a placa.' })
  @MinLength(7, { message: 'Placa inválida.' })
  @MaxLength(10)
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

  @ApiProperty({ description: 'Local onde o rastreador foi instalado' })
  @IsString()
  @IsNotEmpty({ message: 'Informe o local de instalação do rastreador.' })
  @MaxLength(160)
  installLocation!: string;
}
