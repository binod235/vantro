import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Resend } from 'resend';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateQuoteDto } from './dto/create-quote.dto';
import type { UpdateQuoteDto } from './dto/update-quote.dto';

// ─── Line item types ──────────────────────────────────────────────────────────

interface InputLineItem {
  description: string;
  quantity: number;
  unit_price_pence: number;
  vat_type: string;
  vat_rate: number;
}

interface CalculatedLineItem extends InputLineItem {
  id: string;
  net_pence: number;
  vat_pence: number;
  reverse_charge_vat_pence: number;
}

interface QuoteTotals {
  subtotal_pence: number;
  vat_amount_pence: number;
  reverse_charge_vat_pence: number;
  total_pence: number;
  is_reverse_charge: boolean;
}

// ─── Calculation helpers ──────────────────────────────────────────────────────

function calcLineItem(item: InputLineItem, index: number): CalculatedLineItem {
  const net = Math.round(item.quantity * item.unit_price_pence);
  let vat = 0;
  let rcVat = 0;
  if (item.vat_type === 'STANDARD') {
    vat = Math.round((net * item.vat_rate) / 100);
  } else if (item.vat_type === 'REVERSE_CHARGE') {
    rcVat = Math.round((net * item.vat_rate) / 100);
  }
  return {
    ...item,
    id: `item_${index}`,
    net_pence: net,
    vat_pence: vat,
    reverse_charge_vat_pence: rcVat,
  };
}

function calcTotals(items: CalculatedLineItem[]): QuoteTotals {
  const subtotal = items.reduce((s, i) => s + i.net_pence, 0);
  const vat = items.reduce((s, i) => s + i.vat_pence, 0);
  const rcVat = items.reduce((s, i) => s + i.reverse_charge_vat_pence, 0);
  return {
    subtotal_pence: subtotal,
    vat_amount_pence: vat,
    reverse_charge_vat_pence: rcVat,
    total_pence: subtotal + vat,
    is_reverse_charge: items.some(i => i.vat_type === 'REVERSE_CHARGE'),
  };
}

// ─── Prisma include ───────────────────────────────────────────────────────────

