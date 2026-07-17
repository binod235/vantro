import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Resend } from 'resend';
import { PrismaService } from '../../prisma/prisma.service';
import { CommsService } from '../comms/comms.service';
import { serviceRenewalHtml } from './templates/service-renewal.email';

function ukHour(now: Date): number {
  const month = now.getUTCMonth() + 1;
  const isBst = month >= 4 && month <= 10;
  return (now.getUTCHours() + (isBst ? 1 : 0)) % 24;
}

@Injectable()
export class RenewalAutopilotService {
  private readonly logger = new Logger(RenewalAutopilotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comms: CommsService,
  ) {}

  @Cron('0 * * * *')
  async runHourlyRenewal() {
    const currentUkHour = ukHour(new Date());

    const policies = await this.prisma.client.renewalPolicy.findMany({
      where: { enabled: true, send_hour: currentUkHour },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            logo_url: true,
            phone: true,
            branding_footer_enabled: true,
          },
        },
      },
    });

    if (!policies.length) return;

    this.logger.log(`Renewal autopilot: processing ${policies.length} company/companies`);

    await Promise.allSettled(policies.map((p) => this.processCompany(p)));
  }

  async triggerForCompany(companyId: string): Promise<{ processed: number; sent: number }> {
    const policy = await this.prisma.client.renewalPolicy.findUnique({
      where: { company_id: companyId },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            logo_url: true,
            phone: true,
            branding_footer_enabled: true,
          },
        },
      },
    });

    if (!policy || !policy.enabled) return { processed: 0, sent: 0 };

    return this.processCompany(policy);
  }

  private async processCompany(policy: {
    company_id: string;
    days_before: number;
    create_todo: boolean;
    company: {
      id: string;
      name: string;
      logo_url: string | null;
      phone: string | null;
      branding_footer_enabled: boolean;
    };
  }): Promise<{ processed: number; sent: number }> {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + policy.days_before);

    // Find CP12 certs expiring on the target date that haven't been reminded yet
    const certs = await this.prisma.client.gasSafetyCertificate.findMany({
      where: {
        company_id: policy.company_id,
        cert_type: 'CP12',
        next_due_date: {
          gte: targetDate,
          lt: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000),
        },
        customer: { email: { not: null } },
        renewalReminders: { none: {} },
      },
      include: {
        customer: { select: { id: true, name: true, email: true } },
      },
    });

    let sent = 0;

    for (const cert of certs) {
      try {
        if (!cert.customer?.email || !cert.next_due_date) continue;

        await this.sendRenewalEmail({
          cert,
          customer: cert.customer,
          company: policy.company,
          daysUntilExpiry: policy.days_before,
          createTodo: policy.create_todo,
        });

        sent++;
      } catch (err) {
        this.logger.error(`Renewal autopilot failed for cert ${cert.cert_number}: ${String(err)}`);
      }
    }

    this.logger.log(
      `Renewal autopilot: ${policy.company.name} — ${certs.length} eligible, ${sent} sent`,
    );

    return { processed: certs.length, sent };
  }

  private async sendRenewalEmail(ctx: {
    cert: {
      id: string;
      cert_number: string;
      next_due_date: Date | null;
      property_address: string | null;
      property_city: string | null;
    };
    customer: { id: string; name: string; email: string | null };
    company: {
      id: string;
      name: string;
      logo_url: string | null;
      phone: string | null;
      branding_footer_enabled: boolean;
    };
    daysUntilExpiry: number;
    createTodo: boolean;
  }): Promise<void> {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return;

    const { cert, customer, company, daysUntilExpiry, createTodo } = ctx;
    const toEmail = customer.email!;

    const owner = await this.prisma.client.user.findFirst({
      where: { companyId: company.id, role: 'OWNER' },
      select: { id: true, email: true },
    });
    const companyEmail = owner?.email ?? (process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk');

    const expiryDateStr = cert.next_due_date
      ? new Date(cert.next_due_date).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        })
      : '';

    const propertyAddress = [cert.property_address, cert.property_city]
      .filter(Boolean)
      .join(', ') || 'your property';

    const subject = `Gas Safety Certificate renewal due — ${expiryDateStr}`;
    const html = serviceRenewalHtml({
      customerName: customer.name,
      companyName: company.name,
      companyEmail,
      companyPhone: company.phone ?? undefined,
      propertyAddress,
      certNumber: cert.cert_number,
      expiryDateStr,
      daysUntilExpiry,
      logoUrl: company.logo_url,
      brandingFooterEnabled: company.branding_footer_enabled,
    });

    const resend = new Resend(resendKey);
    const { error } = await resend.emails.send({
      from: process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
      to: toEmail,
      replyTo: companyEmail,
      subject,
      html,
    });

    if (error) throw new Error(error.message);

    await this.prisma.client.renewalReminder.create({
      data: {
        company_id: company.id,
        certificate_id: cert.id,
        customer_id: customer.id,
        sent_to: toEmail,
        status: 'SENT',
      },
    });

    if (createTodo && owner) {
      void this.prisma.client.todo.create({
        data: {
          company_id: company.id,
          created_by_id: owner.id,
          title: `Book CP12 renewal for ${customer.name} — ${propertyAddress} (expires ${expiryDateStr})`,
          priority: daysUntilExpiry <= 14 ? 'URGENT' : 'HIGH',
          due_date: cert.next_due_date ?? undefined,
        },
      }).catch(() => {});
    }

    void this.prisma.client.autopilotEvent.create({
      data: {
        company_id: company.id,
        type: 'RENEWAL_SENT',
        title: `Renewal reminder sent to ${customer.name} for ${propertyAddress} (expires ${expiryDateStr})`,
        meta: { certId: cert.id, certNumber: cert.cert_number, daysUntilExpiry },
      },
    }).catch(() => {});

    void this.comms.log({
      company_id: company.id,
      customer_id: customer.id,
      type: 'RENEWAL_REMINDER',
      subject,
      to_email: toEmail,
      reference: cert.cert_number,
      notes: `Auto renewal reminder — ${daysUntilExpiry} days before expiry`,
    });
  }
}
