import { Injectable } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service';
import { CustomersService } from '../customers/customers.service';
import { QuotesService } from '../quotes/quotes.service';
import { InvoicesService } from '../invoices/invoices.service';
import { SubcontractorsService } from '../subcontractors/subcontractors.service';
import { SubcontractorPaymentsService } from '../subcontractors/subcontractor-payments.service';
import { RemindersService } from '../reminders/reminders.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateJobDto } from '../jobs/dto/create-job.dto';
import type { CreateCustomerDto } from '../customers/dto/create-customer.dto';
import { JobStatus } from '@prisma/client';

interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  required?: string[];
}

interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, ToolParameter>;
      required?: string[];
    };
  };
}

type ToolResult = Record<string, unknown> | unknown[] | string;

@Injectable()
export class AiToolsService {
  constructor(
    private readonly jobs: JobsService,
    private readonly customers: CustomersService,
    private readonly quotes: QuotesService,
    private readonly invoices: InvoicesService,
    private readonly subcontractors: SubcontractorsService,
    private readonly subPayments: SubcontractorPaymentsService,
    private readonly reminders: RemindersService,
    private readonly prisma: PrismaService,
  ) {}

  getToolDefinitions(): ToolDefinition[] {
    return [
      // ── JOBS ──────────────────────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'create_job',
          description: 'Create a new job/appointment for a customer',
          parameters: {
            type: 'object',
            properties: {
              customer_name: { type: 'string', description: 'Customer name to search for' },
              title: { type: 'string', description: 'Job title/description' },
              description: { type: 'string', description: 'Detailed description of the work' },
              scheduled_date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
              scheduled_time: { type: 'string', description: 'Time in HH:MM 24hr format' },
              priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
            },
            required: ['customer_name', 'title'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_jobs',
          description: 'Search for jobs by status, customer, or keyword',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search keyword' },
              status: { type: 'string', enum: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'QUOTED', 'INVOICED'] },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_todays_jobs',
          description: "Get all jobs scheduled for today",
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_this_weeks_jobs',
          description: 'Get all jobs scheduled for this week',
          parameters: { type: 'object', properties: {} },
        },
      },

      // ── CUSTOMERS ─────────────────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'create_customer',
          description: 'Create a new customer',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Customer full name' },
              email: { type: 'string', description: 'Email address' },
              phone: { type: 'string', description: 'Phone number' },
              address_line1: { type: 'string', description: 'Street address' },
              city: { type: 'string', description: 'City' },
              postcode: { type: 'string', description: 'UK postcode' },
            },
            required: ['name'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_customers',
          description: 'Search for customers by name, email, phone, or address',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search term' },
            },
            required: ['query'],
          },
        },
      },

      // ── QUOTES ────────────────────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'create_quote',
          description: 'Create a new quote for a customer',
          parameters: {
            type: 'object',
            properties: {
              customer_name: { type: 'string', description: 'Customer name to search for' },
              title: { type: 'string', description: 'Quote reference/title (stored as reference)' },
              line_items: {
                type: 'array',
                description: 'Line items for the quote',
                items: {
                  type: 'object',
                  properties: {
                    description: { type: 'string' },
                    quantity: { type: 'number' },
                    unit_price_pounds: { type: 'number', description: 'Price in pounds e.g. 150.00' },
                    vat_rate: { type: 'number', description: 'VAT percentage e.g. 20' },
                  },
                  required: ['description', 'quantity', 'unit_price_pounds'],
                },
              },
              notes: { type: 'string' },
            },
            required: ['customer_name', 'line_items'],
          },
        },
      },

      // ── INVOICES ──────────────────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'create_invoice_from_quote',
          description: 'Create an invoice from an existing quote — full, percentage, or fixed amount',
          parameters: {
            type: 'object',
            properties: {
              quote_number: { type: 'string', description: 'Quote number e.g. QUO-001' },
              mode: { type: 'string', enum: ['ENTIRE_QUOTE', 'PERCENTAGE', 'FIXED_AMOUNT'] },
              percentage: { type: 'number', description: 'For PERCENTAGE mode: percentage to invoice e.g. 30' },
              fixed_amount_pounds: { type: 'number', description: 'For FIXED_AMOUNT mode: amount in pounds' },
              _confirmed: { type: 'boolean', description: 'Internal confirmation flag' },
            },
            required: ['quote_number', 'mode'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_overdue_invoices',
          description: 'Get all overdue unpaid invoices',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'send_invoice',
          description: 'Email an invoice to the customer',
          parameters: {
            type: 'object',
            properties: {
              invoice_number: { type: 'string', description: 'Invoice number e.g. INV-001' },
              _confirmed: { type: 'boolean', description: 'Internal confirmation flag' },
            },
            required: ['invoice_number'],
          },
        },
      },

      // ── REMINDERS ─────────────────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'send_payment_reminders',
          description: 'Send payment reminder emails to all customers with overdue invoices',
          parameters: {
            type: 'object',
            properties: {
              _confirmed: { type: 'boolean', description: 'Internal confirmation flag' },
            },
          },
        },
      },

      // ── SUBCONTRACTORS + CIS ──────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'record_subcontractor_payment',
          description: 'Record a CIS payment to a subcontractor with automatic deduction calculation',
          parameters: {
            type: 'object',
            properties: {
              subcontractor_name: { type: 'string', description: 'Subcontractor name to search for' },
              gross_amount_pounds: { type: 'number', description: 'Total gross payment in pounds' },
              labour_amount_pounds: { type: 'number', description: 'Labour portion in pounds (CIS deduction applies here only)' },
              materials_amount_pounds: { type: 'number', description: 'Materials portion in pounds (no deduction)' },
              description: { type: 'string', description: 'Payment description' },
              payment_date: { type: 'string', description: 'Payment date YYYY-MM-DD (defaults to today)' },
              _confirmed: { type: 'boolean', description: 'Internal confirmation flag' },
            },
            required: ['subcontractor_name', 'gross_amount_pounds', 'labour_amount_pounds', 'materials_amount_pounds'],
          },
        },
      },

      // ── BUSINESS SUMMARY ──────────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'get_business_summary',
          description: 'Get a summary of the business: revenue, outstanding invoices, jobs, upcoming work',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];
  }

  // Preview a risky action (shows what WOULD happen before confirmation)
  async preview(
    companyId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ message: string }> {
    switch (toolName) {
      case 'create_invoice_from_quote': {
        const quoteNumber = args.quote_number as string;
        const mode = args.mode as string;
        const pct = args.percentage as number | undefined;
        const fixed = args.fixed_amount_pounds as number | undefined;
        const description =
          mode === 'PERCENTAGE' ? `a ${pct ?? '?'}% deposit invoice` :
          mode === 'FIXED_AMOUNT' ? `a £${fixed?.toFixed(2) ?? '?'} invoice` :
          'a full invoice';
        return {
          message: `I'll create ${description} from quote ${quoteNumber}. Shall I go ahead?`,
        };
      }

      case 'send_invoice': {
        return {
          message: `I'll email invoice ${args.invoice_number as string} to the customer. Shall I go ahead?`,
        };
      }

      case 'send_payment_reminders': {
        const count = await this.prisma.client.invoice.count({
          where: {
            company_id: companyId,
            status: { in: ['SENT', 'PART_PAID', 'OVERDUE'] },
            due_date: { lt: new Date() },
            reminders_disabled: false,
            customer: { email: { not: null } },
          },
        });
        return {
          message: `I'll send payment reminder emails to customers with overdue invoices (${count} invoice${count !== 1 ? 's' : ''} eligible). Shall I go ahead?`,
        };
      }

      case 'record_subcontractor_payment': {
        const name = args.subcontractor_name as string;
        const gross = args.gross_amount_pounds as number;
        const labour = args.labour_amount_pounds as number;
        const materials = args.materials_amount_pounds as number;

        // Look up subcontractor to get actual CIS rate
        const subs = await this.prisma.client.subcontractor.findMany({
          where: {
            company_id: companyId,
            name: { contains: name, mode: 'insensitive' },
            is_active: true,
          },
          select: { name: true, deduction_rate: true, cis_status: true },
          take: 1,
        });
        const rate = subs[0]?.deduction_rate ?? 30;
        const deduction = Math.round(labour * 100 * rate / 100) / 100;

        return {
          message: `I'll record a CIS payment of £${gross.toFixed(2)} to ${subs[0]?.name ?? name} — labour £${labour.toFixed(2)}, materials £${materials.toFixed(2)}, CIS deduction £${deduction.toFixed(2)} (${rate}% rate). Shall I go ahead?`,
        };
      }

      default:
        return { message: 'Shall I go ahead?' };
    }
  }

  // Execute a confirmed tool call
  async execute(
    companyId: string,
    _userId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    // Remove internal confirmation flag
    const { _confirmed: _, ...cleanArgs } = args;
    const a = cleanArgs;

    switch (toolName) {
      case 'create_job':                return this.executeCreateJob(companyId, a);
      case 'search_jobs':               return this.executeSearchJobs(companyId, a);
      case 'get_todays_jobs':           return this.executeGetTodaysJobs(companyId);
      case 'get_this_weeks_jobs':       return this.executeGetThisWeeksJobs(companyId);
      case 'create_customer':           return this.executeCreateCustomer(companyId, a);
      case 'search_customers':          return this.executeSearchCustomers(companyId, a);
      case 'create_quote':              return this.executeCreateQuote(companyId, a);
      case 'create_invoice_from_quote': return this.executeCreateInvoiceFromQuote(companyId, a);
      case 'get_overdue_invoices':      return this.executeGetOverdueInvoices(companyId);
      case 'send_invoice':              return this.executeSendInvoice(companyId, a);
      case 'send_payment_reminders':    return this.executeSendReminders(companyId);
      case 'record_subcontractor_payment': return this.executeRecordSubPayment(companyId, a);
      case 'get_business_summary':      return this.executeGetBusinessSummary(companyId);
      default:
        return { error: true, message: `Unknown tool: ${toolName}` };
    }
  }

  // ── Job implementations ─────────────────────────────────────────────────────

  private async executeCreateJob(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const customerName = args.customer_name as string;
    const customers = await this.prisma.client.customer.findMany({
      where: { company_id: companyId, name: { contains: customerName, mode: 'insensitive' } },
      orderBy: { name: 'asc' },
      take: 5,
    });
    if (!customers.length) {
      return { error: true, message: `No customer found matching "${customerName}". Try search_customers first.` };
    }
    const customer = customers[0];

    let scheduledAt: Date | undefined;
    if (args.scheduled_date) {
      const datePart = args.scheduled_date as string;
      const timePart = (args.scheduled_time as string | undefined) ?? '09:00';
      scheduledAt = new Date(`${datePart}T${timePart}:00`);
    }

    const dto: CreateJobDto = {
      customer_id: customer.id,
      title: args.title as string,
      description: args.description as string | undefined,
      status: scheduledAt ? JobStatus.SCHEDULED : JobStatus.QUOTED,
      scheduled_at: scheduledAt,
    };

    const job = await this.jobs.create(dto, companyId);
    const others = customers.length > 1 ? ` (${customers.length - 1} other match${customers.length > 2 ? 'es' : ''} found)` : '';

    return {
      success: true,
      job_id: job.id,
      title: job.title,
      customer: customer.name,
      scheduled_at: job.scheduled_at,
      others,
    };
  }

  private async executeSearchJobs(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const query = args.query as string | undefined;
    const status = args.status as string | undefined;

    const found = await this.prisma.client.job.findMany({
      where: {
        company_id: companyId,
        ...(status ? { status: status as JobStatus } : {}),
        ...(query ? {
          OR: [
            { title: { contains: query, mode: 'insensitive' as const } },
            { description: { contains: query, mode: 'insensitive' as const } },
            { customer: { name: { contains: query, mode: 'insensitive' as const } } },
          ],
        } : {}),
      },
      include: { customer: { select: { name: true } } },
      orderBy: { scheduled_at: 'desc' },
      take: 10,
    });

    return found.map(j => ({
      title: j.title,
      status: j.status,
      customer: j.customer.name,
      scheduled_at: j.scheduled_at,
    }));
  }

  private async executeGetTodaysJobs(companyId: string): Promise<ToolResult> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const found = await this.prisma.client.job.findMany({
      where: {
        company_id: companyId,
        scheduled_at: { gte: start, lte: end },
        status: { in: [JobStatus.SCHEDULED, JobStatus.IN_PROGRESS] },
      },
      include: { customer: { select: { name: true } }, engineer: { select: { name: true } } },
      orderBy: { scheduled_at: 'asc' },
    });

    return {
      count: found.length,
      jobs: found.map(j => ({
        title: j.title,
        status: j.status,
        customer: j.customer.name,
        engineer: j.engineer?.name ?? null,
        scheduled_at: j.scheduled_at,
      })),
    };
  }

  private async executeGetThisWeeksJobs(companyId: string): Promise<ToolResult> {
    const now = new Date();
    const start = new Date(now);
    const day = start.getDay();
    // Monday = start of week
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    const found = await this.prisma.client.job.findMany({
      where: {
        company_id: companyId,
        scheduled_at: { gte: start, lte: end },
        status: { in: [JobStatus.SCHEDULED, JobStatus.IN_PROGRESS] },
      },
      include: { customer: { select: { name: true } } },
      orderBy: { scheduled_at: 'asc' },
    });

    return {
      count: found.length,
      week_starts: start.toISOString().split('T')[0],
      week_ends: end.toISOString().split('T')[0],
      jobs: found.map(j => ({
        title: j.title,
        status: j.status,
        customer: j.customer.name,
        scheduled_at: j.scheduled_at,
      })),
    };
  }

  // ── Customer implementations ────────────────────────────────────────────────

  private async executeCreateCustomer(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const dto: CreateCustomerDto = {
      name: args.name as string,
      email: args.email as string | undefined,
      phone: args.phone as string | undefined,
      address_line1: args.address_line1 as string | undefined,
      city: args.city as string | undefined,
      postcode: args.postcode as string | undefined,
    };

    const customer = await this.customers.create(dto, companyId);
    return {
      success: true,
      customer_id: customer.id,
      name: customer.name,
      email: customer.email,
    };
  }

  private async executeSearchCustomers(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const query = (args.query as string).toLowerCase();
    const all = await this.customers.findAll(companyId);
    const results = all.filter(c =>
      c.name.toLowerCase().includes(query) ||
      (c.email?.toLowerCase().includes(query) ?? false) ||
      (c.phone?.includes(query) ?? false) ||
      (c.address_line1?.toLowerCase().includes(query) ?? false) ||
      (c.postcode?.toLowerCase().includes(query) ?? false),
    ).slice(0, 10);

    return {
      count: results.length,
      customers: results.map(c => ({
        name: c.name,
        email: c.email,
        phone: c.phone,
        address: [c.address_line1, c.city, c.postcode].filter(Boolean).join(', '),
      })),
    };
  }

  // ── Quote implementations ───────────────────────────────────────────────────

  private async executeCreateQuote(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const customerName = args.customer_name as string;
    const customers = await this.prisma.client.customer.findMany({
      where: { company_id: companyId, name: { contains: customerName, mode: 'insensitive' } },
      take: 5,
    });
    if (!customers.length) {
      return { error: true, message: `No customer found matching "${customerName}". Use search_customers to check existing customers.` };
    }
    const customer = customers[0];

    const rawItems = args.line_items as Array<{
      description: string;
      quantity: number;
      unit_price_pounds: number;
      vat_rate?: number;
    }>;

    const lineItems = rawItems.map(item => ({
      description: item.description,
      quantity: item.quantity,
      unit_price_pence: Math.round(item.unit_price_pounds * 100),
      vat_type: 'STANDARD' as const,
      vat_rate: item.vat_rate ?? 20,
    }));

    const quote = await this.quotes.create(companyId, {
      customer_id: customer.id,
      line_items: lineItems,
      reference: args.title as string | undefined,
      notes: args.notes as string | undefined,
    });

    return {
      success: true,
      quote_number: quote.quote_number,
      customer: customer.name,
      total: `£${(quote.total_pence / 100).toFixed(2)}`,
    };
  }

  // ── Invoice implementations ─────────────────────────────────────────────────

  private async executeCreateInvoiceFromQuote(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const quoteNumber = args.quote_number as string;
    const quote = await this.prisma.client.quote.findFirst({
      where: { company_id: companyId, quote_number: { equals: quoteNumber, mode: 'insensitive' } },
      select: { id: true, quote_number: true, total_pence: true },
    });
    if (!quote) {
      return { error: true, message: `Quote "${quoteNumber}" not found. Check the quote number and try again.` };
    }

    const mode = args.mode as string;
    const dto = {
      mode,
      ...(mode === 'PERCENTAGE' && args.percentage
        ? { percentage: args.percentage as number }
        : {}),
      ...(mode === 'FIXED_AMOUNT' && args.fixed_amount_pounds
        ? { fixed_amount_pence: Math.round((args.fixed_amount_pounds as number) * 100) }
        : {}),
    };

    const invoice = await this.invoices.createFromQuote(
      companyId,
      quote.id,
      dto as unknown as Parameters<typeof this.invoices.createFromQuote>[2],
    );

    return {
      success: true,
      invoice_number: (invoice as { invoice_number: string }).invoice_number,
      total: `£${((invoice as { total_pence: number }).total_pence / 100).toFixed(2)}`,
      from_quote: quote.quote_number,
    };
  }

  private async executeGetOverdueInvoices(companyId: string): Promise<ToolResult> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const found = await this.prisma.client.invoice.findMany({
      where: {
        company_id: companyId,
        status: { in: ['SENT', 'PART_PAID', 'OVERDUE'] },
        due_date: { lt: today },
      },
      include: { customer: { select: { name: true } } },
      orderBy: { due_date: 'asc' },
    });

    const totalPence = found.reduce((s, i) => s + i.amount_due_pence, 0);

    return {
      count: found.length,
      total_overdue: `£${(totalPence / 100).toFixed(2)}`,
      invoices: found.map(i => {
        const daysOverdue = Math.floor((Date.now() - new Date(i.due_date!).getTime()) / 86400000);
        return {
          invoice_number: i.invoice_number,
          customer: i.customer.name,
          amount_due: `£${(i.amount_due_pence / 100).toFixed(2)}`,
          due_date: new Date(i.due_date!).toLocaleDateString('en-GB'),
          days_overdue: daysOverdue,
        };
      }),
    };
  }

  private async executeSendInvoice(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const invoiceNumber = args.invoice_number as string;
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { company_id: companyId, invoice_number: { equals: invoiceNumber, mode: 'insensitive' } },
      select: { id: true, invoice_number: true },
    });
    if (!invoice) {
      return { error: true, message: `Invoice "${invoiceNumber}" not found.` };
    }

    await this.invoices.emailInvoice(companyId, invoice.id);
    return { success: true, invoice_number: invoice.invoice_number, sent: true };
  }

  // ── Reminder implementations ────────────────────────────────────────────────

  private async executeSendReminders(companyId: string): Promise<ToolResult> {
    await this.reminders.triggerPaymentReminders(companyId);
    return { success: true, message: 'Payment reminders triggered for all eligible overdue invoices.' };
  }

  // ── Subcontractor implementations ───────────────────────────────────────────

  private async executeRecordSubPayment(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const subName = args.subcontractor_name as string;
    const subs = await this.subcontractors.findAll(companyId);
    const matches = subs.filter(s =>
      s.name.toLowerCase().includes(subName.toLowerCase()),
    );
    if (!matches.length) {
      return { error: true, message: `No subcontractor found matching "${subName}". Check their name in the Subcontractors section.` };
    }
    const sub = matches[0];

    const paymentDate = (args.payment_date as string | undefined) ?? new Date().toISOString().split('T')[0];

    const payment = await this.subPayments.create(companyId, {
      subcontractor_id: sub.id,
      payment_date: paymentDate,
      labour_amount_pence: Math.round((args.labour_amount_pounds as number) * 100),
      materials_amount_pence: Math.round((args.materials_amount_pounds as number) * 100),
      description: args.description as string | undefined,
    });

    return {
      success: true,
      subcontractor: sub.name,
      gross: `£${(payment.gross_amount_pence / 100).toFixed(2)}`,
      deduction: `£${(payment.deduction_amount_pence / 100).toFixed(2)}`,
      net: `£${(payment.net_payment_pence / 100).toFixed(2)}`,
      deduction_rate: `${payment.deduction_rate}%`,
      tax_month: payment.tax_month,
    };
  }

  // ── Business summary ────────────────────────────────────────────────────────

  private async executeGetBusinessSummary(companyId: string): Promise<ToolResult> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const today = new Date(now);
    today.setHours(23, 59, 59, 999);
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);
    weekEnd.setHours(23, 59, 59, 999);

    const [revenueThisMonth, outstanding, overdue, jobsCompleted, jobsUpcoming] = await Promise.all([
      this.prisma.client.invoice.aggregate({
        where: {
          company_id: companyId,
          status: 'PAID',
          paid_date: { gte: monthStart },
        },
        _sum: { total_pence: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: {
          company_id: companyId,
          status: { in: ['SENT', 'PART_PAID', 'OVERDUE'] },
        },
        _sum: { amount_due_pence: true },
        _count: true,
      }),
      this.prisma.client.invoice.aggregate({
        where: {
          company_id: companyId,
          status: { in: ['SENT', 'PART_PAID', 'OVERDUE'] },
          due_date: { lt: now },
        },
        _sum: { amount_due_pence: true },
        _count: true,
      }),
      this.prisma.client.job.count({
        where: {
          company_id: companyId,
          status: 'COMPLETED',
          updated_at: { gte: monthStart },
        },
      }),
      this.prisma.client.job.count({
        where: {
          company_id: companyId,
          scheduled_at: { gte: now, lte: weekEnd },
          status: { in: [JobStatus.SCHEDULED, JobStatus.IN_PROGRESS, JobStatus.QUOTED] },
        },
      }),
    ]);

    return {
      revenue_this_month: `£${((revenueThisMonth._sum.total_pence ?? 0) / 100).toFixed(2)}`,
      outstanding_total: `£${((outstanding._sum.amount_due_pence ?? 0) / 100).toFixed(2)}`,
      outstanding_invoices: outstanding._count,
      overdue_total: `£${((overdue._sum.amount_due_pence ?? 0) / 100).toFixed(2)}`,
      overdue_invoices: overdue._count,
      jobs_completed_this_month: jobsCompleted,
      jobs_scheduled_next_7_days: jobsUpcoming,
    };
  }
}
