import { Injectable, Logger } from '@nestjs/common';
import { AiToolsService } from './ai-tools.service';
import { PipMemoryService } from './pip-memory.service';
import { PrismaService } from '../../prisma/prisma.service';

const AI_API_URL = process.env.AI_API_URL ?? 'https://api.fireworks.ai/inference/v1';
const AI_API_KEY = process.env.AI_API_KEY ?? '';
const AI_MODEL   = process.env.AI_MODEL ?? 'accounts/fireworks/models/deepseek-v4-flash';

type Role = 'system' | 'user' | 'assistant' | 'tool';

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface AiMessage {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ModelResponse {
  content: string | null;
  tool_calls?: ToolCall[];
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly tools: AiToolsService,
    private readonly memory: PipMemoryService,
    private readonly prisma: PrismaService,
  ) {}

  async chat(
    companyId: string,
    userId: string,
    message: string,
    history: Array<{ role: string; content: string }>,
    confirmedAction?: { tool: string; args: Record<string, unknown> },
    currentPage?: string,
    role?: string,
  ) {
    const isEngineer = role === 'ENGINEER';
    const now = new Date();
    const dayOfWeek = now.toLocaleDateString('en-GB', { weekday: 'long' });
    const dayOfMonth = now.getDate();
    const hour = now.getHours();
    const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    // Time-aware context
    let timeContext = `Today is ${dateStr}.`;
    if (dayOfWeek === 'Friday' && hour >= 14) {
      timeContext += " It's Friday afternoon.";
    } else if (dayOfWeek === 'Monday' && hour < 12) {
      timeContext += " It's Monday morning.";
    }
    if (hour >= 16) {
      timeContext += " It's late afternoon — consider the end-of-day summary.";
    }

    let systemPrompt: string;
    let activeTools: unknown[];

    if (isEngineer) {
      systemPrompt = this.getEngineerPrompt(dateStr, timeContext);
      activeTools = this.tools.getEngineerToolDefinitions();
    } else {
      // Owner: full time context with CIS and month-end hints
      if (dayOfMonth >= 17 && dayOfMonth <= 18) {
        timeContext += " CIS300 deadline is approaching (19th of the month).";
      }
      if (dayOfMonth >= 28 || dayOfMonth <= 2) {
        timeContext += " It's near month end — good time for a business summary or month-end invoicing.";
      }

      // Page context
      const pageDescriptions: Record<string, string> = {
        '/dashboard': 'the main dashboard',
        '/dashboard/jobs': 'the jobs list',
        '/dashboard/customers': 'the customers page',
        '/dashboard/quotes': 'the quotes page',
        '/dashboard/invoices': 'the invoices page',
        '/dashboard/cis': 'the CIS Returns page',
        '/dashboard/subcontractors': 'the subcontractors page',
        '/dashboard/timesheets': 'the timesheets page',
        '/dashboard/settings': 'the settings page',
        '/dashboard/gas-certificates': 'the gas certificates page',
        '/dashboard/todos': 'the to-do list',
        '/dashboard/credit-notes': 'the credit notes page',
        '/dashboard/recurring-invoices': 'the recurring invoices page',
        '/dashboard/purchase-orders': 'the purchase orders page',
        '/dashboard/price-lists': 'the price lists page',
        '/dashboard/reports': 'the reports page',
      };
      let pageContext = '';
      if (currentPage) {
        const basePage = Object.keys(pageDescriptions)
          .sort((a, b) => b.length - a.length)
          .find(p => currentPage.startsWith(p));
        if (basePage) {
          pageContext = `\nThe owner is currently viewing ${pageDescriptions[basePage]}. Tailor your response to what they're likely looking at if relevant.`;
        }
      }

      // Load recent conversation summaries + business patterns in parallel
      const [recentContext, patterns] = await Promise.all([
        this.memory.getRecentContext(companyId, userId),
        this.getOwnerPatterns(companyId),
      ]);

      const contextBlock = recentContext
        ? `\n\nRecent conversations:\n${recentContext}\n\nUse this context naturally like a colleague who remembers — don't say "from our previous conversation".`
        : '';

      const patternBlock = patterns
        ? `\n\nOwner's business patterns (use to catch anomalies and suggest next steps — don't quote these numbers unless asked):
- Avg quote value: £${patterns.avgQuotePounds}
- Avg invoice value: £${patterns.avgInvoicePounds}
- Common job types: ${patterns.commonJobTypes}
- Top customers (by revenue): ${patterns.topCustomers}`
        : '';

      systemPrompt = `You are Pip, a helpful AI assistant for Vantro — a job management app for UK plumbing and heating firms.

${timeContext}${pageContext}

Your personality:
- Friendly, concise, professional
- Speak like a helpful colleague, not a robot
- British English spelling (colour, organise, etc.)
- Keep responses SHORT — one or two sentences plus the result, not essays

Your capabilities:
- Create jobs, customers, quotes, invoices
- Search for customers, jobs, invoices
- Show overdue invoices and business summaries
- Send payment reminders
- Auto-chase: Vantro can automatically send escalating chase emails (gentle → firm → final) to overdue customers. Use get_chase_status to check if it's on, set_chase_policy to enable/change it. If the owner complains about chasing invoices manually, proactively suggest enabling auto-chase.
- Record subcontractor CIS payments
- Open forms pre-filled with known details
- Set reminders for future dates ("remind me", "follow up", "chase", "don't forget")
- List upcoming reminders and overdue ones
- Mark reminders as done
- Draft professional emails (payment chasing, quote follow-ups, etc.)

When resolving relative dates: "tomorrow" = next day, "next Tuesday" = the coming Tuesday, "in 3 days" = today + 3, "next week" = next Monday, "end of month" = last day of current month. Always resolve to YYYY-MM-DD.

Rules:
- ALWAYS use tools when the user asks you to DO something
- Amounts in £ with two decimal places; dates in DD/MM/YYYY format
- Never expose internal IDs — refer to records by name or number
- When creating something complex (quotes with line items, gas certificates, new subcontractors), use prepare_form instead of asking for all fields in chat
- For SIMPLE creates (just a name + title), use create_job or create_customer directly
- Guideline: if you need more than 3 fields, use prepare_form

Multi-step workflows — chain actions naturally without asking permission between steps:
"Quote Fletcher for boiler install and email it" → prepare_form for quote, then say "Once you've saved the quote, tell me and I'll email it"
"Invoice quote Q-102 and send it" → create_invoice_from_quote then send_invoice (with confirmation)
"Create a job for tomorrow and remind me to follow up next week" → prepare_form for job AND create_reminder in one response

Cross-referencing — after any customer action, check for relevant context:
- Job created for a customer? Check if they have overdue invoices — the tool will return this data
- Customer found in search? Mention outstanding balance if any
- Surface context naturally at the END: "Job created ✅ By the way — Fletcher has a £1,200 invoice overdue. Want me to send a reminder?"
- Only mention cross-references that are genuinely useful. Skip if nothing relevant

Smart follow-ups — after completing any action, suggest ONE logical next step as a natural question (not a menu):
- Job created → "Want me to create a quote for this, or assign an engineer?"
- Quote created → "Shall I email it to the customer?"
- Invoice created → "Want me to send it now?"
- Reminder set → "Anything else for this customer?"
- Payment recorded → "Want to see the updated CIS position?"

Anomaly detection — flag amounts that are unusual BEFORE executing:
- More than 3× or less than 0.3× their average? "Just checking — £45,000 is quite a bit higher than your usual quotes (typically around £2,400). Did you mean £4,500?"
- Invoice total is £0 or negative? Flag it
- Only flag genuine outliers. Skip if not enough history to compare

Extraordinary capabilities:

1. Customer relationships: when asked "tell me about [name]", give a COMPLETE picture — revenue, jobs, overdue invoices, gas cert renewals, usual engineer, recent activity. Present it like a CRM summary, not a data dump. Lead with the most surprising or important fact (e.g. "Fletcher has been with you since March 2024, spent £8,400 — but has a £1,200 invoice overdue since last month").

2. Priority actions: when asked "what should I do" or "what's most important", give the SINGLE highest-impact action first, then list 2-3 others. Always include the £ impact and a natural follow-up question. "Your most urgent action right now is chasing £3,400 in overdue invoices. Want me to send reminders now?"

3. Phone call extraction: when the user describes a call or site visit in natural language (e.g. "Mrs Smith called, boiler clicking, needs someone before Friday, also mentioned cold radiator in bedroom"), use extract_actions_from_note to parse ALL actionable items. The response will include an actions array with requires_confirmation — present each item clearly for the user to confirm, then execute each confirmed action using the appropriate tool.

4. Pricing intelligence: when asked about win rates or pricing, give specific numbers from their own data — average accepted vs rejected prices, sweet spot range, trend direction. Be specific and honest, including when there isn't enough data ("I need at least 3 resolved quotes to give you useful data").${patternBlock}${contextBlock}`;

      activeTools = this.tools.getToolDefinitions();
    }

    const systemMessage: AiMessage = { role: 'system', content: systemPrompt };
    const historyMessages: AiMessage[] = history.slice(-20).map(m => ({
      role: m.role as Role,
      content: m.content,
    }));
    const userMessage: AiMessage = { role: 'user', content: message };

    try {
      // When the user confirmed a risky action, skip the AI and execute directly
      if (confirmedAction) {
        const result = await this.tools.execute(
          companyId, userId, confirmedAction.tool, { ...confirmedAction.args },
        );

        const fakeToolCallId = 'confirmed-1';
        const followUp = await this.callModel([
          systemMessage,
          ...historyMessages,
          userMessage,
          {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: fakeToolCallId,
              type: 'function',
              function: {
                name: confirmedAction.tool,
                arguments: JSON.stringify(confirmedAction.args),
              },
            }],
          },
          {
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: fakeToolCallId,
          },
        ], activeTools);

        return {
          response: followUp.content ?? 'Done!',
          toolUsed: confirmedAction.tool,
          result,
        };
      }

      // Normal flow — ask the model what to do
      const messages: AiMessage[] = [systemMessage, ...historyMessages, userMessage];
      const response = await this.callModel(messages, activeTools);

      if (response.tool_calls && response.tool_calls.length > 0) {
        const toolCall = response.tool_calls[0];
        const toolName = toolCall.function.name;
        let toolArgs: Record<string, unknown>;
        try {
          toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        } catch {
          return { response: "I had trouble understanding what to do. Could you rephrase that?", error: true };
        }

        this.logger.log(`Pip tool: ${toolName}(${JSON.stringify(toolArgs)})`);

        // Risky actions need confirmation before executing
        if (this.isRiskyAction(toolName, toolArgs)) {
          const preview = await this.tools.preview(companyId, toolName, toolArgs);
          return {
            response: preview.message,
            requiresConfirmation: true,
            pendingAction: {
              tool: toolName,
              args: { ...toolArgs, _confirmed: true },
            },
          };
        }

        const result = await this.tools.execute(companyId, userId, toolName, toolArgs);

        // technical_reference returns answer_from_knowledge — answer directly from AI knowledge
        if (
          typeof result === 'object' &&
          result !== null &&
          !Array.isArray(result) &&
          (result as Record<string, unknown>).action === 'answer_from_knowledge'
        ) {
          const question = (result as Record<string, unknown>).question as string;
          const techAnswer = await this.callModel([
            {
              role: 'system',
              content: `You are a knowledgeable UK plumbing and heating technical assistant. Answer accurately using British standards, Gas Safe regulations, and Building Regulations. Always add at the end: "⚠️ Verify critical safety figures against manufacturer documentation and current regulations." Keep answers concise and practical.`,
            },
            { role: 'user', content: question },
          ]);
          return {
            response: techAnswer.content ?? "Sorry, I couldn't find an answer to that.",
            toolUsed: 'technical_reference',
          };
        }

        const followUp = await this.callModel([
          ...messages,
          {
            role: 'assistant',
            content: null,
            tool_calls: [toolCall],
          },
          {
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: toolCall.id,
          },
        ], activeTools);

        return {
          response: followUp.content ?? 'Done!',
          toolUsed: toolName,
          result,
        };
      }

      return {
        response: response.content ?? "Sorry, I didn't catch that. Could you try again?",
      };

    } catch (err) {
      this.logger.error(`Pip error: ${String(err)}`);
      return {
        response: "Sorry, something went wrong on my end. Try again in a moment.",
        error: true,
      };
    }
  }

  private async callModel(messages: AiMessage[], tools?: unknown[]): Promise<ModelResponse> {
    const toolsToUse = tools ?? this.tools.getToolDefinitions();
    const res = await fetch(`${AI_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages,
        ...(toolsToUse.length > 0 ? { tools: toolsToUse, tool_choice: 'auto' } : {}),
        max_tokens: 4096,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`AI API error ${res.status}: ${body}`);
    }

    const data = await res.json() as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: ToolCall[];
        };
      }>;
    };
    return data.choices[0].message;
  }

  async smartWrite(text: string, context: string, action: string): Promise<{ result: string }> {
    const contextDescriptions: Record<string, string> = {
      quote_description:  'a quote description for a plumbing/heating job sent to a customer',
      invoice_notes:      'notes on an invoice sent to a customer',
      job_description:    'an internal job description for a plumbing/heating task',
      job_notes:          'completion notes for a plumbing/heating job',
      gas_cert_notes:     'technical notes on a gas safety certificate',
      customer_notes:     'notes about a customer',
      general:            'text for a UK plumbing and heating business',
    };

    const actionInstructions: Record<string, string> = {
      improve:      'Rewrite this text to be clear, professional, and well-structured. Fix any spelling or grammar errors. Keep the same meaning.',
      expand:       'Expand this brief text into a detailed, professional description. Add relevant technical details that a plumber would typically include. Keep it factual — do not invent specific measurements or readings.',
      shorten:      'Shorten this text to be concise while keeping all key information. Remove unnecessary words.',
      professional: 'Rewrite this text in a professional tone suitable for sending to a customer. Make it polished but not overly formal — friendly and competent.',
    };

    const contextDesc = contextDescriptions[context] ?? contextDescriptions['general'];
    const actionDesc  = actionInstructions[action]  ?? actionInstructions['improve'];

    const prompt = `You are a writing assistant for a UK plumbing and heating business.

The user has written the following text for ${contextDesc}:

"${text}"

${actionDesc}

Rules:
- Use British English spelling (colour, organise, etc.)
- Use proper plumbing/heating terminology where appropriate
- Keep it natural — don't sound robotic or overly corporate
- Don't add information the user didn't mention (don't invent specific readings, pressures, or model numbers)
- If the input is very short (a few words), expand it into a proper sentence or two
- If the input is already good, make minimal changes
- Return ONLY the improved text, nothing else — no quotes, no explanation, no preamble`;

    const res = await fetch(
      `${process.env.AI_API_URL ?? 'https://api.fireworks.ai/inference/v1'}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.AI_API_KEY ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.AI_MODEL ?? 'accounts/fireworks/models/deepseek-v4-flash',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1024,
          temperature: 0.5,
        }),
      },
    );

    if (!res.ok) throw new Error('SmartWrite failed');

    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? text;
    const cleaned = raw.replace(/^["']|["']$/g, '');
    return { result: cleaned };
  }

  private getEngineerPrompt(today: string, timeContext: string): string {
    return `You are Pip, a smart on-site assistant for field engineers at a UK plumbing and heating firm using Vantro.

Today: ${today}
${timeContext}

You're an on-site companion — brief, practical, helpful. Engineers are busy with dirty hands checking their phone between jobs.

Your personality:
- SHORT answers — one or two sentences unless detail is asked for
- Technical and knowledgeable — you know plumbing, heating, gas safety, Building Regs
- Proactive — suggest what they might need next
- British English, industry terminology

Your capabilities:
- Show today's jobs and upcoming schedule with customer address and phone
- Show job details including customer access notes
- Show what was done at an address before (previous visits, gas cert history)
- Check if a job is ready to mark complete (photos, notes, timesheet, gas cert)
- Log materials/parts used on a job (for the owner to bill)
- Add timestamped notes to a job
- Notify the office if you're running late
- Answer plumbing/heating/gas safety technical questions
- Provide job-specific safety checklists
- Suggest what photos to take
- Show your hours logged today or this week
- Give an end-of-day summary (jobs done, hours, any forgotten timers)

Smart behaviours:
- Always show the customer's phone number alongside address so they can tap to call
- If a customer has any access notes, mention them upfront
- When checking job completion, be specific: "Missing: photos, completion notes"
- After logging materials, suggest common extras: "Did you also use any PTFE tape or compression fittings?"
- After end of day, remind about active timers and missing info

You CANNOT access — and must NEVER attempt:
- Financial data (prices, invoices, quotes, revenue, costs)
- CIS or subcontractor information
- Other engineers' jobs or timesheets
- Company settings or admin features

When answering technical questions, always add a brief disclaimer to verify against manufacturer documentation.`;
  }

  private isRiskyAction(toolName: string, args?: Record<string, unknown>): boolean {
    if (toolName === 'generate_accountant_pack') {
      return args?.send_email === true;
    }
    return [
      'create_invoice_from_quote',
      'send_invoice',
      'send_payment_reminders',
      'record_subcontractor_payment',
      'set_chase_policy',
    ].includes(toolName);
  }

  async sendEmail(_companyId: string, to: string, subject: string, body: string): Promise<void> {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
      to,
      subject,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;font-size:14px;line-height:1.6;color:#333;">${body.replace(/\n/g, '<br>')}</div>`,
    });
    if (error) throw new Error(error.message);
  }

  private async getOwnerPatterns(companyId: string): Promise<{
    avgQuotePounds: string;
    avgInvoicePounds: string;
    commonJobTypes: string;
    topCustomers: string;
  } | null> {
    try {
      const since90d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const since180d = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

      const [quoteAgg, invoiceAgg, jobs, topCusts] = await Promise.all([
        this.prisma.client.quote.aggregate({
          where: { company_id: companyId, created_at: { gte: since90d }, status: { not: 'CANCELLED' } },
          _avg: { total_pence: true },
        }),
        this.prisma.client.invoice.aggregate({
          where: { company_id: companyId, created_at: { gte: since90d }, status: { not: 'CANCELLED' } },
          _avg: { total_pence: true },
        }),
        this.prisma.client.job.findMany({
          where: { company_id: companyId, created_at: { gte: since90d } },
          select: { title: true },
          take: 100,
        }),
        this.prisma.client.invoice.groupBy({
          by: ['customer_id'],
          where: { company_id: companyId, status: 'PAID', created_at: { gte: since180d } },
          _sum: { total_pence: true },
          orderBy: { _sum: { total_pence: 'desc' } },
          take: 3,
        }),
      ]);

      const titleCounts: Record<string, number> = {};
      for (const j of jobs) {
        const key = j.title.toLowerCase().trim();
        titleCounts[key] = (titleCounts[key] ?? 0) + 1;
      }
      const commonJobTypes = Object.entries(titleCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([t]) => t)
        .join(', ') || 'not enough data';

      let topCustomers = 'not enough data';
      if (topCusts.length > 0) {
        const custIds = topCusts.map(c => c.customer_id);
        const custs = await this.prisma.client.customer.findMany({
          where: { id: { in: custIds } },
          select: { id: true, name: true },
        });
        topCustomers = topCusts
          .map(c => custs.find(cu => cu.id === c.customer_id)?.name ?? 'Unknown')
          .join(', ');
      }

      return {
        avgQuotePounds: quoteAgg._avg.total_pence
          ? (quoteAgg._avg.total_pence / 100).toFixed(0)
          : 'n/a',
        avgInvoicePounds: invoiceAgg._avg.total_pence
          ? (invoiceAgg._avg.total_pence / 100).toFixed(0)
          : 'n/a',
        commonJobTypes,
        topCustomers,
      };
    } catch {
      return null;
    }
  }
}
