import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Pedido do código de recuperação do técnico — só o CPF. */
export class TechForgotPasswordDto {
  @ApiProperty({ example: '12345678901' })
  @IsString()
  // 11 (CPF cru) a 14 (com máscara: 123.456.789-01).
  @Length(11, 14, { message: 'Informe um CPF válido.' })
  cpf!: string;
}

/** Confirmação do código + senha nova. */
export class TechResetPasswordDto {
  @ApiProperty({ example: '12345678901' })
  @IsString()
  @Length(11, 14, { message: 'Informe um CPF válido.' })
  cpf!: string;

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
