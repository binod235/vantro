import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Resend } from 'resend';
import { PrismaService } from '../../prisma/prisma.service';
import { CommsService }  from '../comms/comms.service';
import type { CreateGasCertDto } from './dto/create-gas-cert.dto';
import type { UpdateGasCertDto } from './dto/update-gas-cert.dto';

const CERT_INCLUDE = {
  customer: { select: { id: true, name: true, email: true } },
  job: { select: { id: true, title: true, engineer_id: true } },
  engineer: { select: { id: true, name: true } },
} as const;

@Injectable()
export class GasCertificatesService {
  private readonly logger = new Logger(GasCertificatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comms: CommsService,
  ) {}

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async generateCertNumber(
    tx: Parameters<Parameters<typeof this.prisma.client.$transaction>[0]>[0],
    companyId: string,
  ): Promise<string> {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { gas_cert_next_number: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    const num = company.gas_cert_next_number ?? 1;
    const certNumber = `GAS-${String(num).padStart(3, '0')}`;
    await tx.company.update({
      where: { id: companyId },
      data: { gas_cert_next_number: num + 1 },
    });
    return certNumber;
  }

  private getNextDueDate(certType: string, inspectionDate: Date): Date | null {
    if (certType === 'CP12' || certType === 'BOILER_SERVICE') {
      const d = new Date(inspectionDate);
      d.setFullYear(d.getFullYear() + 1);
      return d;
    }
    return null;
  }

  private async verifyCustomer(customerId: string, companyId: string) {
    const c = await this.prisma.client.customer.findFirst({
      where: { id: customerId, company_id: companyId },
    });
    if (!c) throw new NotFoundException('Customer not found');
    return c;
  }

  /** Check engineer access. Returns the cert or throws 404 (never 403). */
  private async getOneEnforced(
    companyId: string,
    certId: string,
    userId: string,
    role: string,
  ) {
    const cert = await this.prisma.client.gasSafetyCertificate.findFirst({
      where: { id: certId, company_id: companyId },
      include: CERT_INCLUDE,
    });
    if (!cert) throw new NotFoundException('Certificate not found');

    if (role === 'ENGINEER') {
      const isOwnCert = cert.engineer_id === userId;
      const isOwnJob = cert.job
        ? (cert.job as { engineer_id: string | null }).engineer_id === userId
        : false;
      if (!isOwnCert && !isOwnJob) throw new NotFoundException('Certificate not found');
    }

    return cert;
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async list(
    companyId: string,
    userId: string,
    role: string,
    filters?: { cert_type?: string; status?: string; search?: string },
  ) {
    const where: Record<string, unknown> = { company_id: companyId };

    if (role === 'ENGINEER') {
      where.OR = [
        { engineer_id: userId },
        { job: { engineer_id: userId } },
      ];
    }

    if (filters?.cert_type) where.cert_type = filters.cert_type;
    if (filters?.status) where.status = filters.status;

    if (filters?.search) {
      // When an engineer filter is active, combine with AND to preserve the scope
      const searchOr = [
        { cert_number: { contains: filters.search, mode: 'insensitive' as const } },
        { customer: { name: { contains: filters.search, mode: 'insensitive' as const } } },
      ];
      if (role === 'ENGINEER') {
        // Already have OR on the root — move both into AND
        const engineerOr = where.OR as unknown[];
        delete where.OR;
        where.AND = [{ OR: engineerOr }, { OR: searchOr }];
      } else {
        where.OR = searchOr;
      }
    }

    return this.prisma.client.gasSafetyCertificate.findMany({
      where,
      include: CERT_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
  }

  // ── Get one ───────────────────────────────────────────────────────────────

  async getOne(companyId: string, certId: string, userId: string, role: string) {
    return this.getOneEnforced(companyId, certId, userId, role);
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async create(
    companyId: string,
    userId: string,
    role: string,
    dto: CreateGasCertDto,
  ) {
    await this.verifyCustomer(dto.customer_id, companyId);

    if (role === 'ENGINEER' && dto.job_id) {
      const job = await this.prisma.client.job.findFirst({
        where: { id: dto.job_id, company_id: companyId, engineer_id: userId },
      });
      if (!job) {
        throw new BadRequestException(
          'You can only create certificates for jobs assigned to you',
        );
      }
    }

    const inspectionDate = new Date(dto.inspection_date);

    return this.prisma.client.$transaction(async (tx) => {
      const certNumber = await this.generateCertNumber(tx, companyId);
      const nextDue = dto.next_due_date
        ? new Date(dto.next_due_date)
        : this.getNextDueDate(dto.cert_type, inspectionDate);

      return tx.gasSafetyCertificate.create({
        data: {
          company_id: companyId,
          customer_id: dto.customer_id,
          job_id: dto.job_id ?? null,
          engineer_id: dto.engineer_id ?? userId,
          cert_type: dto.cert_type as never,
          cert_number: certNumber,
          inspection_date: inspectionDate,
          property_address: dto.property_address ?? null,
          property_city: dto.property_city ?? null,
          property_postcode: dto.property_postcode ?? null,
          engineer_name: dto.engineer_name ?? null,
          gas_safe_number: dto.gas_safe_number ?? null,
          data: dto.data as never,
          notes: dto.notes ?? null,
          next_due_date: nextDue,
        },
        include: CERT_INCLUDE,
      });
    });
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async update(
    companyId: string,
    certId: string,
    userId: string,
    role: string,
    dto: UpdateGasCertDto,
  ) {
    const cert = await this.getOneEnforced(companyId, certId, userId, role);

    if (cert.status === 'COMPLETE') {
      throw new BadRequestException('Cannot edit a completed certificate');
    }

    if (dto.customer_id) await this.verifyCustomer(dto.customer_id, companyId);

    if (role === 'ENGINEER') {
      if (dto.job_id) {
        const job = await this.prisma.client.job.findFirst({
          where: { id: dto.job_id, company_id: companyId, engineer_id: userId },
        });
        if (!job) {
          throw new BadRequestException(
            'You can only assign certificates to jobs assigned to you',
          );
        }
      }
      if (dto.engineer_id && dto.engineer_id !== userId) {
        throw new BadRequestException('You cannot reassign a certificate to another engineer');
      }
    }

    return this.prisma.client.gasSafetyCertificate.update({
      where: { id: certId },
      data: {
        customer_id: dto.customer_id ?? cert.customer_id ?? undefined,
        job_id: dto.job_id !== undefined ? dto.job_id : cert.job_id,
        engineer_id: dto.engineer_id !== undefined ? dto.engineer_id : cert.engineer_id,
        inspection_date: dto.inspection_date ? new Date(dto.inspection_date) : cert.inspection_date,
        property_address: dto.property_address !== undefined ? dto.property_address : cert.property_address,
        property_city: dto.property_city !== undefined ? dto.property_city : cert.property_city,
        property_postcode: dto.property_postcode !== undefined ? dto.property_postcode : cert.property_postcode,
        engineer_name: dto.engineer_name !== undefined ? dto.engineer_name : cert.engineer_name,
        gas_safe_number: dto.gas_safe_number !== undefined ? dto.gas_safe_number : cert.gas_safe_number,
        data: dto.data !== undefined ? (dto.data as never) : (cert.data as never),
        notes: dto.notes !== undefined ? dto.notes : cert.notes,
        next_due_date: dto.next_due_date ? new Date(dto.next_due_date) : cert.next_due_date,
      },
      include: CERT_INCLUDE,
    });
  }

  // ── Mark Complete ─────────────────────────────────────────────────────────

  async markComplete(companyId: string, certId: string, userId: string, role: string) {
    await this.getOneEnforced(companyId, certId, userId, role);
    return this.prisma.client.gasSafetyCertificate.update({
      where: { id: certId },
      data: { status: 'COMPLETE' as never },
      include: CERT_INCLUDE,
    });
  }

  // ── Remove (OWNER only — controller enforces) ─────────────────────────────

  async remove(companyId: string, certId: string): Promise<void> {
    const cert = await this.prisma.client.gasSafetyCertificate.findFirst({
      where: { id: certId, company_id: companyId },
    });
    if (!cert) throw new NotFoundException('Certificate not found');
    if (cert.status !== 'DRAFT') {
      throw new ConflictException('Only draft certificates can be deleted');
    }
    await this.prisma.client.gasSafetyCertificate.delete({ where: { id: certId } });
  }

  // ── Generate PDF ──────────────────────────────────────────────────────────

  async generatePdf(
    companyId: string,
    certId: string,
    userId: string,
    role: string,
  ): Promise<Buffer> {
    const cert = await this.getOneEnforced(companyId, certId, userId, role);
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      omit: { stripe_customer_id: true, stripe_subscription_id: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const { buildGasCertHtml } = await import('./gas-cert.pdf.js') as {
      buildGasCertHtml: (c: unknown, co: unknown) => string;
    };
    const html = buildGasCertHtml(cert, company);

    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  // ── Send Email ────────────────────────────────────────────────────────────

  async sendEmail(
    companyId: string,
    certId: string,
    userId: string,
    role: string,
  ) {
    const cert = await this.getOneEnforced(companyId, certId, userId, role);
    const company = await this.prisma.client.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');
    if (!cert.customer?.email) {
      throw new BadRequestException('Customer email is required to send certificate');
    }
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) throw new BadRequestException('Email service is not configured');

    let pdfBuffer: Buffer | undefined;
    try {
      pdfBuffer = await this.generatePdf(companyId, certId, userId, role);
    } catch (err) {
      this.logger.warn(`PDF generation failed for cert ${certId}: ${String(err)}`);
    }

    const certTypeLabel: Record<string, string> = {
      CP12: 'Gas Safety Certificate (CP12)',
      BOILER_SERVICE: 'Boiler Service Record',
      GAS_WARNING: 'Gas Warning Notice',
      INSTALLATION: 'Installation Record',
    };
    const label = certTypeLabel[cert.cert_type] ?? 'Gas Certificate';

    const resend = new Resend(resendKey);
    const { error: emailError } = await resend.emails.send({
      from: process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
      to: cert.customer.email,
      subject: `${label} ${cert.cert_number} — ${company.name}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#111;">${label}</h2>
          <p>Please find your ${label.toLowerCase()} <strong>${cert.cert_number}</strong> attached from ${company.name}.</p>
          <table style="font-size:14px;border-collapse:collapse;margin:16px 0;">
            <tr><td style="color:#888;padding:4px 16px 4px 0;">Property</td><td><strong>${[cert.property_address, cert.property_city, cert.property_postcode].filter(Boolean).join(', ') || 'See certificate'}</strong></td></tr>
            <tr><td style="color:#888;padding:4px 16px 4px 0;">Inspection Date</td><td><strong>${new Date(cert.inspection_date).toLocaleDateString('en-GB')}</strong></td></tr>
            ${cert.next_due_date ? `<tr><td style="color:#888;padding:4px 16px 4px 0;">Next Due</td><td><strong>${new Date(cert.next_due_date).toLocaleDateString('en-GB')}</strong></td></tr>` : ''}
          </table>
          <p style="color:#999;font-size:12px;margin-top:16px;">If you have any questions, please contact ${company.name}.</p>
        </div>
      `,
      ...(pdfBuffer
        ? { attachments: [{ filename: `${cert.cert_number}.pdf`, content: pdfBuffer }] }
        : {}),
    });
    if (emailError) throw new Error(`Failed to send certificate email: ${emailError.message}`);

    this.logger.log(`Certificate ${cert.cert_number} emailed to ${cert.customer.email}`);

    void this.comms.log({
      company_id:  companyId,
      customer_id: cert.customer_id ?? undefined,
      job_id:      cert.job_id      ?? undefined,
      type:        'GAS_CERT_SENT',
      subject:     `Gas Certificate ${cert.cert_number}`,
      to_email:    cert.customer.email,
      reference:   cert.cert_number,
    });

    await this.prisma.client.gasSafetyCertificate.update({
      where: { id: certId },
      data: {
        status: cert.status === 'DRAFT' ? 'SENT' as never : cert.status as never,
        last_sent_at: new Date(),
      },
    });

    return { sent: true };
  }
}
