import {
  IsString,
  IsBoolean,
  IsOptional,
  IsInt,
  MaxLength,
  MinLength,
  Min,
  Max,
  Matches,
} from 'class-validator';

export class UpdateDomainDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9-_.]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/, {
    message: 'domain must be a valid domain name format',
  })
  domain?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  // Database connection details
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  dbHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  dbPort?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  dbName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  dbUser?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  dbPassword?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

