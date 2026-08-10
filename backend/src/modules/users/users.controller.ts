import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '.prisma/client';
import { Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { MANAGEABLE_ROUTES } from '../../common/constants/manageable-routes';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

interface AuthenticatedRequest {
  tenantId: string;
  user: { id: string; role: Role };
}

@ApiTags('Usuários e acessos')
@ApiBearerAuth()
@Controller('users')
@UseGuards(RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class UsersController {
  constructor(private service: UsersService) {}

  @Get('routes')
  @ApiOperation({ summary: 'Catálogo de telas que podem ser liberadas' })
  routes() {
    return MANAGEABLE_ROUTES;
  }

  @Get()
  @ApiOperation({ summary: 'Lista os acessos do tenant' })
  findAll(
    @Query('search') search: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.findAll(req.tenantId, search);
  }

  @Post()
  @ApiOperation({
    summary: 'Cria acesso e devolve a senha em claro (uma única vez)',
  })
  create(@Body() dto: CreateUserDto, @Req() req: AuthenticatedRequest) {
    return this.service.create(req.tenantId, req.user, dto);
  }

  @Post(':id/reset-password')
  @ApiOperation({ summary: 'Gera uma senha nova e devolve em claro' })
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.resetPassword(id, req.tenantId, req.user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza nome, perfil, telas ou situação' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.update(id, req.tenantId, req.user, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove o acesso (soft delete)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.remove(id, req.tenantId, req.user);
  }
}
