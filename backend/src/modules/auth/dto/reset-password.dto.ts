import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token recebido por email (query param do link)' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: 'novaSenha123', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Senha deve ter ao menos 8 caracteres' })
  password!: string;
}
