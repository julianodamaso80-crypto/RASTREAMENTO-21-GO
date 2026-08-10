import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { AssociateAuthService } from './associate-auth.service';
import { AssociateLoginDto } from './dto/associate-login.dto';
import { ChangeAssociatePasswordDto } from './dto/change-password.dto';
import {
  AssociateForgotPasswordDto,
  AssociateResetPasswordDto,
} from './dto/forgot-password.dto';
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
  @Post('forgot-password')
  @ApiOperation({
    summary:
      'Envia código de 6 dígitos no WhatsApp cadastrado do associado',
    description:
      'Responde igual exista ou não o CPF — a rota não pode virar consulta ' +
      'de "esse CPF é cliente?". Um envio a cada 2 minutos por CPF.',
  })
  async forgotPassword(@Body() dto: AssociateForgotPasswordDto) {
    return this.service.forgotPassword(dto.cpf);
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({ summary: 'Confere o código e grava a senha nova' })
  async resetPassword(@Body() dto: AssociateResetPasswordDto) {
    return this.service.resetPasswordWithCode(
      dto.cpf,
      dto.code,
      dto.newPassword,
    );
  }

  @Public()
  @UseGuards(AssociateJwtGuard)
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Dados do associado logado' })
  async me(@CurrentAssociate('id') associateId: string) {
    return this.service.me(associateId);
  }

  @Public()
  @UseGuards(AssociateJwtGuard)
  @ApiBearerAuth()
  @Post('change-password')
  @ApiOperation({
    summary:
      'Troca a senha do associado — encerra o período em que o CPF vale como senha',
  })
  async changePassword(
    @CurrentAssociate('id') associateId: string,
    @Body() dto: ChangeAssociatePasswordDto,
  ) {
    return this.service.changePassword(
      associateId,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
