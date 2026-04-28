import {
  Controller,
  Post,
  Get,
  Query,
  Req,
  Inject,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { Role } from '.prisma/client';
import { Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { HINOVA_CLIENT, type IHinovaClient } from './hinova.interface';
import { HinovaSyncService } from './hinova-sync.service';

interface AuthenticatedRequest {
  tenantId: string;
  user: { id: string; tenantId: string; role: string };
}

@ApiTags('Hinova SGA')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
@Controller('hinova')
export class HinovaController {
  constructor(
    @Inject(HINOVA_CLIENT) private hinovaClient: IHinovaClient,
    private syncService: HinovaSyncService,
  ) {}

  @Post('sync')
  @ApiOperation({ summary: 'Disparar sincronização manual com Hinova SGA' })
  async sync(@Req() req: AuthenticatedRequest) {
    return this.syncService.sync(req.tenantId);
  }

  @Get('sync/status')
  @ApiOperation({ summary: 'Status da última sincronização' })
  async syncStatus() {
    return this.syncService.getStatus();
  }

  @Get('vehicles')
  @ApiOperation({ summary: 'Listar veículos direto da API Hinova' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'perPage', required: false })
  async listVehicles(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.hinovaClient.listVehicles(
      parseInt(page || '1'),
      parseInt(perPage || '20'),
    );
  }

  @Get('vehicles/search')
  @ApiOperation({ summary: 'Buscar veículo na Hinova por placa' })
  @ApiQuery({ name: 'plate', required: true })
  async searchByPlate(@Query('plate') plate: string) {
    return this.hinovaClient.searchByPlate(plate);
  }
}
