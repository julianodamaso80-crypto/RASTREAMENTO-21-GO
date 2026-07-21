import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { TechnicianJwtGuard } from './guards/technician-jwt.guard';
import {
  CurrentTechnician,
  type TechnicianContext,
} from './decorators/current-technician.decorator';
import { TechFieldService } from './tech-field.service';
import { FinishInstallDto } from './dto/finish-install.dto';

/** Rotas de campo do técnico. Tudo escopado ao técnico logado + tenant dele. */
@ApiTags('Técnico - Campo')
@Public()
@UseGuards(TechnicianJwtGuard)
@ApiBearerAuth()
@Controller('tech')
export class TechFieldController {
  constructor(private readonly service: TechFieldService) {}

  @Get('assignments')
  @ApiOperation({ summary: 'Equipamentos reservados pro técnico logado' })
  assignments(@CurrentTechnician() tech: TechnicianContext) {
    return this.service.assignments(tech.id, tech.tenantId);
  }

  @Get('lookup')
  @ApiOperation({ summary: 'Consulta a placa no SGA' })
  lookup(@Query('placa') placa: string) {
    return this.service.lookup(placa);
  }

  @Get('assignments/:id/signal')
  @ApiOperation({ summary: 'O rastreador já reportou posição?' })
  signal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTechnician() tech: TechnicianContext,
  ) {
    return this.service.signal(id, tech.id, tech.tenantId);
  }

  @Post('assignments/:id/finish')
  @ApiOperation({
    summary: 'Finaliza a instalação: cria cliente, veículo e rastreador',
  })
  finish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FinishInstallDto,
    @CurrentTechnician() tech: TechnicianContext,
  ) {
    return this.service.finish(id, tech.id, tech.name, tech.tenantId, dto);
  }
}
