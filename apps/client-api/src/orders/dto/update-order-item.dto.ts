import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { orderItemDepStatusEnum } from '@org/database';

export class UpdateOrderItemDto {
  @IsOptional()
  @IsBoolean()
  isDep?: boolean;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsIn(orderItemDepStatusEnum)
  depStatus?: 'pending' | 'submitted' | 'complete' | 'error' | 'changes';
}

