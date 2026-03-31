import { PartialType } from '@nestjs/swagger';
import { CreateChipDto } from './create-chip.dto';

export class UpdateChipDto extends PartialType(CreateChipDto) {}
