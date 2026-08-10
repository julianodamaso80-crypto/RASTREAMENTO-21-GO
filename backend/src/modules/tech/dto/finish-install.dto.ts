import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

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

  // --- Conferência de GPS (P0.2). Enviados pelo PWA a partir do
  // navigator.geolocation do celular do técnico. Servem pra provar que a
  // posição do rastreador bate com o lugar onde a instalação aconteceu. ---

  @ApiPropertyOptional({ description: 'Latitude do técnico no ato do aceite' })
  @IsOptional()
  @IsLatitude()
  techLat?: number;

  @ApiPropertyOptional({ description: 'Longitude do técnico no ato do aceite' })
  @IsOptional()
  @IsLongitude()
  techLng?: number;

  @ApiPropertyOptional({
    description:
      'Técnico confirmou finalizar mesmo com a conferência de GPS reprovada.',
  })
  @IsOptional()
  @IsBoolean()
  overrideGpsCheck?: boolean;
}
