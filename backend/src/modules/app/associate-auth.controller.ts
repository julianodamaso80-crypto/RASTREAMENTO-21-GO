import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { AssociateAuthService } from './associate-auth.service';
import { AssociateLoginDto } from './dto/associate-login.dto';
import { AssociateJwtGuard } from './guards/associate-jwt.guard';
import { CurrentAssociate } from './decorators/current-associate.decorator';

/**
 * Auth do app do associado (cliente final). Rotas marcadas @Public() pra pular o
 * JwtAuthGuard global (que valida User do dashboard); o AssociateJwtGuard assume.
 */
@ApiTags('App - Auth Associado')
@Controller('app/auth')
export class AssociateAuthController {
  constructor(private readonly service: AssociateAuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Login do associado por CPF + senha — retorna JWT' })
  async login(@Body() dto: AssociateLoginDto) {
    return this.service.login(dto);
  }

  @Public()
  @UseGuards(AssociateJwtGuard)
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Dados do associado logado' })
  async me(@CurrentAssociate('id') associateId: string) {
    return this.service.me(associateId);
  }
}
