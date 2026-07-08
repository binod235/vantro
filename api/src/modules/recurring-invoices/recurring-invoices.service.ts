import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { InvoicesService } from '../invoices/invoices.service';
import type { CreateRecurringInvoiceDto } from './dto/create-recurring-invoice.dto';
import type { UpdateRecurringInvoiceDto } from './dto/update-recurring-invoice.dto';

// ─── Line item types ──────────────────────────────────────────────────────────
// Same deliberately-simple shape as CreditNote line items — flat vat_rate
// per line, no reverse charge. See CreditNotesService for the rationale.

interface InputLineItem {
  description: string;
  quantity: number;
  unit_price_pence: number;
  vat_rate: number;
}

interface CalculatedLineItem extends InputLineItem {
  id: string;
  net_pence: number;
  vat_pence: number;
}

interface RecurringInvoiceTotals {
  subtotal_pence: number;
  vat_pence: number;
  total_pence: number;
}

function calcLineItem(item: InputLineItem, index: number): CalculatedLineItem {
  const net = Math.round(item.quantity * item.unit_price_pence);
  const vat = Math.round((net * item.vat_rate) / 100);
  return { ...item, id: `item_${index}`, net_pence: net, vat_pence: vat };
}

function calcTotals(items: CalculatedLineItem[]): RecurringInvoiceTotals {
  const subtotal = items.reduce((s, i) => s + i.net_pence, 0);
  const vat = items.reduce((s, i) => s + i.vat_pence, 0);
  return { subtotal_pence: subtotal, vat_pence: vat, total_pence: subtotal + vat };
}

// ─── Next run date calculation ────────────────────────────────────────────────
// Vanilla Date methods only — no date-fns. Note: setMonth()/setFullYear() can
// roll over into the following month on short months (e.g. 31 Jan + 1 month
// lands in March), which is a known quirk of native Date arithmetic — not
// fixed here per the brief, but worth knowing if a template's day_of_month
// ever drifts.

export function calculateNextRunDate(currentDate: Date, frequency: string, dayOfMonth?: number | null): Date {
  switch (frequency) {
    case 'WEEKLY': {
      const next = new Date(currentDate);
      next.setDate(next.getDate() + 7);
      return next;
    }
    case 'MONTHLY': {
      const next = new Date(currentDate);
      next.setMonth(next.getMonth() + 1);
      if (dayOfMonth) next.setDate(dayOfMonth);
      return next;
    }
    case 'QUARTERLY': {
      const next = new Date(currentDate);
      next.setMonth(next.getMonth() + 3);
      if (dayOfMonth) next.setDate(dayOfMonth);
      return next;
    }
    case 'YEARLY': {
      const next = new Date(currentDate);
      next.setFullYear(next.getFullYear() + 1);
      return next;
    }
    default:
      throw new Error(`Unknown frequency: ${frequency}`);
  }
}

// ─── Prisma include ───────────────────────────────────────────────────────────

const LIST_INCLUDE = {
  customer: { select: { id: true, name: true, email: true, phone: true } },
  invoices: {
    select: { id: true, invoice_number: true, status: true, total_pence: true, issue_date: true },
    orderBy: { created_at: 'desc' as const },
    take: 5,
  },
} as const;

const DETAIL_INCLUDE = {
  customer: { select: { id: true, name: true, email: true, phone: true } },
  invoices: {
    select: { id: true, invoice_number: true, status: true, total_pence: true, issue_date: true },
    orderBy: { created_at: 'desc' as const },
    take: 20,
  },
} as const;

