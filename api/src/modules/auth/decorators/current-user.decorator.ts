import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Session } from '../auth.config';

export type CurrentUserType = Session['user'];

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserType => {
    const request = ctx.switchToHttp().getRequest<{ user: CurrentUserType }>();
    return request.user;
  },
);
