import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

/** Pedido do código de recuperação — só o CPF. */
export class AssociateForgotPasswordDto {
  @ApiProperty({ example: '08577590780' })
  @IsString()
  // 11 (CPF cru) a 18 (CNPJ com máscara: 49.410.571/0001-93).
  @Length(11, 18, { message: 'Informe um CPF ou CNPJ válido.' })
  cpf!: string;
}

/** Confirmação do código + senha nova. */
export class AssociateResetPasswordDto {
  @ApiProperty({ example: '08577590780' })
  @IsString()
  // 11 (CPF cru) a 18 (CNPJ com máscara: 49.410.571/0001-93).
  @Length(11, 18, { message: 'Informe um CPF ou CNPJ válido.' })
  cpf!: string;

  @ApiProperty({ example: '482913', description: 'Código de 6 dígitos' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'O código tem 6 números.' })
  code!: string;

  @ApiProperty({ description: 'Nova senha escolhida pelo cliente' })
  @IsString()
  @MinLength(6, { message: 'A nova senha precisa ter ao menos 6 caracteres.' })
  @MaxLength(72)
  newPassword!: string;
}
