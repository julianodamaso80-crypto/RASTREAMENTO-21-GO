import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Pedido do código de recuperação: WhatsApp (telas novas) ou CPF (app
 * publicado nas lojas, que ainda pede o documento). Um dos dois é obrigatório.
 */
export class AssociateForgotPasswordDto {
  @ApiPropertyOptional({ example: '08577590780' })
  @IsOptional()
  @IsString()
  // 11 (CPF cru) a 18 (CNPJ com máscara: 49.410.571/0001-93).
  @Length(11, 18, { message: 'Informe um CPF ou CNPJ válido.' })
  cpf?: string;

  @ApiPropertyOptional({ example: '(21) 99834-5046' })
  @IsOptional()
  @IsString()
  @Length(10, 20, { message: 'Informe o WhatsApp com DDD.' })
  phone?: string;
}

/** Confirmação do código + senha nova — pelo mesmo caminho do pedido. */
export class AssociateResetPasswordDto {
  @ApiPropertyOptional({ example: '08577590780' })
  @IsOptional()
  @IsString()
  // 11 (CPF cru) a 18 (CNPJ com máscara: 49.410.571/0001-93).
  @Length(11, 18, { message: 'Informe um CPF ou CNPJ válido.' })
  cpf?: string;

  @ApiPropertyOptional({ example: '(21) 99834-5046' })
  @IsOptional()
  @IsString()
  @Length(10, 20, { message: 'Informe o WhatsApp com DDD.' })
  phone?: string;

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
