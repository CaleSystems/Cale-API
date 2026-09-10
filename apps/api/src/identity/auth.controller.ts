import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AUTH_THROTTLE } from '../throttle.tiers';
import { LoginDto, RefreshDto } from './auth.dto';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthenticatedUser } from './jwt.strategy';

@Controller('auth')
@Throttle(AUTH_THROTTLE)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.staffId, dto.branchId, dto.pin);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async logout(@Req() req: { user: AuthenticatedUser }): Promise<void> {
    await this.auth.logout(req.user.sessionId);
  }
}
