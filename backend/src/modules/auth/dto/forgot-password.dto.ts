import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
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
  @Length(10, 20, { message: 'Informe o WhatsApp com DDD.' })
  phone!: string;
}

/** Confirmação do código recebido no WhatsApp + senha nova. */
export class ResetPasswordWhatsappDto {
  @ApiProperty({ example: '(21) 99834-5046' })
  @IsString()
  @Length(10, 20, { message: 'Informe o WhatsApp com DDD.' })
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
