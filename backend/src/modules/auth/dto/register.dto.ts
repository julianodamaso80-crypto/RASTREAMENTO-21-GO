import { IsEmail, IsEnum, IsString, IsUUID, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Role } from '.prisma/client';

export class RegisterDto {
  @ApiProperty({ example: 'usuario@empresa.com.br' })
  @IsEmail({}, { message: 'Email inválido' })
  email: string;

  @ApiProperty({ example: 'senha123' })
  @IsString()
  @MinLength(6, { message: 'Senha deve ter no mínimo 6 caracteres' })
  password: string;

  @ApiProperty({ example: 'João Silva' })
  @IsString()
  name: string;

  @ApiProperty({ enum: Role, example: Role.OPERATOR })
  @IsEnum(Role, { message: 'Role inválida' })
  role: Role;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID('4', { message: 'ID da tenant inválido' })
  tenantId: string;
}
