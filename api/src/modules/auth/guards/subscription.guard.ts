import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IncomingHttpHeaders } from 'http';
import { PrismaService } from '../../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { CurrentUserType } from '../decorators/current-user.decorator';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const ALLOWED_STATUSES = new Set(['TRIAL', 'ACTIVE']);

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      method: string;
      headers: IncomingHttpHeaders;
      user?: CurrentUserType;
    }>();

    if (!WRITE_METHODS.has(request.method)) return true;

    const companyId = request.user?.companyId;
    if (!companyId) {
      throw new ForbiddenException('Company context missing.');
    }

    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: { subscription_status: true },
    });

    if (!company) {
      throw new ForbiddenException('Company not found.');
    }

    if (!ALLOWED_STATUSES.has(company.subscription_status)) {
      throw new ForbiddenException({
        message: 'Your trial has ended. Please subscribe to continue using Vantro.',
        code: 'SUBSCRIPTION_LOCKED',
      });
    }

    return true;
  }
}
