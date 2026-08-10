import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Troca de senha do associado no app. No primeiro acesso a senha atual é o
 * próprio CPF; depois disto o CPF deixa de valer como senha.
 */
export class ChangeAssociatePasswordDto {
  @ApiProperty({ description: 'Senha atual (no primeiro acesso, o CPF)' })
  @IsString()
  @MinLength(6, { message: 'Informe a sua senha atual.' })
  @MaxLength(72)
  currentPassword!: string;

  @ApiProperty({ description: 'Nova senha escolhida pelo cliente' })
  @IsString()
  @MinLength(6, { message: 'A nova senha precisa ter ao menos 6 caracteres.' })
  @MaxLength(72)
  newPassword!: string;
}
