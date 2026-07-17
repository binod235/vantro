import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Resend } from 'resend';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CommsService }  from '../comms/comms.service';
import type { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { UpdateInvoiceDto } from './dto/update-invoice.dto';
import type { CreateInvoiceFromQuoteDto } from './dto/create-invoice-from-quote.dto';
import type { AddInvoicePaymentDto } from './dto/add-invoice-payment.dto';
import type { MarkPaidDto } from './dto/mark-paid.dto';
import { ReviewRequestService } from '../reminders/review-request.service';
import { generateQrDataUri } from '../../common/qr.helper';

// ─── Line item types ──────────────────────────────────────────────────────────

interface InputLineItem {
  description: string;
  quantity: number;
  unit_price_pence: number;
  vat_type: string;
  vat_rate: number;
  source_quote_line_item_id?: string;
}

interface CalculatedLineItem extends InputLineItem {
  id: string;
  net_pence: number;
  vat_pence: number;
  reverse_charge_vat_pence: number;
}

interface InvoiceTotals {
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
  // EXEMPT and ZERO_RATED: both 0

  return {
    ...item,
    id: `item_${index}`,
    net_pence: net,
    vat_pence: vat,
    reverse_charge_vat_pence: rcVat,
  };
}

function calcTotals(items: CalculatedLineItem[]): InvoiceTotals {
  const subtotal = items.reduce((s, i) => s + i.net_pence, 0);
  const vat = items.reduce((s, i) => s + i.vat_pence, 0);
  const rcVat = items.reduce((s, i) => s + i.reverse_charge_vat_pence, 0);
  const total = subtotal + vat; // reverse charge VAT is NOT added to payable total
  const isRc = items.some((i) => i.vat_type === 'REVERSE_CHARGE');
  return {
    subtotal_pence: subtotal,
    vat_amount_pence: vat,
    reverse_charge_vat_pence: rcVat,
    total_pence: total,
    is_reverse_charge: isRc,
  };
}

function getSingleVatType(items: CalculatedLineItem[]): string | null {
  const types = new Set(items.map((i) => i.vat_type));
  if (types.size === 1) return [...types][0];
  return null;
}

// ─── Prisma include for full invoice ─────────────────────────────────────────

const INVOICE_INCLUDE = {
  customer: { select: { id: true, name: true, email: true, phone: true, address_line1: true, address_line2: true, city: true, postcode: true } },
  job: { select: { id: true, title: true } },
  quote: { select: { id: true, quote_number: true } },
  payments: { orderBy: { payment_date: 'asc' as const } },
} as const;

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comms: CommsService,
    private readonly reviewRequest: ReviewRequestService,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async verifyCustomer(customerId: string, companyId: string) {
    const c = await this.prisma.client.customer.findFirst({
      where: { id: customerId, company_id: companyId },
    });
    if (!c) throw new NotFoundException('Customer not found');
    return c;
  }

  private async verifyJob(jobId: string, companyId: string) {
    const j = await this.prisma.client.job.findFirst({
      where: { id: jobId, company_id: companyId },
    });
    if (!j) throw new NotFoundException('Job not found');
    return j;
  }

  private async generateInvoiceNumber(
    tx: Parameters<Parameters<typeof this.prisma.client.$transaction>[0]>[0],
    companyId: string,
  ): Promise<string> {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { invoice_prefix: true, invoice_next_number: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const prefix = company.invoice_prefix ?? 'INV';
    const num = company.invoice_next_number ?? 1;
    const invoiceNumber = `${prefix}-${String(num).padStart(3, '0')}`;

    await tx.company.update({
      where: { id: companyId },
      data: { invoice_next_number: num + 1 },
    });

    return invoiceNumber;
  }

  private processLineItems(raw: InputLineItem[]): {
    items: CalculatedLineItem[];
    totals: InvoiceTotals;
  } {
    if (!raw.length) throw new BadRequestException('Invoice must have at least one line item');
    const items = raw.map((item, i) => calcLineItem(item, i));
    const totals = calcTotals(items);
    return { items, totals };
  }

  // Already invoiced amount for a quote (SENT + PART_PAID + PAID only, not DRAFT/CANCELLED)
  private async alreadyInvoicedPence(quoteId: string): Promise<number> {
    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        quote_id: quoteId,
        status: { in: ['SENT', 'PART_PAID', 'PAID'] },
      },
      select: { total_pence: true },
    });
    return invoices.reduce((s, i) => s + i.total_pence, 0);
  }

  // ── List ───────────────────────────────────────────────────────────────────

  async list(companyId: string, filters?: { status?: string; search?: string }) {
    const where: Record<string, unknown> = { company_id: companyId };
    if (filters?.status) where.status = filters.status;
    if (filters?.search) {
      where.OR = [
        { invoice_number: { contains: filters.search, mode: 'insensitive' } },
        { customer: { name: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }

    return this.prisma.client.invoice.findMany({
      where,
      include: INVOICE_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
  }

  // ── Get one ────────────────────────────────────────────────────────────────

  async getOne(companyId: string, invoiceId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, company_id: companyId },
      include: INVOICE_INCLUDE,
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  // ── Create manual invoice ─────────────────────────────────────────────────

  async create(companyId: string, dto: CreateInvoiceDto) {
    await this.verifyCustomer(dto.customer_id, companyId);
    if (dto.job_id) await this.verifyJob(dto.job_id, companyId);

    const { items, totals } = this.processLineItems(dto.line_items);

    return this.prisma.client.$transaction(async (tx) => {
      const invoiceNumber = await this.generateInvoiceNumber(tx, companyId);

      return tx.invoice.create({
        data: {
          company_id: companyId,
          customer_id: dto.customer_id,
          job_id: dto.job_id,
          invoice_number: invoiceNumber,
          invoice_type: (dto.invoice_type ?? 'STANDARD') as never,
          source_type: 'MANUAL',
          line_items: items as never,
          subtotal_pence: totals.subtotal_pence,
          vat_amount_pence: totals.vat_amount_pence,
          reverse_charge_vat_pence: totals.reverse_charge_vat_pence,
          total_pence: totals.total_pence,
          amount_due_pence: totals.total_pence,
          is_reverse_charge: totals.is_reverse_charge,
          reverse_charge_wording: totals.is_reverse_charge
            ? 'Reverse charge: customer to account for VAT to HMRC.'
            : null,
          due_date: dto.due_date ? new Date(dto.due_date) : null,
          issue_date: dto.issue_date ? new Date(dto.issue_date) : new Date(),
          notes: dto.notes,
          payment_method: dto.payment_method,
        },
        include: INVOICE_INCLUDE,
      });
    });
  }

  // ── Create from quote ─────────────────────────────────────────────────────

  async createFromQuote(companyId: string, quoteId: string, dto: CreateInvoiceFromQuoteDto) {
    const quote = await this.prisma.client.quote.findFirst({
      where: { id: quoteId, company_id: companyId },
      include: { job: { select: { customer_id: true } } },
    });
    if (!quote) throw new NotFoundException('Quote not found');

    const quoteLineItems = (quote.line_items as InputLineItem[] | null) ?? [];
    const alreadyInvoiced = await this.alreadyInvoicedPence(quoteId);

    let lineItemsToUse: InputLineItem[];

    switch (dto.mode) {
      case 'ENTIRE_QUOTE': {
        if (quoteLineItems.length > 0) {
          lineItemsToUse = quoteLineItems;
        } else {
          lineItemsToUse = [
            {
              description: `Services — Quote ${quote.quote_number}`,
              quantity: 1,
              unit_price_pence: quote.amount_pence,
              vat_type: 'STANDARD',
              vat_rate: 20,
            },
          ];
        }
        break;
      }

      case 'SELECTED_LINE_ITEMS': {
        if (!quoteLineItems.length) {
          throw new BadRequestException('This quote has no line items. Please create a new quote with line items.');
        }
        const ids = dto.selected_line_item_ids ?? [];
        if (!ids.length) throw new BadRequestException('No line items selected');
        lineItemsToUse = quoteLineItems.filter(
          (item) => ids.includes((item as InputLineItem & { id?: string }).id ?? ''),
        );
        if (!lineItemsToUse.length) throw new BadRequestException('Selected line items not found in quote');
        break;
      }

      case 'PERCENTAGE': {
        if (!dto.percentage) throw new BadRequestException('percentage is required');
        const pct = dto.percentage;
        const quoteBase = quote.amount_pence ||
          (quoteLineItems.length ? calcTotals(quoteLineItems.map((i, idx) => calcLineItem(i, idx))).subtotal_pence : 0);

        const vatType = quoteLineItems.length ? getSingleVatType(quoteLineItems.map((i, idx) => calcLineItem(i, idx))) : 'STANDARD';
        if (vatType === null) {
          throw new BadRequestException(
            'Percentage invoices for mixed VAT quotes are not supported yet.',
          );
        }
        const netPence = Math.round((quoteBase * pct) / 100);
        const remaining = quoteBase - alreadyInvoiced;
        if (netPence > remaining) {
          throw new BadRequestException('Invoice amount exceeds remaining quote amount.');
        }
        lineItemsToUse = [
          {
            description: `${pct}% invoice — Quote ${quote.quote_number}`,
            quantity: 1,
            unit_price_pence: netPence,
            vat_type: vatType,
            vat_rate: 20,
          },
        ];
        break;
      }

      case 'FIXED_AMOUNT': {
        if (!dto.fixed_amount_pence) throw new BadRequestException('fixed_amount_pence is required');
        const quoteBase = quote.amount_pence ||
          (quoteLineItems.length ? calcTotals(quoteLineItems.map((i, idx) => calcLineItem(i, idx))).subtotal_pence : 0);

        const vatType = quoteLineItems.length ? getSingleVatType(quoteLineItems.map((i, idx) => calcLineItem(i, idx))) : 'STANDARD';
        if (vatType === null) {
          throw new BadRequestException(
            'Fixed amount invoices for mixed VAT quotes are not supported yet.',
          );
        }
        const remaining = quoteBase - alreadyInvoiced;
        if (dto.fixed_amount_pence > remaining) {
          throw new BadRequestException('Invoice amount exceeds remaining quote amount.');
        }
        lineItemsToUse = [
          {
            description: `Fixed amount invoice — Quote ${quote.quote_number}`,
            quantity: 1,
            unit_price_pence: dto.fixed_amount_pence,
            vat_type: vatType,
            vat_rate: 20,
          },
        ];
        break;
      }

      default:
        throw new BadRequestException('Invalid invoice mode');
    }

    const { items, totals } = this.processLineItems(lineItemsToUse);
    const customerId = quote.customer_id ?? quote.job?.customer_id;
    if (!customerId) throw new BadRequestException('Quote has no customer — cannot create invoice');

    return this.prisma.client.$transaction(async (tx) => {
      const invoiceNumber = await this.generateInvoiceNumber(tx, companyId);

      return tx.invoice.create({
        data: {
          company_id: companyId,
          customer_id: customerId,
          job_id: quote.job_id,
          quote_id: quoteId,
          invoice_number: invoiceNumber,
          invoice_type: (dto.invoice_type ?? 'STANDARD') as never,
          source_type: 'QUOTE',
          quote_invoice_mode: dto.mode as never,
          quote_percentage: dto.percentage,
          fixed_amount_pence: dto.fixed_amount_pence,
          line_items: items as never,
          subtotal_pence: totals.subtotal_pence,
          vat_amount_pence: totals.vat_amount_pence,
          reverse_charge_vat_pence: totals.reverse_charge_vat_pence,
          total_pence: totals.total_pence,
          amount_due_pence: totals.total_pence,
          is_reverse_charge: totals.is_reverse_charge,
          reverse_charge_wording: totals.is_reverse_charge
            ? 'Reverse charge: customer to account for VAT to HMRC.'
            : null,
          due_date: dto.due_date ? new Date(dto.due_date) : null,
          notes: dto.notes,
        },
        include: INVOICE_INCLUDE,
      });
    });
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  async update(companyId: string, invoiceId: string, dto: UpdateInvoiceDto) {
    const invoice = await this.getOne(companyId, invoiceId);
    if (['PAID', 'CANCELLED'].includes(invoice.status)) {
      throw new BadRequestException('Paid and cancelled invoices cannot be edited');
    }

    if (dto.customer_id) await this.verifyCustomer(dto.customer_id, companyId);

   const rawItems = dto.line_items ?? (invoice.line_items as unknown as InputLineItem[]);
    const { items, totals } = this.processLineItems(rawItems);

    const newAmountDue = Math.max(0, totals.total_pence - invoice.amount_paid_pence);

    return this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: {
        customer_id: dto.customer_id ?? invoice.customer_id,
        job_id: dto.job_id !== undefined ? dto.job_id : invoice.job_id,
        invoice_type: dto.invoice_type as never ?? invoice.invoice_type,
        line_items: items as never,
        subtotal_pence: totals.subtotal_pence,
        vat_amount_pence: totals.vat_amount_pence,
        reverse_charge_vat_pence: totals.reverse_charge_vat_pence,
        total_pence: totals.total_pence,
        amount_due_pence: newAmountDue,
        is_reverse_charge: totals.is_reverse_charge,
        reverse_charge_wording: totals.is_reverse_charge
          ? 'Reverse charge: customer to account for VAT to HMRC.'
          : null,
        due_date: dto.due_date ? new Date(dto.due_date) : invoice.due_date,
        issue_date: dto.issue_date ? new Date(dto.issue_date) : invoice.issue_date,
        notes: dto.notes !== undefined ? dto.notes : invoice.notes,
        payment_method: dto.payment_method !== undefined ? dto.payment_method : invoice.payment_method,
      },
      include: INVOICE_INCLUDE,
    });
  }

  // ── Update status ──────────────────────────────────────────────────────────

  async updateStatus(companyId: string, invoiceId: string, status: string) {
    const invoice = await this.getOne(companyId, invoiceId);
    if (invoice.status === 'CANCELLED') {
      throw new BadRequestException('Cancelled invoices cannot have their status changed');
    }
    return this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: { status: status as never },
      include: INVOICE_INCLUDE,
    });
  }

  // ── Add payment ────────────────────────────────────────────────────────────

  async addPayment(companyId: string, invoiceId: string, dto: AddInvoicePaymentDto) {
    const invoice = await this.getOne(companyId, invoiceId);
    if (invoice.status === 'CANCELLED') {
      throw new BadRequestException('Cannot add payment to cancelled invoice');
    }

    const newPaid = invoice.amount_paid_pence + dto.amount_pence;
    const newDue = Math.max(0, invoice.total_pence - newPaid);

    let newStatus: string = invoice.status;
    let paidDate: Date | null = invoice.paid_date;

    if (newPaid >= invoice.total_pence) {
      newStatus = 'PAID';
      paidDate = new Date(dto.payment_date);
    } else if (newPaid > 0) {
      newStatus = 'PART_PAID';
    }

    await this.prisma.client.invoicePayment.create({
      data: {
        company_id: companyId,
        invoice_id: invoiceId,
        payment_date: new Date(dto.payment_date),
        amount_pence: dto.amount_pence,
        payment_method: dto.payment_method,
        reference: dto.reference,
        notes: dto.notes,
      },
    });

    const result = await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: {
        amount_paid_pence: newPaid,
        amount_due_pence: newDue,
        status: newStatus as never,
        paid_date: paidDate,
      },
      include: INVOICE_INCLUDE,
    });

    if (newStatus === 'PAID') {
      await this.prisma.client.jobStage.updateMany({
        where: { invoice_id: invoiceId, status: 'INVOICED' },
        data:  { status: 'PAID' },
      });
    }

    return result;
  }

  // ── Mark paid ──────────────────────────────────────────────────────────────

  async markPaid(companyId: string, invoiceId: string, dto: MarkPaidDto) {
    const invoice = await this.getOne(companyId, invoiceId);
    if (invoice.status === 'CANCELLED') {
      throw new BadRequestException('Cannot mark cancelled invoice as paid');
    }

    const paidDate = dto.paid_date ? new Date(dto.paid_date) : new Date();
    const remaining = invoice.total_pence - invoice.amount_paid_pence;

    if (remaining > 0) {
      await this.prisma.client.invoicePayment.create({
        data: {
          company_id: companyId,
          invoice_id: invoiceId,
          payment_date: paidDate,
          amount_pence: remaining,
          payment_method: dto.payment_method,
          reference: dto.reference,
        },
      });
    }

    const result = await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'PAID',
        amount_paid_pence: invoice.total_pence,
        amount_due_pence: 0,
        paid_date: paidDate,
        payment_method: dto.payment_method ?? invoice.payment_method,
      },
      include: INVOICE_INCLUDE,
    });

    await this.prisma.client.jobStage.updateMany({
      where: { invoice_id: invoiceId, status: 'INVOICED' },
      data:  { status: 'PAID' },
    });

    void this.reviewRequest.sendAfterPayment(invoiceId, companyId);

    return result;
  }

  // ── Mark unpaid ────────────────────────────────────────────────────────────

  async markUnpaid(companyId: string, invoiceId: string) {
    const invoice = await this.getOne(companyId, invoiceId);
    if (invoice.status === 'CANCELLED') {
      throw new BadRequestException('Cannot change cancelled invoice');
    }

    await this.prisma.client.invoicePayment.deleteMany({
      where: { invoice_id: invoiceId, company_id: companyId },
    });

    const newStatus = invoice.status === 'DRAFT' ? 'DRAFT' : 'SENT';

    return this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: {
        status: newStatus as never,
        amount_paid_pence: 0,
        amount_due_pence: invoice.total_pence,
        paid_date: null,
      },
      include: INVOICE_INCLUDE,
    });
  }

  // ── Cancel ─────────────────────────────────────────────────────────────────

  async cancel(companyId: string, invoiceId: string) {
    const invoice = await this.getOne(companyId, invoiceId);
    if (invoice.status === 'CANCELLED') return invoice;
    if (invoice.status === 'PAID') {
      throw new BadRequestException('Cannot cancel a paid invoice');
    }
    return this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: { status: 'CANCELLED' },
      include: INVOICE_INCLUDE,
    });
  }

  // ── Mark viewed ───────────────────────────────────────────────────────────

  async markViewed(invoiceId: string) {
    try {
      const invoice = await this.prisma.client.invoice.findUnique({
        where: { id: invoiceId },
        select: { viewed_at: true },
      });
      await this.prisma.client.invoice.update({
        where: { id: invoiceId },
        data: {
          viewed_at:  invoice?.viewed_at ? undefined : new Date(),
          view_count: { increment: 1 },
        },
      });
    } catch {
      // Silently ignore if invoice not found
    }
  }

  // ── Toggle reminders ──────────────────────────────────────────────────────

  async toggleReminders(companyId: string, invoiceId: string) {
    const invoice = await this.getOne(companyId, invoiceId);
    return this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data:  { reminders_disabled: !invoice.reminders_disabled },
      include: INVOICE_INCLUDE,
    });
  }

  async toggleChasePaused(companyId: string, invoiceId: string) {
    const invoice = await this.getOne(companyId, invoiceId);
    return this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data:  { chase_paused: !invoice.chase_paused },
      include: INVOICE_INCLUDE,
    });
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async remove(companyId: string, invoiceId: string) {
    const invoice = await this.getOne(companyId, invoiceId);
    if (invoice.status !== 'DRAFT') {
      throw new ConflictException('Only draft invoices can be deleted');
    }
    await this.prisma.client.invoicePayment.deleteMany({ where: { invoice_id: invoiceId } });
    await this.prisma.client.invoice.delete({ where: { id: invoiceId } });
  }

  // ── Generate PDF ───────────────────────────────────────────────────────────

  async generatePdf(companyId: string, invoiceId: string): Promise<Buffer> {
    const invoice = await this.getOne(companyId, invoiceId);
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      omit: { stripe_customer_id: true, stripe_subscription_id: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const { buildInvoiceHtml } = await import('./invoices.pdf.js');
    const html = buildInvoiceHtml(invoice as never, company as never);

    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
     await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' } });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  // ── Bulk create from jobs ─────────────────────────────────────────────────

  async bulkCreateFromJobs(
    companyId: string,
    jobIds:    string[],
    options: {
      due_date?:    string;
      send_emails?: boolean;
    },
  ) {
    const results: {
      job_id:         string;
      job_title:      string;
      invoice_id:     string | null;
      invoice_number: string | null;
      success:        boolean;
      error?:         string;
    }[] = [];

    for (const jobId of jobIds) {
      try {
        const job = await this.prisma.client.job.findFirst({
          where:   { id: jobId, company_id: companyId },
          include: {
            customer: true,
            quotes: {
              where:   { status: 'ACCEPTED' as never },
              orderBy: { created_at: 'desc' },
              take:    1,
            },
            timesheets: {
              select: {
                duration_minutes:  true,
                total_pence:       true,
              },
            },
          },
        });

        if (!job) {
          results.push({
            job_id: jobId, job_title: '', invoice_id: null,
            invoice_number: null, success: false,
            error: 'Job not found',
          });
          continue;
        }

        // Build line items from accepted quote or timesheets
        let lineItems: unknown[] = [];
        let subtotalPence = 0;
        let vatPence = 0;

        const acceptedQuote = job.quotes[0];
        if (acceptedQuote?.line_items && (acceptedQuote.line_items as unknown[]).length > 0) {
          lineItems     = acceptedQuote.line_items as unknown[];
          subtotalPence = acceptedQuote.subtotal_pence;
          vatPence      = acceptedQuote.vat_amount_pence;
        } else if (job.timesheets.length > 0) {
          lineItems = job.timesheets.map((ts, i) => ({
            id:               `ts_${i}`,
            description:      `Labour — ${Math.floor(ts.duration_minutes / 60)}h${ts.duration_minutes % 60 > 0 ? ` ${ts.duration_minutes % 60}m` : ''}`,
            quantity:         1,
            unit_price_pence: ts.total_pence,
            vat_type:         'STANDARD',
            vat_rate:         20,
            net_pence:        ts.total_pence,
            vat_pence:        Math.round(ts.total_pence * 0.20),
            reverse_charge_vat_pence: 0,
          }));
          subtotalPence = job.timesheets.reduce((s, t) => s + t.total_pence, 0);
          vatPence      = Math.round(subtotalPence * 0.20);
        }

        if (lineItems.length === 0) {
          results.push({
            job_id: jobId, job_title: job.title, invoice_id: null,
            invoice_number: null, success: false,
            error: 'No accepted quote or timesheets to invoice from',
          });
          continue;
        }

        const totalPence = subtotalPence + vatPence;

        const issueDate = new Date();
        const dueDate   = options.due_date
          ? new Date(options.due_date)
          : new Date(issueDate.getTime() + 30 * 24 * 60 * 60 * 1000);

        const invoice = await this.prisma.client.$transaction(async (tx) => {
          const invoiceNumber = await this.generateInvoiceNumber(tx, companyId);
          return tx.invoice.create({
            data: {
              company_id:              companyId,
              customer_id:             job.customer_id,
              job_id:                  job.id,
              invoice_number:          invoiceNumber,
              invoice_type:            'STANDARD' as never,
              source_type:             'JOB'      as never,
              status:                  'DRAFT'    as never,
              line_items:              lineItems  as never,
              subtotal_pence:          subtotalPence,
              vat_amount_pence:        vatPence,
              reverse_charge_vat_pence: 0,
              total_pence:             totalPence,
              amount_due_pence:        totalPence,
              is_reverse_charge:       false,
              issue_date:              issueDate,
              due_date:                dueDate,
            },
          });
        });

        if (options.send_emails) {
          try {
            await this.emailInvoice(companyId, invoice.id);
          } catch (emailErr) {
            this.logger.warn(
              `Bulk invoice email failed for ${invoice.invoice_number}: ${String(emailErr)}`,
            );
          }
        }

        results.push({
          job_id:         jobId,
          job_title:      job.title,
          invoice_id:     invoice.id,
          invoice_number: invoice.invoice_number,
          success:        true,
        });

      } catch (err) {
        results.push({
          job_id:         jobId,
          job_title:      '',
          invoice_id:     null,
          invoice_number: null,
          success:        false,
          error:          err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const created = results.filter(r => r.success).length;
    const failed  = results.filter(r => !r.success).length;

    this.logger.log(`Bulk invoicing: ${created} created, ${failed} failed`);

    return { results, created, failed };
  }

  // ── Email invoice ──────────────────────────────────────────────────────────

  async emailInvoice(companyId: string, invoiceId: string) {
    const invoice = await this.getOne(companyId, invoiceId);
    const company = await this.prisma.client.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');

    if (!invoice.customer.email) {
      throw new BadRequestException('Customer email is required to send invoice');
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) throw new BadRequestException('Email service is not configured');

    // Generate payment_token if not yet set
    const rawInvoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: { payment_token: true },
    });
    let paymentToken = rawInvoice?.payment_token;
    if (!paymentToken) {
      paymentToken = randomUUID();
      await this.prisma.client.invoice.update({
        where: { id: invoiceId },
        data: { payment_token: paymentToken },
      });
    }

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3001';
    const payLink = `${frontendUrl}/invoice/${paymentToken}`;
    const canPayOnline = company.stripe_connect_enabled && company.stripe_connect_onboarded;

    let pdfBuffer: Buffer | undefined;
    try {
      pdfBuffer = await this.generatePdf(companyId, invoiceId);
    } catch (err) {
      this.logger.warn(`PDF generation failed for invoice ${invoiceId}: ${String(err)}`);
    }

    const apiUrl = process.env.API_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
    const trackingUrl = `${apiUrl}/api/invoices/${invoiceId}/viewed`;

    const bankSection = company.bank_account_number
      ? `<div style="margin:20px 0;padding:16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
           <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#374151;">Bank Transfer Details</p>
           ${company.bank_name ? `<p style="margin:2px 0;font-size:13px;color:#6b7280;">Bank: ${company.bank_name}</p>` : ''}
           ${company.bank_account_name ? `<p style="margin:2px 0;font-size:13px;color:#6b7280;">Account name: ${company.bank_account_name}</p>` : ''}
           ${company.bank_sort_code ? `<p style="margin:2px 0;font-size:13px;color:#6b7280;">Sort code: ${company.bank_sort_code}</p>` : ''}
           <p style="margin:2px 0;font-size:13px;color:#6b7280;">Account number: ${company.bank_account_number}</p>
         </div>`
      : '';

    const payNowSection = canPayOnline
      ? `<div style="margin:24px 0;text-align:center;">
           <a href="${payLink}" style="display:inline-block;background:#1d4ed8;color:#fff;font-weight:600;font-size:15px;padding:12px 32px;border-radius:8px;text-decoration:none;">Pay Now Online</a>
           <p style="margin:10px 0 0;font-size:12px;color:#9ca3af;">Or <a href="${payLink}?action=mark-paid" style="color:#6b7280;">click here if you've already paid by bank transfer</a></p>
         </div>`
      : `<div style="margin:16px 0;">
           <a href="${payLink}" style="font-size:13px;color:#6b7280;">View invoice online</a>
         </div>`;

    const qrDataUri = canPayOnline ? await generateQrDataUri(payLink) : null;
    const qrSection = qrDataUri
      ? `<div style="margin:24px 0;text-align:center;">
           <img src="${qrDataUri}" width="120" height="120" alt="Scan to pay" style="display:inline-block;" />
           <p style="margin:6px 0 0;font-size:11px;color:#9ca3af;">Scan to pay online</p>
         </div>`
      : '';

    const resend = new Resend(resendKey);
    const { error: emailError } = await resend.emails.send({
      from: process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
      to: invoice.customer.email,
      subject: `Invoice ${invoice.invoice_number} from ${company.name}`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111827;">
               <h2 style="font-size:20px;margin-bottom:4px;">Invoice ${invoice.invoice_number}</h2>
               <p style="color:#6b7280;font-size:14px;margin-top:0;">From <strong>${company.name}</strong></p>
               <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                 <tr><td style="padding:6px 0;font-size:14px;color:#6b7280;">Total</td><td style="padding:6px 0;font-size:14px;font-weight:600;text-align:right;">£${(invoice.total_pence / 100).toFixed(2)}</td></tr>
                 <tr><td style="padding:6px 0;font-size:14px;color:#6b7280;">Amount due</td><td style="padding:6px 0;font-size:14px;font-weight:700;color:#1d4ed8;text-align:right;">£${(invoice.amount_due_pence / 100).toFixed(2)}</td></tr>
                 ${invoice.due_date ? `<tr><td style="padding:6px 0;font-size:14px;color:#6b7280;">Due date</td><td style="padding:6px 0;font-size:14px;text-align:right;">${new Date(invoice.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</td></tr>` : ''}
               </table>
               ${payNowSection}
               ${qrSection}
               ${bankSection}
               <p style="font-size:13px;color:#6b7280;">${company.default_payment_terms ?? 'Payment due within 30 days'}</p>
               <img src="${trackingUrl}" width="1" height="1" style="display:none" alt="" />
               ${company.branding_footer_enabled !== false ? '<hr style="border:none;border-top:1px solid #f0f0f0;margin:20px 0 12px;" /><p style="margin:0;font-size:11px;color:#bbb;text-align:center;">Sent with <a href="https://vantro.co.uk" style="color:#bbb;text-decoration:none;">Vantro</a></p>' : ''}
             </div>`,
      ...(pdfBuffer
        ? {
            attachments: [
              {
                filename: `invoice-${invoice.invoice_number}.pdf`,
                content: pdfBuffer,
              },
            ],
          }
        : {}),
    });
    if (emailError) throw new Error(`Failed to send invoice email: ${emailError.message}`);

    this.logger.log(`Invoice ${invoice.invoice_number} emailed to ${invoice.customer.email}`);

    void this.comms.log({
      company_id:  companyId,
      customer_id: invoice.customer_id ?? undefined,
      job_id:      invoice.job_id      ?? undefined,
      invoice_id:  invoice.id,
      type:        'INVOICE_SENT',
      subject:     `Invoice ${invoice.invoice_number}`,
      to_email:    invoice.customer.email,
      reference:   invoice.invoice_number,
    });

    // Advance status from DRAFT → SENT (but not if already PAID/PART_PAID)
    if (invoice.status === 'DRAFT') {
      await this.prisma.client.invoice.update({
        where: { id: invoiceId },
        data: { status: 'SENT' },
      });
    }

    return { sent: true };
  }
}
