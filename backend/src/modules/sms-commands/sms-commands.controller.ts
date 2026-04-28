import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '.prisma/client';
import { Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { SmsCommandsService } from './sms-commands.service';
import { IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class SendCommandDto {
  @ApiProperty({ example: 'SET_SERVER_IP', description: 'Tipo do comando' })
  @IsString()
  type: string;

  @ApiPropertyOptional({
    description: 'Comando customizado (substitui template)',
  })
  @IsOptional()
  @IsString()
  customCommand?: string;
}

interface AuthenticatedRequest {
  tenantId: string;
  user: { id: string; role: string };
}

@ApiTags('Comandos SMS')
@ApiBearerAuth()
@Controller('devices/:deviceId/commands')
export class SmsCommandsController {
  constructor(private smsCommandsService: SmsCommandsService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Gerar comandos SMS de configuração (sem enviar)' })
  async generate(
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.smsCommandsService.generateCommands(deviceId, req.tenantId);
  }

  @Post('send')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({ summary: 'Enviar comando SMS ao dispositivo' })
  async send(
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: SendCommandDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.smsCommandsService.sendCommand(
      deviceId,
      req.tenantId,
      req.user.id,
      req.user.role,
      dto.type,
      dto.customCommand,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Histórico de comandos do dispositivo' })
  async history(
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Query() query: PaginationQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.smsCommandsService.getHistory(deviceId, req.tenantId, query);
  }
}
