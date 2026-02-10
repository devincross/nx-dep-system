import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { orderStatusEnum } from '@org/database';
import { CreateOrderItemDto } from './create-order-item.dto.js';

export class CreateOrderDto {
  @IsUUID()
  @IsNotEmpty()
  orderId!: string;

  @IsInt()
  @IsNotEmpty()
  accountId!: number;

  @IsOptional()
  @IsString()
  externalOrderId?: string;

  @IsOptional()
  @IsString()
  externalAccountId?: string;

  @IsOptional()
  @IsString()
  externalOrderStatus?: string;

  @IsIn(orderStatusEnum)
  @IsNotEmpty()
  status!: 'waiting' | 'pending' | 'submitted' | 'complete' | 'error' | 'changes';

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
  @Type(() => CreateOrderItemDto)
  items?: CreateOrderItemDto[];
}

