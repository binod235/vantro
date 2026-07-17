import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Resend } from 'resend';
import { PrismaService } from '../../prisma/prisma.service';
import { CommsService } from '../comms/comms.service';
import { onMyWayHtml } from '../reminders/templates/on-my-way.email';

const RATE_LIMIT_HOURS = 4;

@Injectable()
export class OnMyWayService {
  private readonly logger = new Logger(OnMyWayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comms: CommsService,
  ) {}

  async send(jobId: string, companyId: string, engineerId: string): Promise<{ sent: boolean }> {
    const job = await this.prisma.client.job.findFirst({
      where: { id: jobId, company_id: companyId },
      include: {
        customer: { select: { id: true, name: true, email: true } },
      },
    });

    if (!job) throw new NotFoundException('Job not found');
    if (!job.customer?.email) throw new BadRequestException('Customer has no email address');

    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        logo_url: true,
        phone: true,
        branding_footer_enabled: true,
        customer_notifications_enabled: true,
      },
    });

    if (!company?.customer_notifications_enabled) {
      return { sent: false };
    }

    // Rate limit: once per RATE_LIMIT_HOURS per job
    if (job.on_my_way_sent_at) {
      const cutoff = new Date(Date.now() - RATE_LIMIT_HOURS * 60 * 60 * 1000);
      if (job.on_my_way_sent_at > cutoff) {
        throw new BadRequestException(
          `On My Way already sent within the last ${RATE_LIMIT_HOURS} hours`,
        );
      }
    }

    const engineer = await this.prisma.client.user.findUnique({
      where: { id: engineerId },
      select: { name: true },
    });

    const owner = await this.prisma.client.user.findFirst({
      where: { companyId: company.id, role: 'OWNER' },
      select: { email: true },
    });
    const companyEmail = owner?.email ?? (process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk');

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return { sent: false };

    const subject = `Your engineer is on the way — ${company.name}`;
    const html = onMyWayHtml({
      customerName: job.customer.name,
      companyName: company.name,
      companyEmail,
      companyPhone: company.phone ?? undefined,
      engineerName: engineer?.name ?? 'Your engineer',
      jobTitle: job.title,
      logoUrl: company.logo_url,
      brandingFooterEnabled: company.branding_footer_enabled,
    });

    const resend = new Resend(resendKey);
    const { error } = await resend.emails.send({
      from: process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
      to: job.customer.email,
      replyTo: companyEmail,
      subject,
      html,
    });

    if (error) throw new Error(error.message);

    await this.prisma.client.job.update({
      where: { id: jobId },
      data: { on_my_way_sent_at: new Date() },
    });

    void this.prisma.client.autopilotEvent.create({
      data: {
        company_id: companyId,
        type: 'ON_MY_WAY_SENT',
        title: `On My Way sent to ${job.customer.name} for job: ${job.title}`,
        meta: { jobId, engineerId },
      },
    }).catch(() => {});

    void this.comms.log({
      company_id: companyId,
      customer_id: job.customer.id,
      job_id: jobId,
      type: 'ON_MY_WAY',
      subject,
      to_email: job.customer.email,
      reference: job.title,
      notes: `On My Way sent by engineer ${engineer?.name ?? engineerId}`,
    });

    this.logger.log(`On My Way sent for job ${jobId} → ${job.customer.email}`);

    return { sent: true };
  }
}
