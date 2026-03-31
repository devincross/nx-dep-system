import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentTenant } from '../tenant/tenant.decorator.js';
import type { TenantContext } from '../tenant/tenant-context.service.js';
import { HistoricalImportService, ImportResult } from './historical-import.service.js';

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

interface ImportJob {
  status: 'running' | 'completed' | 'error';
  startedAt: string;
  completedAt?: string;
  result?: ImportResult;
  error?: string;
}

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class HistoricalImportController {
  private readonly logger = new Logger(HistoricalImportController.name);
  private readonly activeJobs = new Map<string, ImportJob>();

  constructor(
    private readonly historicalImportService: HistoricalImportService,
  ) {}

  /**
   * Start a historical import in the background.
   * Returns immediately with a job status that can be polled via GET.
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

    const tenantSlug = tenant.tenant.slug;

    // Prevent duplicate runs for the same tenant
    const existing = this.activeJobs.get(tenantSlug);
    if (existing?.status === 'running') {
      return {
        status: 'already_running',
        message: 'An import is already in progress for this account.',
        startedAt: existing.startedAt,
      };
    }

    const pageSize = Math.min(body.pageSize ?? 50, 200);
    const pageDelayMs = body.pageDelayMs ?? 2000;

    this.logger.log(
      `Historical import requested for tenant ${tenantSlug} from ${startDate.toISOString()}`,
    );

    const job: ImportJob = {
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    this.activeJobs.set(tenantSlug, job);

    // Fire and forget — run in the background
    this.historicalImportService
      .runImport(tenant, startDate, pageSize, pageDelayMs)
      .then((result) => {
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
        job.result = result;
        this.logger.log(`Historical import completed for ${tenantSlug}: ${result.processed} processed`);
      })
      .catch((error) => {
        job.status = 'error';
        job.completedAt = new Date().toISOString();
        job.error = error.message || 'Unknown error';
        this.logger.error(`Historical import failed for ${tenantSlug}: ${job.error}`);
      });

    return {
      status: 'started',
      message: 'Import started. Use GET /orders/historical-import/status to check progress.',
      startedAt: job.startedAt,
    };
  }

  /**
   * Check the status of the current/last historical import job.
   */
  @Get('historical-import/status')
  async getImportStatus(@CurrentTenant() tenant: TenantContext) {
    const job = this.activeJobs.get(tenant.tenant.slug);
    if (!job) {
      return { status: 'none', message: 'No import has been started.' };
    }
    return job;
  }
}
