import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTenantDto {
  @ApiProperty({ example: '21 GO Rastreamento' })
  @IsString()
  name: string;

  @ApiProperty({ example: '21-go-rastreamento' })
  @IsString()
  slug: string;

  @ApiPropertyOptional({ example: '12345678000190', description: 'CNPJ' })
  @IsOptional()
  @IsString()
  document?: string;

  @ApiPropertyOptional({ example: 'https://example.com/logo.png' })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional({ example: '#10b981' })
  @IsOptional()
  @IsString()
  primaryColor?: string;
}
