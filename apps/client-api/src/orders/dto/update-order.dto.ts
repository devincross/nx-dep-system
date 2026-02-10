import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { orderStatusEnum } from '@org/database';
import { UpdateOrderItemDto } from './update-order-item.dto.js';

export class UpdateOrderDto {
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsInt()
  accountId?: number;

  @IsOptional()
  @IsString()
  externalOrderId?: string;

  @IsOptional()
  @IsString()
  externalAccountId?: string;

  @IsOptional()
  @IsString()
  externalOrderStatus?: string;

  @IsOptional()
  @IsIn(orderStatusEnum)
  status?: 'waiting' | 'pending' | 'submitted' | 'complete' | 'error' | 'changes';

  @IsOptional()
  @IsString()
  po?: string;

  @IsOptional()
  @IsString()
  changes?: string;

  @IsOptional()
  @IsUUID()
  depOrderId?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateOrderItemDto)
  items?: UpdateOrderItemDto[];
}

