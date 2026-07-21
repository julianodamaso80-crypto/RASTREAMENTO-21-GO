import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Payload da finalização de instalação feita pelo técnico em campo. */
export class FinishInstallDto {
  @ApiProperty({ example: 'KQV7463', description: 'Placa a consultar no SGA' })
  @IsString()
  @MinLength(7, { message: 'Placa inválida.' })
  @MaxLength(10)
  placa!: string;

  @ApiProperty({ example: 'Painel — atrás do console central' })
  @IsString()
  @MinLength(3, { message: 'Informe o local de instalação.' })
  @MaxLength(160)
  installLocation!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
