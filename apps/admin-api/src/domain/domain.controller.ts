import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DomainService } from './domain.service.js';
import { CreateDomainDto, UpdateDomainDto } from './dto/index.js';

@Controller('domains')
export class DomainController {
  constructor(private readonly domainService: DomainService) {}

  @Get()
  findAll(@Query('tenantId') tenantId?: string) {
    if (tenantId) {
      return this.domainService.findByTenantId(tenantId);
    }
    return this.domainService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.domainService.findOne(id);
  }

  @Post()
  create(@Body() createDomainDto: CreateDomainDto) {
    return this.domainService.create(createDomainDto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateDomainDto: UpdateDomainDto) {
    return this.domainService.update(id, updateDomainDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.domainService.remove(id);
  }

  @Post(':id/test-connection')
  testConnection(@Param('id') id: string) {
    return this.domainService.testConnection(id);
  }

  @Post(':id/provision')
  provisionDatabase(@Param('id') id: string) {
    return this.domainService.provisionDatabase(id);
  }
}

