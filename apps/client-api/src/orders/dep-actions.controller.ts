import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentTenant } from '../tenant/tenant.decorator.js';
import type { TenantContext } from '../tenant/tenant-context.service.js';
import { DepActionsService } from './dep-actions.service.js';

class DepEnrollDto {
  /** Override the customer ID (Apple org ID). Uses depAccountId from account if not provided */
  customerId?: string;
}

class DepReturnDto {
  /** Serial numbers to return. If empty, returns all devices on the order */
  serialNumbers?: string[];
}

class DepReconcileDto {
  /** Order IDs to reconcile. If empty, reconciles all orders on the current page */
  orderIds?: number[];
}

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class DepActionsController {
  constructor(private readonly depActionsService: DepActionsService) {}

  /**
   * Manually enroll an order's devices in Apple DEP (OR)
   */
  @Post(':id/dep/enroll')
  async enrollOrder(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: DepEnrollDto,
  ) {
    return this.depActionsService.enrollOrder(tenant.db, id, body.customerId);
  }

  /**
   * Manually return devices from Apple DEP (RE)
   */
  @Post(':id/dep/return')
  async returnDevices(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: DepReturnDto,
  ) {
    return this.depActionsService.returnDevices(tenant.db, id, body.serialNumbers);
  }

  /**
   * Manually void an order in Apple DEP (VD)
   */
  @Post(':id/dep/void')
  async voidOrder(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.depActionsService.voidOrder(tenant.db, id);
  }

  /**
   * Manually override an order in Apple DEP (OV)
   */
  @Post(':id/dep/override')
  async overrideOrder(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: DepEnrollDto,
  ) {
    return this.depActionsService.overrideOrder(tenant.db, id, body.customerId);
  }

  /**
   * Check DEP transaction status for an order
   */
  @Get(':id/dep/status')
  async getDepStatus(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.depActionsService.getDepStatus(tenant.db, id);
  }

  /**
   * Show order details from Apple DEP (what Apple has)
   */
  @Get(':id/dep/details')
  async showDepDetails(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.depActionsService.showDepOrderDetails(tenant.db, id);
  }

  /**
   * Check DEP enrollment status from Apple and update order/item statuses.
   * Queries Apple for enrolled devices and marks matching items as complete.
   * If all DEP items are enrolled, marks the order as complete.
   */
  @Post(':id/dep/check-status')
  async checkAndUpdateStatus(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.depActionsService.checkAndUpdateDepStatus(tenant.db, id);
  }

  /**
   * Check the status of the most recent in-flight DEP transaction for this order.
   * Calls Apple's check-transaction-status with deviceEnrollmentTransactionId —
   * the only way to see per-device errors after an async ingest.
   */
  @Post(':id/dep/check-transaction-status')
  async checkTransactionStatus(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.depActionsService.checkTransactionStatus(tenant.db, id);
  }

  /**
   * Reconcile orders across our DB, DEP, and ERP.
   * Returns side-by-side comparison for each order.
   */
  @Post('dep/reconcile')
  async reconcile(
    @CurrentTenant() tenant: TenantContext,
    @Body() body: DepReconcileDto,
  ) {
    return this.depActionsService.reconcileOrders(tenant, body.orderIds);
  }
}
