import {
  Controller,
  Post,
  Body,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentTenant } from '../tenant/tenant.decorator.js';
import type { TenantContext } from '../tenant/tenant-context.service.js';
import { HistoricalImportService } from './historical-import.service.js';

class HistoricalImportDto {
  /** ISO date string — pull orders modified since this date */
  @IsString()
  @IsNotEmpty()
  startDate!: string;

  /** Records per page (default 50, max 200) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;

  /** Delay between pages in ms (default 2000) */
  @IsOptional()
  @IsInt()
  @Min(0)
  pageDelayMs?: number;
}

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class HistoricalImportController {
  private readonly logger = new Logger(HistoricalImportController.name);

  constructor(
    private readonly historicalImportService: HistoricalImportService,
  ) {}

  /**
   * Import historical orders from the configured ERP (NetSuite/Zoho).
   * Orders are imported WITHOUT creating change records, so they
   * will NOT be pushed to Apple DEP.
   */
  @Post('historical-import')
  async importHistorical(
    @CurrentTenant() tenant: TenantContext,
    @Body() body: HistoricalImportDto,
  ) {
    if (!body.startDate) {
      throw new BadRequestException('startDate is required (ISO format)');
    }

    const startDate = new Date(body.startDate);
    if (isNaN(startDate.getTime())) {
      throw new BadRequestException('startDate must be a valid date');
    }

    const pageSize = Math.min(body.pageSize ?? 50, 200);
    const pageDelayMs = body.pageDelayMs ?? 2000;

    this.logger.log(
      `Historical import requested for tenant ${tenant.tenant.slug} from ${startDate.toISOString()}`,
    );

    const result = await this.historicalImportService.runImport(
      tenant,
      startDate,
      pageSize,
      pageDelayMs,
    );

    return result;
  }
}
