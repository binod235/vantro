import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Resend } from 'resend';
import { PrismaService } from '../../prisma/prisma.service';
import { CommsService }  from '../comms/comms.service';
import { paymentReminderHtml } from './templates/payment-reminder.email';
import { cp12RenewalHtml } from './templates/cp12-renewal.email';

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comms: CommsService,
  ) {}

  // ── Run every day at 08:00 ────────────────────────────────────────────────
  @Cron('0 8 * * *')
  async runDailyReminders() {
    this.logger.log('Running daily reminders...');
    await Promise.allSettled([
      this.sendPaymentReminders(),
      this.sendCp12Renewals(),
    ]);
  }

  // ── Run every day at 09:00 — quote acceptance reminders ──────────────────
  @Cron('0 9 * * *')
  async sendQuoteAcceptanceReminders(companyId?: string) {
    const now = new Date();
    const followUpDays = [3, 7];

    const companies = await this.prisma.client.company.findMany({
      where:  companyId ? { id: companyId } : undefined,
      select: { id: true, name: true },
    });

    for (const company of companies) {
      for (const days of followUpDays) {
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() - days);
        targetDate.setHours(0, 0, 0, 0);
        const targetEnd = new Date(targetDate);
        targetEnd.setHours(23, 59, 59, 999);

        const quotes = await this.prisma.client.quote.findMany({
          where: {
            company_id: company.id,
            status:     { in: ['SENT' as never] },
            last_sent_at: { gte: targetDate, lte: targetEnd },
            customer:   { email: { not: null } },
          },
          include: {
            customer: { select: { name: true, email: true } },
          },
        });

        for (const quote of quotes) {
          if (!quote.customer?.email) continue;
          try {
            const resendKey = process.env.RESEND_API_KEY;
            if (!resendKey) continue;
            const resend = new Resend(resendKey);
            await resend.emails.send({
              from:    process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
              to:      quote.customer.email,
              subject: `Friendly reminder — your quote from ${company.name} is awaiting your response`,
              html: `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                  <h2 style="color:#111;">Reminder: Quote ${quote.quote_number}</h2>
                  <p style="color:#555;">Hi ${quote.customer.name},</p>
                  <p style="color:#555;">
                    We wanted to follow up on your quote <strong>${quote.quote_number}</strong>
                    from <strong>${company.name}</strong>, which is still awaiting your response.
                  </p>
                  <table style="font-size:14px;border-collapse:collapse;margin:16px 0;">
                    <tr><td style="color:#888;padding:4px 16px 4px 0;">Total</td><td><strong>£${(quote.total_pence / 100).toFixed(2)}</strong></td></tr>
                    ${quote.expiry_date ? `<tr><td style="color:#888;padding:4px 16px 4px 0;">Valid until</td><td><strong>${new Date(quote.expiry_date).toLocaleDateString('en-GB')}</strong></td></tr>` : ''}
                  </table>
                  ${quote.acceptance_token ? `
                  <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'}/quote/${quote.acceptance_token}"
                    style="display:inline-block;background:#1d4ed8;color:white;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;margin:8px 0;">
                    View Quote &amp; Respond &rarr;
                  </a>` : ''}
                  <p style="color:#999;font-size:12px;margin-top:16px;">
                    If you have any questions, please don't hesitate to get in touch.
                  </p>
                </div>
              `,
            });
            this.logger.log(
              `Quote acceptance reminder sent for ${quote.quote_number} (${days} days) to ${quote.customer.email}`,
            );

            void this.comms.log({
              company_id:  company.id,
              customer_id: quote.customer_id ?? undefined,
              quote_id:    quote.id,
              type:        'QUOTE_REMINDER',
              subject:     `Quote reminder — ${quote.quote_number}`,
              to_email:    quote.customer.email,
              reference:   quote.quote_number,
            });
          } catch (err) {
            this.logger.error(
              `Failed to send quote reminder for ${quote.quote_number}: ${String(err)}`,
            );
          }
        }
      }
    }
  }

  // ── Payment Reminders ─────────────────────────────────────────────────────

  async sendPaymentReminders(companyId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const companies = await this.prisma.client.company.findMany({
      where: { payment_reminders_enabled: true, ...(companyId ? { id: companyId } : {}) },
      select: {
        id:                   true,
        name:                 true,
        reminder_days_before: true,
        reminder_days_after_1: true,
        reminder_days_after_2: true,
        reminder_days_after_3: true,
      },
    });

    for (const company of companies) {
      const invoices = await this.prisma.client.invoice.findMany({
        where: {
          company_id:         company.id,
          status:             { notIn: ['PAID', 'CANCELLED', 'DRAFT'] },
          reminders_disabled: false,
          due_date:           { not: null },
          customer:           { email: { not: null } },
        },
        include: {
          customer: { select: { name: true, email: true } },
        },
      });

      const thresholds = [
        -company.reminder_days_before,
        company.reminder_days_after_1,
        company.reminder_days_after_2,
        company.reminder_days_after_3,
      ];

      for (const invoice of invoices) {
        if (!invoice.due_date || !invoice.customer?.email) continue;

        const dueDate = new Date(invoice.due_date);
        dueDate.setHours(0, 0, 0, 0);
        const daysOverdue = Math.floor(
          (today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
        );

        if (!thresholds.includes(daysOverdue)) continue;

        // Skip if already sent a reminder today
        if (invoice.last_reminder_sent_at) {
          const lastSent = new Date(invoice.last_reminder_sent_at);
          lastSent.setHours(0, 0, 0, 0);
          if (lastSent.getTime() === today.getTime()) continue;
        }

        try {
          await this.sendPaymentReminderEmail({
            toEmail:       invoice.customer.email,
            customerName:  invoice.customer.name,
            companyName:   company.name,
            invoiceNumber: invoice.invoice_number,
            totalPence:    invoice.amount_due_pence ?? invoice.total_pence,
            dueDate,
            daysOverdue:   Math.max(0, daysOverdue),
          });

          await this.prisma.client.invoice.update({
            where: { id: invoice.id },
            data: {
              last_reminder_sent_at: new Date(),
              reminder_count:        { increment: 1 },
            },
          });

          this.logger.log(
            `Payment reminder sent for invoice ${invoice.invoice_number} ` +
            `(${daysOverdue} days overdue) to ${invoice.customer.email}`,
          );

          void this.comms.log({
            company_id:  company.id,
            customer_id: invoice.customer_id ?? undefined,
            invoice_id:  invoice.id,
            type:        'PAYMENT_REMINDER',
            subject:     `Payment reminder — ${invoice.invoice_number}`,
            to_email:    invoice.customer.email,
            reference:   invoice.invoice_number,
            notes:       daysOverdue > 0 ? `${daysOverdue} days overdue` : 'Due today',
          });

          // Notify company owner
          try {
            const owner = await this.prisma.client.user.findFirst({
              where: { companyId: company.id, role: 'OWNER' },
              select: { email: true, name: true },
            });
            if (owner?.email) {
              const resend = new Resend(process.env.RESEND_API_KEY);
              const { error } = await resend.emails.send({
                from:    process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
                to:      owner.email,
                subject: `Reminder sent — ${invoice.invoice_number} (${daysOverdue > 0 ? `${daysOverdue} days overdue` : 'due today'})`,
                html: `
                  <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;">
                    <h3 style="color:#111;">Payment reminder sent</h3>
                    <p style="color:#555;font-size:14px;">
                      A reminder was automatically sent to <strong>${invoice.customer.name}</strong>
                      for invoice <strong>${invoice.invoice_number}</strong>.
                    </p>
                    <table style="font-size:13px;border-collapse:collapse;margin:16px 0;background:#f9fafb;width:100%;border-radius:8px;">
                      <tr><td style="padding:8px 16px;color:#888;">Invoice</td><td style="padding:8px 16px;font-weight:600;">${invoice.invoice_number}</td></tr>
                      <tr style="border-top:1px solid #e5e7eb;"><td style="padding:8px 16px;color:#888;">Customer</td><td style="padding:8px 16px;">${invoice.customer.name}</td></tr>
                      <tr style="border-top:1px solid #e5e7eb;"><td style="padding:8px 16px;color:#888;">Amount</td><td style="padding:8px 16px;font-weight:600;">£${((invoice.amount_due_pence ?? invoice.total_pence) / 100).toFixed(2)}</td></tr>
                      <tr style="border-top:1px solid #e5e7eb;"><td style="padding:8px 16px;color:#888;">Status</td><td style="padding:8px 16px;color:${daysOverdue > 0 ? '#dc2626' : '#1d4ed8'};">${daysOverdue > 0 ? `${daysOverdue} days overdue` : 'Due today'}</td></tr>
                    </table>
                    <p style="color:#888;font-size:12px;">This is an automated notification from Vantro.</p>
                  </div>
                `,
              });
              if (error) {
                this.logger.warn(`Failed to send owner notification: ${error.message}`);
              }
            }
          } catch (ownerErr) {
            this.logger.warn(`Owner notification failed for ${invoice.invoice_number}: ${String(ownerErr)}`);
          }
        } catch (err) {
          this.logger.error(
            `Failed to send reminder for invoice ${invoice.invoice_number}: ${String(err)}`,
          );
        }
      }
    }
  }

  private async sendPaymentReminderEmail(data: {
    toEmail:       string;
    customerName:  string;
    companyName:   string;
    invoiceNumber: string;
    totalPence:    number;
    dueDate:       Date;
    daysOverdue:   number;
  }) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const dueDateStr = data.dueDate.toLocaleDateString('en-GB', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
    const isOverdue = data.daysOverdue > 0;
    const subject = isOverdue
      ? `Payment reminder — ${data.invoiceNumber} is ${data.daysOverdue} days overdue`
      : `Payment due today — ${data.invoiceNumber}`;

    const { error } = await resend.emails.send({
      from:    process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
      to:      data.toEmail,
      subject,
      html: paymentReminderHtml({
        customerName:  data.customerName,
        companyName:   data.companyName,
        invoiceNumber: data.invoiceNumber,
        totalPence:    data.totalPence,
        dueDateStr,
        daysOverdue:   data.daysOverdue,
      }),
    });
    if (error) throw new Error(error.message);
  }

  // ── CP12 Renewal Reminders ────────────────────────────────────────────────

  async sendCp12Renewals(companyId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const companies = await this.prisma.client.company.findMany({
      where: { cp12_reminders_enabled: true, ...(companyId ? { id: companyId } : {}) },
      select: {
        id:                        true,
        name:                      true,
        phone:                     true,
        cp12_reminder_days_before: true,
      },
    });

    for (const company of companies) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + company.cp12_reminder_days_before);

      const certs = await this.prisma.client.gasSafetyCertificate.findMany({
        where: {
          company_id: company.id,
          cert_type:  'CP12',
          status:     'COMPLETE',
          next_due_date: {
            gte: targetDate,
            lt:  new Date(targetDate.getTime() + 24 * 60 * 60 * 1000),
          },
          customer: { email: { not: null } },
        },
        include: {
          customer: { select: { name: true, email: true } },
        },
      });

      for (const cert of certs) {
        if (!cert.customer?.email || !cert.next_due_date) continue;

        try {
          const expiryDate    = new Date(cert.next_due_date);
          const daysUntil     = Math.ceil(
            (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
          );
          const propertyAddress = [
            cert.property_address,
            cert.property_city,
            cert.property_postcode,
          ].filter(Boolean).join(', ') || 'your property';

          await this.sendCp12RenewalEmail({
            toEmail:         cert.customer.email,
            customerName:    cert.customer.name,
            companyName:     company.name,
            companyPhone:    company.phone ?? undefined,
            propertyAddress,
            expiryDate,
            daysUntilExpiry: daysUntil,
            certNumber:      cert.cert_number,
          });

          await this.prisma.client.gasSafetyCertificate.update({
            where: { id: cert.id },
            data:  { last_sent_at: new Date() },
          });

          this.logger.log(
            `CP12 renewal reminder sent for cert ${cert.cert_number} ` +
            `to ${cert.customer.email} (expires in ${daysUntil} days)`,
          );

          void this.comms.log({
            company_id:  company.id,
            customer_id: cert.customer_id ?? undefined,
            type:        'CP12_RENEWAL',
            subject:     `CP12 renewal reminder — ${cert.cert_number}`,
            to_email:    cert.customer.email,
            reference:   cert.cert_number,
            notes:       `Expires in ${daysUntil} days`,
          });
        } catch (err) {
          this.logger.error(
            `Failed to send CP12 reminder for cert ${cert.cert_number}: ${String(err)}`,
          );
        }
      }
    }
  }

  private async sendCp12RenewalEmail(data: {
    toEmail:         string;
    customerName:    string;
    companyName:     string;
    companyPhone?:   string;
    propertyAddress: string;
    expiryDate:      Date;
    daysUntilExpiry: number;
    certNumber:      string;
  }) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const expiryDateStr = data.expiryDate.toLocaleDateString('en-GB', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

    const { error } = await resend.emails.send({
      from:    process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
      to:      data.toEmail,
      subject: `Gas Safety Certificate renewal due in ${data.daysUntilExpiry} days — ${data.propertyAddress}`,
      html: cp12RenewalHtml({
        customerName:    data.customerName,
        companyName:     data.companyName,
        companyPhone:    data.companyPhone,
        propertyAddress: data.propertyAddress,
        expiryDateStr,
        daysUntilExpiry: data.daysUntilExpiry,
        certNumber:      data.certNumber,
      }),
    });
    if (error) throw new Error(error.message);
  }

  // ── Appointment Reminders ─────────────────────────────────────────────────

  @Cron('0 9 * * *')
  async sendAppointmentReminders(companyId?: string) {
    this.logger.log('Running appointment reminders...');

    const companies = await this.prisma.client.company.findMany({
      where: { appointment_reminders_enabled: true, ...(companyId ? { id: companyId } : {}) },
      select: {
        id: true,
        name: true,
        phone: true,
        appointment_reminder_hours: true,
        appointment_reminder_message: true,
      },
    });

    for (const company of companies) {
      const hours = company.appointment_reminder_hours ?? 24;
      const now = new Date();
      const windowFrom = new Date(now.getTime() + hours * 60 * 60 * 1000);
      const windowTo = new Date(windowFrom.getTime() + 24 * 60 * 60 * 1000);

      const jobs = await this.prisma.client.job.findMany({
        where: {
          company_id: company.id,
          status: { in: ['SCHEDULED' as never, 'IN_PROGRESS' as never] },
          scheduled_at: { gte: windowFrom, lt: windowTo },
          reminder_sent_at: null,
          customer: { email: { not: null } },
        },
        include: {
          customer: { select: { name: true, email: true } },
          engineer: { select: { name: true } },
        },
      });

      for (const job of jobs) {
        if (!job.customer?.email || !job.scheduled_at) continue;

        try {
          await this.sendAppointmentReminderEmail({
            toEmail: job.customer.email,
            customerName: job.customer.name,
            companyName: company.name,
            companyPhone: company.phone ?? null,
            jobTitle: job.title,
            scheduledAt: new Date(job.scheduled_at),
            engineerName: job.engineer?.name ?? null,
            customMessage: company.appointment_reminder_message ?? null,
          });

          await this.prisma.client.job.update({
            where: { id: job.id },
            data: { reminder_sent_at: new Date() },
          });

          this.logger.log(
            `Appointment reminder sent for job "${job.title}" to ${job.customer.email}`,
          );

          void this.comms.log({
            company_id:  company.id,
            customer_id: job.customer_id ?? undefined,
            job_id:      job.id,
            type:        'APPOINTMENT_REMINDER',
            subject:     `Appointment reminder — ${job.title}`,
            to_email:    job.customer.email,
            reference:   job.title,
          });
        } catch (err) {
          this.logger.error(
            `Appointment reminder failed for job ${job.id}: ${String(err)}`,
          );
        }
      }
    }
  }

  private async sendAppointmentReminderEmail(data: {
    toEmail: string;
    customerName: string;
    companyName: string;
    companyPhone: string | null;
    jobTitle: string;
    scheduledAt: Date;
    engineerName: string | null;
    customMessage: string | null;
  }) {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return;

    const resend = new Resend(resendKey);

    const dayStr = data.scheduledAt.toLocaleDateString('en-GB', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    });
    const timeStr = data.scheduledAt.toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit',
    });

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = data.scheduledAt.toDateString() === tomorrow.toDateString();
    const whenStr = isTomorrow ? `tomorrow, ${dayStr}` : `on ${dayStr}`;

    const { error } = await resend.emails.send({
      from: process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
      to: data.toEmail,
      subject: `Appointment reminder — ${data.jobTitle} ${isTomorrow ? 'tomorrow' : `on ${dayStr}`}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
          <div style="background:#1d4ed8;padding:24px 32px;border-radius:8px 8px 0 0;">
            <h1 style="color:white;margin:0;font-size:20px;">${data.companyName}</h1>
            <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">Appointment Reminder</p>
          </div>
          <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:28px;">
            <p style="margin:0 0 16px;">Dear ${data.customerName},</p>
            <p style="color:#555;margin:0 0 20px;">
              This is a friendly reminder that <strong>${data.companyName}</strong> will be attending
              <strong>${whenStr} at ${timeStr}</strong> for your <strong>${data.jobTitle}</strong>.
            </p>
            <table style="width:100%;font-size:13px;border-collapse:collapse;background:#f9fafb;border-radius:8px;margin-bottom:20px;">
              <tr>
                <td style="padding:10px 16px;color:#888;width:130px;">Date</td>
                <td style="padding:10px 16px;font-weight:600;">${dayStr}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:10px 16px;color:#888;">Time</td>
                <td style="padding:10px 16px;font-weight:600;">${timeStr}</td>
              </tr>
              ${data.engineerName ? `
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:10px 16px;color:#888;">Engineer</td>
                <td style="padding:10px 16px;">${data.engineerName}</td>
              </tr>` : ''}
              ${data.companyPhone ? `
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:10px 16px;color:#888;">Contact</td>
                <td style="padding:10px 16px;">
                  <a href="tel:${data.companyPhone}" style="color:#1d4ed8;text-decoration:none;">${data.companyPhone}</a>
                </td>
              </tr>` : ''}
            </table>
            ${data.customMessage ? `
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
              <p style="margin:0;font-size:13px;color:#1e40af;">${data.customMessage}</p>
            </div>` : ''}
            <p style="color:#888;font-size:12px;margin:0;">
              If you need to reschedule, please contact us as soon as possible.
            </p>
          </div>
        </div>
      `,
    });

    if (error) throw new Error(`Appointment reminder failed: ${error.message}`);
  }

  // ── Manual triggers (for testing) ────────────────────────────────────────

  async triggerPaymentReminders(companyId: string) {
    await this.sendPaymentReminders(companyId);
    return { triggered: true };
  }

  async triggerCp12Reminders(companyId: string) {
    await this.sendCp12Renewals(companyId);
    return { triggered: true };
  }

  async triggerQuoteReminders(companyId: string) {
    await this.sendQuoteAcceptanceReminders(companyId);
    return { triggered: true };
  }

  async triggerAppointmentReminders(companyId: string) {
    await this.sendAppointmentReminders(companyId);
    return { triggered: true };
  }
}
