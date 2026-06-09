import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { PrismaService } from '../../prisma/prisma.service';
import { trialReminderEmailHtml, trialReminderSubject } from './trial-reminder.email';

@Injectable()
export class TrialReminderService {
  private readonly logger = new Logger(TrialReminderService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sendReminders(): Promise<void> {
    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    await Promise.all([
      this.sendRemindersForDaysLeft(todayUtc, 4),
      this.sendRemindersForDaysLeft(todayUtc, 1),
    ]);
  }

  private async sendRemindersForDaysLeft(todayUtc: Date, daysLeft: number): Promise<void> {
    const windowStart = new Date(todayUtc);
    windowStart.setUTCDate(windowStart.getUTCDate() + daysLeft);
    const windowEnd = new Date(windowStart);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);

    const sentAtField = daysLeft === 4
      ? 'trial_reminder_4_days_sent_at'
      : 'trial_reminder_1_day_sent_at';

    const companies = await this.prisma.client.company.findMany({
      where: {
        subscription_status: 'TRIAL',
        trial_ends_at: { gte: windowStart, lt: windowEnd },
        [sentAtField]: null,
      },
      select: {
        id: true,
        name: true,
        users: {
          where: { role: 'OWNER' },
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (companies.length === 0) return;

    this.logger.log(`Sending ${daysLeft}-day reminders to ${companies.length} company/companies`);

    const resendKey = process.env.RESEND_API_KEY;
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3001';

    for (const company of companies) {
      const owners = company.users;
      if (owners.length === 0) {
        this.logger.warn(`Company ${company.id} has no OWNER user — skipping reminder`);
        continue;
      }

      let emailSent = false;

      for (const owner of owners) {
        if (!resendKey) {
          this.logger.warn(`RESEND_API_KEY not set — skipping reminder email to ${owner.email}`);
          continue;
        }

        try {
          const resend = new Resend(resendKey);
          const { error } = await resend.emails.send({
            from: process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
            to: owner.email,
            subject: trialReminderSubject(daysLeft),
            html: trialReminderEmailHtml(owner.name, daysLeft, `${frontendUrl}/dashboard`),
          });
          if (error) throw new Error(error.message);
          this.logger.log(`${daysLeft}-day reminder sent to ${owner.email} (company ${company.id})`);
          emailSent = true;
        } catch (err) {
          this.logger.error(`Failed to send ${daysLeft}-day reminder to ${owner.email}`, err);
        }
      }

      // Only mark as sent if at least one email was dispatched successfully
      if (emailSent) {
        await this.prisma.client.company.update({
          where: { id: company.id },
          data: { [sentAtField]: new Date() },
        });
      }
    }
  }
}
