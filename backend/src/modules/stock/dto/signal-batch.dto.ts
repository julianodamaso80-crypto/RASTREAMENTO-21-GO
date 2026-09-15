import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsUUID,
} from 'class-validator';

/**
 * Conferência em pacote. O teto de 50 é operacional: acima disso não cabe na
 * tela nem faz sentido acompanhar ao vivo, e cada item custa uma consulta ao
 * servidor GPS a cada 10 segundos.
 */
export class SignalBatchDto {
  @ApiProperty({ type: [String], description: 'IDs dos itens de estoque' })
  @IsArray()
  @ArrayNotEmpty({ message: 'Selecione ao menos um equipamento.' })
  @ArrayMaxSize(50, { message: 'Máximo de 50 equipamentos por conferência.' })
  @IsUUID('4', { each: true })
  stockItemIds!: string[];
}
