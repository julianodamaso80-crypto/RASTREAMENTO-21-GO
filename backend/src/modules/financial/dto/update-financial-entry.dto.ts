import { PartialType } from '@nestjs/swagger';
import { CreateFinancialEntryDto } from './create-financial-entry.dto';

export class UpdateFinancialEntryDto extends PartialType(CreateFinancialEntryDto) {}
