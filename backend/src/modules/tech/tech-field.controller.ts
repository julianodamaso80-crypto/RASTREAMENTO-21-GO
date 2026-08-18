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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { TechnicianJwtGuard } from './guards/technician-jwt.guard';
import {
  CurrentTechnician,
  type TechnicianContext,
} from './decorators/current-technician.decorator';
import { TechFieldService } from './tech-field.service';
import { RoutesService } from '../installation-pendings/routes.service';
import { FinishInstallDto } from './dto/finish-install.dto';

/** Rotas de campo do técnico. Tudo escopado ao técnico logado + tenant dele. */
@ApiTags('Técnico - Campo')
@Public()
@UseGuards(TechnicianJwtGuard)
@ApiBearerAuth()
@Controller('tech')
export class TechFieldController {
  constructor(
    private readonly service: TechFieldService,
    private readonly routes: RoutesService,
  ) {}

  @Get('assignments')
  @ApiOperation({ summary: 'Equipamentos reservados pro técnico logado' })
  assignments(@CurrentTechnician() tech: TechnicianContext) {
    return this.service.assignments(tech.id, tech.tenantId);
  }

  @Get('route')
  @ApiOperation({ summary: 'Rota de instalação do dia enviada pro técnico' })
  route(@CurrentTechnician() tech: TechnicianContext) {
    return this.routes.currentRouteForTechnician(tech.tenantId, tech.id);
  }

  @Get('lookup')
  @ApiOperation({ summary: 'Consulta a placa (ou chassi) no SGA' })
  lookup(
    @Query('placa') placa: string,
    @CurrentTechnician() tech: TechnicianContext,
  ) {
    return this.service.lookup(tech.tenantId, placa);
  }

  @Get('assignments/:id/signal')
  @ApiOperation({
    summary:
      'Conferência de GPS do rastreador: fix válido, recente e perto do técnico',
  })
  @ApiQuery({ name: 'lat', required: false, description: 'Latitude do técnico' })
  @ApiQuery({ name: 'lng', required: false, description: 'Longitude do técnico' })
  signal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTechnician() tech: TechnicianContext,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ) {
    // Coordenada do técnico vem da query como texto; só entra se for número.
    const num = (v?: string) => {
      const n = Number(v);
      return v != null && v !== '' && Number.isFinite(n) ? n : undefined;
    };
    return this.service.signal(id, tech.id, tech.tenantId, num(lat), num(lng));
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
