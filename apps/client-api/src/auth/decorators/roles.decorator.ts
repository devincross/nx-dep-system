import { SetMetadata } from '@nestjs/common';
import type { UserRoleLevel } from '@org/database';

export const ROLES_KEY = 'roles';

/**
 * Restrict a route (or whole controller) to the given role levels.
 * Requires RolesGuard alongside JwtAuthGuard.
 */
export const Roles = (...roles: UserRoleLevel[]) => SetMetadata(ROLES_KEY, roles);
