import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { randomBytes } from 'crypto';
import { ChangeOwnPasswordDto, LoginDto } from '../dto';
import { PlatformService } from '../platform.service';
import { clearAuthCookie, setAuthCookie, setCsrfCookie } from '../security/cookies';
import { JwtAuthGuard } from '../security/guards';
import { UserEntity } from '../types';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly platformService: PlatformService) {}

  @Post('login')
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.platformService.login(body.email, body.password);
    setAuthCookie(response, result.accessToken);
    const csrfToken = randomBytes(32).toString('base64url');
    setCsrfCookie(response, csrfToken);
    return { user: result.user, accessToken: result.accessToken, csrfToken };
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@Req() request: { user: UserEntity }) {
    return this.platformService.me(request.user);
  }

  @Post('change-password')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  changePassword(@Req() request: { user: UserEntity }, @Body() body: ChangeOwnPasswordDto) {
    return this.platformService.changeOwnPassword(request.user, body.currentPassword, body.newPassword);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) response: Response) {
    clearAuthCookie(response);
    return { success: true };
  }
}
