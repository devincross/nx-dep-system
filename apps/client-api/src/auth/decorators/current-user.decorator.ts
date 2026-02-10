import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SafeUser } from '../auth.service.js';

/**
 * Parameter decorator to extract the current authenticated user from the request.
 * The user is set by the JwtStrategy after successful authentication.
 *
 * Usage:
 * @Get('me')
 * @UseGuards(JwtAuthGuard)
 * getProfile(@CurrentUser() user: SafeUser) {
 *   return user;
 * }
 *
 * You can also get a specific property:
 * @Get('my-email')
 * @UseGuards(JwtAuthGuard)
 * getEmail(@CurrentUser('email') email: string) {
 *   return email;
 * }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof SafeUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return null;
    }

    return data ? user[data] : user;
  }
);

