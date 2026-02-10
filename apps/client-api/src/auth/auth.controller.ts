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
import { LoginDto, RegisterDto } from './dto/index.js';
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
   * Register endpoint - creates a new user and returns JWT token
   */
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @CurrentTenant() ctx: TenantContext,
    @Body() registerDto: RegisterDto
  ): Promise<{ access_token: string; user: SafeUser }> {
    const user = await this.authService.register(ctx.db, registerDto);

    // Generate token for the new user
    const payload = { sub: user.id, email: user.email, tenantId: ctx.tenant.id };

    return {
      access_token: this.authService['jwtService'].sign(payload),
      user,
    };
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

