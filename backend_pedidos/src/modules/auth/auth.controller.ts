import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { TenantId } from '../../common/decorators/tenant-id.decorator';

@UseGuards(ThrottlerGuard)
@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('auth/register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post(':tenant/auth/login')
  login(@Body() dto: LoginDto, @TenantId() tenantId: string) {
    return this.authService.login(dto, tenantId);
  }
}
