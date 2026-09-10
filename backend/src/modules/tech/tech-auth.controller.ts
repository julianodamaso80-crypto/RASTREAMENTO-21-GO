import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { TechAuthService } from './tech-auth.service';
import { TechLoginDto } from './dto/tech-login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  TechForgotPasswordDto,
  TechResetPasswordDto,
} from './dto/forgot-password.dto';
import { ConfirmPhoneDto, StartPhoneDto } from '../auth/dto/phone.dto';
import { PhoneVerificationService } from '../auth/phone-verification.service';
import { TechnicianJwtGuard } from './guards/technician-jwt.guard';
import { CurrentTechnician } from './decorators/current-technician.decorator';

/**
 * Auth do PWA do técnico (/tecnico). Rotas marcadas @Public() pra pular o
 * JwtAuthGuard global (que valida User do painel); o TechnicianJwtGuard assume.
 */
@ApiTags('Técnico - Auth')
@Controller('tech/auth')
export class TechAuthController {
  constructor(
    private readonly service: TechAuthService,
    private readonly phoneVerification: PhoneVerificationService,
  ) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Login do técnico por CPF + senha — retorna JWT' })
  login(@Body() dto: TechLoginDto) {
    return this.service.login(dto);
  }

  @Public()
  @Post('forgot-password')
  @ApiOperation({
    summary: 'Envia código de 6 dígitos no WhatsApp cadastrado do técnico',
    description:
      'O técnico informa o WhatsApp; o código vai para esse número. Responde ' +
      'igual exista ou não o cadastro. Um envio a cada 2 minutos.',
  })
  forgotPassword(@Body() dto: TechForgotPasswordDto) {
    return this.service.forgotPassword(dto.phone);
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({ summary: 'Confere o código e grava a senha nova' })
  resetPassword(@Body() dto: TechResetPasswordDto) {
    return this.service.resetPasswordWithCode(
      dto.phone,
      dto.code,
      dto.newPassword,
    );
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
  @Post('phone/start')
  @ApiOperation({
    summary: 'Envia código para verificar o WhatsApp do técnico logado',
  })
  startPhone(
    @CurrentTechnician('id') id: string,
    @Body() dto: StartPhoneDto,
  ) {
    return this.phoneVerification.iniciar('technician', id, dto.phone);
  }

  @Public()
  @UseGuards(TechnicianJwtGuard)
  @ApiBearerAuth()
  @Post('phone/confirm')
  @ApiOperation({ summary: 'Confirma o código e marca o WhatsApp como verificado' })
  confirmPhone(
    @CurrentTechnician('id') id: string,
    @Body() dto: ConfirmPhoneDto,
  ) {
    return this.phoneVerification.confirmar('technician', id, dto.code);
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
