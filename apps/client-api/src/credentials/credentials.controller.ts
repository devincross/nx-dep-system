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
import { CredentialsService } from './credentials.service.js';
import { CreateCredentialDto, UpdateCredentialDto } from './dto/index.js';

@Controller('credentials')
@UseGuards(JwtAuthGuard)
export class CredentialsController {
  constructor(private readonly credentialsService: CredentialsService) {}

  @Get()
  async findAll(@CurrentTenant() tenant: TenantContext) {
    return this.credentialsService.findAll(tenant.db);
  }

  @Get('type/:type')
  async findByType(
    @CurrentTenant() tenant: TenantContext,
    @Param('type') type: 'dep' | 'zoho' | 'netsuite' | 'database' | 'ssl'
  ) {
    return this.credentialsService.findByType(tenant.db, type);
  }

  @Get(':id')
  async findOne(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.credentialsService.findOne(tenant.db, id);
  }

  @Post()
  async create(
    @CurrentTenant() tenant: TenantContext,
    @Body() createCredentialDto: CreateCredentialDto
  ) {
    return this.credentialsService.create(tenant.db, createCredentialDto);
  }

  @Put(':id')
  async update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCredentialDto: UpdateCredentialDto
  ) {
    return this.credentialsService.update(tenant.db, id, updateCredentialDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.credentialsService.remove(tenant.db, id);
  }

  @Post(':id/restore')
  async restore(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.credentialsService.restore(tenant.db, id);
  }

  @Delete(':id/permanent')
  @HttpCode(HttpStatus.NO_CONTENT)
  async hardDelete(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.credentialsService.hardDelete(tenant.db, id);
  }
}