@Injectable()
export class RecurringInvoicesService {
  private readonly logger = new Logger(RecurringInvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async verifyCustomer(customerId: string, companyId: string) {
    const c = await this.prisma.client.customer.findFirst({
      where: { id: customerId, company_id: companyId },
    });
    if (!c) throw new NotFoundException('Customer not found');
    return c;
  }

  private processLineItems(raw: InputLineItem[]): { items: CalculatedLineItem[]; totals: RecurringInvoiceTotals } {
    if (!raw.length) throw new BadRequestException('Recurring invoice must have at least one line item');
    const items = raw.map((item, i) => calcLineItem(item, i));
    return { items, totals: calcTotals(items) };
  }

  // Same numbering counter every other invoice-creating path shares
  // (InvoicesService.create, job-stages' createInvoiceFromStage) — recurring
  // invoices are still real invoices and shouldn't have their own sequence.
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

  // ── List ───────────────────────────────────────────────────────────────────

  async list(companyId: string) {
    return this.prisma.client.recurringInvoice.findMany({
      where: { company_id: companyId },
      include: LIST_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
  }

  // ── Get one ────────────────────────────────────────────────────────────────

  async getOne(companyId: string, id: string) {
    const ri = await this.prisma.client.recurringInvoice.findFirst({
      where: { id, company_id: companyId },
      include: DETAIL_INCLUDE,
    });
    if (!ri) throw new NotFoundException('Recurring invoice not found');
    return ri;
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(companyId: string, dto: CreateRecurringInvoiceDto) {
    await this.verifyCustomer(dto.customer_id, companyId);
    const { items, totals } = this.processLineItems(dto.line_items);

    return this.prisma.client.recurringInvoice.create({
      data: {
        company_id: companyId,
        customer_id: dto.customer_id,
        title: dto.title,
        line_items: items as never,
        subtotal_pence: totals.subtotal_pence,
        vat_pence: totals.vat_pence,
        total_pence: totals.total_pence,
        frequency: dto.frequency as never,
        next_run_date: new Date(dto.start_date),
        day_of_month: dto.day_of_month,
        payment_terms_days: dto.payment_terms_days ?? 30,
        auto_email: dto.auto_email ?? false,
        notes: dto.notes,
        is_active: true,
      },
      include: LIST_INCLUDE,
    });
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  async update(companyId: string, id: string, dto: UpdateRecurringInvoiceDto) {
    await this.getOne(companyId, id);
    if (dto.customer_id) await this.verifyCustomer(dto.customer_id, companyId);

    let lineItemsData: { line_items: unknown; subtotal_pence: number; vat_pence: number; total_pence: number } | undefined;
    if (dto.line_items) {
      const { items, totals } = this.processLineItems(dto.line_items);
      lineItemsData = {
        line_items: items as never,
        subtotal_pence: totals.subtotal_pence,
        vat_pence: totals.vat_pence,
        total_pence: totals.total_pence,
      };
    }

    const data = {
      ...(dto.customer_id !== undefined && { customer_id: dto.customer_id }),
      ...(dto.title !== undefined && { title: dto.title }),
      ...(lineItemsData ?? {}),
      ...(dto.frequency !== undefined && { frequency: dto.frequency }),
      ...(dto.next_run_date !== undefined && { next_run_date: new Date(dto.next_run_date) }),
      ...(dto.day_of_month !== undefined && { day_of_month: dto.day_of_month }),
      ...(dto.payment_terms_days !== undefined && { payment_terms_days: dto.payment_terms_days }),
      ...(dto.auto_email !== undefined && { auto_email: dto.auto_email }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
      ...(dto.is_active !== undefined && { is_active: dto.is_active }),
    };

    return this.prisma.client.recurringInvoice.update({
      where: { id },
      data: data as never,
      include: LIST_INCLUDE,
    });
  }

  // ── Pause / Activate ──────────────────────────────────────────────────────

  async pause(companyId: string, id: string) {
    await this.getOne(companyId, id);
    return this.prisma.client.recurringInvoice.update({
      where: { id },
      data: { is_active: false },
      include: LIST_INCLUDE,
    });
  }

  async activate(companyId: string, id: string) {
    await this.getOne(companyId, id);
    return this.prisma.client.recurringInvoice.update({
      where: { id },
      data: { is_active: true },
      include: LIST_INCLUDE,
    });
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async remove(companyId: string, id: string): Promise<void> {
    await this.getOne(companyId, id);
    await this.prisma.client.invoice.updateMany({
      where: { recurring_invoice_id: id },
      data: { recurring_invoice_id: null },
    });
    await this.prisma.client.recurringInvoice.delete({ where: { id } });
  }

  // ── Generate invoice from template (shared by cron + manual trigger) ─────

  private async generateInvoice(ri: {
    id: string;
    company_id: string;
    customer_id: string;
    title: string;
    line_items: unknown;
    notes: string | null;
    payment_terms_days: number;
    auto_email: boolean;
    frequency: string;
    next_run_date: Date;
    day_of_month: number | null;
  }) {
    const { items, totals } = this.processLineItems((ri.line_items as InputLineItem[]) ?? []);

    const issueDate = new Date();
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + ri.payment_terms_days);

    const nextRunDate = calculateNextRunDate(ri.next_run_date, ri.frequency, ri.day_of_month);

    const invoice = await this.prisma.client.$transaction(async (tx) => {
      const invoiceNumber = await this.generateInvoiceNumber(tx, ri.company_id);

      const created = await tx.invoice.create({
        data: {
          company_id: ri.company_id,
          customer_id: ri.customer_id,
          recurring_invoice_id: ri.id,
          invoice_number: invoiceNumber,
          invoice_type: 'STANDARD',
          source_type: 'RECURRING',
          line_items: items as never,
          subtotal_pence: totals.subtotal_pence,
          vat_amount_pence: totals.vat_pence,
          total_pence: totals.total_pence,
          amount_due_pence: totals.total_pence,
          is_reverse_charge: false,
          issue_date: issueDate,
          due_date: dueDate,
          notes: ri.notes,
        },
      });

      await tx.recurringInvoice.update({
        where: { id: ri.id },
        data: {
          next_run_date: nextRunDate,
          last_generated_at: new Date(),
          invoices_generated: { increment: 1 },
        },
      });

      return created;
    });

    this.logger.log(`Generated invoice ${invoice.invoice_number} from recurring template "${ri.title}" (${ri.id})`);

    void this.prisma.client.autopilotEvent.create({
      data: {
        company_id: ri.company_id,
        type: 'RECURRING_GENERATED',
        title: `Auto-generated ${invoice.invoice_number} from "${ri.title}" · £${(invoice.total_pence / 100).toFixed(2)}`,
        meta: { invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, recurringId: ri.id },
      },
    }).catch(() => {});

    if (ri.auto_email) {
      try {
        await this.invoicesService.emailInvoice(ri.company_id, invoice.id);
        void this.prisma.client.autopilotEvent.create({
          data: {
            company_id: ri.company_id,
            type: 'INVOICE_AUTO_EMAILED',
            title: `Invoice ${invoice.invoice_number} auto-emailed (recurring)`,
            meta: { invoiceId: invoice.id, invoiceNumber: invoice.invoice_number },
          },
        }).catch(() => {});
      } catch (err) {
        this.logger.warn(`Auto-email failed for recurring invoice ${ri.id}: ${String(err)}`);
      }
    }

    return invoice;
  }

  // ── Cron: daily at 06:00 — runs before the 08:00 reminders cron ──────────

  @Cron('0 6 * * *')
  async runDailyGeneration() {
    this.logger.log('Running recurring invoice generation...');

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // lte (not a same-day window) so a missed day — downtime, deploy — still
    // catches up rather than silently skipping a billing cycle.
    const due = await this.prisma.client.recurringInvoice.findMany({
      where: { is_active: true, next_run_date: { lte: endOfToday } },
    });

    this.logger.log(`Found ${due.length} recurring invoice(s) due`);

    let created = 0;
    let failed = 0;

    for (const ri of due) {
      try {
        await this.generateInvoice(ri);
        created++;
      } catch (err) {
        failed++;
        this.logger.error(`Failed to generate invoice from recurring template ${ri.id}: ${String(err)}`);
      }
    }

    this.logger.log(`Recurring invoice generation complete: ${created} created, ${failed} failed`);
  }

  // ── Manual trigger ─────────────────────────────────────────────────────────

  async generateNow(companyId: string, id: string) {
    const ri = await this.getOne(companyId, id);
    const invoice = await this.generateInvoice(ri);
    return { triggered: true, invoice };
  }
}
