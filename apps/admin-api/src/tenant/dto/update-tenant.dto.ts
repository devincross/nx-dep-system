import {
  IsString,
  IsBoolean,
  IsOptional,
  MaxLength,
  MinLength,
  Matches,
  IsJSON,
} from 'class-validator';

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'slug must be lowercase alphanumeric with hyphens only (e.g., my-tenant-slug)',
  })
  slug?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  syncEnabled?: boolean;

  @IsOptional()
  @IsJSON()
  metadata?: string;
}

