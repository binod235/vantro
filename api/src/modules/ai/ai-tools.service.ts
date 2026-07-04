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
      {
        type: 'function',
        function: {
          name: 'prepare_form',
          description: `Prepares and pre-fills a form for the user to complete. Use this instead of create_job/create_quote/create_customer when the user's request involves complex structured data like line items, kits, multiple fields, or price lists. The user will complete the details in the proper form UI rather than typing everything in chat.

Use prepare_form for:
- Creating quotes (need line items, prices, VAT)
- Creating invoices manually (need line items)
- Creating jobs (many optional fields)
- Creating customers (address, contact details)
- Recording subcontractor payments (amount breakdowns)
- Creating gas certificates (technical fields)
- Creating credit notes (line items)
- Adding new subcontractors (UTR, CIS status, company type)

Do NOT use prepare_form for:
- Simple searches (use search tools)
- Read-only queries (use get_ tools)
- Actions like send_invoice, send_reminders (use those directly)
- Creating invoice from quote (use create_invoice_from_quote directly)`,
          parameters: {
            type: 'object',
            properties: {
              form_type: {
                type: 'string',
                enum: ['job', 'customer', 'quote', 'invoice', 'gas_certificate', 'subcontractor_payment', 'credit_note', 'subcontractor'],
                description: 'Which form to open',
              },
              customer_name: { type: 'string', description: 'Customer name to search and pre-fill' },
              subcontractor_name: { type: 'string', description: 'Subcontractor name to search and pre-fill' },
              title: { type: 'string', description: 'Job/quote title to pre-fill' },
              description: { type: 'string', description: 'Description to pre-fill' },
              scheduled_date: { type: 'string', description: 'Date to pre-fill (YYYY-MM-DD)' },
              scheduled_time: { type: 'string', description: 'Time to pre-fill (HH:MM)' },
            },
            required: ['form_type'],
          },
        },
      },

      // ── EMAIL DRAFTING ────────────────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'draft_email',
          description: `Draft a professional email for the business owner. Use when the user asks to "write an email", "draft a message", "follow up", "chase", "write to", or similar. Returns a draft the user can review and edit before sending.`,
          parameters: {
            type: 'object',
            properties: {
              recipient_name: { type: 'string', description: 'Who the email is for' },
              recipient_email: { type: 'string', description: 'Email address if known' },
              purpose: {
                type: 'string',
                enum: ['payment_chase', 'quote_follow_up', 'appointment_confirmation', 'job_complete', 'thank_you', 'general'],
                description: 'What the email is about',
              },
              context: { type: 'string', description: 'Any specific details to include' },
              tone: {
                type: 'string',
                enum: ['friendly', 'firm', 'formal'],
                description: 'Tone of the email',
              },
            },
            required: ['recipient_name', 'purpose'],
          },
        },
      },

      // ── EXTRAORDINARY FEATURES ────────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'get_customer_profile',
          description: `Get a comprehensive profile of a customer — their full history with your business. Use when the user says "tell me about [name]", "what's the story with [name]", "customer summary for [name]", "everything on [name]", or just mentions a customer name in a way that implies they want context.`,
          parameters: {
            type: 'object',
            properties: {
              customer_name: { type: 'string', description: 'Customer name to look up' },
            },
            required: ['customer_name'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_priority_action',
          description: `Analyse the business right now and recommend the single most impactful thing the owner should do. Use when the user asks "what should I focus on", "what's most important", "what should I do", "priorities", "what needs attention".`,
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'extract_actions_from_note',
          description: `Extract and execute multiple actions from a free-form note or phone call summary. Use when the user describes what happened in a call, meeting, or visit in natural language and expects you to figure out what needs doing. Extract: jobs to create, quotes to send, reminders to set, notes to add, follow-ups to schedule.`,
          parameters: {
            type: 'object',
            properties: {
              note: { type: 'string', description: 'The free-form text describing what happened' },
            },
            required: ['note'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_win_rate_analysis',
          description: `Analyse quote win rates and pricing patterns. Use when the user asks about pricing, win rates, "am I pricing right", "why are quotes being rejected", "how much should I charge for X".`,
          parameters: {
            type: 'object',
            properties: {
              job_type: { type: 'string', description: 'Specific job type to analyse (e.g. "boiler install"). Leave empty for overall analysis.' },
            },
          },
        },
      },

      // ── REMINDERS ─────────────────────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'create_reminder',
          description: `Create a reminder for a future date. Use this when the user says "remind me", "follow up", "chase", "check on", "don't forget" or similar. Creates a todo item that will appear in the morning briefing on the due date.`,
          parameters: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'What to be reminded about (e.g. "Follow up with James Fletcher about boiler quote")',
              },
              due_date: {
                type: 'string',
                description: 'When to be reminded, in YYYY-MM-DD format. Resolve relative dates like "tomorrow", "next Tuesday", "in 3 days" using today\'s date from the system prompt.',
              },
              priority: {
                type: 'string',
                enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
                description: 'Priority level. Default MEDIUM. Use HIGH for money-related follow-ups, URGENT only if user explicitly says it\'s urgent.',
              },
              customer_name: {
                type: 'string',
                description: 'Related customer name if mentioned (for linking)',
              },
              notes: {
                type: 'string',
                description: 'Any additional context the user mentioned',
              },
            },
            required: ['title', 'due_date'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_reminders',
          description: 'List upcoming reminders/todos. Use when the user asks "what reminders do I have", "what\'s coming up", "any follow-ups due".',
          parameters: {
            type: 'object',
            properties: {
              period: {
                type: 'string',
                enum: ['today', 'this_week', 'next_week', 'all_upcoming'],
                description: 'Time period to show',
              },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'complete_reminder',
          description: 'Mark a reminder/todo as done. Use when the user says "done", "completed", "mark as done" about a specific reminder.',
          parameters: {
            type: 'object',
            properties: {
              search: {
                type: 'string',
                description: 'Search text to find the reminder (partial title match)',
              },
            },
            required: ['search'],
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
      case 'prepare_form':                 return this.executePrepareForm(companyId, a);
      case 'draft_email':                  return this.executeDraftEmail(companyId, a);

      // Extraordinary tools
      case 'get_customer_profile':         return this.executeGetCustomerProfile(companyId, a);
      case 'get_priority_action':          return this.executeGetPriorityAction(companyId);
      case 'extract_actions_from_note':    return this.executeExtractActionsFromNote(companyId, a);
      case 'get_win_rate_analysis':        return this.executeGetWinRateAnalysis(companyId, a);

      // Reminder tools
      case 'create_reminder':              return this.executeCreateReminder(companyId, _userId, a);
      case 'list_reminders':               return this.executeListReminders(companyId, a);
      case 'complete_reminder':            return this.executeCompleteReminder(companyId, a);

      // Engineer tools
      case 'get_my_todays_jobs':       return this.executeGetMyTodaysJobs(companyId, _userId);
      case 'get_my_next_job':          return this.executeGetMyNextJob(companyId, _userId);
      case 'get_my_week':              return this.executeGetMyWeek(companyId, _userId);
      case 'get_job_details':          return this.executeGetJobDetails(companyId, _userId, a);
      case 'get_address_history':      return this.executeGetAddressHistory(companyId, a);
      case 'check_job_completion':     return this.executeCheckJobCompletion(companyId, _userId, a);
      case 'get_my_hours':             return this.executeGetMyHours(companyId, _userId, a);
      case 'technical_reference':      return this.executeGetTechnicalReference(a);
      case 'add_job_note':             return this.executeAddJobNote(companyId, _userId, a);
      case 'running_late':             return this.executeRunningLate(companyId, _userId, a);
      case 'log_materials':            return this.executeLogMaterials(companyId, _userId, a);
      case 'get_previous_readings':    return this.executeGetPreviousReadings(companyId, a);
      case 'get_end_of_day_summary':   return this.executeGetEndOfDaySummary(companyId, _userId);
      case 'get_safety_checklist':     return this.executeGetSafetyChecklist(a);
      case 'get_photo_guidance':       return this.executeGetPhotoGuidance(a);

      default:
        return { error: true, message: `Unknown tool: ${toolName}` };
    }
  }

  getEngineerToolDefinitions() {
    return [
      {
        type: 'function' as const,
        function: {
          name: 'get_my_todays_jobs',
          description: "Get the engineer's own jobs scheduled for today",
          parameters: { type: 'object' as const, properties: {} },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'get_my_next_job',
          description: "Get the engineer's next upcoming job with full details including customer address and phone",
          parameters: { type: 'object' as const, properties: {} },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'get_my_week',
          description: "Get the engineer's schedule for this week",
          parameters: { type: 'object' as const, properties: {} },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'get_job_details',
          description: 'Get full details of a specific job assigned to this engineer by title or customer name',
          parameters: {
            type: 'object' as const,
            properties: {
              search: { type: 'string', description: 'Job title or customer name to search' },
            },
            required: ['search'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'get_address_history',
          description: `Get the history of previous work done at a customer's address. Use when engineer asks "what was done here before", "previous visits", "history at this address".`,
          parameters: {
            type: 'object' as const,
            properties: {
              customer_name: { type: 'string', description: 'Customer name to look up' },
            },
            required: ['customer_name'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'check_job_completion',
          description: `Check if a job has everything needed to be marked complete — photos, notes, timesheet, gas cert. Use when engineer asks "can I close this", "is this job done", "what's missing".`,
          parameters: {
            type: 'object' as const,
            properties: {
              search: { type: 'string', description: 'Job title or customer name' },
            },
            required: ['search'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'get_my_hours',
          description: "Get the engineer's own timesheet hours for today, this week, or last week",
          parameters: {
            type: 'object' as const,
            properties: {
              period: { type: 'string', enum: ['today', 'this_week', 'last_week'] },
            },
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'technical_reference',
          description: `Answer plumbing and heating technical questions — gas safety regulations, boiler specs, pipe sizing, flow rates, flue clearances, Building Regs Part J/L, Gas Safe requirements, water bylaws.`,
          parameters: {
            type: 'object' as const,
            properties: {
              question: { type: 'string', description: 'The technical question' },
            },
            required: ['question'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'add_job_note',
          description: `Add a timestamped note to a job. Use when the engineer wants to record what they did, what they found, or what needs following up.`,
          parameters: {
            type: 'object' as const,
            properties: {
              search: { type: 'string', description: 'Job title or customer name' },
              note: { type: 'string', description: 'The note to add' },
            },
            required: ['search', 'note'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'running_late',
          description: `Notify the office that the engineer is running late to a job. Use when engineer says "running late", "delayed", "stuck in traffic", "won't make it on time".`,
          parameters: {
            type: 'object' as const,
            properties: {
              customer_name: { type: 'string', description: 'Which customer/job' },
              delay_minutes: { type: 'number', description: 'Estimated delay in minutes' },
              reason: { type: 'string', description: 'Brief reason: traffic, previous job overran, etc.' },
            },
            required: ['customer_name'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'log_materials',
          description: `Log materials/parts used on a job. Use when engineer says "I used", "parts used", "fitted a", "installed", "replaced with". Records what was used so the owner can bill for materials.`,
          parameters: {
            type: 'object' as const,
            properties: {
              search: { type: 'string', description: 'Job title or customer name' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    description: { type: 'string', description: 'Part/material name' },
                    quantity: { type: 'number', description: 'How many' },
                  },
                  required: ['description'],
                },
                description: 'List of parts/materials used',
              },
            },
            required: ['search', 'items'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'get_previous_readings',
          description: `Get previous gas certificate readings for a property. Use when engineer asks "what were the readings last time", "previous CO readings", "last gas cert results".`,
          parameters: {
            type: 'object' as const,
            properties: {
              customer_name: { type: 'string', description: 'Customer name' },
            },
            required: ['customer_name'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'get_end_of_day_summary',
          description: `Get a summary of the engineer's day — jobs done, hours logged, active timers, missing documentation. Use when engineer says "day summary", "am I done", "end of day", "heading home".`,
          parameters: { type: 'object' as const, properties: {} },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'get_safety_checklist',
          description: `Get a safety checklist for the type of work being done. Use when engineer asks about safety checks, what to check before starting.`,
          parameters: {
            type: 'object' as const,
            properties: {
              job_type: {
                type: 'string',
                enum: ['gas_service', 'gas_install', 'boiler_repair', 'unvented_cylinder', 'bathroom', 'radiators', 'leak_repair', 'general_plumbing'],
                description: 'Type of work',
              },
            },
            required: ['job_type'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'get_photo_guidance',
          description: `Suggest what photos to take for this type of job. Use when engineer asks "what photos do I need" or "what should I photograph".`,
          parameters: {
            type: 'object' as const,
            properties: {
              job_type: { type: 'string', description: 'Type of work being done' },
            },
            required: ['job_type'],
          },
        },
      },
    ];
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

    // Cross-reference: overdue invoices + last engineer for this customer
    const [overdueCount, lastJob] = await Promise.all([
      this.prisma.client.invoice.count({
        where: {
          company_id: companyId,
          customer_id: customer.id,
          status: { in: ['SENT', 'PART_PAID', 'OVERDUE'] },
          due_date: { lt: new Date() },
        },
      }),
      this.prisma.client.job.findFirst({
        where: {
          company_id: companyId,
          customer_id: customer.id,
          status: 'COMPLETED',
          engineer_id: { not: null },
          id: { not: job.id },
        },
        orderBy: { updated_at: 'desc' },
        include: { engineer: { select: { name: true } } },
      }),
    ]);

    return {
      success: true,
      job_id: job.id,
      title: job.title,
      customer: customer.name,
      scheduled_at: job.scheduled_at,
      others,
      cross_reference: {
        overdue_invoices: overdueCount > 0 ? overdueCount : null,
        last_engineer: lastJob?.engineer?.name ?? null,
        last_job_type: lastJob?.title ?? null,
      },
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

  // ── Prepare form ────────────────────────────────────────────────────────────

  private async executePrepareForm(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const formType = args.form_type as string;
    const prefill: Record<string, unknown> = {};
    let note: string | undefined;

    if (args.customer_name) {
      const customers = await this.prisma.client.customer.findMany({
        where: {
          company_id: companyId,
          name: { contains: args.customer_name as string, mode: 'insensitive' },
        },
        take: 1,
      });
      if (customers.length > 0) {
        prefill.customer_id = customers[0].id;
        prefill.customer_name = customers[0].name;
      } else {
        prefill.customer_name_search = args.customer_name;
        note = `No customer found matching "${args.customer_name as string}" — you can search or create one in the form.`;
      }
    }

    if (args.subcontractor_name) {
      const subs = await this.prisma.client.subcontractor.findMany({
        where: {
          company_id: companyId,
          name: { contains: args.subcontractor_name as string, mode: 'insensitive' },
        },
        take: 1,
      });
      if (subs.length > 0) {
        prefill.subcontractor_id = subs[0].id;
        prefill.subcontractor_name = subs[0].name;
      }
    }

    if (args.title) prefill.title = args.title;
    if (args.description) prefill.description = args.description;
    if (args.scheduled_date) prefill.scheduled_date = args.scheduled_date;
    if (args.scheduled_time) prefill.scheduled_time = args.scheduled_time;

    return { action: 'open_form', form: formType, prefill, note };
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

  // ── Reminder implementations ─────────────────────────────────────────────────

  private async executeCreateReminder(
    companyId: string,
    userId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const title = args.title as string;
    const dueDate = new Date(args.due_date as string);
    const priority = (args.priority as string | undefined) ?? 'MEDIUM';
    const notes = (args.notes as string | undefined) ?? null;
    const customerName = args.customer_name as string | undefined;

    let description = notes;

    // If customer name given, search and append to description (Todo has no customer_id)
    if (customerName) {
      const customers = await this.prisma.client.customer.findMany({
        where: { company_id: companyId, name: { contains: customerName, mode: 'insensitive' } },
        select: { name: true },
        take: 1,
      });
      const matched = customers[0]?.name ?? customerName;
      if (notes) {
        description = `Re: ${matched}\n${notes}`;
      } else {
        description = `Re: ${matched}`;
      }
    }

    const todo = await this.prisma.client.todo.create({
      data: {
        company_id: companyId,
        title,
        description,
        due_date: dueDate,
        priority: priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
        status: 'OPEN',
        created_by_id: userId,
      },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    let dueLabel: string;
    if (diffDays === 0) dueLabel = 'today';
    else if (diffDays === 1) dueLabel = 'tomorrow';
    else if (diffDays <= 7) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      dueLabel = dayNames[dueDate.getDay()];
    } else {
      dueLabel = dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
    }

    return {
      success: true,
      reminder_id: todo.id,
      title,
      due: dueLabel,
      due_date: args.due_date,
      priority,
      message: `Reminder set for ${dueLabel}: "${title}"`,
    };
  }

  private async executeListReminders(
    companyId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const period = (args.period as string | undefined) ?? 'all_upcoming';

    let dateFilter: { gte?: Date; lt?: Date } = {};
    let periodLabel = 'upcoming';

    switch (period) {
      case 'today':
        dateFilter = { gte: today, lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) };
        periodLabel = 'today';
        break;
      case 'this_week': {
        const endOfWeek = new Date(today);
        endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
        dateFilter = { gte: today, lt: endOfWeek };
        periodLabel = 'this week';
        break;
      }
      case 'next_week': {
        const startNext = new Date(today);
        startNext.setDate(startNext.getDate() + (7 - startNext.getDay()));
        const endNext = new Date(startNext.getTime() + 7 * 24 * 60 * 60 * 1000);
        dateFilter = { gte: startNext, lt: endNext };
        periodLabel = 'next week';
        break;
      }
      default:
        dateFilter = { gte: today };
        periodLabel = 'upcoming';
    }

    const [todos, overdue] = await Promise.all([
      this.prisma.client.todo.findMany({
        where: { company_id: companyId, status: 'OPEN', due_date: dateFilter },
        orderBy: [{ priority: 'desc' }, { due_date: 'asc' }],
        take: 15,
      }),
      this.prisma.client.todo.findMany({
        where: { company_id: companyId, status: 'OPEN', due_date: { lt: today } },
        orderBy: { due_date: 'asc' },
        take: 5,
      }),
    ]);

    return {
      period: periodLabel,
      reminders: todos.map(t => ({
        id: t.id,
        title: t.title,
        due_date: t.due_date ? t.due_date.toISOString().split('T')[0] : null,
        priority: t.priority,
        description: t.description,
      })),
      overdue: overdue.map(t => ({
        id: t.id,
        title: t.title,
        due_date: t.due_date ? t.due_date.toISOString().split('T')[0] : null,
        priority: t.priority,
        days_overdue: t.due_date
          ? Math.floor((now.getTime() - t.due_date.getTime()) / (1000 * 60 * 60 * 24))
          : 0,
      })),
      total_upcoming: todos.length,
      total_overdue: overdue.length,
    };
  }

  private async executeCompleteReminder(
    companyId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const search = args.search as string;

    const todos = await this.prisma.client.todo.findMany({
      where: {
        company_id: companyId,
        status: 'OPEN',
        title: { contains: search, mode: 'insensitive' },
      },
      take: 3,
    });

    if (todos.length === 0) {
      return { success: false, message: `No open reminder found matching "${search}".` };
    }

    if (todos.length > 1) {
      return {
        success: false,
        message: `Found ${todos.length} reminders matching "${search}": ${todos.map(t => `"${t.title}"`).join(', ')}. Please be more specific.`,
        matches: todos.map(t => ({ id: t.id, title: t.title })),
      };
    }

    await this.prisma.client.todo.update({
      where: { id: todos[0].id },
      data: { status: 'DONE', done_at: new Date() },
    });

    return {
      success: true,
      message: `Done! Marked "${todos[0].title}" as completed.`,
      reminder_id: todos[0].id,
      title: todos[0].title,
    };
  }

  // ── Extraordinary features ───────────────────────────────────────────────────

  private async executeGetCustomerProfile(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const customer = await this.prisma.client.customer.findFirst({
      where: {
        company_id: companyId,
        name: { contains: args.customer_name as string, mode: 'insensitive' },
      },
    });
    if (!customer) {
      return { error: true, message: `No customer found matching "${args.customer_name as string}"` };
    }

    const now = new Date();

    const [jobs, invoices, quotes, gasCerts] = await Promise.all([
      this.prisma.client.job.findMany({
        where: { company_id: companyId, customer_id: customer.id },
        orderBy: { created_at: 'desc' },
        include: { engineer: { select: { name: true } } },
      }),
      this.prisma.client.invoice.findMany({
        where: { company_id: companyId, customer_id: customer.id },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.client.quote.findMany({
        where: { company_id: companyId, customer_id: customer.id },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.client.gasSafetyCertificate.findMany({
        where: { company_id: companyId, customer_id: customer.id },
        orderBy: { created_at: 'desc' },
        take: 5,
      }),
    ]);

    const completedJobs = jobs.filter(j => j.status === 'COMPLETED');
    const activeJobs = jobs.filter(j => ['SCHEDULED', 'IN_PROGRESS'].includes(j.status));

    const paidInvoices = invoices.filter(i => i.status === 'PAID');
    const overdueInvoices = invoices.filter(i =>
      ['SENT', 'PART_PAID'].includes(i.status) && i.due_date !== null && i.due_date < now,
    );
    const outstandingInvoices = invoices.filter(i => ['SENT', 'PART_PAID'].includes(i.status));

    const lifetimeRevenue = paidInvoices.reduce((sum, i) => sum + i.total_pence, 0);
    const outstandingTotal = outstandingInvoices.reduce((sum, i) => sum + i.amount_due_pence, 0);
    const overdueTotal = overdueInvoices.reduce((sum, i) => sum + i.amount_due_pence, 0);

    const acceptedQuotes = quotes.filter(q => q.status === 'ACCEPTED');
    const pendingQuotes = quotes.filter(q => q.status === 'SENT');

    // CP12 renewal prediction
    const lastCP12 = gasCerts.find(g => g.cert_type === 'CP12');
    let cp12DueInfo: string | null = null;
    if (lastCP12) {
      const renewalDate = new Date(lastCP12.created_at);
      renewalDate.setFullYear(renewalDate.getFullYear() + 1);
      const daysUntilRenewal = Math.ceil((renewalDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntilRenewal <= 60) {
        cp12DueInfo = daysUntilRenewal > 0
          ? `Gas safety cert renewal due in ${daysUntilRenewal} days`
          : `Gas safety cert OVERDUE by ${Math.abs(daysUntilRenewal)} days`;
      }
    }

    // Most common engineer
    const engineerCounts: Record<string, { name: string; count: number }> = {};
    for (const j of jobs) {
      if (j.engineer_id && j.engineer) {
        const id = j.engineer_id;
        if (!engineerCounts[id]) engineerCounts[id] = { name: j.engineer.name, count: 0 };
        engineerCounts[id].count++;
      }
    }
    const topEngineer = Object.values(engineerCounts).sort((a, b) => b.count - a.count)[0] ?? null;

    // Customer since
    const firstInteraction = [...jobs, ...quotes, ...invoices]
      .map(r => r.created_at)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const customerSince = firstInteraction
      ? firstInteraction.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
      : 'recently';

    const avgJobValue = paidInvoices.length > 0
      ? Math.round(lifetimeRevenue / paidInvoices.length)
      : 0;

    const recentActivity = [
      ...jobs.slice(0, 5).map(j => ({ date: j.created_at, description: `${j.title} — ${j.status.toLowerCase()}` })),
      ...invoices.slice(0, 3).map(i => ({ date: i.created_at, description: `Invoice ${i.invoice_number} — £${(i.total_pence / 100).toFixed(2)} — ${i.status.toLowerCase()}` })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 6);

    return {
      customer: {
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: [customer.address_line1, customer.city, customer.postcode].filter(Boolean).join(', '),
        customer_since: customerSince,
      },
      financials: {
        lifetime_revenue_pounds: (lifetimeRevenue / 100).toFixed(2),
        outstanding_pounds: (outstandingTotal / 100).toFixed(2),
        overdue_pounds: (overdueTotal / 100).toFixed(2),
        overdue_count: overdueInvoices.length,
        oldest_overdue_days: overdueInvoices.length > 0
          ? Math.floor((now.getTime() - overdueInvoices[0].due_date!.getTime()) / (1000 * 60 * 60 * 24))
          : 0,
        avg_job_value_pounds: (avgJobValue / 100).toFixed(2),
        total_invoices: invoices.length,
        total_paid: paidInvoices.length,
      },
      jobs: {
        total: jobs.length,
        completed: completedJobs.length,
        active: activeJobs.length,
        active_details: activeJobs.map(j => ({
          title: j.title,
          status: j.status,
          scheduled_date: j.scheduled_at?.toISOString().split('T')[0] ?? null,
        })),
      },
      quotes: {
        total: quotes.length,
        accepted: acceptedQuotes.length,
        pending: pendingQuotes.length,
        pending_details: pendingQuotes.map(q => ({
          number: q.quote_number,
          total_pounds: (q.total_pence / 100).toFixed(2),
          sent_date: q.updated_at.toISOString().split('T')[0],
        })),
      },
      gas_certificates: {
        total: gasCerts.length,
        renewal_warning: cp12DueInfo,
      },
      relationship: {
        usual_engineer: topEngineer
          ? `${topEngineer.name} (${topEngineer.count} of ${jobs.length} jobs)`
          : null,
      },
      recent_activity: recentActivity.map(a => ({
        date: a.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        description: a.description,
      })),
    };
  }

  private async executeGetPriorityAction(companyId: string): Promise<ToolResult> {
    const now = new Date();
    const priorities: Array<{
      priority: number;
      category: string;
      title: string;
      detail: string;
      impact_pounds: number;
      action_label: string;
      action_command: string;
    }> = [];

    // 1. Overdue invoices
    const overdueInvoices = await this.prisma.client.invoice.findMany({
      where: {
        company_id: companyId,
        status: { in: ['SENT', 'PART_PAID'] },
        due_date: { lt: now },
      },
      include: { customer: { select: { name: true } } },
      orderBy: { due_date: 'asc' },
    });

    if (overdueInvoices.length > 0) {
      const total = overdueInvoices.reduce((s, i) => s + i.amount_due_pence, 0);
      const oldest = overdueInvoices[0];
      const days = Math.floor((now.getTime() - oldest.due_date!.getTime()) / (1000 * 60 * 60 * 24));
      priorities.push({
        priority: days > 30 ? 100 : 80,
        category: '💰 Revenue at risk',
        title: `Chase ${overdueInvoices.length} overdue invoice${overdueInvoices.length > 1 ? 's' : ''}`,
        detail: `£${(total / 100).toFixed(2)} outstanding. Worst: ${oldest.customer?.name ?? 'Unknown'} (${days} days).`,
        impact_pounds: total / 100,
        action_label: 'Send reminders now',
        action_command: 'Send payment reminders for all overdue invoices',
      });
    }

    // 2. Unbilled completed jobs
    const completedJobs = await this.prisma.client.job.findMany({
      where: { company_id: companyId, status: 'COMPLETED' },
      include: {
        invoices: { where: { status: { not: 'CANCELLED' } }, select: { id: true } },
        quotes: { select: { total_pence: true }, orderBy: { created_at: 'desc' }, take: 1 },
      },
    });
    const unbilled = completedJobs.filter(j => j.invoices.length === 0);

    if (unbilled.length > 0) {
      const estimated = unbilled.reduce((s, j) => s + (j.quotes[0]?.total_pence ?? 0), 0);
      priorities.push({
        priority: 70,
        category: '📋 Unbilled work',
        title: `Invoice ${unbilled.length} completed job${unbilled.length > 1 ? 's' : ''}`,
        detail: estimated > 0
          ? `~£${(estimated / 100).toFixed(2)} of work done but not billed.`
          : `${unbilled.length} jobs finished but no invoice created.`,
        impact_pounds: estimated / 100,
        action_label: 'Show unbilled jobs',
        action_command: 'Show me unbilled completed jobs',
      });
    }

    // 3. CIS deadline approaching (days 12–19)
    const dayOfMonth = now.getDate();
    if (dayOfMonth >= 12 && dayOfMonth <= 19) {
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const [subPayments, returnStatus] = await Promise.all([
        this.prisma.client.subcontractorPayment.count({
          where: { company_id: companyId, tax_month: currentMonth },
        }),
        this.prisma.client.cisMonthlyReturn.findUnique({
          where: { company_id_tax_month: { company_id: companyId, tax_month: currentMonth } },
        }),
      ]);
      if (subPayments > 0 && !returnStatus) {
        const daysLeft = 19 - dayOfMonth;
        priorities.push({
          priority: dayOfMonth >= 17 ? 95 : 60,
          category: '⏰ Compliance deadline',
          title: `CIS300 due ${daysLeft === 0 ? 'TODAY' : `in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`}`,
          detail: 'Monthly CIS return not yet submitted.',
          impact_pounds: 0,
          action_label: 'Go to CIS Returns',
          action_command: 'Show me my CIS position',
        });
      }
    }

    // 4. Stale quotes
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const staleQuotes = await this.prisma.client.quote.findMany({
      where: {
        company_id: companyId,
        status: 'SENT',
        updated_at: { lt: sevenDaysAgo },
      },
      include: { customer: { select: { name: true } } },
    });

    if (staleQuotes.length > 0) {
      const totalValue = staleQuotes.reduce((s, q) => s + q.total_pence, 0);
      priorities.push({
        priority: 50,
        category: '📝 Pipeline',
        title: `Follow up on ${staleQuotes.length} unanswered quote${staleQuotes.length > 1 ? 's' : ''}`,
        detail: `£${(totalValue / 100).toFixed(2)} in quotes waiting for response.`,
        impact_pounds: totalValue / 100,
        action_label: 'View stale quotes',
        action_command: 'Show me my quote pipeline',
      });
    }

    // 5. Overdue todos
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const overdueTodos = await this.prisma.client.todo.count({
      where: {
        company_id: companyId,
        status: 'OPEN',
        due_date: { lt: todayStart },
      },
    });

    if (overdueTodos > 0) {
      priorities.push({
        priority: 40,
        category: '📌 Follow-ups',
        title: `${overdueTodos} overdue reminder${overdueTodos > 1 ? 's' : ''}`,
        detail: 'Things you asked to be reminded about that are past due.',
        impact_pounds: 0,
        action_label: 'Show reminders',
        action_command: 'List my overdue reminders',
      });
    }

    priorities.sort((a, b) => b.priority - a.priority);

    return {
      top_priority: priorities[0] ?? null,
      all_priorities: priorities.slice(0, 5),
      total_actionable: priorities.length,
      total_revenue_at_stake_pounds: priorities.reduce((s, p) => s + p.impact_pounds, 0).toFixed(2),
    };
  }

  private async executeExtractActionsFromNote(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const note = args.note as string;
    const todayStr = new Date().toISOString().split('T')[0];

    const res = await fetch(`${process.env.AI_API_URL ?? 'https://api.fireworks.ai/inference/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.AI_API_KEY ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL ?? 'accounts/fireworks/models/deepseek-v4-flash',
        messages: [{
          role: 'user',
          content: `You are an assistant for a UK plumbing business. Extract actionable items from this note/call summary. Return ONLY valid JSON, no markdown, no explanation.

Note: "${note}"

Extract into this JSON structure:
{
  "actions": [
    {
      "type": "create_job" | "create_reminder" | "create_quote" | "add_note",
      "customer_name": "string or null",
      "title": "string",
      "description": "string",
      "date": "YYYY-MM-DD or null",
      "time": "HH:MM or null",
      "priority": "LOW" | "MEDIUM" | "HIGH" | "URGENT",
      "amount_pounds": number or null
    }
  ],
  "summary": "one sentence summary of what was discussed"
}

Rules:
- If someone needs a visit/appointment, that is a create_job
- If something needs following up later, that is a create_reminder
- If pricing was discussed, that could be a create_quote
- If it is just information, that is an add_note
- Resolve relative dates using today: ${todayStr}
- "ASAP" or "urgent" = priority URGENT, date = tomorrow
- "next week" = next Monday
- Return at least one action`,
        }],
        max_tokens: 1024,
        temperature: 0.2,
      }),
    });

    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim() ?? '{}';

    let parsed: { actions?: Array<Record<string, unknown>>; summary?: string };
    try {
      const clean = content.replace(/```json\n?|```\n?/g, '').trim();
      parsed = JSON.parse(clean) as typeof parsed;
    } catch {
      return { error: true, message: 'I had trouble parsing that note. Could you try again with more detail?' };
    }

    // Enrich with customer lookups
    if (parsed.actions && Array.isArray(parsed.actions)) {
      for (const action of parsed.actions) {
        if (action.customer_name) {
          const customer = await this.prisma.client.customer.findFirst({
            where: {
              company_id: companyId,
              name: { contains: action.customer_name as string, mode: 'insensitive' },
            },
            select: { id: true, name: true },
          });
          action.customer_found = !!customer;
          action.customer_id = customer?.id ?? null;
          action.customer_resolved_name = customer?.name ?? action.customer_name;
        }
      }
    }

    const actionCount = parsed.actions?.length ?? 0;
    return {
      actions: parsed.actions ?? [],
      summary: parsed.summary ?? '',
      action_count: actionCount,
      requires_confirmation: true,
      message: `I found ${actionCount} action${actionCount !== 1 ? 's' : ''} from your note. Review and confirm:`,
    };
  }

  private async executeGetWinRateAnalysis(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

    const quotes = await this.prisma.client.quote.findMany({
      where: {
        company_id: companyId,
        created_at: { gte: twelveMonthsAgo },
        status: { in: ['ACCEPTED', 'REJECTED', 'EXPIRED'] },
        ...(args.job_type ? {
          reference: { contains: args.job_type as string, mode: 'insensitive' as const },
        } : {}),
      },
      select: {
        id: true,
        reference: true,
        total_pence: true,
        status: true,
        created_at: true,
        customer: { select: { name: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    if (quotes.length < 3) {
      return {
        message: `Not enough quote history to analyse${args.job_type ? ` for "${args.job_type as string}"` : ''}. Need at least 3 resolved quotes (you have ${quotes.length}).`,
        insufficient_data: true,
      };
    }

    const accepted = quotes.filter(q => q.status === 'ACCEPTED');
    const rejected = quotes.filter(q => q.status === 'REJECTED');
    const expired = quotes.filter(q => q.status === 'EXPIRED');

    const winRate = (accepted.length / quotes.length) * 100;
    const acceptedAvg = accepted.length > 0
      ? accepted.reduce((s, q) => s + q.total_pence, 0) / accepted.length : 0;
    const rejectedAvg = rejected.length > 0
      ? rejected.reduce((s, q) => s + q.total_pence, 0) / rejected.length : 0;

    // Quartile price range analysis
    const allPrices = quotes
      .map(q => ({ price: q.total_pence, accepted: q.status === 'ACCEPTED' }))
      .sort((a, b) => a.price - b.price);

    const quarter = Math.max(1, Math.floor(allPrices.length / 4));
    const priceRanges = [
      { label: 'Budget',   quotes: allPrices.slice(0, quarter) },
      { label: 'Low-mid',  quotes: allPrices.slice(quarter, quarter * 2) },
      { label: 'High-mid', quotes: allPrices.slice(quarter * 2, quarter * 3) },
      { label: 'Premium',  quotes: allPrices.slice(quarter * 3) },
    ].filter(r => r.quotes.length > 0).map(r => ({
      label: r.label,
      range_pounds: `£${(r.quotes[0].price / 100).toFixed(0)} – £${(r.quotes[r.quotes.length - 1].price / 100).toFixed(0)}`,
      win_rate: Math.round((r.quotes.filter(q => q.accepted).length / r.quotes.length) * 100),
      count: r.quotes.length,
    }));

    const bestRange = [...priceRanges].sort((a, b) => b.win_rate - a.win_rate)[0];

    // Trend: last 3 months vs previous 3 months
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const recentQuotes = quotes.filter(q => q.created_at >= threeMonthsAgo);
    const olderQuotes = quotes.filter(q => q.created_at >= sixMonthsAgo && q.created_at < threeMonthsAgo);
    const recentWinRate = recentQuotes.length > 0
      ? (recentQuotes.filter(q => q.status === 'ACCEPTED').length / recentQuotes.length) * 100 : 0;
    const olderWinRate = olderQuotes.length > 0
      ? (olderQuotes.filter(q => q.status === 'ACCEPTED').length / olderQuotes.length) * 100 : 0;

    const biggestRejections = rejected
      .sort((a, b) => b.total_pence - a.total_pence)
      .slice(0, 3)
      .map(q => ({
        reference: q.reference ?? '(no reference)',
        amount_pounds: (q.total_pence / 100).toFixed(2),
        customer: q.customer?.name ?? null,
        date: q.created_at.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
      }));

    return {
      job_type: (args.job_type as string | undefined) ?? 'all jobs',
      period: 'Last 12 months',
      total_quotes: quotes.length,
      accepted: accepted.length,
      rejected: rejected.length,
      expired: expired.length,
      win_rate_percent: Math.round(winRate),
      avg_accepted_pounds: (acceptedAvg / 100).toFixed(2),
      avg_rejected_pounds: (rejectedAvg / 100).toFixed(2),
      price_gap: rejectedAvg > acceptedAvg
        ? `Rejected quotes average £${((rejectedAvg - acceptedAvg) / 100).toFixed(0)} more than accepted ones`
        : null,
      sweet_spot: bestRange ? { range: bestRange.range_pounds, win_rate: bestRange.win_rate } : null,
      price_ranges: priceRanges,
      trend: {
        recent_win_rate: Math.round(recentWinRate),
        previous_win_rate: Math.round(olderWinRate),
        direction: recentWinRate > olderWinRate ? 'improving' : recentWinRate < olderWinRate ? 'declining' : 'stable',
      },
      biggest_rejections: biggestRejections,
    };
  }

  // ── Email drafting ────────────────────────────────────────────────────────────

  private async executeDraftEmail(
    companyId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const recipientName = args.recipient_name as string;
    const purpose = (args.purpose as string) ?? 'general';
    const tone = (args.tone as string | undefined) ?? 'friendly';

    const [company, customerResult] = await Promise.all([
      this.prisma.client.company.findUnique({
        where: { id: companyId },
        select: { name: true, phone: true, website: true },
      }),
      this.prisma.client.customer.findMany({
        where: { company_id: companyId, name: { contains: recipientName, mode: 'insensitive' } },
        take: 1,
        include: {
          invoices: {
            where: { status: { in: ['SENT', 'PART_PAID', 'OVERDUE'] }, due_date: { lt: new Date() } },
            orderBy: { due_date: 'asc' },
            take: 3,
            select: { invoice_number: true, amount_due_pence: true, due_date: true },
          },
        },
      }),
    ]);

    const customer = customerResult[0] ?? null;

    let emailContext = `You are writing on behalf of ${company?.name ?? 'a UK plumbing and heating business'}.`;
    emailContext += ` The email recipient is ${customer?.name ?? recipientName}.`;
    emailContext += ` Tone: ${tone}.`;

    if (purpose === 'payment_chase' && customer?.invoices?.length) {
      const overdueTotal = customer.invoices.reduce((s, i) => s + i.amount_due_pence, 0);
      const oldest = customer.invoices[0];
      emailContext += ` ${customer.name} has ${customer.invoices.length} overdue invoice(s) totalling £${(overdueTotal / 100).toFixed(2)}.`;
      if (oldest?.due_date) {
        const daysAgo = Math.floor((Date.now() - oldest.due_date.getTime()) / (1000 * 60 * 60 * 24));
        emailContext += ` The oldest is ${oldest.invoice_number}, overdue by ${daysAgo} days.`;
      }
    }

    if (args.context) emailContext += ` Additional context: ${args.context as string}`;

    const signature = [company?.name, company?.phone, company?.website]
      .filter(Boolean)
      .join('\n');

    const res = await fetch(`${process.env.AI_API_URL ?? 'https://api.fireworks.ai/inference/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.AI_API_KEY ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL ?? 'accounts/fireworks/models/deepseek-v4-flash',
        messages: [{
          role: 'user',
          content: `${emailContext}

Write a short, professional email body. Rules:
- British English
- Under 150 words
- Clear call to action
- Do NOT include Subject line or email headers
- End with sign-off and company details below

Company signature:
${signature}`,
        }],
        max_tokens: 512,
        temperature: 0.6,
      }),
    });

    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const draft = data.choices?.[0]?.message?.content?.trim() ?? '';

    const subjects: Record<string, string> = {
      payment_chase: `Payment reminder — ${company?.name ?? ''}`,
      quote_follow_up: `Your quote — ${company?.name ?? ''}`,
      appointment_confirmation: `Appointment confirmation — ${company?.name ?? ''}`,
      job_complete: `Job completed — ${company?.name ?? ''}`,
      thank_you: `Thank you — ${company?.name ?? ''}`,
      general: `Message from ${company?.name ?? ''}`,
    };

    return {
      action: 'show_draft',
      draft: {
        to: customer?.email ?? (args.recipient_email as string | undefined) ?? '',
        to_name: customer?.name ?? recipientName,
        subject: subjects[purpose] ?? subjects['general'],
        body: draft,
      },
      message: `Here's a draft email for ${customer?.name ?? recipientName}. Review and edit before sending.`,
    };
  }

  // ── ENGINEER TOOLS ────────────────────────────────────────────────────────

  private async executeGetMyTodaysJobs(companyId: string, userId: string): Promise<ToolResult> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const jobs = await this.prisma.client.job.findMany({
      where: {
        company_id: companyId,
        engineer_id: userId,
        scheduled_at: { gte: startOfDay, lte: endOfDay },
      },
      include: { customer: true },
      orderBy: { scheduled_at: 'asc' },
    });

    if (jobs.length === 0) return { message: "You have no jobs scheduled for today." };

    return {
      date: startOfDay.toDateString(),
      job_count: jobs.length,
      jobs: jobs.map(j => ({
        id: j.id,
        title: j.title,
        status: j.status,
        scheduled_at: j.scheduled_at?.toISOString() ?? null,
        duration_minutes: j.duration_minutes,
        customer: j.customer ? {
          name: j.customer.name,
          phone: j.customer.phone,
          address: [j.customer.address_line1, j.customer.city, j.customer.postcode].filter(Boolean).join(', '),
        } : null,
      })),
    };
  }

  private async executeGetMyNextJob(companyId: string, userId: string): Promise<ToolResult> {
    const now = new Date();
    const job = await this.prisma.client.job.findFirst({
      where: {
        company_id: companyId,
        engineer_id: userId,
        scheduled_at: { gte: now },
        status: { notIn: [JobStatus.COMPLETED, JobStatus.INVOICED] },
      },
      include: { customer: true },
      orderBy: { scheduled_at: 'asc' },
    });

    if (!job) return { message: "No upcoming jobs scheduled." };

    return {
      id: job.id,
      title: job.title,
      description: job.description,
      status: job.status,
      scheduled_at: job.scheduled_at?.toISOString() ?? null,
      duration_minutes: job.duration_minutes,
      schedule_note: job.schedule_note,
      notes: job.notes,
      customer: job.customer ? {
        name: job.customer.name,
        phone: job.customer.phone,
        email: job.customer.email,
        address: [job.customer.address_line1, job.customer.address_line2, job.customer.city, job.customer.postcode].filter(Boolean).join(', '),
      } : null,
    };
  }

  private async executeGetMyWeek(companyId: string, userId: string): Promise<ToolResult> {
    const now = new Date();
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const jobs = await this.prisma.client.job.findMany({
      where: {
        company_id: companyId,
        engineer_id: userId,
        scheduled_at: { gte: monday, lte: sunday },
      },
      include: { customer: true },
      orderBy: { scheduled_at: 'asc' },
    });

    const byDay: Record<string, unknown[]> = {};
    for (const j of jobs) {
      const dateKey = j.scheduled_at?.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }) ?? 'Unscheduled';
      if (!byDay[dateKey]) byDay[dateKey] = [];
      byDay[dateKey].push({
        id: j.id,
        title: j.title,
        status: j.status,
        time: j.scheduled_at?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) ?? null,
        customer: j.customer?.name ?? null,
        address: j.customer ? [j.customer.address_line1, j.customer.city].filter(Boolean).join(', ') : null,
      });
    }

    return {
      week_start: monday.toDateString(),
      week_end: sunday.toDateString(),
      total_jobs: jobs.length,
      schedule: byDay,
    };
  }

  private async executeGetJobDetails(companyId: string, userId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const search = (args.search as string | undefined) ?? '';

    const jobs = await this.prisma.client.job.findMany({
      where: {
        company_id: companyId,
        engineer_id: userId,
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { customer: { name: { contains: search, mode: 'insensitive' } } },
        ],
      },
      include: {
        customer: true,
        gasCertificates: { select: { id: true, cert_type: true, status: true, inspection_date: true } },
        timesheets: { select: { id: true, date: true, duration_minutes: true } },
        photos: { select: { id: true, phase: true } },
      },
      orderBy: { scheduled_at: 'desc' },
      take: 3,
    });

    if (jobs.length === 0) return { message: `No jobs found matching "${search}".` };

    return {
      jobs: jobs.map(j => ({
        id: j.id,
        title: j.title,
        description: j.description,
        status: j.status,
        scheduled_at: j.scheduled_at?.toISOString() ?? null,
        duration_minutes: j.duration_minutes,
        notes: j.notes,
        schedule_note: j.schedule_note,
        customer: j.customer ? {
          name: j.customer.name,
          phone: j.customer.phone,
          email: j.customer.email,
          address: [j.customer.address_line1, j.customer.address_line2, j.customer.city, j.customer.postcode].filter(Boolean).join(', '),
        } : null,
        gas_certificates: j.gasCertificates.map(c => ({ type: c.cert_type, status: c.status, date: c.inspection_date.toISOString() })),
        timesheet_entries: j.timesheets.length,
        photos: j.photos.length,
      })),
    };
  }

  private async executeGetAddressHistory(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const customerName = (args.customer_name as string | undefined) ?? '';

    const customer = await this.prisma.client.customer.findFirst({
      where: { company_id: companyId, name: { contains: customerName, mode: 'insensitive' } },
    });

    if (!customer) return { message: `No customer found matching "${customerName}".` };

    const jobs = await this.prisma.client.job.findMany({
      where: { company_id: companyId, customer_id: customer.id },
      include: {
        gasCertificates: { select: { cert_type: true, status: true, inspection_date: true } },
      },
      orderBy: { scheduled_at: 'desc' },
      take: 20,
    });

    return {
      customer: customer.name,
      address: [customer.address_line1, customer.address_line2, customer.city, customer.postcode].filter(Boolean).join(', '),
      total_visits: jobs.length,
      history: jobs.map(j => ({
        title: j.title,
        status: j.status,
        date: j.scheduled_at?.toLocaleDateString('en-GB') ?? j.created_at.toLocaleDateString('en-GB'),
        notes: j.notes,
        gas_certs: j.gasCertificates.map(c => c.cert_type),
      })),
    };
  }

  private async executeCheckJobCompletion(companyId: string, userId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const search = (args.search as string | undefined) ?? '';

    const job = await this.prisma.client.job.findFirst({
      where: {
        company_id: companyId,
        engineer_id: userId,
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { customer: { name: { contains: search, mode: 'insensitive' } } },
        ],
      },
      include: {
        customer: true,
        gasCertificates: { select: { id: true, cert_type: true, status: true } },
        timesheets: { select: { id: true } },
        photos: { select: { id: true, phase: true } },
        activeTimers: { select: { id: true } },
      },
      orderBy: { scheduled_at: 'desc' },
    });

    if (!job) return { message: `No job found matching "${search}".` };

    const hasPhotos = job.photos.length > 0;
    const hasNotes = !!job.notes?.trim();
    const hasTimesheet = job.timesheets.length > 0;
    const timerRunning = job.activeTimers.length > 0;
    const gasCertRequired = ['CP12', 'BOILER_SERVICE', 'INSTALLATION'].some(t =>
      job.title.toLowerCase().includes('gas') || job.title.toLowerCase().includes('boiler') || job.title.toLowerCase().includes('cp12')
    );
    const gasCertDone = job.gasCertificates.some(c => c.status === 'COMPLETE');

    const checklist = [
      { item: 'Photos taken', done: hasPhotos, count: job.photos.length },
      { item: 'Job notes added', done: hasNotes },
      { item: 'Time logged', done: hasTimesheet },
      { item: 'Timer stopped', done: !timerRunning, warning: timerRunning ? 'Timer is still running!' : null },
      ...(gasCertRequired ? [{ item: 'Gas certificate completed', done: gasCertDone }] : []),
    ];

    const allDone = checklist.every(c => c.done);

    return {
      job: job.title,
      customer: job.customer?.name ?? null,
      status: job.status,
      ready_to_close: allDone,
      checklist,
      message: allDone
        ? 'Everything looks good — you can mark this job complete.'
        : `${checklist.filter(c => !c.done).length} item(s) still needed before closing.`,
    };
  }

  private async executeGetMyHours(companyId: string, userId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const period = (args.period as string | undefined) ?? 'today';

    const now = new Date();
    let start: Date;
    let end: Date;
    let label: string;

    if (period === 'today') {
      start = new Date(now); start.setHours(0, 0, 0, 0);
      end = new Date(now); end.setHours(23, 59, 59, 999);
      label = 'Today';
    } else if (period === 'last_week') {
      const day = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) - 7);
      monday.setHours(0, 0, 0, 0);
      start = monday;
      end = new Date(monday); end.setDate(monday.getDate() + 6); end.setHours(23, 59, 59, 999);
      label = 'Last week';
    } else {
      const day = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      monday.setHours(0, 0, 0, 0);
      start = monday;
      end = new Date(monday); end.setDate(monday.getDate() + 6); end.setHours(23, 59, 59, 999);
      label = 'This week';
    }

    const [timesheets, activeTimer] = await Promise.all([
      this.prisma.client.timesheet.findMany({
        where: { company_id: companyId, user_id: userId, date: { gte: start, lte: end } },
        include: { job: { select: { title: true } } },
        orderBy: { date: 'asc' },
      }),
      this.prisma.client.activeTimer.findFirst({
        where: { company_id: companyId, user_id: userId },
        include: { job: { select: { title: true } } },
      }),
    ]);

    const totalMinutes = timesheets.reduce((sum, t) => sum + t.duration_minutes, 0);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return {
      period: label,
      total_hours: `${hours}h ${minutes}m`,
      total_minutes: totalMinutes,
      entry_count: timesheets.length,
      active_timer: activeTimer ? {
        job: activeTimer.job.title,
        started_at: activeTimer.started_at.toISOString(),
        elapsed_minutes: Math.floor((Date.now() - activeTimer.started_at.getTime()) / 60000),
      } : null,
      entries: timesheets.map(t => ({
        date: t.date.toLocaleDateString('en-GB'),
        job: t.job?.title ?? null,
        duration: `${Math.floor(t.duration_minutes / 60)}h ${t.duration_minutes % 60}m`,
      })),
    };
  }

  private executeGetTechnicalReference(args: Record<string, unknown>): ToolResult {
    return {
      action: 'answer_from_knowledge',
      question: args.question as string,
    };
  }

  private async executeAddJobNote(companyId: string, userId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const search = (args.search as string | undefined) ?? '';
    const note = (args.note as string | undefined) ?? '';

    const job = await this.prisma.client.job.findFirst({
      where: {
        company_id: companyId,
        engineer_id: userId,
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { customer: { name: { contains: search, mode: 'insensitive' } } },
        ],
      },
      orderBy: { scheduled_at: 'desc' },
    });

    if (!job) return { error: true, message: `No job found matching "${search}".` };

    const timestamp = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' });
    const newNote = `[${timestamp}] ${note}`;
    const updatedNotes = job.notes ? `${job.notes}\n\n${newNote}` : newNote;

    await this.prisma.client.job.update({
      where: { id: job.id },
      data: { notes: updatedNotes },
    });

    return { success: true, job: job.title, note_added: newNote };
  }

  private async executeRunningLate(companyId: string, userId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const customerName = (args.customer_name as string | undefined) ?? '';
    const delayMinutes = (args.delay_minutes as number | undefined) ?? null;
    const reason = (args.reason as string | undefined) ?? 'Running behind schedule';

    const customer = await this.prisma.client.customer.findFirst({
      where: { company_id: companyId, name: { contains: customerName, mode: 'insensitive' } },
    });

    const engineer = await this.prisma.client.user.findUnique({ where: { id: userId } });
    const engineerName = engineer?.name ?? 'Engineer';

    const delayText = delayMinutes ? `${delayMinutes} minutes` : 'some time';
    const description = `${engineerName} is running approximately ${delayText} late to ${customer?.name ?? customerName}. Reason: ${reason}`;

    await this.prisma.client.todo.create({
      data: {
        company_id: companyId,
        created_by_id: userId,
        title: `Running late — ${customer?.name ?? customerName}`,
        description,
        priority: 'HIGH',
        status: 'OPEN',
      },
    });

    return {
      success: true,
      message: `Office has been notified you are running ${delayText} late to ${customer?.name ?? customerName}.`,
      todo_created: true,
    };
  }

  private async executeLogMaterials(companyId: string, userId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const search = (args.search as string | undefined) ?? '';
    const items = (args.items as Array<{ description: string; quantity?: number }> | undefined) ?? [];

    const job = await this.prisma.client.job.findFirst({
      where: {
        company_id: companyId,
        engineer_id: userId,
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { customer: { name: { contains: search, mode: 'insensitive' } } },
        ],
      },
      orderBy: { scheduled_at: 'desc' },
    });

    if (!job) return { error: true, message: `No job found matching "${search}".` };
    if (items.length === 0) return { error: true, message: 'No materials specified.' };

    const timestamp = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' });
    const materialsText = items.map(i => `  - ${i.quantity ?? 1}x ${i.description}`).join('\n');
    const noteEntry = `[${timestamp}] Materials used:\n${materialsText}`;

    const updatedNotes = job.notes ? `${job.notes}\n\n${noteEntry}` : noteEntry;

    await this.prisma.client.job.update({
      where: { id: job.id },
      data: { notes: updatedNotes },
    });

    return {
      success: true,
      job: job.title,
      materials_logged: items.length,
      items: items.map(i => `${i.quantity ?? 1}x ${i.description}`),
      message: `Logged ${items.length} material(s) on ${job.title}. The owner can use this to raise an invoice.`,
    };
  }

  private async executeGetPreviousReadings(companyId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const customerName = (args.customer_name as string | undefined) ?? '';

    const customer = await this.prisma.client.customer.findFirst({
      where: { company_id: companyId, name: { contains: customerName, mode: 'insensitive' } },
    });

    if (!customer) return { message: `No customer found matching "${customerName}".` };

    const certs = await this.prisma.client.gasSafetyCertificate.findMany({
      where: { company_id: companyId, customer_id: customer.id, status: 'COMPLETE' },
      orderBy: { inspection_date: 'desc' },
      take: 5,
    });

    if (certs.length === 0) return { message: `No completed gas certificates found for ${customer.name}.` };

    return {
      customer: customer.name,
      address: [customer.address_line1, customer.city, customer.postcode].filter(Boolean).join(', '),
      certificates: certs.map(c => ({
        type: c.cert_type,
        date: c.inspection_date.toLocaleDateString('en-GB'),
        next_due: c.next_due_date?.toLocaleDateString('en-GB') ?? null,
        data: c.data,
        notes: c.notes,
      })),
    };
  }

  private async executeGetEndOfDaySummary(companyId: string, userId: string): Promise<ToolResult> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const [jobs, timesheets, activeTimer] = await Promise.all([
      this.prisma.client.job.findMany({
        where: { company_id: companyId, engineer_id: userId, scheduled_at: { gte: startOfDay, lte: endOfDay } },
        include: {
          customer: { select: { name: true } },
          photos: { select: { id: true } },
          gasCertificates: { select: { cert_type: true, status: true } },
        },
      }),
      this.prisma.client.timesheet.findMany({
        where: { company_id: companyId, user_id: userId, date: { gte: startOfDay, lte: endOfDay } },
      }),
      this.prisma.client.activeTimer.findFirst({
        where: { company_id: companyId, user_id: userId },
        include: { job: { select: { title: true } } },
      }),
    ]);

    const totalMinutes = timesheets.reduce((sum, t) => sum + t.duration_minutes, 0);
    const jobsWithIssues = jobs
      .map(j => {
        const issues: string[] = [];
        if (!j.notes?.trim()) issues.push('no notes');
        if (j.photos.length === 0) issues.push('no photos');
        return { job: j.title, customer: j.customer?.name, status: j.status, issues };
      })
      .filter(j => j.issues.length > 0);

    return {
      date: startOfDay.toDateString(),
      jobs_today: jobs.length,
      jobs_complete: jobs.filter(j => j.status === JobStatus.COMPLETED).length,
      total_hours: `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`,
      active_timer: activeTimer ? `Timer still running on "${activeTimer.job.title}" — remember to clock out!` : null,
      jobs_needing_attention: jobsWithIssues,
      all_good: jobsWithIssues.length === 0 && !activeTimer,
    };
  }

  private executeGetSafetyChecklist(args: Record<string, unknown>): ToolResult {
    const jobType = (args.job_type as string | undefined) ?? 'general_plumbing';

    const checklists: Record<string, string[]> = {
      gas_service: [
        'Check Gas Safe registration is current',
        'Visual inspection of pipework for corrosion/damage',
        'Check all appliance flues are clear and unobstructed',
        'Test gas tightness — use approved leak detection fluid',
        'Check ventilation requirements are met (BS 5440)',
        'Check appliance operating pressure against manufacturer specs',
        'Check all safety devices operate correctly (overheat stat, pressure relief)',
        'Record all readings on gas safety certificate',
        'Advise customer of any defects or advisory items',
        'Issue Gas Safety Certificate (CP12) on completion',
      ],
      gas_install: [
        'Check Gas Safe registration covers this appliance type',
        'Notify Gas Safe Register if new installation (within 30 days)',
        'Check Building Regs notification required (Part J)',
        'Verify appliance is on approved products list',
        'Check flue clearances per manufacturer and BS 5440',
        'Ensure adequate ventilation per BS 5440',
        'Pressure test all new pipework before connecting appliance',
        'Commission appliance to manufacturer instructions',
        'Complete installation certificate and handover to customer',
        'Register appliance warranty where required',
      ],
      boiler_repair: [
        'Isolate gas and electricity before opening boiler',
        'Check system pressure before and after repair',
        'Inspect heat exchanger for signs of leakage or corrosion',
        'Check flue integrity — no cracks or blockages',
        'Test all safety controls operate after repair',
        'Check CO levels with calibrated analyser',
        'Run appliance through full operating cycle before leaving',
        'Note any additional defects or advisories in writing',
      ],
      unvented_cylinder: [
        'Check G3 qualification covers this work',
        'Notify Building Control (Part G) before installation',
        'Verify expansion vessel pre-charge pressure',
        'Check pressure relief valve — test operation',
        'Verify temperature/pressure relief valve (T&PR) discharge pipe routes correctly',
        'Check expansion relief valve and discharge pipe',
        'Commission to manufacturer instructions',
        'Label cylinder with service record card',
        'Leave commissioning documentation with customer',
      ],
      bathroom: [
        'Check water supply can be isolated before starting',
        'Verify waste connections comply with water bylaws',
        'Check macerator installation if fitted — Part H Building Regs',
        'Ensure shower thermostat set to max 48°C (scalding prevention)',
        'Check silicon sealing is watertight on all joints',
        'Test all fixtures and fittings for leaks under pressure',
      ],
      radiators: [
        'Isolate system and drain relevant section before removing radiators',
        'Check pipework condition when radiator removed',
        'Use new PTFE and fittings — never reuse old olives',
        'Refill and vent system thoroughly',
        'Check system pressure at correct operating level',
        'Balance system if multiple radiators changed',
      ],
      leak_repair: [
        'Identify and isolate water supply to leak',
        'Check if leak is on mains or heating circuit',
        'Take photos before and after repair',
        'Test repair under pressure before opening supply',
        'Check for water damage — advise customer in writing if found',
      ],
      general_plumbing: [
        'Identify stop valves before starting work',
        'Protect flooring and customer property',
        'Check water regulations compliance for any new connections',
        'Pressure test new pipework before covering',
        'Clean up and check for leaks before leaving',
        'Advise customer of any stop valve or isolation valve issues found',
      ],
    };

    const list = checklists[jobType] ?? checklists['general_plumbing'];

    return {
      job_type: jobType,
      checklist: list,
      item_count: list.length,
      reminder: 'Always consult manufacturer instructions and current BS/Building Regs for the specific appliance.',
    };
  }

  private executeGetPhotoGuidance(args: Record<string, unknown>): ToolResult {
    const jobType = (args.job_type as string | undefined) ?? '';

    const lower = jobType.toLowerCase();
    let guidance: string[];
    let label: string;

    if (lower.includes('gas') || lower.includes('boiler') || lower.includes('cp12') || lower.includes('service')) {
      label = 'Gas/Boiler';
      guidance = [
        'Before: existing appliance from the front showing model label',
        'Before: flue terminal outside the building',
        'Before: existing pipework and connections',
        'During: any defects or advisories found',
        'After: completed appliance/installation',
        'After: Gas Safety Certificate completed (readable)',
        'After: appliance data plate / serial number label',
      ];
    } else if (lower.includes('bathroom') || lower.includes('toilet') || lower.includes('shower') || lower.includes('bath')) {
      label = 'Bathroom';
      guidance = [
        'Before: existing bathroom from doorway (wide shot)',
        'Before: existing fixtures showing any damage or issues',
        'During: rough-in pipework before boarding/tiling',
        'During: waste connections before covering',
        'After: finished bathroom from doorway',
        'After: close-up of each new fixture',
        'After: silicone sealing finished',
      ];
    } else if (lower.includes('leak') || lower.includes('repair')) {
      label = 'Leak Repair';
      guidance = [
        'Before: location of leak clearly showing the affected area',
        'Before: close-up of the fault',
        'During: pipework exposed (if applicable)',
        'After: completed repair',
        'After: any water damage visible (for customer record)',
      ];
    } else if (lower.includes('radiator') || lower.includes('heating')) {
      label = 'Heating';
      guidance = [
        'Before: existing setup',
        'After: new radiator(s) installed',
        'After: pipework connections',
        'After: system pressure gauge reading',
      ];
    } else if (lower.includes('cylinder') || lower.includes('unvented')) {
      label = 'Unvented Cylinder';
      guidance = [
        'Before: existing cylinder from front showing model label',
        'During: discharge pipe routing (T&PR and expansion relief)',
        'After: installed cylinder from front',
        'After: pressure relief valve and discharge pipework',
        'After: commissioning record card attached to cylinder',
      ];
    } else {
      label = 'General';
      guidance = [
        'Before: overall area showing existing condition',
        'Before: close-up of the specific issue or area being worked on',
        'During: any pipework or work before covering',
        'After: completed work',
        'After: any new fittings or connections',
      ];
    }

    return {
      job_type: label,
      photo_list: guidance,
      tip: 'Take photos in good light. Make sure model labels and cert numbers are readable. Photos protect you if there are any disputes later.',
    };
  }
}
