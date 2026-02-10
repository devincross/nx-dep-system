  import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { orderItemDepStatusEnum } from '@org/database';

export class CreateOrderItemDto {
  @IsOptional()
  @IsBoolean()
  isDep?: boolean;

  @IsString()
  @IsNotEmpty()
  serialNumber!: string;

  @IsIn(orderItemDepStatusEnum)
  @IsNotEmpty()
  depStatus!: 'pending' | 'submitted' | 'complete' | 'error' | 'changes';
}

