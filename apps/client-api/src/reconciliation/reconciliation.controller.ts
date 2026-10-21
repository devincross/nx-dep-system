import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Type, Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentTenant } from '../tenant/tenant.decorator.js';
import type { TenantContext } from '../tenant/tenant-context.service.js';
import { ReconciliationService } from './reconciliation.service.js';
import { DepActionsService } from '../orders/dep-actions.service.js';

// Global ValidationPipe runs whitelist + forbidNonWhitelisted + transform.

class CreateRunDto {
  @IsOptional()
  @IsString()
  note?: string;
}

class ListRunsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

class FindingsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsIn(['ok', 'warn', 'critical'])
  severity?: 'ok' | 'warn' | 'critical';

  @IsOptional()
  @IsIn(['none', 'ov_restore', 'investigate', 'not_in_apple', 'not_in_zoho'])
  recommendedAction?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  onlyMismatches?: boolean;

  @IsOptional()
  @IsString()
  search?: string;
}

class RestoreItemsDto {
  /** Must be explicitly false to actually write to order_items. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  dryRun?: boolean;

  /** Max orders to restore in this call (for a canary). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20000)
  limit?: number;
}

class RemediateDto {
  /** Must be explicitly false to actually push overrides to Apple. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  dryRun?: boolean;

  /** Max candidate orders to remediate in this call. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50000)
  limit?: number;

  /** Orders per Apple bulk-enroll request. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  chunkSize?: number;
}

@Controller('reconciliation')
@UseGuards(JwtAuthGuard)
export class ReconciliationController {
  constructor(
    private readonly reconciliationService: ReconciliationService,
    private readonly depActionsService: DepActionsService,
  ) {}

  /** Start a reconciliation run (the sync-worker picks it up). */
  @Post('runs')
  async createRun(@CurrentTenant() tenant: TenantContext, @Body() body: CreateRunDto) {
    return this.reconciliationService.createRun(tenant.db, { note: body.note });
  }

  /** Recent runs (history). */
  @Get('runs')
  async listRuns(@CurrentTenant() tenant: TenantContext, @Query() q: ListRunsDto) {
    return this.reconciliationService.listRuns(tenant.db, q.page ?? 1, q.limit ?? 20);
  }

  /** Run status + summary (the portal polls this). */
  @Get('runs/:runId')
  async getRun(@CurrentTenant() tenant: TenantContext, @Param('runId') runId: string) {
    return this.reconciliationService.getRun(tenant.db, runId);
  }

  /** Paginated, filterable findings (the report). */
  @Get('runs/:runId/findings')
  async listFindings(
    @CurrentTenant() tenant: TenantContext,
    @Param('runId') runId: string,
    @Query() q: FindingsQueryDto,
  ) {
    return this.reconciliationService.listFindings(tenant.db, runId, q);
  }

  /** Full report as a CSV download. */
  @Get('runs/:runId/findings.csv')
  async exportCsv(
    @CurrentTenant() tenant: TenantContext,
    @Param('runId') runId: string,
    @Res() res: Response,
  ) {
    const csv = await this.reconciliationService.exportCsv(tenant.db, runId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="reconciliation-${runId}.csv"`,
    );
    res.send(csv);
  }

  /** Resume a stalled/errored/paused run from its checkpoint. */
  @Post('runs/:runId/resume')
  async resume(@CurrentTenant() tenant: TenantContext, @Param('runId') runId: string) {
    return this.reconciliationService.resume(tenant.db, runId);
  }

  /** Cancel a run. */
  @Post('runs/:runId/cancel')
  async cancel(@CurrentTenant() tenant: TenantContext, @Param('runId') runId: string) {
    return this.reconciliationService.cancel(tenant.db, runId);
  }

  /**
   * Rebuild order_items from the run's captured Zoho lists (un-delete + insert +
   * is_dep) for orders whose devices were wrongly removed. Defaults to a dry-run
   * that reports exactly what would change per order. After executing, re-run the
   * report so these reclassify as ov_restore, then remediate.
   */
  @Post('runs/:runId/restore-items')
  async restoreItems(
    @CurrentTenant() tenant: TenantContext,
    @Param('runId') runId: string,
    @Body() body: RestoreItemsDto,
  ) {
    const dryRun = body.dryRun !== false; // default true — safe
    return this.reconciliationService.restoreItems(tenant.db, runId, { dryRun, limit: body.limit });
  }

  /**
   * Remediate ov_restore findings by batched DEP Override. Defaults to a
   * dry-run that returns exactly what would be sent; pass dryRun=false to
   * actually push to Apple.
   */
  @Post('runs/:runId/remediate')
  async remediate(
    @CurrentTenant() tenant: TenantContext,
    @Param('runId') runId: string,
    @Body() body: RemediateDto,
  ) {
    const dryRun = body.dryRun !== false; // default true — safe
    const candidates = await this.reconciliationService.getRemediationCandidates(
      tenant.db,
      runId,
      body.limit ?? 5000,
    );
    const result = await this.depActionsService.batchRemediate(
      tenant.db,
      candidates.map((c) => ({ orderId: c.orderId, action: c.action })),
      { dryRun, chunkSize: body.chunkSize },
    );
    return { runId, candidateCount: candidates.length, ...result };
  }
}
