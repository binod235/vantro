import { Injectable } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service';
import { CustomersService } from '../customers/customers.service';
import { QuotesService } from '../quotes/quotes.service';
import { InvoicesService } from '../invoices/invoices.service';
import { SubcontractorsService } from '../subcontractors/subcontractors.service';
import { SubcontractorPaymentsService } from '../subcontractors/subcontractor-payments.service';
import { CisEngineService } from '../subcontractors/cis-engine.service';
import { RemindersService } from '../reminders/reminders.service';
import { StorageService } from '../../storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { buildBusinessReportHtml } from './ai-report.pdf';
import type { CreateJobDto } from '../jobs/dto/create-job.dto';
import type { CreateCustomerDto } from '../customers/dto/create-customer.dto';
import { JobStatus, InvoiceStatus } from '@prisma/client';
import { randomUUID } from 'crypto';

interface ToolParameter {
  type: string;
  description?: string;
  enum?: (string | number)[];
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

const p2 = (pence: number) => parseFloat((pence / 100).toFixed(2));

@Injectable()
export class AiToolsService {
  constructor(
    private readonly jobs: JobsService,
    private readonly customers: CustomersService,
    private readonly quotes: QuotesService,
    private readonly invoices: InvoicesService,
    private readonly subcontractors: SubcontractorsService,
    private readonly subPayments: SubcontractorPaymentsService,
    private readonly cisEngine: CisEngineService,
    private readonly reminders: RemindersService,
    private readonly storage: StorageService,
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

      // ── BUSINESS INTELLIGENCE ─────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'get_unbilled_jobs',
          description: "Find completed jobs that have not been invoiced yet — helps catch revenue you forgot to bill for",
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_customer_debt_summary',
          description: 'Shows which customers owe you the most money, ranked by outstanding balance with aging breakdown (current/30/60/90 days)',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_cash_flow_forecast',
          description: 'Forecasts cash flow for the next 30/60/90 days based on upcoming invoice payments, recurring invoices, and outstanding purchase orders',
          parameters: {
            type: 'object',
            properties: {
              days: { type: 'number', description: 'Forecast period in days', enum: [30, 60, 90] },
            },
            required: ['days'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_cis_position',
          description: "Shows your CIS position for the current tax month — deductions made, deductions suffered, net liability, and deadline",
          parameters: {
            type: 'object',
            properties: {
              tax_month: { type: 'string', description: 'Tax month YYYY-MM (defaults to current if omitted)' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_revenue_breakdown',
          description: 'Shows revenue breakdown by month and customer for a given period, with comparison to the previous equivalent period',
          parameters: {
            type: 'object',
            properties: {
              period: {
                type: 'string',
                description: 'Time period to analyse',
                enum: ['this_month', 'last_month', 'this_quarter', 'last_quarter', 'this_year'],
              },
            },
            required: ['period'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_team_productivity',
          description: 'Shows engineer productivity — hours logged, jobs completed, and average time per job for each team member',
          parameters: {
            type: 'object',
            properties: {
              period: {
                type: 'string',
                description: 'Time period',
                enum: ['this_week', 'last_week', 'this_month', 'last_month'],
              },
            },
            required: ['period'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_quote_pipeline',
          description: 'Shows your quote pipeline — drafts, sent awaiting response, accepted but not started, conversion rate, and total pipeline value',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_weekly_digest',
          description: 'Comprehensive weekly business summary — jobs, revenue, quotes, CIS, unbilled work, team hours, and key highlights. The Monday morning briefing.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_profit_and_loss',
          description: 'Simplified profit and loss — revenue from paid invoices minus expenses from purchase orders and subcontractor payments. Includes comparison with previous period.',
          parameters: {
            type: 'object',
            properties: {
              period: {
                type: 'string',
                description: 'Time period to analyse',
                enum: ['this_month', 'last_month', 'this_quarter', 'last_quarter', 'this_year'],
              },
            },
            required: ['period'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'generate_business_report',
          description: 'Generates a professional PDF business summary report with financials, job stats, CIS position, and key highlights. Returns a download URL.',
          parameters: {
            type: 'object',
            properties: {
              period: {
                type: 'string',
                description: 'Report period',
                enum: ['this_week', 'this_month', 'last_month', 'this_quarter'],
              },
            },
            required: ['period'],
          },
        },
      },
    ];
  }

  // ── Preview (risky actions only) ────────────────────────────────────────────

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

  // ── Execute ─────────────────────────────────────────────────────────────────

  async execute(
    companyId: string,
    _userId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const { _confirmed: _, ...cleanArgs } = args;
    const a = cleanArgs;

    switch (toolName) {
      // Existing CRUD tools
      case 'create_job':                   return this.executeCreateJob(companyId, a);
      case 'search_jobs':                  return this.executeSearchJobs(companyId, a);
      case 'get_todays_jobs':              return this.executeGetTodaysJobs(companyId);
      case 'get_this_weeks_jobs':          return this.executeGetThisWeeksJobs(companyId);
      case 'create_customer':              return this.executeCreateCustomer(companyId, a);
      case 'search_customers':             return this.executeSearchCustomers(companyId, a);
      case 'create_quote':                 return this.executeCreateQuote(companyId, a);
      case 'create_invoice_from_quote':    return this.executeCreateInvoiceFromQuote(companyId, a);
      case 'get_overdue_invoices':         return this.executeGetOverdueInvoices(companyId);
      case 'send_invoice':                 return this.executeSendInvoice(companyId, a);
      case 'send_payment_reminders':       return this.executeSendReminders(companyId);
      case 'record_subcontractor_payment': return this.executeRecordSubPayment(companyId, a);
      case 'get_business_summary':         return this.executeGetBusinessSummary(companyId);

      // New BI tools
      case 'get_unbilled_jobs':            return this.executeGetUnbilledJobs(companyId);
      case 'get_customer_debt_summary':    return this.executeGetCustomerDebtSummary(companyId);
      case 'get_cash_flow_forecast':       return this.executeGetCashFlowForecast(companyId, a);
      case 'get_cis_position':             return this.executeGetCisPosition(companyId, a);
      case 'get_revenue_breakdown':        return this.executeGetRevenueBreakdown(companyId, a);
      case 'get_team_productivity':        return this.executeGetTeamProductivity(companyId, a);
      case 'get_quote_pipeline':           return this.executeGetQuotePipeline(companyId);
      case 'get_weekly_digest':            return this.executeGetWeeklyDigest(companyId);
      case 'get_profit_and_loss':          return this.executeGetProfitAndLoss(companyId, a);
      case 'generate_business_report':     return this.executeGenerateBusinessReport(companyId, a);

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

  // ── BI: Unbilled jobs ───────────────────────────────────────────────────────

  private async executeGetUnbilledJobs(companyId: string): Promise<ToolResult> {
    const allCompleted = await this.prisma.client.job.findMany({
      where: { company_id: companyId, status: JobStatus.COMPLETED },
      include: {
        customer: { select: { name: true } },
        invoices: { select: { id: true, status: true } },
        quotes: { select: { total_pence: true }, orderBy: { created_at: 'desc' }, take: 1 },
      },
      orderBy: { updated_at: 'desc' },
    });

    const unbilled = allCompleted.filter(j =>
      !j.invoices.some(i => i.status !== InvoiceStatus.CANCELLED),
    );

    const estimatedPence = unbilled.reduce((s, j) => s + (j.quotes[0]?.total_pence ?? 0), 0);

    return {
      unbilled_count: unbilled.length,
      estimated_value_pounds: p2(estimatedPence),
      jobs: unbilled.map(j => ({
        title: j.title,
        customer_name: j.customer.name,
        completed_date: j.updated_at.toLocaleDateString('en-GB'),
        quote_total_pounds: j.quotes[0] ? p2(j.quotes[0].total_pence) : null,
      })),
    };
  }

  // ── BI: Customer debt summary ───────────────────────────────────────────────

  private async executeGetCustomerDebtSummary(companyId: string): Promise<ToolResult> {
    const now = new Date();
    const outstanding = await this.prisma.client.invoice.findMany({
      where: {
        company_id: companyId,
        status: { in: ['SENT', 'PART_PAID', 'OVERDUE'] },
      },
      include: { customer: { select: { name: true } } },
    });

    const custMap = new Map<string, { name: string; invoices: typeof outstanding }>();
    for (const inv of outstanding) {
      const existing = custMap.get(inv.customer_id);
      if (existing) {
        existing.invoices.push(inv);
      } else {
        custMap.set(inv.customer_id, { name: inv.customer.name, invoices: [inv] });
      }
    }

    const customers = Array.from(custMap.values()).map(({ name, invoices: custInvs }) => {
      const totalOwed = custInvs.reduce((s, i) => s + i.amount_due_pence, 0);
      const aging = { current: 0, days_30: 0, days_60: 0, days_90: 0 };
      let oldestDays = 0;

      for (const inv of custInvs) {
        const daysOverdue = inv.due_date
          ? Math.floor((now.getTime() - new Date(inv.due_date).getTime()) / 86400000)
          : 0;
        if (daysOverdue > oldestDays) oldestDays = daysOverdue;
        const amt = inv.amount_due_pence;
        if (daysOverdue <= 0) aging.current += amt;
        else if (daysOverdue <= 30) aging.days_30 += amt;
        else if (daysOverdue <= 60) aging.days_60 += amt;
        else aging.days_90 += amt;
      }

      return {
        name,
        total_owed_pounds: p2(totalOwed),
        invoice_count: custInvs.length,
        oldest_days: Math.max(0, oldestDays),
        aging: {
          current_pounds: p2(aging.current),
          days_30_pounds: p2(aging.days_30),
          days_60_pounds: p2(aging.days_60),
          days_90_plus_pounds: p2(aging.days_90),
        },
      };
    }).sort((a, b) => b.total_owed_pounds - a.total_owed_pounds).slice(0, 10);

    const totalOutstanding = outstanding.reduce((s, i) => s + i.amount_due_pence, 0);
    const totalOverdue = outstanding
      .filter(i => i.due_date && new Date(i.due_date) < now)
      .reduce((s, i) => s + i.amount_due_pence, 0);

    return {
      total_outstanding_pounds: p2(totalOutstanding),
      total_overdue_pounds: p2(totalOverdue),
      customers,
    };
  }

  // ── BI: Cash flow forecast ──────────────────────────────────────────────────

  private async executeGetCashFlowForecast(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const days = (args.days as number) || 30;
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + days);

    const [invoicesDue, recurringInvoices, poOutstanding, subPaymentsAgg] = await Promise.all([
      this.prisma.client.invoice.aggregate({
        where: {
          company_id: companyId,
          status: { in: ['SENT', 'PART_PAID', 'OVERDUE'] },
          due_date: { gte: now, lte: end },
        },
        _sum: { amount_due_pence: true },
      }),
      this.prisma.client.recurringInvoice.aggregate({
        where: {
          company_id: companyId,
          is_active: true,
          next_run_date: { gte: now, lte: end },
        },
        _sum: { total_pence: true },
      }),
      this.prisma.client.purchaseOrder.aggregate({
        where: {
          company_id: companyId,
          status: { in: ['DRAFT', 'SENT'] },
        },
        _sum: { total_pence: true },
      }),
      this.prisma.client.subcontractorPayment.aggregate({
        where: {
          company_id: companyId,
          payment_date: { gte: now, lte: end },
        },
        _sum: { net_payment_pence: true },
      }),
    ]);

    const invoiceIncomePence = invoicesDue._sum.amount_due_pence ?? 0;
    const recurringIncomePence = recurringInvoices._sum.total_pence ?? 0;
    const poExpensesPence = poOutstanding._sum.total_pence ?? 0;
    const subExpensesPence = subPaymentsAgg._sum.net_payment_pence ?? 0;

    const totalIncome = invoiceIncomePence + recurringIncomePence;
    const totalExpenses = poExpensesPence + subExpensesPence;
    const net = totalIncome - totalExpenses;

    const warnings: string[] = [];
    if (net < 0) {
      warnings.push(`Potential cash shortfall of £${p2(Math.abs(net))} over the next ${days} days`);
    }
    if (poExpensesPence > invoiceIncomePence) {
      warnings.push(`Purchase orders outstanding (£${p2(poExpensesPence)}) exceed incoming invoice payments due (£${p2(invoiceIncomePence)})`);
    }

    return {
      period_days: days,
      expected_income_pounds: p2(totalIncome),
      expected_expenses_pounds: p2(totalExpenses),
      net_pounds: p2(net),
      breakdown: {
        invoice_payments_due_pounds: p2(invoiceIncomePence),
        recurring_invoices_pounds: p2(recurringIncomePence),
        purchase_orders_outstanding_pounds: p2(poExpensesPence),
        subcontractor_payments_pounds: p2(subExpensesPence),
      },
      warning: warnings.length > 0 ? warnings.join('. ') : null,
    };
  }

  // ── BI: CIS position ────────────────────────────────────────────────────────

  private async executeGetCisPosition(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const taxMonth = (args.tax_month as string | undefined) ?? this.cisEngine.getCurrentTaxMonth();
    const [summary, submission] = await Promise.all([
      this.cisEngine.getMonthlySummary(companyId, taxMonth),
      this.cisEngine.getSubmissionStatus(companyId, taxMonth),
    ]);

    const now = new Date();
    const daysUntilDeadline = Math.ceil((summary.deadline.getTime() - now.getTime()) / 86400000);

    let warning: string | null = null;
    if (!submission) {
      if (daysUntilDeadline < 0) {
        warning = `CIS300 deadline was ${Math.abs(daysUntilDeadline)} days ago — submit immediately to avoid penalties`;
      } else if (daysUntilDeadline <= 30) {
        warning = `CIS300 deadline in ${daysUntilDeadline} days — not yet submitted`;
      }
    }

    return {
      tax_month: taxMonth,
      tax_month_label: summary.tax_month_label,
      deducted_from_subs_pounds: p2(summary.total_deductions_pence),
      suffered_pounds: p2(summary.total_suffered_pence),
      net_liability_pounds: p2(summary.net_cis_liability_pence),
      deadline: summary.deadline.toISOString().split('T')[0],
      days_until_deadline: daysUntilDeadline,
      cis300_submitted: !!submission,
      subcontractor_count: summary.subcontractor_count,
      is_nil_return: summary.is_nil_return,
      warning,
    };
  }

  // ── BI: Revenue breakdown ───────────────────────────────────────────────────

  private async executeGetRevenueBreakdown(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const period = (args.period as string) || 'this_month';
    const { start, end, prevStart, prevEnd, label } = this.getPeriodDates(period);

    const [paid, prevAgg] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where: {
          company_id: companyId,
          status: 'PAID',
          paid_date: { gte: start, lte: end },
        },
        include: { customer: { select: { name: true } } },
      }),
      this.prisma.client.invoice.aggregate({
        where: {
          company_id: companyId,
          status: 'PAID',
          paid_date: { gte: prevStart, lte: prevEnd },
        },
        _sum: { total_pence: true },
      }),
    ]);

    const totalPence = paid.reduce((s, i) => s + i.total_pence, 0);
    const prevPence = prevAgg._sum.total_pence ?? 0;
    const changePercent = prevPence > 0
      ? parseFloat(((totalPence - prevPence) / prevPence * 100).toFixed(1))
      : null;

    // Group by month
    const monthMap = new Map<string, number>();
    for (const inv of paid) {
      if (!inv.paid_date) continue;
      const key = new Date(inv.paid_date).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      monthMap.set(key, (monthMap.get(key) ?? 0) + inv.total_pence);
    }
    const byMonth = Array.from(monthMap.entries()).map(([month, pence]) => ({
      month,
      revenue_pounds: p2(pence),
    }));

    // Top customers
    const custMap = new Map<string, { name: string; total: number }>();
    for (const inv of paid) {
      const existing = custMap.get(inv.customer_id);
      if (existing) {
        existing.total += inv.total_pence;
      } else {
        custMap.set(inv.customer_id, { name: inv.customer.name, total: inv.total_pence });
      }
    }
    const topCustomers = Array.from(custMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map(c => ({ name: c.name, revenue_pounds: p2(c.total) }));

    return {
      period: label,
      total_revenue_pounds: p2(totalPence),
      previous_period_pounds: p2(prevPence),
      change_percent: changePercent,
      by_month: byMonth,
      top_customers: topCustomers,
      invoice_count: paid.length,
      average_invoice_pounds: paid.length > 0 ? p2(Math.round(totalPence / paid.length)) : 0,
    };
  }

  // ── BI: Team productivity ───────────────────────────────────────────────────

  private async executeGetTeamProductivity(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const period = (args.period as string) || 'this_week';
    const { start, end, label } = this.getSimplePeriodDates(period);

    const timesheets = await this.prisma.client.timesheet.findMany({
      where: {
        company_id: companyId,
        date: { gte: start, lte: end },
      },
      include: {
        user: { select: { name: true } },
        job: { select: { status: true } },
      },
    });

    const engMap = new Map<string, {
      name: string;
      totalMinutes: number;
      jobIds: Set<string>;
      completedJobIds: Set<string>;
    }>();

    for (const ts of timesheets) {
      const existing = engMap.get(ts.user_id);
      if (existing) {
        existing.totalMinutes += ts.duration_minutes;
        if (ts.job_id) {
          existing.jobIds.add(ts.job_id);
          if (ts.job?.status === 'COMPLETED') existing.completedJobIds.add(ts.job_id);
        }
      } else {
        const entry = {
          name: ts.user.name,
          totalMinutes: ts.duration_minutes,
          jobIds: new Set<string>(),
          completedJobIds: new Set<string>(),
        };
        if (ts.job_id) {
          entry.jobIds.add(ts.job_id);
          if (ts.job?.status === 'COMPLETED') entry.completedJobIds.add(ts.job_id);
        }
        engMap.set(ts.user_id, entry);
      }
    }

    const engineers = Array.from(engMap.values()).map(e => {
      const hours = parseFloat((e.totalMinutes / 60).toFixed(1));
      const jobsWorked = e.jobIds.size;
      return {
        name: e.name,
        hours_logged: hours,
        jobs_completed: e.completedJobIds.size,
        jobs_worked: jobsWorked,
        avg_hours_per_job: jobsWorked > 0 ? parseFloat((hours / jobsWorked).toFixed(1)) : 0,
      };
    }).sort((a, b) => b.hours_logged - a.hours_logged);

    const teamTotalMinutes = timesheets.reduce((s, ts) => s + ts.duration_minutes, 0);
    const allCompletedJobIds = new Set(
      timesheets.filter(ts => ts.job?.status === 'COMPLETED' && ts.job_id).map(ts => ts.job_id!),
    );

    return {
      period: label,
      engineers,
      team_total_hours: parseFloat((teamTotalMinutes / 60).toFixed(1)),
      team_jobs_completed: allCompletedJobIds.size,
    };
  }

  // ── BI: Quote pipeline ──────────────────────────────────────────────────────

  private async executeGetQuotePipeline(companyId: string): Promise<ToolResult> {
    const now = new Date();
    const allQuotes = await this.prisma.client.quote.findMany({
      where: {
        company_id: companyId,
        status: { notIn: ['CANCELLED', 'EXPIRED'] },
      },
      include: { customer: { select: { name: true } } },
      orderBy: { last_sent_at: 'asc' },
    });

    const breakdown = {
      draft: { count: 0, totalPence: 0 },
      sent_awaiting: { count: 0, totalPence: 0 },
      accepted_not_started: { count: 0, totalPence: 0 },
    };

    let oldestSent: (typeof allQuotes)[0] | null = null;

    for (const q of allQuotes) {
      if (q.status === 'DRAFT' || q.status === 'APPROVED') {
        breakdown.draft.count++;
        breakdown.draft.totalPence += q.total_pence;
      } else if (q.status === 'SENT') {
        breakdown.sent_awaiting.count++;
        breakdown.sent_awaiting.totalPence += q.total_pence;
        if (q.last_sent_at) {
          if (!oldestSent?.last_sent_at || q.last_sent_at < oldestSent.last_sent_at) {
            oldestSent = q;
          }
        }
      } else if (q.status === 'ACCEPTED') {
        breakdown.accepted_not_started.count++;
        breakdown.accepted_not_started.totalPence += q.total_pence;
      }
    }

    const acceptedCount = allQuotes.filter(q => q.status === 'ACCEPTED' || q.status === 'INVOICED').length;
    const rejectedCount = allQuotes.filter(q => q.status === 'REJECTED').length;
    const conversionRate = (acceptedCount + rejectedCount) > 0
      ? parseFloat(((acceptedCount / (acceptedCount + rejectedCount)) * 100).toFixed(1))
      : null;

    const pipelinePence = breakdown.draft.totalPence + breakdown.sent_awaiting.totalPence + breakdown.accepted_not_started.totalPence;

    return {
      pipeline_total_pounds: p2(pipelinePence),
      breakdown: {
        draft: { count: breakdown.draft.count, total_pounds: p2(breakdown.draft.totalPence) },
        sent_awaiting: { count: breakdown.sent_awaiting.count, total_pounds: p2(breakdown.sent_awaiting.totalPence) },
        accepted_not_started: { count: breakdown.accepted_not_started.count, total_pounds: p2(breakdown.accepted_not_started.totalPence) },
      },
      oldest_unanswered: oldestSent ? {
        quote_number: oldestSent.quote_number,
        customer: oldestSent.customer?.name ?? 'Unknown',
        sent_date: oldestSent.last_sent_at?.toLocaleDateString('en-GB') ?? null,
        days_waiting: oldestSent.last_sent_at
          ? Math.floor((now.getTime() - oldestSent.last_sent_at.getTime()) / 86400000)
          : null,
        total_pounds: p2(oldestSent.total_pence),
      } : null,
      conversion_rate_percent: conversionRate,
    };
  }

  // ── BI: Weekly digest ───────────────────────────────────────────────────────

  private async executeGetWeeklyDigest(companyId: string): Promise<ToolResult> {
    const now = new Date();

    // This week (Mon–Sun)
    const weekStart = new Date(now);
    const day = weekStart.getDay();
    weekStart.setDate(weekStart.getDate() - (day === 0 ? 6 : day - 1));
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    // Next week
    const nextWeekStart = new Date(weekEnd);
    nextWeekStart.setDate(nextWeekStart.getDate() + 1);
    nextWeekStart.setHours(0, 0, 0, 0);
    const nextWeekEnd = new Date(nextWeekStart);
    nextWeekEnd.setDate(nextWeekEnd.getDate() + 6);
    nextWeekEnd.setHours(23, 59, 59, 999);

    // Previous week (for revenue comparison)
    const prevWeekStart = new Date(weekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    const prevWeekEnd = new Date(weekEnd);
    prevWeekEnd.setDate(prevWeekEnd.getDate() - 7);

    const taxMonth = this.cisEngine.getCurrentTaxMonth();

    const [
      jobsCompleted,
      jobsInProgress,
      jobsScheduledThisWeek,
      jobsScheduledNextWeek,
      revenueCollected,
      revenueInvoiced,
      outstanding,
      overdue,
      quotesSent,
      quotesAccepted,
      quotePipelineAgg,
      allCompletedJobs,
      remindersSent,
      timesheetsAgg,
      prevRevenueAgg,
      cisSubmission,
    ] = await Promise.all([
      this.prisma.client.job.count({
        where: { company_id: companyId, status: 'COMPLETED', updated_at: { gte: weekStart, lte: weekEnd } },
      }),
      this.prisma.client.job.count({
        where: { company_id: companyId, status: 'IN_PROGRESS' },
      }),
      this.prisma.client.job.count({
        where: {
          company_id: companyId,
          scheduled_at: { gte: weekStart, lte: weekEnd },
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        },
      }),
      this.prisma.client.job.count({
        where: {
          company_id: companyId,
          scheduled_at: { gte: nextWeekStart, lte: nextWeekEnd },
          status: 'SCHEDULED',
        },
      }),
      this.prisma.client.invoice.aggregate({
        where: { company_id: companyId, status: 'PAID', paid_date: { gte: weekStart, lte: weekEnd } },
        _sum: { total_pence: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { company_id: companyId, issue_date: { gte: weekStart, lte: weekEnd } },
        _sum: { total_pence: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { company_id: companyId, status: { in: ['SENT', 'PART_PAID', 'OVERDUE'] } },
        _sum: { amount_due_pence: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { company_id: companyId, status: { in: ['SENT', 'PART_PAID', 'OVERDUE'] }, due_date: { lt: now } },
        _sum: { amount_due_pence: true },
      }),
      this.prisma.client.quote.count({
        where: { company_id: companyId, last_sent_at: { gte: weekStart, lte: weekEnd } },
      }),
      this.prisma.client.quote.count({
        where: { company_id: companyId, accepted_at: { gte: weekStart, lte: weekEnd } },
      }),
      this.prisma.client.quote.aggregate({
        where: {
          company_id: companyId,
          status: { in: ['DRAFT', 'APPROVED', 'SENT', 'ACCEPTED'] },
        },
        _sum: { total_pence: true },
      }),
      this.prisma.client.job.findMany({
        where: { company_id: companyId, status: JobStatus.COMPLETED },
        include: {
          invoices: { select: { id: true, status: true } },
          quotes: { select: { total_pence: true }, orderBy: { created_at: 'desc' }, take: 1 },
        },
      }),
      this.prisma.client.communicationLog.count({
        where: {
          company_id: companyId,
          type: 'PAYMENT_REMINDER',
          sent_at: { gte: weekStart, lte: weekEnd },
        },
      }),
      this.prisma.client.timesheet.aggregate({
        where: { company_id: companyId, date: { gte: weekStart, lte: weekEnd } },
        _sum: { duration_minutes: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { company_id: companyId, status: 'PAID', paid_date: { gte: prevWeekStart, lte: prevWeekEnd } },
        _sum: { total_pence: true },
      }),
      this.cisEngine.getSubmissionStatus(companyId, taxMonth),
    ]);

    const cisData = await this.cisEngine.getMonthlySummary(companyId, taxMonth);

    const unbilledJobs = allCompletedJobs.filter(j =>
      !j.invoices.some(i => i.status !== InvoiceStatus.CANCELLED),
    );
    const unbilledCount = unbilledJobs.length;
    const unbilledPence = unbilledJobs.reduce((s, j) => s + (j.quotes[0]?.total_pence ?? 0), 0);

    const thisRevenuePence = revenueCollected._sum.total_pence ?? 0;
    const prevRevenuePence = prevRevenueAgg._sum.total_pence ?? 0;
    const teamHours = Math.round((timesheetsAgg._sum.duration_minutes ?? 0) / 60);
    const daysUntilDeadline = Math.ceil((cisData.deadline.getTime() - now.getTime()) / 86400000);

    // Build highlights
    const highlights: string[] = [];
    if (prevRevenuePence > 0) {
      const changeSign = thisRevenuePence >= prevRevenuePence ? 'up' : 'down';
      const changePct = Math.abs(Math.round((thisRevenuePence - prevRevenuePence) / prevRevenuePence * 100));
      highlights.push(`Revenue ${changeSign} ${changePct}% vs last week (£${p2(thisRevenuePence)} vs £${p2(prevRevenuePence)})`);
    }
    if (unbilledCount > 0) {
      const est = unbilledPence > 0 ? ` — estimated £${p2(unbilledPence)} to bill` : '';
      highlights.push(`${unbilledCount} completed job${unbilledCount !== 1 ? 's' : ''} not yet invoiced${est}`);
    }
    if (!cisSubmission && daysUntilDeadline <= 30 && cisData.subcontractor_count > 0) {
      const urgency = daysUntilDeadline < 0 ? 'OVERDUE' : `${daysUntilDeadline} days remaining`;
      highlights.push(`CIS300 not submitted — ${urgency}`);
    }
    const overduePence = overdue._sum.amount_due_pence ?? 0;
    if (overduePence > 0) {
      const topDebtor = await this.prisma.client.invoice.groupBy({
        by: ['customer_id'],
        where: { company_id: companyId, status: { in: ['SENT', 'PART_PAID', 'OVERDUE'] }, due_date: { lt: now } },
        _sum: { amount_due_pence: true },
        orderBy: { _sum: { amount_due_pence: 'desc' } },
        take: 1,
      });
      if (topDebtor.length > 0 && (topDebtor[0]._sum.amount_due_pence ?? 0) > 0) {
        const cust = await this.prisma.client.customer.findUnique({
          where: { id: topDebtor[0].customer_id },
          select: { name: true },
        });
        if (cust) {
          highlights.push(`${cust.name} owes £${p2(topDebtor[0]._sum.amount_due_pence ?? 0)} — consider sending a reminder`);
        }
      }
    }

    const periodLabel = `${weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${weekEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;

    return {
      period: periodLabel,
      jobs: {
        completed: jobsCompleted,
        in_progress: jobsInProgress,
        scheduled_this_week: jobsScheduledThisWeek,
        scheduled_next_week: jobsScheduledNextWeek,
      },
      revenue: {
        collected_pounds: p2(thisRevenuePence),
        invoiced_pounds: p2(revenueInvoiced._sum.total_pence ?? 0),
        outstanding_pounds: p2(outstanding._sum.amount_due_pence ?? 0),
        overdue_pounds: p2(overduePence),
      },
      quotes: {
        sent: quotesSent,
        accepted: quotesAccepted,
        pipeline_pounds: p2(quotePipelineAgg._sum.total_pence ?? 0),
      },
      cis: {
        current_month_liability_pounds: p2(cisData.net_cis_liability_pence),
        deadline: cisData.deadline.toISOString().split('T')[0],
        days_until_deadline: daysUntilDeadline,
        submitted: !!cisSubmission,
      },
      unbilled_jobs: unbilledCount,
      unbilled_estimated_pounds: p2(unbilledPence),
      reminders_sent: remindersSent,
      team_hours: teamHours,
      highlights,
    };
  }

  // ── BI: Profit and loss ─────────────────────────────────────────────────────

  private async executeGetProfitAndLoss(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const period = (args.period as string) || 'this_month';
    const { start, end, prevStart, prevEnd, label } = this.getPeriodDates(period);

    const [revenue, prevRevenue, poReceived, prevPoReceived, subPaid, prevSubPaid] = await Promise.all([
      this.prisma.client.invoice.aggregate({
        where: { company_id: companyId, status: 'PAID', paid_date: { gte: start, lte: end } },
        _sum: { total_pence: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { company_id: companyId, status: 'PAID', paid_date: { gte: prevStart, lte: prevEnd } },
        _sum: { total_pence: true },
      }),
      this.prisma.client.purchaseOrder.aggregate({
        where: {
          company_id: companyId,
          status: 'RECEIVED',
          received_date: { gte: start, lte: end },
        },
        _sum: { total_pence: true },
      }),
      this.prisma.client.purchaseOrder.aggregate({
        where: {
          company_id: companyId,
          status: 'RECEIVED',
          received_date: { gte: prevStart, lte: prevEnd },
        },
        _sum: { total_pence: true },
      }),
      this.prisma.client.subcontractorPayment.aggregate({
        where: { company_id: companyId, payment_date: { gte: start, lte: end } },
        _sum: { net_payment_pence: true },
      }),
      this.prisma.client.subcontractorPayment.aggregate({
        where: { company_id: companyId, payment_date: { gte: prevStart, lte: prevEnd } },
        _sum: { net_payment_pence: true },
      }),
    ]);

    const revPence = revenue._sum.total_pence ?? 0;
    const prevRevPence = prevRevenue._sum.total_pence ?? 0;
    const materialsPence = poReceived._sum.total_pence ?? 0;
    const prevMaterialsPence = prevPoReceived._sum.total_pence ?? 0;
    const subPence = subPaid._sum.net_payment_pence ?? 0;
    const prevSubPence = prevSubPaid._sum.net_payment_pence ?? 0;

    const totalExpenses = materialsPence + subPence;
    const grossProfit = revPence - totalExpenses;
    const grossMargin = revPence > 0 ? parseFloat(((grossProfit / revPence) * 100).toFixed(1)) : 0;

    const prevTotalExpenses = prevMaterialsPence + prevSubPence;
    const prevGrossProfit = prevRevPence - prevTotalExpenses;

    const revenueChange = prevRevPence > 0
      ? parseFloat(((revPence - prevRevPence) / prevRevPence * 100).toFixed(1))
      : null;
    const profitChange = prevGrossProfit > 0
      ? parseFloat(((grossProfit - prevGrossProfit) / prevGrossProfit * 100).toFixed(1))
      : null;

    const prevPeriodDates = this.getPeriodDates(
      period === 'this_month' ? 'last_month' :
      period === 'this_quarter' ? 'last_quarter' :
      period,
    );

    return {
      period: label,
      revenue_pounds: p2(revPence),
      expenses: {
        materials_pounds: p2(materialsPence),
        subcontractor_pounds: p2(subPence),
        total_pounds: p2(totalExpenses),
      },
      gross_profit_pounds: p2(grossProfit),
      gross_margin_percent: grossMargin,
      comparison: {
        previous_period: prevPeriodDates.label,
        previous_revenue_pounds: p2(prevRevPence),
        previous_profit_pounds: p2(prevGrossProfit),
        revenue_change_percent: revenueChange,
        profit_change_percent: profitChange,
      },
      note: 'Simplified P&L based on invoices and purchase orders in Vantro. Does not include overhead costs (rent, fuel, insurance, wages). Consult your accountant for full statutory accounts.',
    };
  }

  // ── PDF business report ─────────────────────────────────────────────────────

  private async executeGenerateBusinessReport(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const period = (args.period as string) || 'this_month';
    const now = new Date();

    // Resolve period window
    let start: Date;
    let end: Date;
    let label: string;

    if (period === 'this_week') {
      const { start: s, end: e, label: l } = this.getSimplePeriodDates('this_week');
      start = s; end = e; label = l;
    } else {
      const dates = this.getPeriodDates(period === 'last_month' ? 'last_month' : period === 'this_quarter' ? 'this_quarter' : 'this_month');
      start = dates.start; end = dates.end; label = dates.label;
    }

    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: { name: true, logo_url: true, invoice_accent_colour: true },
    });
    if (!company) return { error: true, message: 'Company not found' };

    const taxMonth = this.cisEngine.getCurrentTaxMonth();

    const [
      paidInvoices,
      outstandingAgg,
      overdueAgg,
      outstandingCount,
      overdueCount,
      allCompletedJobs,
      jobsInProgress,
      jobsScheduled,
      quotesSent,
      quotesAccepted,
      quotePipelineAgg,
      allOutstandingInvoices,
      cashFlowIncome,
      cashFlowExpenses,
      teamTimesheets,
      cisSubmission,
    ] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where: { company_id: companyId, status: 'PAID', paid_date: { gte: start, lte: end } },
        include: { customer: { select: { name: true } } },
      }),
      this.prisma.client.invoice.aggregate({
        where: { company_id: companyId, status: { in: ['SENT', 'PART_PAID', 'OVERDUE'] } },
        _sum: { amount_due_pence: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { company_id: companyId, status: { in: ['SENT', 'PART_PAID', 'OVERDUE'] }, due_date: { lt: now } },
        _sum: { amount_due_pence: true },
      }),
      this.prisma.client.invoice.count({
        where: { company_id: companyId, status: { in: ['SENT', 'PART_PAID', 'OVERDUE'] } },
      }),
      this.prisma.client.invoice.count({
        where: { company_id: companyId, status: { in: ['SENT', 'PART_PAID', 'OVERDUE'] }, due_date: { lt: now } },
      }),
      this.prisma.client.job.findMany({
        where: { company_id: companyId, status: JobStatus.COMPLETED, updated_at: { gte: start, lte: end } },
      }),
      this.prisma.client.job.count({ where: { company_id: companyId, status: 'IN_PROGRESS' } }),
      this.prisma.client.job.count({
        where: {
          company_id: companyId,
          status: 'SCHEDULED',
          scheduled_at: { gte: now },
        },
      }),
      this.prisma.client.quote.count({
        where: { company_id: companyId, last_sent_at: { gte: start, lte: end } },
      }),
      this.prisma.client.quote.count({
        where: { company_id: companyId, accepted_at: { gte: start, lte: end } },
      }),
      this.prisma.client.quote.aggregate({
        where: { company_id: companyId, status: { in: ['DRAFT', 'APPROVED', 'SENT', 'ACCEPTED'] } },
        _sum: { total_pence: true },
      }),
      this.prisma.client.invoice.findMany({
        where: { company_id: companyId, status: { in: ['SENT', 'PART_PAID', 'OVERDUE'] } },
        include: { customer: { select: { name: true } } },
      }),
      this.prisma.client.invoice.aggregate({
        where: {
          company_id: companyId,
          status: { in: ['SENT', 'PART_PAID', 'OVERDUE'] },
          due_date: { gte: now, lte: new Date(now.getTime() + 30 * 86400000) },
        },
        _sum: { amount_due_pence: true },
      }),
      this.prisma.client.purchaseOrder.aggregate({
        where: { company_id: companyId, status: { in: ['DRAFT', 'SENT'] } },
        _sum: { total_pence: true },
      }),
      this.prisma.client.timesheet.findMany({
        where: { company_id: companyId, date: { gte: start, lte: end } },
        include: { user: { select: { name: true } } },
      }),
      this.cisEngine.getSubmissionStatus(companyId, taxMonth),
    ]);

    const cisData = await this.cisEngine.getMonthlySummary(companyId, taxMonth);

    // Revenue metrics
    const revPence = paidInvoices.reduce((s, i) => s + i.total_pence, 0);
    const invCount = paidInvoices.length;
    const avgInv = invCount > 0 ? revPence / invCount : 0;

    // Top debtors
    const custDebtMap = new Map<string, { name: string; total: number; count: number; oldestDays: number }>();
    for (const inv of allOutstandingInvoices) {
      const daysOverdue = inv.due_date ? Math.floor((now.getTime() - new Date(inv.due_date).getTime()) / 86400000) : 0;
      const existing = custDebtMap.get(inv.customer_id);
      if (existing) {
        existing.total += inv.amount_due_pence;
        existing.count++;
        if (daysOverdue > existing.oldestDays) existing.oldestDays = daysOverdue;
      } else {
        custDebtMap.set(inv.customer_id, { name: inv.customer.name, total: inv.amount_due_pence, count: 1, oldestDays: Math.max(0, daysOverdue) });
      }
    }
    const debtors = Array.from(custDebtMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map(d => ({ name: d.name, total_owed_pounds: p2(d.total), invoice_count: d.count, oldest_days: d.oldestDays }));

    // Team by engineer
    const engMap = new Map<string, { name: string; minutes: number; jobs: Set<string> }>();
    for (const ts of teamTimesheets) {
      const existing = engMap.get(ts.user_id);
      if (existing) {
        existing.minutes += ts.duration_minutes;
        if (ts.job_id) existing.jobs.add(ts.job_id);
      } else {
        const entry = { name: ts.user.name, minutes: ts.duration_minutes, jobs: new Set<string>() };
        if (ts.job_id) entry.jobs.add(ts.job_id);
        engMap.set(ts.user_id, entry);
      }
    }
    const team = Array.from(engMap.values())
      .map(e => ({ name: e.name, hours_logged: parseFloat((e.minutes / 60).toFixed(1)), jobs_completed: allCompletedJobs.filter(j => e.jobs.has(j.id)).length }))
      .sort((a, b) => b.hours_logged - a.hours_logged);

    // Conversion rate
    const acceptedAll = await this.prisma.client.quote.count({ where: { company_id: companyId, status: { in: ['ACCEPTED', 'INVOICED'] } } });
    const rejectedAll = await this.prisma.client.quote.count({ where: { company_id: companyId, status: 'REJECTED' } });
    const convRate = (acceptedAll + rejectedAll) > 0 ? parseFloat(((acceptedAll / (acceptedAll + rejectedAll)) * 100).toFixed(1)) : null;

    // Highlights
    const highlights: string[] = [];
    const unbilledForReport = allCompletedJobs.length;
    if (unbilledForReport > 0) highlights.push(`${unbilledForReport} jobs completed in this period`);
    const outstandingPence = outstandingAgg._sum.amount_due_pence ?? 0;
    if (outstandingPence > 0) highlights.push(`£${p2(outstandingPence)} outstanding from ${outstandingCount} invoice${outstandingCount !== 1 ? 's' : ''}`);
    const overduePence = overdueAgg._sum.amount_due_pence ?? 0;
    if (overduePence > 0) highlights.push(`£${p2(overduePence)} overdue across ${overdueCount} invoice${overdueCount !== 1 ? 's' : ''} — consider chasing`);
    const daysUntilDeadline = Math.ceil((cisData.deadline.getTime() - now.getTime()) / 86400000);
    if (!cisSubmission && cisData.subcontractor_count > 0 && daysUntilDeadline <= 30) {
      highlights.push(`CIS300 due in ${daysUntilDeadline} days — not yet submitted`);
    }

    // Previous period for revenue comparison
    const prevDates = period === 'this_week'
      ? this.getSimplePeriodDates('last_week')
      : this.getPeriodDates(period === 'this_month' ? 'last_month' : period === 'this_quarter' ? 'last_quarter' : 'last_month');
    const prevRevAgg = await this.prisma.client.invoice.aggregate({
      where: { company_id: companyId, status: 'PAID', paid_date: { gte: prevDates.start, lte: prevDates.end } },
      _sum: { total_pence: true },
    });
    const prevRevPence = prevRevAgg._sum.total_pence ?? 0;
    const changePercent = prevRevPence > 0 ? parseFloat(((revPence - prevRevPence) / prevRevPence * 100).toFixed(1)) : null;

    // Generate PDF
    const html = buildBusinessReportHtml({
      company_name: company.name,
      logo_url: company.logo_url ?? null,
      accent_colour: company.invoice_accent_colour ?? null,
      period: label,
      generated_at: now,
      revenue: {
        total_pounds: p2(revPence),
        previous_pounds: p2(prevRevPence),
        change_percent: changePercent,
        invoice_count: invCount,
        average_pounds: p2(avgInv),
      },
      invoices: {
        outstanding_pounds: p2(outstandingPence),
        overdue_pounds: p2(overduePence),
        outstanding_count: outstandingCount,
        overdue_count: overdueCount,
      },
      debtors,
      cash_flow: {
        income_pounds: p2(cashFlowIncome._sum.amount_due_pence ?? 0),
        expenses_pounds: p2(cashFlowExpenses._sum.total_pence ?? 0),
        net_pounds: p2((cashFlowIncome._sum.amount_due_pence ?? 0) - (cashFlowExpenses._sum.total_pence ?? 0)),
      },
      jobs: {
        completed: allCompletedJobs.length,
        in_progress: jobsInProgress,
        scheduled: jobsScheduled,
      },
      quotes: {
        pipeline_pounds: p2(quotePipelineAgg._sum.total_pence ?? 0),
        sent_count: quotesSent,
        accepted_count: quotesAccepted,
        conversion_rate: convRate,
      },
      cis: cisData.subcontractor_count > 0 ? {
        tax_month_label: cisData.tax_month_label,
        liability_pounds: p2(cisData.net_cis_liability_pence),
        deadline: cisData.deadline.toLocaleDateString('en-GB'),
        days_until_deadline: daysUntilDeadline,
        submitted: !!cisSubmission,
      } : null,
      team,
      highlights,
    });

    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    let pdfBuffer: Buffer;
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      pdfBuffer = Buffer.from(await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
      }));
    } finally {
      await browser.close();
    }

    const key = `reports/${companyId}/${randomUUID()}.pdf`;
    const url = await this.storage.uploadFile(pdfBuffer, key, 'application/pdf');

    return {
      success: true,
      download_url: url,
      period: label,
      generated_at: now.toLocaleDateString('en-GB'),
      message: `Your ${label} business report is ready.`,
    };
  }

  // ── Period helpers ──────────────────────────────────────────────────────────

  private getPeriodDates(period: string): {
    start: Date; end: Date;
    prevStart: Date; prevEnd: Date;
    label: string;
  } {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    switch (period) {
      case 'last_month': {
        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0, 23, 59, 59, 999);
        return { start, end, prevStart: new Date(year, month - 2, 1), prevEnd: new Date(year, month - 1, 0, 23, 59, 59, 999), label: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
      }
      case 'this_quarter': {
        const q = Math.floor(month / 3);
        const start = new Date(year, q * 3, 1);
        const end = new Date(year, q * 3 + 3, 0, 23, 59, 59, 999);
        const pqYear = q === 0 ? year - 1 : year;
        const pq = q === 0 ? 3 : q - 1;
        return { start, end, prevStart: new Date(pqYear, pq * 3, 1), prevEnd: new Date(pqYear, pq * 3 + 3, 0, 23, 59, 59, 999), label: `Q${q + 1} ${year}` };
      }
      case 'last_quarter': {
        const q = Math.floor(month / 3);
        const pq = q === 0 ? 3 : q - 1;
        const pqYear = q === 0 ? year - 1 : year;
        const start = new Date(pqYear, pq * 3, 1);
        const end = new Date(pqYear, pq * 3 + 3, 0, 23, 59, 59, 999);
        const ppq = pq === 0 ? 3 : pq - 1;
        const ppqYear = pq === 0 ? pqYear - 1 : pqYear;
        return { start, end, prevStart: new Date(ppqYear, ppq * 3, 1), prevEnd: new Date(ppqYear, ppq * 3 + 3, 0, 23, 59, 59, 999), label: `Q${pq + 1} ${pqYear}` };
      }
      case 'this_year': {
        return {
          start: new Date(year, 0, 1),
          end: new Date(year, 11, 31, 23, 59, 59, 999),
          prevStart: new Date(year - 1, 0, 1),
          prevEnd: new Date(year - 1, 11, 31, 23, 59, 59, 999),
          label: String(year),
        };
      }
      default: { // this_month
        const start = new Date(year, month, 1);
        const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
        return { start, end, prevStart: new Date(year, month - 1, 1), prevEnd: new Date(year, month, 0, 23, 59, 59, 999), label: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
      }
    }
  }

  private getSimplePeriodDates(period: string): { start: Date; end: Date; label: string } {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const day = now.getDay();

    switch (period) {
      case 'last_week': {
        const start = new Date(now);
        start.setDate(now.getDate() - (day === 0 ? 6 : day - 1) - 7);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        return { start, end, label: 'Last week' };
      }
      case 'this_month': {
        return { start: new Date(year, month, 1), end: new Date(year, month + 1, 0, 23, 59, 59, 999), label: now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
      }
      case 'last_month': {
        const start = new Date(year, month - 1, 1);
        return { start, end: new Date(year, month, 0, 23, 59, 59, 999), label: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
      }
      default: { // this_week
        const start = new Date(now);
        start.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        return { start, end, label: 'This week' };
      }
    }
  }
}
