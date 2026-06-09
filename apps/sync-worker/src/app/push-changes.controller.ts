import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PushChangesService } from './push-changes.service.js';
import {
  PushChangesRequestDto,
  DownstreamConfigDto,
  PushChangesResponseDto,
  PendingChangesResponseDto,
} from './dto/push-changes.dto.js';

/**
 * Controller for managing downstream push operations
 */
@Controller('push')
export class PushChangesController {
  private readonly logger = new Logger(PushChangesController.name);

  constructor(private readonly pushChangesService: PushChangesService) {}

  /**
   * Configure the downstream system
   * Must be called before pushing changes (unless already configured)
   * 
   * POST /push/configure
   */
  @Post('configure')
  @HttpCode(HttpStatus.OK)
  configure(@Body() config: DownstreamConfigDto) {
    this.pushChangesService.configureDownstream({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    });

    return {
      success: true,
      message: `Downstream configured: ${config.baseUrl}`,
    };
  }

  /**
   * Trigger a push of order changes to the downstream system
   * 
   * POST /push/changes
   * 
   * Body:
   * - tenantSlug?: string - Push for specific tenant (optional, defaults to all)
   * - batchSize?: number - Max orders to process (optional, defaults to 100)
   * - orderIds?: number[] - Only push specific orders (optional)
   */
  @Post('changes')
  @HttpCode(HttpStatus.OK)
  async pushChanges(
    @Body() request: PushChangesRequestDto
  ): Promise<PushChangesResponseDto> {
    this.logger.log('Push changes endpoint called');
    
    return this.pushChangesService.pushChanges(request);
  }

  /**
   * Get pending (unsynced) changes for a tenant
   * 
   * GET /push/pending?tenantSlug=xxx
   */
  @Get('pending')
  async getPendingChanges(
    @Query('tenantSlug') tenantSlug: string
  ): Promise<PendingChangesResponseDto> {
    if (!tenantSlug) {
      throw new Error('tenantSlug query parameter is required');
    }
    
    return this.pushChangesService.getPendingChanges(tenantSlug);
  }

  /**
   * Health check for push service
   * 
   * GET /push/health
   */
  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      service: 'push-changes',
      timestamp: new Date().toISOString(),
    };
  }
}

