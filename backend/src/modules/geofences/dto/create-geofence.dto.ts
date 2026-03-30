import { IsString, IsOptional, IsEnum, IsObject, IsArray, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGeofenceDto {
  @ApiProperty({ example: 'Centro Goiânia' })
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: ['POLYGON', 'CIRCLE'] })
  @IsEnum(['POLYGON', 'CIRCLE'])
  type: 'POLYGON' | 'CIRCLE';

  @ApiProperty({
    description: 'Coordenadas: CIRCLE={latitude,longitude,radius} ou POLYGON=[[lng,lat],...]',
    example: { latitude: -16.6799, longitude: -49.2550, radius: 1000 },
  })
  @IsObject()
  coordinates: Record<string, unknown>;

  @ApiPropertyOptional({ example: '#3b82f6' })
  @IsOptional()
  @IsString()
  color?: string;
}

export class UpdateGeofenceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  coordinates?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  color?: string;
}

export class LinkVehiclesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  vehicleIds: string[];
}
