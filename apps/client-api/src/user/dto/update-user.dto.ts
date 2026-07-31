import {
  IsString,
  IsEmail,
  IsIn,
  IsOptional,
  IsBoolean,
  MinLength,
  MaxLength,
} from 'class-validator';
import { userRoleEnum, type UserRoleLevel } from '@org/database';

export class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  /** Set a new password (admin reset) */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(255)
  password?: string;

  @IsOptional()
  @IsIn(userRoleEnum)
  role?: UserRoleLevel;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  lastName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
