import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { BillingService } from './billing.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('create-checkout-session')
  @Roles('OWNER')
  async createCheckoutSession(@CurrentUser() user: CurrentUserType) {
    if (!user.companyId) {
      throw new BadRequestException('Company context missing.');
    }
    return this.billingService.createCheckoutSession(user.companyId);
  }

  @Post('create-portal-session')
  @Roles('OWNER')
  async createPortalSession(@CurrentUser() user: CurrentUserType) {
    if (!user.companyId) {
      throw new BadRequestException('Company context missing.');
    }
    return this.billingService.createPortalSession(user.companyId);
  }

  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing raw body.');
    }
    await this.billingService.handleWebhook(rawBody, signature);
    return { received: true };
  }
}
