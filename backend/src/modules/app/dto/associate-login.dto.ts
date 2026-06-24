import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AssociateLoginDto {
  @ApiProperty({ example: '12345678900', description: 'CPF (com ou sem máscara)' })
  @IsString()
  cpf!: string;

  @ApiProperty({ example: 'senha123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password!: string;
}
