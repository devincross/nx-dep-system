import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Query,
} from '@nestjs/common';
import { NetsuiteService } from './netsuite.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentTenant } from '../tenant/tenant.decorator.js';
import type { TenantContext } from '../tenant/tenant-context.service.js';

@Controller('netsuite')
@UseGuards(JwtAuthGuard)
export class NetsuiteController {
  constructor(private readonly netsuiteService: NetsuiteService) {}

  /**
   * Get the current NetSuite credential status (without sensitive data)
   */
  @Get('status')
  async getStatus(@CurrentTenant() tenant: TenantContext) {
    const credential = await this.netsuiteService.getNetsuiteCredential(tenant.db);
    return {
      id: credential.id,
      status: credential.status,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    };
  }

  /**
   * Test NetSuite connection
   */
  @Get('test')
  async testConnection(@CurrentTenant() tenant: TenantContext) {
    try {
      // Try to get credentials to verify they exist
      await this.netsuiteService.getNetsuiteCredential(tenant.db);
      return {
        success: true,
        message: 'NetSuite credentials are configured',
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Call the order script (GET)
   */
  @Get('orders')
  async getOrders(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: Record<string, unknown>
  ) {
    return this.netsuiteService.callOrderScript(tenant.db, 'GET', query);
  }

  /**
   * Call the order script (POST)
   */
  @Post('orders')
  async createOrder(
    @CurrentTenant() tenant: TenantContext,
    @Body() data: Record<string, unknown>
  ) {
    return this.netsuiteService.callOrderScript(tenant.db, 'POST', data);
  }

  /**
   * Call the account script (GET)
   */
  @Get('accounts')
  async getAccounts(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: Record<string, unknown>
  ) {
    return this.netsuiteService.callAccountScript(tenant.db, 'GET', query);
  }

  /**
   * Call the account script (POST)
   */
  @Post('accounts')
  async createAccount(
    @CurrentTenant() tenant: TenantContext,
    @Body() data: Record<string, unknown>
  ) {
    return this.netsuiteService.callAccountScript(tenant.db, 'POST', data);
  }

  /**
   * Generic RESTlet call endpoint
   */
  @Post('restlet')
  async callRestlet(
    @CurrentTenant() tenant: TenantContext,
    @Body() body: { scriptId: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE'; data?: Record<string, unknown> }
  ) {
    return this.netsuiteService.makeRequest(
      tenant.db,
      body.method,
      body.scriptId,
      body.data
    );
  }
}

