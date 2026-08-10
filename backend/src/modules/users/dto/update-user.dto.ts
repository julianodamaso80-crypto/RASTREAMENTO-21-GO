import { ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '.prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { MANAGEABLE_ROUTE_KEYS } from '../../../common/constants/manageable-routes';
import { ASSIGNABLE_ROLES } from './create-user.dto';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'Informe o nome completo' })
  name?: string;

  @ApiPropertyOptional({ enum: ASSIGNABLE_ROLES })
  @IsOptional()
  @IsEnum(Role)
  @IsIn(ASSIGNABLE_ROLES as unknown as Role[], { message: 'Perfil inválido' })
  role?: Role;

  @ApiPropertyOptional({ example: ['mapa', 'alertas'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(MANAGEABLE_ROUTE_KEYS, { each: true, message: 'Tela inválida' })
  allowedRoutes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
