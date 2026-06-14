import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JobNotificationsService {
  private readonly logger = new Logger(JobNotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sendJobAssignedEmail(jobId: string) {
    try {
      const job = await this.prisma.client.job.findUnique({
        where: { id: jobId },
        include: {
          engineer: { select: { id: true, name: true, email: true } },
          customer: { select: { name: true, address_line1: true, city: true, postcode: true, phone: true } },
          company:  { select: { name: true } },
        },
      });

      if (!job?.engineer?.email) return;

      const resend  = new Resend(process.env.RESEND_API_KEY);
      const appUrl  = process.env.FRONTEND_URL ?? 'http://localhost:3001';
      const jobUrl  = `${appUrl}/dashboard/jobs/${job.id}`;

      const scheduledStr = job.scheduled_at
        ? new Date(job.scheduled_at).toLocaleDateString('en-GB', {
            weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
          }) + ' at ' + new Date(job.scheduled_at).toLocaleTimeString('en-GB', {
            hour: '2-digit', minute: '2-digit',
          })
        : 'Not yet scheduled';

      const address = [
        job.customer?.address_line1,
        job.customer?.city,
        job.customer?.postcode,
      ].filter(Boolean).join(', ');

      const { error } = await resend.emails.send({
        from:    process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
        to:      job.engineer.email,
        subject: `New job assigned: ${job.title}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
            <div style="background:#1d4ed8;padding:24px 32px;border-radius:8px 8px 0 0;">
              <h1 style="color:white;margin:0;font-size:18px;">${job.company?.name ?? 'Vantro'}</h1>
              <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">New job assigned to you</p>
            </div>
            <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:28px;">
              <h2 style="margin:0 0 16px;font-size:16px;">${job.title}</h2>
              <table style="width:100%;font-size:13px;border-collapse:collapse;background:#f9fafb;border-radius:8px;margin-bottom:20px;">
                <tr><td style="padding:10px 16px;color:#888;width:120px;">Customer</td><td style="padding:10px 16px;font-weight:600;">${job.customer?.name ?? '—'}</td></tr>
                ${address ? `<tr style="border-top:1px solid #e5e7eb;"><td style="padding:10px 16px;color:#888;">Address</td><td style="padding:10px 16px;">${address}</td></tr>` : ''}
                ${job.customer?.phone ? `<tr style="border-top:1px solid #e5e7eb;"><td style="padding:10px 16px;color:#888;">Phone</td><td style="padding:10px 16px;">${job.customer.phone}</td></tr>` : ''}
                <tr style="border-top:1px solid #e5e7eb;"><td style="padding:10px 16px;color:#888;">Scheduled</td><td style="padding:10px 16px;font-weight:600;">${scheduledStr}</td></tr>
                ${job.duration_minutes ? `<tr style="border-top:1px solid #e5e7eb;"><td style="padding:10px 16px;color:#888;">Duration</td><td style="padding:10px 16px;">${Math.floor(job.duration_minutes / 60)}h${job.duration_minutes % 60 > 0 ? ` ${job.duration_minutes % 60}m` : ''}</td></tr>` : ''}
                ${job.description ? `<tr style="border-top:1px solid #e5e7eb;"><td style="padding:10px 16px;color:#888;">Details</td><td style="padding:10px 16px;">${job.description}</td></tr>` : ''}
                ${job.schedule_note ? `<tr style="border-top:1px solid #e5e7eb;"><td style="padding:10px 16px;color:#888;">Note</td><td style="padding:10px 16px;color:#d97706;">${job.schedule_note}</td></tr>` : ''}
              </table>
              <a href="${jobUrl}"
                style="display:inline-block;background:#1d4ed8;color:white;padding:12px 24px;
                  border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px;">
                View Job →
              </a>
              <p style="margin:20px 0 0;font-size:12px;color:#999;">
                Hi ${job.engineer.name}, you have been assigned this job by ${job.company?.name ?? 'your company'}.
              </p>
            </div>
          </div>
        `,
      });

      if (error) {
        this.logger.warn(`Failed to send job assignment email: ${error.message}`);
      } else {
        this.logger.log(`Job assignment email sent to ${job.engineer.email} for job ${jobId}`);
      }
    } catch (err) {
      this.logger.error(`Job assignment notification failed for job ${jobId}: ${String(err)}`);
    }
  }
}
