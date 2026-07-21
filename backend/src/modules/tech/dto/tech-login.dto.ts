import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';

export class TechLoginDto {
  @ApiProperty({ example: '137.915.777-35' })
  @IsString()
  @Matches(/^\D*(\d\D*){11}$/, { message: 'CPF precisa ter 11 dígitos' })
  cpf!: string;

  @ApiProperty()
  @IsString()
  @MinLength(6, { message: 'Senha precisa ter ao menos 6 caracteres' })
  password!: string;
}
