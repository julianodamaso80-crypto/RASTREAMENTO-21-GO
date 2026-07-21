import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Reserva de equipamentos pro login do técnico. Sempre em lote — marcar um único
 * checkbox na tela é só um lote de tamanho 1.
 */
export class AssignStockDto {
  @ApiProperty({ type: [String], description: 'IDs dos itens de estoque' })
  @IsArray()
  @ArrayNotEmpty({ message: 'Selecione ao menos um equipamento.' })
  @ArrayMaxSize(500, { message: 'Máximo de 500 equipamentos por vez.' })
  @IsUUID('4', { each: true })
  stockItemIds!: string[];

  @ApiPropertyOptional({
    description: 'Técnico que recebe. Não usado no unassign.',
  })
  @IsOptional()
  @IsUUID()
  technicianId?: string;
}
