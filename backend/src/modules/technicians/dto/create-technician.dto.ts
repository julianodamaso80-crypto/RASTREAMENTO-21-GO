import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

export class CreateTechnicianDto {
  @ApiProperty({ example: 'Iury Queiroz de Oliveira' })
  @IsString()
  @MinLength(3, { message: 'Nome precisa ter ao menos 3 caracteres' })
  name: string;

  @ApiProperty({ example: '137.915.777-35' })
  @IsString()
  @Matches(/^\D*(\d\D*){11}$/, { message: 'CPF precisa ter 11 dígitos' })
  cpf: string;

  @ApiPropertyOptional({ example: '21999998888' })
  @IsOptional()
  @IsString()
  @Length(10, 20, { message: 'Celular inválido' })
  phone?: string;

  @ApiPropertyOptional({ example: 'tecnico@21go.com.br' })
  @IsOptional()
  @IsEmail({}, { message: 'E-mail inválido' })
  email?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  canReceiveEquipment?: boolean;
}
