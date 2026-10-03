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
  UseGuards,
} from '@nestjs/common';
import { CurrentTenant } from '../tenant/tenant.decorator.js';
import type { TenantContext } from '../tenant/tenant-context.service.js';
import { JwtAuthGuard, RolesGuard } from '../auth/guards/index.js';
import { Roles, CurrentUser } from '../auth/decorators/index.js';
import { UserService } from './user.service.js';
import type { SafeUser } from './user.service.js';
import { CreateUserDto, UpdateUserDto, UpdateMeDto } from './dto/index.js';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * Self-service: any authenticated user can update their own
   * name/email/password. Declared before ':id' routes so 'me' isn't
   * captured as an id.
   */
  @Put('me')
  updateMe(
    @CurrentTenant() ctx: TenantContext,
    @CurrentUser() user: SafeUser,
    @Body() updateMeDto: UpdateMeDto
  ) {
    return this.userService.updateMe(ctx.db, user.id, updateMeDto);
  }

  @Get()
  @Roles('admin')
  findAll(@CurrentTenant() ctx: TenantContext) {
    return this.userService.findAll(ctx.db);
  }

  @Get(':id')
  @Roles('admin')
  findOne(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.userService.findOne(ctx.db, id);
  }

  @Post()
  @Roles('admin')
  create(
    @CurrentTenant() ctx: TenantContext,
    @Body() createUserDto: CreateUserDto
  ) {
    return this.userService.create(ctx.db, createUserDto);
  }

  @Put(':id')
  @Roles('admin')
  update(
    @CurrentTenant() ctx: TenantContext,
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto
  ) {
    return this.userService.update(ctx.db, id, updateUserDto, user.id);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentTenant() ctx: TenantContext,
    @CurrentUser() user: SafeUser,
    @Param('id') id: string
  ) {
    return this.userService.remove(ctx.db, id, user.id);
  }
}