const QUOTE_INCLUDE = {
  customer: {
    select: {
      id: true, name: true, email: true, phone: true,
      address_line1: true, address_line2: true, city: true, postcode: true,
    },
  },
  job: { select: { id: true, title: true } },
  invoices: { select: { id: true, status: true, total_pence: true, invoice_number: true } },
} as const;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async verifyCustomer(customerId: string, companyId: string) {
    const c = await this.prisma.client.customer.findFirst({
      where: { id: customerId, company_id: companyId },
    });
    if (!c) throw new NotFoundException('Customer not found');
    return c;
  }

  private processLineItems(raw: InputLineItem[]) {
    if (!raw.length) throw new BadRequestException('Quote must have at least one line item');
    const items = raw.map((item, i) => calcLineItem(item, i));
    return { items, totals: calcTotals(items) };
  }

  private async generateQuoteNumber(
    tx: Parameters<Parameters<typeof this.prisma.client.$transaction>[0]>[0],
    companyId: string,
  ): Promise<string> {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { quote_prefix: true, quote_next_number: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    const prefix = company.quote_prefix ?? 'QUO';
    const num = company.quote_next_number ?? 1;
    const quoteNumber = `${prefix}-${String(num).padStart(3, '0')}`;
    await tx.company.update({
      where: { id: companyId },
      data: { quote_next_number: num + 1 },
    });
    return quoteNumber;
  }

  private getDefaultExpiry(expiryDays: number | null | undefined, issueDate: Date): Date {
    const days = expiryDays ?? 30;
    const expiry = new Date(issueDate);
    expiry.setDate(expiry.getDate() + days);
    return expiry;
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async list(companyId: string, filters?: { status?: string; search?: string }) {
    const where: Record<string, unknown> = { company_id: companyId };
    if (filters?.status) where.status = filters.status;
    if (filters?.search) {
      where.OR = [
        { quote_number: { contains: filters.search, mode: 'insensitive' } },
        { customer: { name: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }
    return this.prisma.client.quote.findMany({
      where,
      include: QUOTE_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
  }

  // ── Get one ───────────────────────────────────────────────────────────────

  async getOne(companyId: string, quoteId: string) {
    const quote = await this.prisma.client.quote.findFirst({
      where: { id: quoteId, company_id: companyId },
      include: QUOTE_INCLUDE,
    });
    if (!quote) throw new NotFoundException('Quote not found');
    return quote;
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async create(companyId: string, dto: CreateQuoteDto) {
    await this.verifyCustomer(dto.customer_id, companyId);
    const { items, totals } = this.processLineItems(dto.line_items);

    return this.prisma.client.$transaction(async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { quote_expiry_days: true },
      });
      const quoteNumber = await this.generateQuoteNumber(tx, companyId);
      const issueDate = dto.issue_date ? new Date(dto.issue_date) : new Date();
      const expiryDate = dto.expiry_date
        ? new Date(dto.expiry_date)
        : this.getDefaultExpiry(company?.quote_expiry_days, issueDate);

      return tx.quote.create({
        data: {
          company_id: companyId,
          customer_id: dto.customer_id,
          job_id: dto.job_id,
          quote_number: quoteNumber,
          reference: dto.reference,
          line_items: items as never,
          subtotal_pence: totals.subtotal_pence,
          vat_amount_pence: totals.vat_amount_pence,
          reverse_charge_vat_pence: totals.reverse_charge_vat_pence,
          total_pence: totals.total_pence,
          amount_pence: totals.total_pence,
          is_reverse_charge: totals.is_reverse_charge,
          reverse_charge_wording: totals.is_reverse_charge
            ? 'Reverse charge: customer to account for VAT to HMRC.'
            : null,
          issue_date: issueDate,
          expiry_date: expiryDate,
          notes: dto.notes,
        },
        include: QUOTE_INCLUDE,
      });
    });
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async update(companyId: string, quoteId: string, dto: UpdateQuoteDto) {
    const quote = await this.getOne(companyId, quoteId);
    if (['ACCEPTED', 'INVOICED'].includes(quote.status)) {
      throw new BadRequestException('Cannot edit an accepted or invoiced quote');
    }
    const rawItems = dto.line_items ?? (quote.line_items as unknown as InputLineItem[]);
    const { items, totals } = this.processLineItems(rawItems);

    return this.prisma.client.quote.update({
      where: { id: quoteId },
      data: {
        customer_id: dto.customer_id ?? quote.customer_id ?? undefined,
        job_id: dto.job_id !== undefined ? dto.job_id : quote.job_id,
        reference: dto.reference !== undefined ? dto.reference : quote.reference,
        line_items: items as never,
        subtotal_pence: totals.subtotal_pence,
        vat_amount_pence: totals.vat_amount_pence,
        reverse_charge_vat_pence: totals.reverse_charge_vat_pence,
        total_pence: totals.total_pence,
        amount_pence: totals.total_pence,
        is_reverse_charge: totals.is_reverse_charge,
        reverse_charge_wording: totals.is_reverse_charge
          ? 'Reverse charge: customer to account for VAT to HMRC.'
          : null,
        expiry_date: dto.expiry_date ? new Date(dto.expiry_date) : quote.expiry_date,
        issue_date: dto.issue_date ? new Date(dto.issue_date) : quote.issue_date,
        notes: dto.notes !== undefined ? dto.notes : quote.notes,
      },
      include: QUOTE_INCLUDE,
    });
  }

  // ── Remove ────────────────────────────────────────────────────────────────

  async remove(companyId: string, quoteId: string): Promise<void> {
    const quote = await this.getOne(companyId, quoteId);
    if (quote.status !== 'DRAFT') {
      throw new ConflictException('Only draft quotes can be deleted');
    }
    await this.prisma.client.quote.delete({ where: { id: quoteId } });
  }

  // ── Cancel ────────────────────────────────────────────────────────────────

  async cancel(companyId: string, quoteId: string) {
    const quote = await this.getOne(companyId, quoteId);
    if (['ACCEPTED', 'INVOICED'].includes(quote.status)) {
      throw new BadRequestException('Cannot cancel an accepted or invoiced quote');
    }
    return this.prisma.client.quote.update({
      where: { id: quoteId },
      data: { status: 'CANCELLED' as never },
      include: QUOTE_INCLUDE,
    });
  }

  // ── Generate PDF ─────────────────────────────────────────────────────────

  async generatePdf(companyId: string, quoteId: string): Promise<Buffer> {
    const quote = await this.getOne(companyId, quoteId);
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      omit: { stripe_customer_id: true, stripe_subscription_id: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    const { buildQuoteHtml } = await import('./quote.pdf.js') as { buildQuoteHtml: (q: unknown, c: unknown) => string };
    const html = buildQuoteHtml(quote as never, company as never);
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
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  // ── Send email ────────────────────────────────────────────────────────────

  async sendEmail(companyId: string, quoteId: string) {
    const quote = await this.getOne(companyId, quoteId);
    const company = await this.prisma.client.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');
    if (!quote.customer?.email) {
      throw new BadRequestException('Customer email is required to send quote');
    }
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) throw new BadRequestException('Email service is not configured');

    const token = quote.acceptance_token ?? randomUUID();
    if (!quote.acceptance_token) {
      await this.prisma.client.quote.update({
        where: { id: quoteId },
        data: { acceptance_token: token },
      });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
    const acceptanceUrl = `${appUrl}/quote/${token}`;

    let pdfBuffer: Buffer | undefined;
    try {
      pdfBuffer = await this.generatePdf(companyId, quoteId);
    } catch (err) {
      this.logger.warn(`PDF generation failed for quote ${quoteId}: ${String(err)}`);
    }

    const resend = new Resend(resendKey);
    const { error: emailError } = await resend.emails.send({
      from: process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
      to: quote.customer.email,
      subject: `Quote ${quote.quote_number} from ${company.name}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#111;">Quote from ${company.name}</h2>
          <p>Please find your quote <strong>${quote.quote_number}</strong> attached.</p>
          <table style="font-size:14px;border-collapse:collapse;margin:16px 0;">
            <tr><td style="color:#888;padding:4px 16px 4px 0;">Total</td><td><strong>£${(quote.total_pence / 100).toFixed(2)}</strong></td></tr>
            ${quote.expiry_date ? `<tr><td style="color:#888;padding:4px 16px 4px 0;">Valid until</td><td><strong>${new Date(quote.expiry_date).toLocaleDateString('en-GB')}</strong></td></tr>` : ''}
          </table>
          <a href="${acceptanceUrl}" style="display:inline-block;background:#1d4ed8;color:white;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;margin:8px 0;">
            View &amp; Accept Quote
          </a>
          <p style="color:#999;font-size:12px;margin-top:16px;">Or copy this link: ${acceptanceUrl}</p>
        </div>
      `,
      ...(pdfBuffer
        ? { attachments: [{ filename: `quote-${quote.quote_number}.pdf`, content: pdfBuffer }] }
        : {}),
    });
    if (emailError) throw new Error(`Failed to send quote email: ${emailError.message}`);

    this.logger.log(`Quote ${quote.quote_number} emailed to ${quote.customer.email}`);

    await this.prisma.client.quote.update({
      where: { id: quoteId },
      data: {
        status: quote.status === 'DRAFT' ? 'SENT' as never : quote.status as never,
        last_sent_at: new Date(),
      },
    });

    return { sent: true, acceptance_url: acceptanceUrl };
  }

  // ── Public: get by token ──────────────────────────────────────────────────

  async getPublicByToken(token: string) {
    const quote = await this.prisma.client.quote.findUnique({
      where: { acceptance_token: token },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true, address_line1: true, city: true, postcode: true } },
        job: { select: { id: true, title: true } },
        company: {
          select: {
            name: true, logo_url: true, phone: true,
            address_line1: true, address_line2: true, city: true, postcode: true,
            vat_number: true, vat_registered: true,
            invoice_template: true, invoice_accent_colour: true,
          },
        },
      },
    });
    if (!quote) throw new NotFoundException('Quote not found or link has expired');
    return { ...quote, acceptance_token: undefined };
  }

  // ── Public: accept by token ───────────────────────────────────────────────

  async acceptByToken(token: string) {
    const quote = await this.prisma.client.quote.findUnique({
      where: { acceptance_token: token },
      select: { id: true, status: true },
    });
    if (!quote) throw new NotFoundException('Quote not found');
    if (quote.status === 'ACCEPTED') return { success: true, already: true };
    if (['REJECTED', 'INVOICED', 'EXPIRED', 'CANCELLED'].includes(quote.status)) {
      throw new BadRequestException(`Quote cannot be accepted — status: ${quote.status}`);
    }
    await this.prisma.client.quote.update({
      where: { id: quote.id },
      data: { status: 'ACCEPTED' as never, accepted_at: new Date() },
    });
    return { success: true, already: false };
  }

  // ── Public: reject by token ───────────────────────────────────────────────

  async rejectByToken(token: string, reason?: string) {
    const quote = await this.prisma.client.quote.findUnique({
      where: { acceptance_token: token },
      select: { id: true, status: true },
    });
    if (!quote) throw new NotFoundException('Quote not found');
    if (quote.status === 'REJECTED') return { success: true, already: true };
    if (['ACCEPTED', 'INVOICED', 'EXPIRED', 'CANCELLED'].includes(quote.status)) {
      throw new BadRequestException(`Quote cannot be declined — status: ${quote.status}`);
    }
    await this.prisma.client.quote.update({
      where: { id: quote.id },
      data: {
        status: 'REJECTED' as never,
        rejected_at: new Date(),
        rejection_reason: reason ?? null,
      },
    });
    return { success: true, already: false };
  }
}
