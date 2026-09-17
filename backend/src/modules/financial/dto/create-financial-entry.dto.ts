import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FINANCIAL_STATUSES, type FinancialStatus } from '../financial.constants';

const aparar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class CreateFinancialEntryDto {
  @ApiProperty({ example: 'SRL5A25' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @MinLength(1, { message: 'Informe a placa' })
  @MaxLength(80)
  plate: string;

  @ApiProperty({ enum: FINANCIAL_STATUSES })
  @IsIn(FINANCIAL_STATUSES, { message: 'Situação financeira inválida' })
  status: FinancialStatus;

  @ApiPropertyOptional({ example: 9, description: '1 a 12' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number | null;

  @ApiPropertyOptional({ example: 'RAMON PONTES ARAUJO' })
  @IsOptional()
  @Transform(aparar)
  @IsString()
  @MaxLength(160)
  consultantName?: string | null;

  @ApiPropertyOptional({ example: '(21) 99834-5046' })
  @IsOptional()
  @Transform(aparar)
  @IsString()
  @MaxLength(40)
  consultantContact?: string | null;

  @ApiPropertyOptional({ example: 'E18236120202609021756s12ddb5002f' })
  @IsOptional()
  @Transform(aparar)
  @IsString()
  @MaxLength(160)
  receiptId?: string | null;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  plateCount?: number;
}
