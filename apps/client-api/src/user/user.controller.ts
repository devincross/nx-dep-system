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
} from '@nestjs/common';
import { CurrentTenant } from '../tenant/tenant.decorator.js';
import type { TenantContext } from '../tenant/tenant-context.service.js';
import { UserService } from './user.service.js';
import { CreateUserDto, UpdateUserDto } from './dto/index.js';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  findAll(@CurrentTenant() ctx: TenantContext) {
    return this.userService.findAll(ctx.db);
  }

  @Get(':id')
  findOne(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.userService.findOne(ctx.db, id);
  }

  @Post()
  create(
    @CurrentTenant() ctx: TenantContext,
    @Body() createUserDto: CreateUserDto
  ) {
    return this.userService.create(ctx.db, createUserDto);
  }

  @Put(':id')
  update(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto
  ) {
    return this.userService.update(ctx.db, id, updateUserDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.userService.remove(ctx.db, id);
  }
}

