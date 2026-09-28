import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/** Preferências de push do associado. Campo ausente = não mexe. */
export class NotificationPrefsDto {
  @ApiPropertyOptional({ description: 'Avisar quando a chave for ligada' })
  @IsOptional()
  @IsBoolean()
  ignicaoLigada?: boolean;

  @ApiPropertyOptional({ description: 'Avisar quando a chave for desligada' })
  @IsOptional()
  @IsBoolean()
  ignicaoDesligada?: boolean;
}
