import {
  IsString,
  IsEmail,
  IsOptional,
  MaxLength,
  MinLength,
  IsIn,
} from 'class-validator';
import { userStatusEnum } from '@org/database';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(255)
  password?: string;

  @IsOptional()
  @IsIn(userStatusEnum)
  status?: 'active' | 'inactive' | 'suspended';
}

