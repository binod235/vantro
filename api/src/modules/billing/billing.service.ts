import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';

function stripeId(val: string | { id: string } | null | undefined): string | null {
  if (!val) return null;
  if (typeof val === 'string') return val;
  return val.id;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private _stripe: Stripe | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private get stripe(): Stripe {
    if (!this._stripe) {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) throw new BadRequestException('Stripe is not configured.');
      this._stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' });
    }
    return this._stripe;
  }

  private static readonly BLOCKING_SUB_STATUSES = new Set([
    'active', 'trialing', 'past_due', 'unpaid',
  ]);

  async createCheckoutSession(companyId: string): Promise<{ url: string }> {
    const priceId = process.env.STRIPE_PRICE_ID;
    if (!priceId) throw new BadRequestException('Stripe is not configured.');

    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        subscription_status: true,
        stripe_customer_id: true,
        stripe_subscription_id: true,
      },
    });

    if (!company) throw new NotFoundException('Company not found.');

    // Guard 1: status-level check
    if (company.subscription_status === 'ACTIVE') {
      throw new BadRequestException('Company already has an active subscription.');
    }

    // Guard 2: verify with Stripe if a subscription ID is already stored
    if (company.stripe_subscription_id) {
      try {
        const sub = await this.stripe.subscriptions.retrieve(
          company.stripe_subscription_id,
        );
        if (BillingService.BLOCKING_SUB_STATUSES.has(sub.status)) {
          throw new BadRequestException(
            'Company already has a subscription. Please manage billing from settings.',
          );
        }
        // status is canceled / incomplete_expired — allow new checkout
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        // Subscription not found in Stripe or transient error — allow checkout
        this.logger.warn(
          `Could not retrieve subscription ${company.stripe_subscription_id}: ${String(err)}`,
        );
      }
    }

    let customerId = company.stripe_customer_id;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        name: company.name,
        metadata: { company_id: company.id },
      });
      customerId = customer.id;
      await this.prisma.client.company.update({
        where: { id: company.id },
        data: { stripe_customer_id: customerId },
      });
    }

    // 5-minute idempotency window — prevents duplicate sessions from rapid clicks
    const windowKey = Math.floor(Date.now() / (1000 * 60 * 5));
    const idempotencyKey = `checkout:${company.id}:${windowKey}`;

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3001';
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendUrl}/billing/cancelled`,
        metadata: { company_id: company.id },
        subscription_data: { metadata: { company_id: company.id } },
      },
      { idempotencyKey },
    );

    this.logger.log(`Checkout session created for company ${company.id}`);

    if (!session.url) throw new BadRequestException('Failed to create checkout URL.');
    return { url: session.url };
  }

  async createPortalSession(companyId: string): Promise<{ url: string }> {
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: { id: true, stripe_customer_id: true },
    });

    if (!company) throw new NotFoundException('Company not found.');
    if (!company.stripe_customer_id) {
      throw new BadRequestException('No Stripe customer found for this company.');
    }

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3001';
    const session = await this.stripe.billingPortal.sessions.create({
      customer: company.stripe_customer_id,
      return_url: `${frontendUrl}/dashboard/settings`,
    });

    this.logger.log(`Billing portal session created for company ${companyId}`);
    return { url: session.url };
  }

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      this.logger.error('STRIPE_WEBHOOK_SECRET not configured');
      throw new BadRequestException('Stripe is not configured.');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch {
      throw new BadRequestException('Invalid Stripe signature.');
    }

    this.logger.log(`Webhook received: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.updated':
        await this.onSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_failed':
        await this.onPaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        this.logger.log(`Ignored webhook event: ${event.type}`);
    }
  }

  private async onCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
    const companyId = session.metadata?.company_id;
    if (!companyId) {
      this.logger.warn('checkout.session.completed: missing company_id in metadata');
      return;
    }

    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) {
      this.logger.warn(`checkout.session.completed: company ${companyId} not found`);
      return;
    }

    const customerId = stripeId(session.customer);
    const subscriptionId = stripeId(session.subscription);

    // Retrieve subscription to capture period fields
    let currentPeriodEnd: Date | null = null;
    if (subscriptionId) {
      try {
        const sub = await this.stripe.subscriptions.retrieve(subscriptionId);
        if (sub.current_period_end) {
          currentPeriodEnd = new Date(sub.current_period_end * 1000);
        }
      } catch {
        this.logger.warn(`checkout.session.completed: could not retrieve subscription ${subscriptionId}`);
      }
    }

    await this.prisma.client.company.update({
      where: { id: companyId },
      data: {
        ...(customerId && { stripe_customer_id: customerId }),
        ...(subscriptionId && { stripe_subscription_id: subscriptionId }),
        subscription_status: 'ACTIVE',
        payment_failed_at: null,
        stripe_cancel_at_period_end: false,
        stripe_current_period_end: currentPeriodEnd,
      },
    });

    this.logger.log(`Company ${companyId} activated after successful checkout`);
  }

  private async onSubscriptionDeleted(subscription: Stripe.Subscription) {
    const company = await this.prisma.client.company.findFirst({
      where: { stripe_subscription_id: subscription.id },
      select: { id: true },
    });

    if (!company) {
      this.logger.warn(`customer.subscription.deleted: no company for subscription ${subscription.id}`);
      return;
    }

    await this.prisma.client.company.update({
      where: { id: company.id },
      data: {
        subscription_status: 'LOCKED',
        stripe_cancel_at_period_end: false,
        stripe_current_period_end: null,
      },
    });

    this.logger.log(`Company ${company.id} locked due to subscription deletion`);
  }

  private async onSubscriptionUpdated(subscription: Stripe.Subscription) {
    const company = await this.prisma.client.company.findFirst({
      where: { stripe_subscription_id: subscription.id },
      select: { id: true },
    });
    if (!company) return;

    const cancelAtPeriodEnd = subscription.cancel_at_period_end;
    const currentPeriodEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : null;

    const periodFields = {
      stripe_cancel_at_period_end: cancelAtPeriodEnd,
      ...(currentPeriodEnd ? { stripe_current_period_end: currentPeriodEnd } : {}),
    };

    if (subscription.status === 'active' || subscription.status === 'trialing') {
      await this.prisma.client.company.update({
        where: { id: company.id },
        data: {
          ...periodFields,
          subscription_status: 'ACTIVE',
          payment_failed_at: null,
        },
      });
      const note = cancelAtPeriodEnd ? ' (cancel_at_period_end=true)' : '';
      this.logger.log(`Company ${company.id} ACTIVE via subscription update${note}`);
    } else if (['canceled', 'unpaid', 'incomplete_expired'].includes(subscription.status)) {
      await this.prisma.client.company.update({
        where: { id: company.id },
        data: { ...periodFields, subscription_status: 'LOCKED' },
      });
      this.logger.log(`Company ${company.id} locked: subscription status=${subscription.status}`);
    } else {
      // past_due and other statuses — store period fields, leave subscription_status unchanged
      await this.prisma.client.company.update({
        where: { id: company.id },
        data: periodFields,
      });
      this.logger.log(`Company ${company.id} subscription status=${subscription.status}, period fields updated`);
    }
  }

  private async onPaymentFailed(invoice: Stripe.Invoice) {
    const subscriptionId = stripeId(invoice.subscription);
    const customerId = stripeId(invoice.customer);

    const conditions: Array<{ stripe_subscription_id: string } | { stripe_customer_id: string }> = [];
    if (subscriptionId) conditions.push({ stripe_subscription_id: subscriptionId });
    if (customerId) conditions.push({ stripe_customer_id: customerId });
    if (conditions.length === 0) {
      this.logger.warn('invoice.payment_failed: no subscription or customer id');
      return;
    }

    const company = await this.prisma.client.company.findFirst({
      where: { OR: conditions },
      select: { id: true },
    });

    if (!company) {
      this.logger.warn('invoice.payment_failed: no company found');
      return;
    }

    await this.prisma.client.company.update({
      where: { id: company.id },
      data: { payment_failed_at: new Date() },
    });

    this.logger.log(`payment_failed_at updated for company ${company.id}`);
  }
}
