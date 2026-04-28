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
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Public, Roles, CurrentUser } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

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
