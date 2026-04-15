import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenant } from '../tenant/tenant.decorator.js';
import type { TenantContext } from '../tenant/tenant-context.service.js';
import { JwtAuthGuard } from '../auth/guards/index.js';
import { OrdersService } from './orders.service.js';
import {
  CreateOrderDto,
  UpdateOrderDto,
  CreateOrderItemDto,
  UpdateOrderItemDto,
} from './dto/index.js';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  async findAll(@CurrentTenant() tenant: TenantContext) {
    return this.ordersService.findAll(tenant.db);
  }

  @Get('account/:accountId')
  async findByAccountId(
    @CurrentTenant() tenant: TenantContext,
    @Param('accountId', ParseIntPipe) accountId: number
  ) {
    return this.ordersService.findByAccountId(tenant.db, accountId);
  }

  @Get(':id')
  async findOne(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.ordersService.findOne(tenant.db, id);
  }

  @Post()
  async create(
    @CurrentTenant() tenant: TenantContext,
    @Body() createOrderDto: CreateOrderDto
  ) {
    return this.ordersService.create(tenant.db, createOrderDto);
  }

  @Put(':id')
  async update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() updateOrderDto: UpdateOrderDto
  ) {
    return this.ordersService.update(tenant.db, id, updateOrderDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.ordersService.remove(tenant.db, id);
  }

  // Order Items endpoints
  @Post(':orderId/items')
  async addOrderItem(
    @CurrentTenant() tenant: TenantContext,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() createOrderItemDto: CreateOrderItemDto
  ) {
    const items = await this.ordersService.createOrderItems(tenant.db, orderId, [
      createOrderItemDto,
    ]);
    return items[0];
  }

  @Put(':orderId/items/:itemId')
  async updateOrderItem(
    @CurrentTenant() tenant: TenantContext,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() updateOrderItemDto: UpdateOrderItemDto
  ) {
    return this.ordersService.updateOrderItem(
      tenant.db,
      orderId,
      itemId,
      updateOrderItemDto
    );
  }

  @Delete(':orderId/items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeOrderItem(
    @CurrentTenant() tenant: TenantContext,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Param('itemId', ParseIntPipe) itemId: number
  ) {
    return this.ordersService.removeOrderItem(tenant.db, orderId, itemId);
  }

  @Post(':orderId/items/:itemId/restore')
  async restoreOrderItem(
    @CurrentTenant() tenant: TenantContext,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Param('itemId', ParseIntPipe) itemId: number
  ) {
    return this.ordersService.restoreOrderItem(tenant.db, orderId, itemId);
  }
}

