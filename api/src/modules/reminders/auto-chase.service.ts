import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Resend } from 'resend';
import { PrismaService } from '../../prisma/prisma.service';
import { CommsService } from '../comms/comms.service';
import { chaseGentleHtml } from './templates/chase-gentle.email';
import { chaseFirmHtml } from './templates/chase-firm.email';
import { chaseFinalHtml } from './templates/chase-final.email';
import { generateQrDataUri } from '../../common/qr.helper';

type ChaseStage = 'GENTLE' | 'FIRM' | 'FINAL';

// Converts UTC now to UK hour (BST = UTC+1 in summer, GMT = UTC+0 in winter).
// This is a pragmatic approximation — avoids a full timezone library dependency.
function ukHour(now: Date): number {
  const month = now.getUTCMonth() + 1; // 1-12
  const isBst = month >= 4 && month <= 10;
  return (now.getUTCHours() + (isBst ? 1 : 0)) % 24;
}

@Injectable()
export class AutoChaseService {
  private readonly logger = new Logger(AutoChaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comms: CommsService,
  ) {}

  // ── Hourly cron — process companies whose send_hour matches current UK hour ─

  @Cron('0 * * * *')
  async runHourlyChase() {
    const currentUkHour = ukHour(new Date());
    this.logger.log(`Auto-chase hourly tick — UK hour: ${currentUkHour}`);

    const policies = await this.prisma.client.chasePolicy.findMany({
      where: {
        enabled: true,
        send_hour: currentUkHour,
      },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            logo_url: true,
            branding_footer_enabled: true,
          },
        },
      },
    });

    if (!policies.length) return;

    this.logger.log(`Auto-chase: processing ${policies.length} company/companies`);

    await Promise.allSettled(
      policies.map((policy) => this.processCompany(policy)),
    );
  }

  // ── Manual trigger (for testing + Pip tool) ──────────────────────────────────

  async triggerForCompany(companyId: string): Promise<{ processed: number; sent: number }> {
    const policy = await this.prisma.client.chasePolicy.findUnique({
      where: { company_id: companyId },
      include: {
        company: { select: { id: true, name: true, logo_url: true, branding_footer_enabled: true } },
      },
    });

    if (!policy || !policy.enabled) {
      return { processed: 0, sent: 0 };
    }

    return this.processCompany(policy);
  }

  // ── Core processing logic ────────────────────────────────────────────────────

  private async processCompany(policy: {
    id: string;
    company_id: string;
    company: { id: string; name: string; logo_url: string | null; branding_footer_enabled: boolean };
    gentle_days: number;
    firm_days: number;
    final_days: number;
    interest_enabled: boolean;
    interest_rate_pct: number;
  }): Promise<{ processed: number; sent: number }> {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        company_id: policy.company_id,
        status: { in: ['SENT', 'PART_PAID'] },
        due_date: { lt: now },
        chase_paused: false,
        customer: {
          chase_excluded: false,
          email: { not: null },
        },
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            is_business: true,
          },
        },
        chaseActivities: {
          select: { stage: true },
        },
      },
    });

    let sent = 0;

    for (const invoice of invoices) {
      try {
        if (!invoice.customer?.email || !invoice.due_date) continue;

        const dueDate = new Date(invoice.due_date);
        dueDate.setHours(0, 0, 0, 0);
        const daysOverdue = Math.floor(
          (now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
        );

        const sentStages = new Set(invoice.chaseActivities.map((a) => a.stage));

        const stage = this.determineStage(
          daysOverdue,
          sentStages,
          policy.gentle_days,
          policy.firm_days,
          policy.final_days,
        );

        if (!stage) continue;

        await this.sendChaseEmail({
          stage,
          invoice,
          customer: invoice.customer,
          company: policy.company,
          daysOverdue,
          dueDateStr: dueDate.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          }),
          policy,
        });

        sent++;
      } catch (err) {
        this.logger.error(
          `Auto-chase failed for invoice ${invoice.invoice_number}: ${String(err)}`,
        );
      }
    }

    this.logger.log(
      `Auto-chase: ${policy.company.name} — ${invoices.length} eligible, ${sent} sent`,
    );

    return { processed: invoices.length, sent };
  }

  private determineStage(
    daysOverdue: number,
    sentStages: Set<string>,
    gentleDays: number,
    firmDays: number,
    finalDays: number,
  ): ChaseStage | null {
    if (daysOverdue >= finalDays && !sentStages.has('FINAL')) return 'FINAL';
    if (daysOverdue >= firmDays && !sentStages.has('FIRM')) return 'FIRM';
    if (daysOverdue >= gentleDays && !sentStages.has('GENTLE')) return 'GENTLE';
    return null;
  }

  private async sendChaseEmail(ctx: {
    stage: ChaseStage;
    invoice: {
      id: string;
      invoice_number: string;
      amount_due_pence: number;
      payment_token: string | null;
    };
    customer: {
      id: string;
      name: string;
      email: string | null;
      is_business: boolean;
    };
    company: { id: string; name: string; logo_url: string | null; branding_footer_enabled: boolean };
    daysOverdue: number;
    dueDateStr: string;
    policy: {
      interest_enabled: boolean;
      interest_rate_pct: number;
    };
  }): Promise<void> {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return;

    const { stage, invoice, customer, company, daysOverdue, dueDateStr, policy } = ctx;
    const toEmail = customer.email!;

    // Company model has no email field — use the owner's email as reply-to
    const owner = await this.prisma.client.user.findFirst({
      where: { companyId: company.id, role: 'OWNER' },
      select: { email: true },
    });
    const companyEmail = owner?.email ?? (process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk');
    const frontendUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
    const paymentLink = invoice.payment_token
      ? `${frontendUrl}/invoice/${invoice.payment_token}`
      : `${frontendUrl}/dashboard/invoices`;

    const qrDataUri = invoice.payment_token ? await generateQrDataUri(paymentLink) : null;

    const commonData = {
      customerName: customer.name,
      companyName: company.name,
      companyEmail,
      invoiceNumber: invoice.invoice_number,
      amountDuePence: invoice.amount_due_pence,
      dueDateStr,
      paymentLink,
      logoUrl: company.logo_url,
      brandingFooterEnabled: company.branding_footer_enabled,
      qrDataUri,
    };

    let subject: string;
    let html: string;
    let interestPounds: number | null = null;

    if (stage === 'GENTLE') {
      subject = `Friendly reminder — Invoice ${invoice.invoice_number}`;
      html = chaseGentleHtml(commonData);
    } else if (stage === 'FIRM') {
      subject = `Overdue: Invoice ${invoice.invoice_number} — ${this.gbpStr(invoice.amount_due_pence)}`;
      html = chaseFirmHtml({ ...commonData, daysOverdue });
    } else {
      // FINAL — calculate statutory interest for business customers
      if (policy.interest_enabled && customer.is_business) {
        const principal = invoice.amount_due_pence / 100;
        interestPounds = parseFloat(
          (principal * (policy.interest_rate_pct / 100) * (daysOverdue / 365)).toFixed(2),
        );
      }
      subject = `Final notice — Invoice ${invoice.invoice_number}`;
      html = chaseFinalHtml({
        ...commonData,
        daysOverdue,
        interestEnabled: policy.interest_enabled,
        isBusiness: customer.is_business,
        interestRatePct: policy.interest_rate_pct,
        interestPounds,
      });
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

    // Record the activity
    await this.prisma.client.chaseActivity.create({
      data: {
        company_id: company.id,
        invoice_id: invoice.id,
        customer_id: customer.id,
        stage,
        sent_to: toEmail,
        interest_pounds: interestPounds,
        status: 'SENT',
      },
    });

    // Autopilot feed — fire-and-forget, must not break the primary action
    void this.prisma.client.autopilotEvent.create({
      data: {
        company_id: company.id,
        type: 'CHASE_SENT',
        title: `Chased ${customer.name} — ${invoice.invoice_number} (${stage.toLowerCase()} reminder, ${daysOverdue}d overdue)`,
        meta: { stage, invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, daysOverdue },
      },
    }).catch(() => {});

    void this.comms.log({
      company_id: company.id,
      customer_id: customer.id,
      invoice_id: invoice.id,
      type: 'PAYMENT_REMINDER',
      subject,
      to_email: toEmail,
      reference: invoice.invoice_number,
      notes: `Auto-chase ${stage} (${daysOverdue} days overdue)`,
    });

    this.logger.log(
      `Auto-chase ${stage} sent for ${invoice.invoice_number} (${daysOverdue}d) → ${toEmail}`,
    );
  }

  private gbpStr(pence: number): string {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(
      pence / 100,
    );
  }

  // ── Summary for Pip tool / status endpoint ────────────────────────────────────

  async getChaseStatus(companyId: string) {
    const [policy, recentActivity, recoveredCount] = await Promise.all([
      this.prisma.client.chasePolicy.findUnique({
        where: { company_id: companyId },
      }),
      this.prisma.client.chaseActivity.findMany({
        where: {
          company_id: companyId,
          created_at: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
          status: 'SENT',
        },
        include: {
          invoice: { select: { invoice_number: true, amount_due_pence: true } },
          customer: { select: { name: true } },
        },
        orderBy: { created_at: 'desc' },
        take: 20,
      }),
      // Invoices that received a chase and are now PAID
      this.prisma.client.invoice.count({
        where: {
          company_id: companyId,
          status: 'PAID',
          chaseActivities: { some: {} },
        },
      }),
    ]);

    return { policy, recentActivity, recoveredCount };
  }
}
