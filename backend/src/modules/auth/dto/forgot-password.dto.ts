import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'usuario@exemplo.com' })
  @IsEmail({}, { message: 'Email inválido' })
  @IsNotEmpty()
  email!: string;
}

/** Pedido do código: a pessoa informa o WhatsApp cadastrado. */
export class ForgotPasswordWhatsappDto {
  @ApiProperty({ example: '(21) 99834-5046' })
  @IsString()
  @Length(10, 120, { message: 'Informe o WhatsApp com DDD, o CPF ou o e-mail.' })
  phone!: string;
}

/** Confirmação do código recebido no WhatsApp + senha nova. */
export class ResetPasswordWhatsappDto {
  @ApiProperty({ example: '(21) 99834-5046' })
  @IsString()
  @Length(10, 120, { message: 'Informe o WhatsApp com DDD, o CPF ou o e-mail.' })
  phone!: string;

  @ApiProperty({ example: '482913', description: 'Código de 6 dígitos' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'O código tem 6 números.' })
  code!: string;

  @ApiProperty({ description: 'Nova senha' })
  @IsString()
  @MinLength(6, { message: 'A nova senha precisa ter ao menos 6 caracteres.' })
  @MaxLength(72)
  newPassword!: string;
}

/** A pessoa logada troca a própria senha. */
export class ChangeOwnPasswordDto {
  @ApiProperty({ description: 'Senha nova', minLength: 6 })
  @IsString()
  @Length(6, 100, { message: 'A senha precisa ter ao menos 6 caracteres.' })
  newPassword!: string;

  @ApiProperty({ required: false, description: 'Senha atual (dispensada quando a senha é provisória)' })
  @IsOptional()
  @IsString()
  currentPassword?: string;
}
