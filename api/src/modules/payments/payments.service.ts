import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { CommsService }  from '../comms/comms.service';
import { randomUUID } from 'crypto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comms: CommsService,
  ) {}

  private get stripe(): Stripe {
    return new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2025-02-24.acacia',
    });
  }

  // ── Owner: Stripe Connect onboarding ──────────────────────────────────────

  async createConnectAccountLink(companyId: string): Promise<{ url: string }> {
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
    });
    if (!company) throw new NotFoundException('Company not found');

    let connectId = company.stripe_connect_id;

    if (!connectId) {
      const account = await this.stripe.accounts.create({
        type: 'express',
        country: 'GB',
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: { name: company.name },
      });
      connectId = account.id;
      await this.prisma.client.company.update({
        where: { id: companyId },
        data: { stripe_connect_id: connectId },
      });
    }

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3001';
    const link = await this.stripe.accountLinks.create({
      account: connectId,
      refresh_url: `${frontendUrl}/dashboard/settings?tab=payments&stripe=refresh`,
      return_url: `${frontendUrl}/dashboard/settings?tab=payments&stripe=success`,
      type: 'account_onboarding',
    });

    return { url: link.url };
  }

  async getConnectStatus(companyId: string): Promise<{
    connected: boolean;
    onboarded: boolean;
    pass_fee_to_customer: boolean;
    account_id: string | null;
  }> {
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
    });
    if (!company) throw new NotFoundException('Company not found');

    if (company.stripe_connect_id && !company.stripe_connect_onboarded) {
      try {
        const account = await this.stripe.accounts.retrieve(
          company.stripe_connect_id,
        );
        if (account.details_submitted && account.charges_enabled) {
          await this.prisma.client.company.update({
            where: { id: companyId },
            data: {
              stripe_connect_onboarded: true,
              stripe_connect_enabled: true,
            },
          });
          return {
            connected: true,
            onboarded: true,
            pass_fee_to_customer: company.pass_fee_to_customer,
            account_id: company.stripe_connect_id,
          };
        }
      } catch {
        // Account may have been deleted on Stripe side
      }
    }

    return {
      connected: !!company.stripe_connect_id,
      onboarded: company.stripe_connect_onboarded,
      pass_fee_to_customer: company.pass_fee_to_customer,
      account_id: company.stripe_connect_id,
    };
  }

  async disconnectStripe(companyId: string): Promise<void> {
    await this.prisma.client.company.update({
      where: { id: companyId },
      data: {
        stripe_connect_id: null,
        stripe_connect_enabled: false,
        stripe_connect_onboarded: false,
      },
    });
  }

  async updateFeeSettings(
    companyId: string,
    passFeeToCustomer: boolean,
  ): Promise<void> {
    await this.prisma.client.company.update({
      where: { id: companyId },
      data: { pass_fee_to_customer: passFeeToCustomer },
    });
  }

  // ── Public: get invoice by token ──────────────────────────────────────────

  async getPublicInvoice(token: string) {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { payment_token: token },
      include: {
        company: {
          select: {
            name: true,
            logo_url: true,
            phone: true,
            address_line1: true,
            city: true,
            postcode: true,
            vat_number: true,
            vat_registered: true,
            bank_name: true,
            bank_sort_code: true,
            bank_account_number: true,
            bank_account_name: true,
            invoice_accent_colour: true,
            stripe_connect_enabled: true,
            stripe_connect_onboarded: true,
            pass_fee_to_customer: true,
          },
        },
        customer: {
          select: {
            name: true,
            email: true,
            address_line1: true,
            city: true,
            postcode: true,
          },
        },
      },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'CANCELLED')
      throw new BadRequestException('Invoice is cancelled');

    const platformFeeAmount = Math.round(invoice.amount_due_pence * 0.006);
    const customerPayAmount = invoice.company.pass_fee_to_customer
      ? invoice.amount_due_pence + platformFeeAmount
      : invoice.amount_due_pence;

    return {
      invoice_number: invoice.invoice_number,
      status: invoice.status,
      total_pence: invoice.total_pence,
      amount_due_pence: invoice.amount_due_pence,
      subtotal_pence: invoice.subtotal_pence,
      vat_amount_pence: invoice.vat_amount_pence,
      is_reverse_charge: invoice.is_reverse_charge,
      reverse_charge_wording: invoice.reverse_charge_wording,
      issue_date: invoice.issue_date,
      due_date: invoice.due_date,
      notes: invoice.notes,
      line_items: invoice.line_items,
      paid_online: invoice.paid_online,
      company: invoice.company,
      customer: invoice.customer,
      customer_pay_amount_pence: customerPayAmount,
      can_pay_online:
        invoice.company.stripe_connect_enabled &&
        invoice.company.stripe_connect_onboarded,
    };
  }

  // ── Public: customer reports payment (does NOT mark paid) ────────────────

  async customerReportPayment(
    token: string,
    method: string,
    note?: string,
  ): Promise<{ success: boolean; already_paid: boolean; already_reported: boolean }> {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { payment_token: token },
      include: {
        company: {
          select: { id: true, name: true },
        },
        customer: {
          select: { id: true, email: true },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'PAID')
      return { success: true, already_paid: true, already_reported: false };
    if (invoice.payment_review_status === 'PENDING')
      return { success: true, already_paid: false, already_reported: true };

    await this.prisma.client.invoice.update({
      where: { id: invoice.id },
      data: {
        payment_reported_at: new Date(),
        payment_reported_method: method,
        payment_reported_note: note ?? null,
        payment_review_status: 'PENDING',
      },
    });

    void this.comms.log({
      company_id:  invoice.company_id,
      customer_id: invoice.customer?.id ?? undefined,
      invoice_id:  invoice.id,
      type:        'PAYMENT_REPORTED',
      subject:     `Payment reported by customer — ${invoice.invoice_number}`,
      to_email:    invoice.customer?.email ?? '',
      reference:   invoice.invoice_number,
      notes:       `Method: ${method}${note ? ` · "${note}"` : ''}`,
    });

    // Notify the owner via email
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const owners = await this.prisma.client.user.findMany({
          where: { companyId: invoice.company_id, role: 'OWNER' as never },
          select: { email: true, name: true },
        });

        const { Resend } = await import('resend');
        const resend = new Resend(resendKey);

        for (const owner of owners) {
          await resend.emails.send({
            from: 'Vantro <noreply@vantro.co.uk>',
            to: owner.email,
            subject: `Payment reported for invoice ${invoice.invoice_number} — please verify`,
            html: `
              <p>Hi ${owner.name},</p>
              <p>Your customer has reported that they have paid invoice <strong>${invoice.invoice_number}</strong>.</p>
              <p><strong>Payment method reported:</strong> ${method}</p>
              ${note ? `<p><strong>Customer note:</strong> ${note}</p>` : ''}
              <p style="background:#fff3cd;border:1px solid #ffc107;padding:12px;border-radius:6px;">
                <strong>Important:</strong> This invoice has NOT been marked as paid.
                Please verify the payment has been received and then confirm or reject it in Vantro.
              </p>
              <p>Log in to Vantro to confirm or reject this payment report.</p>
            `,
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to send payment report notification: ${String(err)}`);
      }
    }

    return { success: true, already_paid: false, already_reported: false };
  }

  // ── Owner: confirm customer's payment report ──────────────────────────────

  async confirmPaymentReport(
    companyId: string,
    invoiceId: string,
  ): Promise<{ confirmed: boolean }> {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, company_id: companyId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.payment_review_status !== 'PENDING')
      throw new BadRequestException('No pending payment report for this invoice');

    await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'PAID' as never,
        paid_date: invoice.payment_reported_at ?? new Date(),
        payment_method: invoice.payment_reported_method ?? 'bank_transfer',
        payment_review_status: 'CONFIRMED',
      },
    });

    return { confirmed: true };
  }

  // ── Owner: reject customer's payment report ───────────────────────────────

  async rejectPaymentReport(
    companyId: string,
    invoiceId: string,
  ): Promise<{ rejected: boolean }> {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, company_id: companyId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.payment_review_status !== 'PENDING')
      throw new BadRequestException('No pending payment report for this invoice');

    await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: {
        payment_review_status: 'REJECTED',
        payment_reported_at: null,
        payment_reported_method: null,
        payment_reported_note: null,
      },
    });

    return { rejected: true };
  }

  // ── Public: create Stripe Checkout session ────────────────────────────────

  async createPublicCheckoutSession(token: string): Promise<{ url: string }> {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { payment_token: token },
      include: {
        company: {
          select: {
            name: true,
            stripe_connect_id: true,
            stripe_connect_enabled: true,
            stripe_connect_onboarded: true,
            pass_fee_to_customer: true,
          },
        },
        customer: { select: { name: true, email: true } },
      },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'PAID')
      throw new BadRequestException('Invoice is already paid');
    if (invoice.status === 'CANCELLED')
      throw new BadRequestException('Invoice is cancelled');
    if (
      !invoice.company.stripe_connect_enabled ||
      !invoice.company.stripe_connect_id ||
      !invoice.company.stripe_connect_onboarded
    ) {
      throw new BadRequestException(
        'Online payments are not enabled for this company',
      );
    }

    const platformFeeAmount = Math.round(invoice.amount_due_pence * 0.006);
    const customerAmount = invoice.company.pass_fee_to_customer
      ? invoice.amount_due_pence + platformFeeAmount
      : invoice.amount_due_pence;

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3001';

    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: invoice.customer?.email ?? undefined,
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: `Invoice ${invoice.invoice_number}`,
              description: `From ${invoice.company.name}`,
            },
            unit_amount: customerAmount,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: platformFeeAmount,
        transfer_data: { destination: invoice.company.stripe_connect_id },
      },
      success_url: `${frontendUrl}/invoice/${token}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/invoice/${token}`,
      metadata: { invoice_id: invoice.id, payment_token: token },
    });

    await this.prisma.client.invoice.update({
      where: { id: invoice.id },
      data: { stripe_checkout_session: session.id },
    });

    return { url: session.url! };
  }

  // ── Owner: create checkout session from dashboard ─────────────────────────

  async createCheckoutSession(
    companyId: string,
    invoiceId: string,
  ): Promise<{ url: string }> {
    const raw = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, company_id: companyId },
      select: { payment_token: true, status: true },
    });
    if (!raw) throw new NotFoundException('Invoice not found');

    let token = raw.payment_token;
    if (!token) {
      token = randomUUID();
      await this.prisma.client.invoice.update({
        where: { id: invoiceId },
        data: { payment_token: token },
      });
    }

    return this.createPublicCheckoutSession(token);
  }

  // ── Webhook ───────────────────────────────────────────────────────────────

  async handlePaymentWebhook(
    signature: string,
    rawBody: Buffer,
  ): Promise<void> {
    const webhookSecret = process.env.STRIPE_PAYMENT_WEBHOOK_SECRET;
    if (!webhookSecret) {
      this.logger.warn('STRIPE_PAYMENT_WEBHOOK_SECRET not set — skipping');
      return;
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      );
    } catch (err) {
      throw new BadRequestException(
        `Webhook signature verification failed: ${String(err)}`,
      );
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const token = session.metadata?.payment_token;
      if (token) {
        await this.prisma.client.invoice.updateMany({
          where: { payment_token: token },
          data: {
            status: 'PAID' as never,
            paid_date: new Date(),
            paid_online: true,
            payment_method: 'card',
            stripe_payment_intent:
              typeof session.payment_intent === 'string'
                ? session.payment_intent
                : null,
          },
        });
        this.logger.log(
          `Invoice payment completed via Stripe for token ${token}`,
        );
      }
    }
  }
}
