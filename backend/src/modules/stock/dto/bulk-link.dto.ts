import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class BulkLinkRowDto {
  @IsInt()
  linha!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(17)
  placa!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(15)
  imei!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  tecnico!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  local!: string;
}

/**
 * Cada chamada leva poucas linhas porque cada uma consulta o SGA ao vivo: a tela
 * manda em pacotes e mostra o andamento, em vez de segurar uma requisição por
 * minutos (o proxy derruba).
 */
export class BulkLinkDto {
  @ApiProperty({ type: [BulkLinkRowDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(15, { message: 'Máximo de 15 linhas por chamada.' })
  @ValidateNested({ each: true })
  @Type(() => BulkLinkRowDto)
  linhas!: BulkLinkRowDto[];
}
