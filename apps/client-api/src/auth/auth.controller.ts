import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import type { SafeUser } from './auth.service.js';
import { LoginDto } from './dto/index.js';
import { CurrentTenant } from '../tenant/tenant.decorator.js';
import type { TenantContext } from '../tenant/tenant-context.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { Public } from './decorators/public.decorator.js';
import { CurrentUser } from './decorators/current-user.decorator.js';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Login endpoint - returns JWT token and user info
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @CurrentTenant() ctx: TenantContext,
    @Body() loginDto: LoginDto
  ): Promise<{ access_token: string; user: SafeUser }> {
    const result = await this.authService.login(ctx.db, loginDto, ctx.tenant.id);

    // Update last login timestamp
    await this.authService.updateLastLogin(ctx.db, result.user.id);

    return result;
  }

  /**
   * Get current user profile
   */
  @Get('me')
  async getProfile(@CurrentUser() user: SafeUser): Promise<SafeUser> {
    return user;
  }

  /**
   * Validate token - returns the current user if token is valid
   */
  @Get('validate')
  async validateToken(@CurrentUser() user: SafeUser): Promise<{ valid: true; user: SafeUser }> {
    return { valid: true, user };
  }
}

