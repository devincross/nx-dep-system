import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from './auth.service.js';

export interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env['JWT_SECRET'] || 'your-secret-key-change-in-production',
      passReqToCallback: true,
    });
  }

  async validate(request: any, payload: JwtPayload) {
    // Get tenant context from request (set by TenantMiddleware)
    const tenantContext = request.tenantContext;

    if (!tenantContext) {
      throw new UnauthorizedException('Tenant context not found');
    }

    // Verify the JWT tenant matches the request tenant
    if (payload.tenantId !== tenantContext.tenant.id) {
      throw new UnauthorizedException('Token not valid for this tenant');
    }

    try {
      const user = await this.authService.findById(tenantContext.db, payload.sub);

      if (!user) {
        throw new UnauthorizedException();
      }

      return user;
    } catch {
      throw new UnauthorizedException();
    }
  }
}

