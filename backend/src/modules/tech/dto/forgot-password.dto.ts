import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Pedido do código de recuperação do técnico — só o WhatsApp. */
export class TechForgotPasswordDto {
  @ApiProperty({ example: '(21) 99834-5046' })
  @IsString()
  @Length(10, 20, { message: 'Informe o WhatsApp com DDD.' })
  phone!: string;
}

/** Confirmação do código + senha nova. */
export class TechResetPasswordDto {
  @ApiProperty({ example: '(21) 99834-5046' })
  @IsString()
  @Length(10, 20, { message: 'Informe o WhatsApp com DDD.' })
  phone!: string;

  @ApiProperty({ example: '482913', description: 'Código de 6 dígitos' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'O código tem 6 números.' })
  code!: string;

  @ApiProperty({ description: 'Nova senha escolhida pelo técnico' })
  @IsString()
  @MinLength(6, { message: 'A nova senha precisa ter ao menos 6 caracteres.' })
  @MaxLength(72)
  newPassword!: string;
}
