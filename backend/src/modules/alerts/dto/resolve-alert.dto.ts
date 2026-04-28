import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResolveAlertDto {
  @ApiProperty({
    description: 'Observação da resolução (obrigatória)',
    minLength: 3,
    maxLength: 2000,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  resolution!: string;
}
