import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Resend }     from 'resend';
import { PrismaService } from '../../prisma/prisma.service';

const JOB_INCLUDE = {
  customer:  { select: { id: true, name: true, email: true, address_line1: true, city: true, postcode: true } },
  engineer:  { select: { id: true, name: true } },
  timesheets: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { date: 'asc' as const },
  },
  gasCertificates: { orderBy: { created_at: 'asc' as const } },
  photos:    { include: { user: { select: { id: true, name: true } } }, orderBy: { created_at: 'asc' as const } },
} as const;

const JSR_INCLUDE = {
  customer: { select: { id: true, name: true, email: true } },
  job: {
    select: {
      id: true, title: true, description: true,
      notes: true, scheduled_at: true, status: true,
    },
  },
} as const;

@Injectable()
export class JsrService {
  private readonly logger = new Logger(JsrService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string, jobId: string) {
    return this.prisma.client.jobServiceReport.findMany({
      where:   { company_id: companyId, job_id: jobId },
      include: JSR_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
  }

  async getOne(companyId: string, jsrId: string) {
    const jsr = await this.prisma.client.jobServiceReport.findFirst({
      where:   { id: jsrId, company_id: companyId },
      include: JSR_INCLUDE,
    });
    if (!jsr) throw new NotFoundException('Report not found');
    return jsr;
  }

  async previewJobData(companyId: string, jobId: string) {
    const job = await this.prisma.client.job.findFirst({
      where:   { id: jobId, company_id: companyId },
      include: JOB_INCLUDE,
    });
    if (!job) throw new NotFoundException('Job not found');

    const warnings: string[] = [];
    if (!job.timesheets.length)      warnings.push('No timesheets recorded for this job');
    if (!job.gasCertificates.length) warnings.push('No gas certificates for this job');
    if (!job.photos.length)          warnings.push('No photos attached to this job');
    if (!job.customer?.email)        warnings.push('Customer has no email address — cannot email report');

    return { job, warnings };
  }

  async create(companyId: string, jobId: string) {
    if (!companyId) throw new BadRequestException('Missing company');
    const job = await this.prisma.client.job.findFirst({
      where:   { id: jobId, company_id: companyId },
      include: { customer: true },
    });
    if (!job) throw new NotFoundException('Job not found');

    const company = await this.prisma.client.company.findUnique({
      where:  { id: companyId },
      select: { jsr_prefix: true, jsr_next_number: true, jsr_default_terms: true },
    });

    return this.prisma.client.$transaction(async (tx) => {
      const prefix       = company?.jsr_prefix      ?? 'JSR';
      const num          = company?.jsr_next_number  ?? 1;
      const reportNumber = `${prefix}-${String(num).padStart(3, '0')}`;

      await tx.company.update({
        where: { id: companyId },
        data:  { jsr_next_number: { increment: 1 } },
      });

      return tx.jobServiceReport.create({
        data: {
          company_id:    companyId,
          job_id:        jobId,
          customer_id:   job.customer_id ?? null,
          report_number: reportNumber,
          description:   [job.description, job.notes].filter(Boolean).join('\n\n') || null,
          terms:         company?.jsr_default_terms ?? null,
        },
        include: JSR_INCLUDE,
      });
    });
  }

  async update(companyId: string, jsrId: string, dto: {
    title?:           string;
    description?:     string | null;
    terms?:           string | null;
    show_timesheets?: boolean;
    show_certs?:      boolean;
    show_photos?:     boolean;
    show_notes?:      boolean;
  }) {
    const jsr = await this.getOne(companyId, jsrId);
    if (['ACCEPTED', 'DECLINED'].includes(jsr.status)) {
      throw new BadRequestException('Cannot edit a signed-off report');
    }
    return this.prisma.client.jobServiceReport.update({
      where:   { id: jsrId },
      data:    dto as never,
      include: JSR_INCLUDE,
    });
  }

  async generatePdf(companyId: string, jsrId: string): Promise<Buffer> {
    const jsr = await this.getOne(companyId, jsrId);
    const job = await this.prisma.client.job.findFirst({
      where:   { id: jsr.job_id, company_id: companyId },
      include: JOB_INCLUDE,
    });
    if (!job) throw new NotFoundException('Job not found');
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      omit:  { stripe_customer_id: true, stripe_subscription_id: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const { buildJsrHtml } = await import('./jsr.pdf.js');
    const html = buildJsrHtml(jsr as never, job as never, company as never);

    const puppeteer = await import('puppeteer');
    const browser   = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdf = await page.pdf({
        format: 'A4', printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  async sendToCustomer(companyId: string, jsrId: string) {
    const jsr     = await this.getOne(companyId, jsrId);
    const company = await this.prisma.client.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');
    if (!jsr.customer) throw new BadRequestException('No customer on this report');
    if (!jsr.customer.email) throw new BadRequestException('Customer has no email address');

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) throw new BadRequestException('Email not configured');

    const token = jsr.acceptance_token ?? randomUUID();
    if (!jsr.acceptance_token) {
      await this.prisma.client.jobServiceReport.update({
        where: { id: jsrId },
        data:  { acceptance_token: token },
      });
    }

    const appUrl    = process.env.FRONTEND_URL ?? 'http://localhost:3001';
    const reportUrl = `${appUrl}/service-report/${token}`;

    let pdfBuffer: Buffer | undefined;
    try { pdfBuffer = await this.generatePdf(companyId, jsrId); }
    catch (err) { this.logger.warn(`JSR PDF failed: ${String(err)}`); }

    const resend = new Resend(resendKey);
    const { error } = await resend.emails.send({
      from:    process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
      to:      jsr.customer.email,
      subject: `Job Service Report — ${jsr.job?.title ?? jsr.report_number}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#111;">Job Service Report from ${company.name}</h2>
          <p>Please find your job service report for
          <strong>${jsr.job?.title ?? 'your recent job'}</strong>.</p>
          <p>You can review and sign off the report using the button below.</p>
          <a href="${reportUrl}"
            style="display:inline-block;background:#1d4ed8;color:white;
              padding:14px 28px;border-radius:6px;text-decoration:none;
              font-weight:bold;font-size:15px;margin:16px 0;">
            View &amp; Sign Off Report →
          </a>
          <p style="color:#888;font-size:12px;margin-top:16px;">
            Or copy this link: ${reportUrl}
          </p>
        </div>
      `,
      ...(pdfBuffer ? {
        attachments: [{ filename: `${jsr.report_number}.pdf`, content: pdfBuffer }],
      } : {}),
    });

    if (error) throw new Error(`Failed to send: ${error.message}`);

    await this.prisma.client.jobServiceReport.update({
      where: { id: jsrId },
      data: {
        status:       jsr.status === 'DRAFT' ? 'SENT' : jsr.status,
        last_sent_at: new Date(),
      },
    });

    this.logger.log(`JSR ${jsr.report_number} sent to ${jsr.customer.email}`);
    return { sent: true };
  }

  async remove(companyId: string, jsrId: string): Promise<void> {
    const jsr = await this.getOne(companyId, jsrId);
    if (jsr.status !== 'DRAFT') {
      throw new BadRequestException('Only draft reports can be deleted');
    }
    await this.prisma.client.jobServiceReport.delete({ where: { id: jsrId } });
  }

  async getPublicByToken(token: string) {
    const jsr = await this.prisma.client.jobServiceReport.findUnique({
      where:   { acceptance_token: token },
      include: {
        customer: { select: { name: true, email: true } },
        job: { include: JOB_INCLUDE },
        company: {
          select: {
            name: true, logo_url: true, phone: true,
            address_line1: true, city: true, postcode: true,
            invoice_accent_colour: true,
          },
        },
      },
    });
    if (!jsr) throw new NotFoundException('Report not found');
    return { ...jsr, acceptance_token: undefined };
  }

  async acceptByToken(token: string) {
    const jsr = await this.prisma.client.jobServiceReport.findUnique({
      where:  { acceptance_token: token },
      select: { id: true, status: true },
    });
    if (!jsr) throw new NotFoundException('Report not found');
    if (jsr.status === 'ACCEPTED') return { success: true, already: true };
    await this.prisma.client.jobServiceReport.update({
      where: { id: jsr.id },
      data:  { status: 'ACCEPTED', accepted_at: new Date() },
    });
    return { success: true, already: false };
  }

  async declineByToken(token: string, reason?: string) {
    const jsr = await this.prisma.client.jobServiceReport.findUnique({
      where:  { acceptance_token: token },
      select: { id: true, status: true },
    });
    if (!jsr) throw new NotFoundException('Report not found');
    if (jsr.status === 'DECLINED') return { success: true, already: true };
    await this.prisma.client.jobServiceReport.update({
      where: { id: jsr.id },
      data: {
        status:         'DECLINED',
        declined_at:    new Date(),
        decline_reason: reason ?? null,
      },
    });
    return { success: true, already: false };
  }
}
