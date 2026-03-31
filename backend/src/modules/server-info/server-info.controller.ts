import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ServerInfoService } from './server-info.service';

@ApiTags('Servidor')
@ApiBearerAuth()
@Controller('server')
export class ServerInfoController {
  constructor(private serverInfoService: ServerInfoService) {}

  @Get('info')
  @ApiOperation({ summary: 'Informações do servidor de rastreamento' })
  async getInfo() {
    return this.serverInfoService.getServerInfo();
  }
}
