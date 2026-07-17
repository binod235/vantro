import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Resend } from 'resend';
import { PrismaService } from '../../prisma/prisma.service';
import { CommsService } from '../comms/comms.service';
import { quoteChaseFirstHtml } from './templates/quote-chase-first.email';
import { quoteChaseSecondHtml } from './templates/quote-chase-second.email';
import { quoteChaseFinalhHtml } from './templates/quote-chase-final.email';

type QuoteChaseStage = 'FIRST' | 'SECOND' | 'FINAL';

function ukHour(now: Date): number {
  const month = now.getUTCMonth() + 1;
  const isBst = month >= 4 && month <= 10;
  return (now.getUTCHours() + (isBst ? 1 : 0)) % 24;
}

@Injectable()
export class QuoteChaseService {
  private readonly logger = new Logger(QuoteChaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comms: CommsService,
  ) {}

  @Cron('0 * * * *')
  async runHourlyQuoteChase() {
    const currentUkHour = ukHour(new Date());

    const policies = await this.prisma.client.quoteChasePolicy.findMany({
      where: { enabled: true, send_hour: currentUkHour },
      include: {
        company: {
          select: { id: true, name: true, logo_url: true, branding_footer_enabled: true },
        },
      },
    });

    if (!policies.length) return;

    this.logger.log(`Quote auto-chase: processing ${policies.length} company/companies`);

    await Promise.allSettled(policies.map((p) => this.processCompany(p)));
  }

  async triggerForCompany(companyId: string): Promise<{ processed: number; sent: number }> {
    const policy = await this.prisma.client.quoteChasePolicy.findUnique({
      where: { company_id: companyId },
      include: {
        company: { select: { id: true, name: true, logo_url: true, branding_footer_enabled: true } },
      },
    });

    if (!policy || !policy.enabled) return { processed: 0, sent: 0 };

    return this.processCompany(policy);
  }

  private async processCompany(policy: {
    company_id: string;
    company: { id: string; name: string; logo_url: string | null; branding_footer_enabled: boolean };
    first_days: number;
    second_days: number;
    final_days: number;
  }): Promise<{ processed: number; sent: number }> {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const quotes = await this.prisma.client.quote.findMany({
      where: {
        company_id: policy.company_id,
        status: 'SENT',
        chase_paused: false,
        last_sent_at: { not: null },
        customer: {
          email: { not: null },
        },
      },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        quoteChaseActivities: { select: { stage: true } },
      },
    });

    let sent = 0;

    for (const quote of quotes) {
      try {
        if (!quote.customer?.email || !quote.last_sent_at) continue;

        const sentAt = new Date(quote.last_sent_at);
        sentAt.setHours(0, 0, 0, 0);
        const daysSinceSent = Math.floor(
          (now.getTime() - sentAt.getTime()) / (1000 * 60 * 60 * 24),
        );

        const sentStages = new Set(quote.quoteChaseActivities.map((a) => a.stage));

        const stage = this.determineStage(
          daysSinceSent,
          sentStages,
          policy.first_days,
          policy.second_days,
          policy.final_days,
        );

        if (!stage) continue;

        await this.sendChaseEmail({
          stage,
          quote,
          customer: quote.customer,
          company: policy.company,
        });

        sent++;
      } catch (err) {
        this.logger.error(
          `Quote auto-chase failed for ${quote.quote_number}: ${String(err)}`,
        );
      }
    }

    this.logger.log(
      `Quote auto-chase: ${policy.company.name} — ${quotes.length} eligible, ${sent} sent`,
    );

    return { processed: quotes.length, sent };
  }

  private determineStage(
    daysSinceSent: number,
    sentStages: Set<string>,
    firstDays: number,
    secondDays: number,
    finalDays: number,
  ): QuoteChaseStage | null {
    if (daysSinceSent >= finalDays && !sentStages.has('FINAL')) return 'FINAL';
    if (daysSinceSent >= secondDays && !sentStages.has('SECOND')) return 'SECOND';
    if (daysSinceSent >= firstDays && !sentStages.has('FIRST')) return 'FIRST';
    return null;
  }

  private async sendChaseEmail(ctx: {
    stage: QuoteChaseStage;
    quote: {
      id: string;
      quote_number: string;
      total_pence: number;
      acceptance_token: string | null;
      expiry_date: Date | null;
    };
    customer: { id: string; name: string; email: string | null };
    company: { id: string; name: string; logo_url: string | null; branding_footer_enabled: boolean };
  }): Promise<void> {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return;

    const { stage, quote, customer, company } = ctx;
    const toEmail = customer.email!;

    const owner = await this.prisma.client.user.findFirst({
      where: { companyId: company.id, role: 'OWNER' },
      select: { email: true },
    });
    const companyEmail = owner?.email ?? (process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk');
    const frontendUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
    const acceptanceLink = quote.acceptance_token
      ? `${frontendUrl}/quote/${quote.acceptance_token}`
      : `${frontendUrl}/dashboard/quotes`;

    const expiryDateStr = quote.expiry_date
      ? new Date(quote.expiry_date).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        })
      : null;

    const commonData = {
      customerName: customer.name,
      companyName: company.name,
      companyEmail,
      quoteNumber: quote.quote_number,
      totalPence: quote.total_pence,
      expiryDateStr,
      acceptanceLink,
      logoUrl: company.logo_url,
      brandingFooterEnabled: company.branding_footer_enabled,
    };

    let subject: string;
    let html: string;

    if (stage === 'FIRST') {
      subject = `Following up on your quote — ${quote.quote_number}`;
      html = quoteChaseFirstHtml(commonData);
    } else if (stage === 'SECOND') {
      subject = `Reminder: Quote ${quote.quote_number} still open`;
      html = quoteChaseSecondHtml(commonData);
    } else {
      subject = `Final follow-up — Quote ${quote.quote_number}`;
      html = quoteChaseFinalhHtml(commonData);
    }

    const resend = new Resend(resendKey);
    const { error } = await resend.emails.send({
      from: process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
      to: toEmail,
      replyTo: companyEmail,
      subject,
      html,
    });

    if (error) throw new Error(error.message);

    await this.prisma.client.quoteChaseActivity.create({
      data: {
        company_id: company.id,
        quote_id: quote.id,
        customer_id: customer.id,
        stage,
        sent_to: toEmail,
        status: 'SENT',
      },
    });

    void this.prisma.client.autopilotEvent.create({
      data: {
        company_id: company.id,
        type: 'QUOTE_CHASE_SENT',
        title: `Chased ${customer.name} for quote ${quote.quote_number} (${stage.toLowerCase()} follow-up)`,
        meta: { stage, quoteId: quote.id, quoteNumber: quote.quote_number },
      },
    }).catch(() => {});

    void this.comms.log({
      company_id: company.id,
      customer_id: customer.id,
      quote_id: quote.id,
      type: 'QUOTE_CHASE',
      subject,
      to_email: toEmail,
      reference: quote.quote_number,
      notes: `Auto quote-chase ${stage}`,
    });
  }
}
