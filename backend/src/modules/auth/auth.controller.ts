import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { Role } from '.prisma/client';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import {
  ForgotPasswordDto,
  ForgotPasswordWhatsappDto,
  ResetPasswordWhatsappDto,
} from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ConfirmPhoneDto, StartPhoneDto } from './dto/phone.dto';
import { PhoneVerificationService } from './phone-verification.service';
import { Public, Roles, CurrentUser } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private phoneVerification: PhoneVerificationService,
  ) {}

  @Post('phone/start')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Envia código para verificar o WhatsApp do usuário logado',
    description:
      'O número fica pendente até o código conferir — número errado não ' +
      'substitui o que já estava cadastrado.',
  })
  startPhone(@CurrentUser('id') userId: string, @Body() dto: StartPhoneDto) {
    return this.phoneVerification.iniciar('user', userId, dto.phone);
  }

  @Post('phone/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirma o código e marca o WhatsApp como verificado' })
  confirmPhone(@CurrentUser('id') userId: string, @Body() dto: ConfirmPhoneDto) {
    return this.phoneVerification.confirmar('user', userId, dto.code);
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Login - retorna JWT' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('register')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Registrar novo usuário (apenas SUPER_ADMIN)' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Solicita email de redefinição de senha',
    description:
      'Sempre retorna 202 independente de o email existir (anti-enumeração). Rate limit: 3/email/hora, 10/IP/hora.',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)
        ?.split(',')[0]
        ?.trim() ||
      req.ip ||
      'unknown';
    await this.authService.forgotPassword(dto, ip);
    return {
      message: 'Se o email existir, você receberá instruções em breve.',
    };
  }

  @Public()
  @Post('forgot-password-whatsapp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Envia código de 6 dígitos no WhatsApp cadastrado do usuário',
    description:
      'A pessoa informa o WhatsApp; a conta é achada por ele e o código vai ' +
      'para esse número. Responde igual exista ou não (anti-enumeração). Um ' +
      'envio a cada 2 minutos. O código vale 15 minutos.',
  })
  forgotPasswordWhatsapp(@Body() dto: ForgotPasswordWhatsappDto) {
    return this.authService.forgotPasswordWhatsapp(dto.phone);
  }

  @Public()
  @Post('reset-password-whatsapp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confere o código do WhatsApp e grava a senha nova',
    description: 'Código single-use. Morre em 5 tentativas erradas.',
  })
  resetPasswordWhatsapp(@Body() dto: ResetPasswordWhatsappDto) {
    return this.authService.resetPasswordWhatsapp(
      dto.phone,
      dto.code,
      dto.newPassword,
    );
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Redefine senha com token recebido por email',
    description: 'Token é single-use. Exp 60 min. Invalida após sucesso.',
  })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return {
      message: 'Senha redefinida com sucesso. Faça login com a nova senha.',
    };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retorna dados do usuário logado' })
  async me(@CurrentUser('id') userId: string) {
    return this.authService.me(userId);
  }
}
