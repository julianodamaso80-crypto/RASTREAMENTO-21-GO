import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

/** Número informado no popup obrigatório do login. */
export class StartPhoneDto {
  @ApiProperty({ example: '(21) 99999-8888' })
  @IsString()
  @Length(10, 20, { message: 'Informe um número de WhatsApp com DDD.' })
  phone!: string;
}

/** Código recebido no número informado. */
export class ConfirmPhoneDto {
  @ApiProperty({ example: '482913', description: 'Código de 6 dígitos' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'O código tem 6 números.' })
  code!: string;
}
