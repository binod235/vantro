import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { IsBoolean } from 'class-validator';
import { PaymentsService } from './payments.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';

class UpdateFeeSettingsDto {
  @IsBoolean()
  pass_fee_to_customer: boolean = false;
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // ── Owner: Stripe Connect ──────────────────────────────────────────────────

  @Post('connect/onboard')
  @Roles('OWNER')
  async onboard(@CurrentUser() user: CurrentUserType) {
    return this.payments.createConnectAccountLink(user.companyId!);
  }

  @Get('connect/status')
  @Roles('OWNER')
  async getStatus(@CurrentUser() user: CurrentUserType) {
    return this.payments.getConnectStatus(user.companyId!);
  }

  @Delete('connect')
  @Roles('OWNER')
  async disconnect(@CurrentUser() user: CurrentUserType) {
    await this.payments.disconnectStripe(user.companyId!);
    return { success: true };
  }

  @Patch('connect/fee-settings')
  @Roles('OWNER')
  async updateFeeSettings(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: UpdateFeeSettingsDto,
  ) {
    await this.payments.updateFeeSettings(
      user.companyId!,
      dto.pass_fee_to_customer,
    );
    return { success: true };
  }

  @Post('invoices/:id/checkout')
  @Roles('OWNER')
  async createCheckout(
    @CurrentUser() user: CurrentUserType,
    @Param('id') invoiceId: string,
  ) {
    return this.payments.createCheckoutSession(user.companyId!, invoiceId);
  }

  // ── Public ────────────────────────────────────────────────────────────────

  @Get('invoice/:token')
  @Public()
  async getPublicInvoice(@Param('token') token: string) {
    return this.payments.getPublicInvoice(token);
  }

  @Post('invoice/:token/mark-paid')
  @Public()
  @HttpCode(HttpStatus.OK)
  async markPaid(
    @Param('token') token: string,
    @Body() body: { method?: string; note?: string },
  ) {
    return this.payments.customerReportPayment(
      token,
      body.method ?? 'Bank transfer',
      body.note,
    );
  }

  @Post('invoice/:invoiceId/confirm-payment')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER')
  async confirmPayment(
    @CurrentUser() user: CurrentUserType,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.payments.confirmPaymentReport(user.companyId!, invoiceId);
  }

  @Post('invoice/:invoiceId/reject-payment')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER')
  async rejectPayment(
    @CurrentUser() user: CurrentUserType,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.payments.rejectPaymentReport(user.companyId!, invoiceId);
  }

  @Post('invoice/:token/checkout')
  @Public()
  async publicCheckout(@Param('token') token: string) {
    return this.payments.createPublicCheckoutSession(token);
  }

  // ── Webhook ───────────────────────────────────────────────────────────────

  @Post('webhook/stripe')
  @Public()
  @HttpCode(HttpStatus.OK)
  async stripeWebhook(
    @Headers('stripe-signature') sig: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    await this.payments.handlePaymentWebhook(sig, req.rawBody!);
    return { received: true };
  }
}
