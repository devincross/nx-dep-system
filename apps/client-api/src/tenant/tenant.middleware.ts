import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantContextService } from './tenant-context.service.js';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenantContextService: TenantContextService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const hostname = req.hostname;

    try {
      const tenantContext =
        await this.tenantContextService.resolveByDomain(hostname);

      // Attach tenant context to request
      (req as any).tenantContext = tenantContext;

      next();
    } catch (error) {
      if (error instanceof NotFoundException) {
        res.status(404).json({
          statusCode: 404,
          message: `Tenant not found for domain: ${hostname}`,
          error: 'Not Found',
        });
      } else {
        throw error;
      }
    }
  }
}

