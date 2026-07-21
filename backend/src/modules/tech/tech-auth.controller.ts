import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { TechAuthService } from './tech-auth.service';
import { TechLoginDto } from './dto/tech-login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { TechnicianJwtGuard } from './guards/technician-jwt.guard';
import { CurrentTechnician } from './decorators/current-technician.decorator';

/**
 * Auth do PWA do técnico (/tecnico). Rotas marcadas @Public() pra pular o
 * JwtAuthGuard global (que valida User do painel); o TechnicianJwtGuard assume.
 */
@ApiTags('Técnico - Auth')
@Controller('tech/auth')
export class TechAuthController {
  constructor(private readonly service: TechAuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Login do técnico por CPF + senha — retorna JWT' })
  login(@Body() dto: TechLoginDto) {
    return this.service.login(dto);
  }

  @Public()
  @UseGuards(TechnicianJwtGuard)
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Dados do técnico logado' })
  me(@CurrentTechnician('id') id: string) {
    return this.service.me(id);
  }

  @Public()
  @UseGuards(TechnicianJwtGuard)
  @ApiBearerAuth()
  @Post('change-password')
  @ApiOperation({ summary: 'Troca de senha (obrigatória no primeiro acesso)' })
  changePassword(
    @CurrentTechnician('id') id: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.service.changePassword(id, dto);
  }
}
