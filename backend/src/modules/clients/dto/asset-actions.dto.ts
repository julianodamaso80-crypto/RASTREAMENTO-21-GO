import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsUUID } from 'class-validator';

export class SetAppAccessDto {
  @ApiProperty({ description: 'true corta o acesso do cliente a este ativo' })
  @IsBoolean()
  blocked!: boolean;
}

export class SetFinancialStatusDto {
  @ApiProperty({ enum: ['ADIMPLENTE', 'INADIMPLENTE'] })
  @IsIn(['ADIMPLENTE', 'INADIMPLENTE'])
  status!: 'ADIMPLENTE' | 'INADIMPLENTE';
}

export class SetTechnicianDto {
  @ApiProperty({ description: 'Técnico que executou a instalação' })
  @IsUUID()
  technicianId!: string;
}
