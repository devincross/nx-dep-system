import {
  IsString,
  IsBoolean,
  IsOptional,
  MaxLength,
  MinLength,
  Matches,
  IsJSON,
} from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'slug must be lowercase alphanumeric with hyphens only (e.g., my-tenant-slug)',
  })
  slug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'subdomain must be lowercase alphanumeric with hyphens only (e.g., acme)',
  })
  subdomain!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsJSON()
  metadata?: string;
}

