import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '.prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { MANAGEABLE_ROUTE_KEYS } from '../../../common/constants/manageable-routes';

/** Perfis que podem ser concedidos pela tela de usuários. */
export const ASSIGNABLE_ROLES = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.OPERATOR,
  Role.VIEWER,
] as const;

export class CreateUserDto {
  @ApiProperty({ example: 'Maria Souza' })
  @IsString()
  @MinLength(3, { message: 'Informe o nome completo' })
  name!: string;

  @ApiProperty({ example: 'maria@21go.com.br' })
  @IsEmail({}, { message: 'E-mail inválido' })
  email!: string;

  @ApiProperty({ enum: ASSIGNABLE_ROLES, example: Role.OPERATOR })
  @IsEnum(Role)
  @IsIn(ASSIGNABLE_ROLES as unknown as Role[], { message: 'Perfil inválido' })
  role!: Role;

  @ApiPropertyOptional({
    description:
      'Telas liberadas. Vazio = todas as telas que o perfil já permite.',
    example: ['mapa', 'alertas', 'estoque'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(MANAGEABLE_ROUTE_KEYS, { each: true, message: 'Tela inválida' })
  allowedRoutes?: string[];
}
