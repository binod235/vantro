import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CommsService } from '../comms/comms.service';
import { Resend } from 'resend';

// ─── Rate-limiting + session state (in-memory, per-process) ──────────────────
// Sessions expire after 1 hour. Acceptable for MVP — processes restart daily.
const MAX_MESSAGES_PER_SESSION = 20;
const SESSION_TTL_MS = 60 * 60 * 1000;
const IP_WINDOW_MS = 60 * 1000;        // 1-minute window
const IP_MAX_REQUESTS = 30;             // max messages per IP per minute

interface SessionState {
  messageCount: number;
  booked: boolean;
  expiresAt: number;
}

const sessions = new Map<string, SessionState>();
const ipCounters = new Map<string, { count: number; resetAt: number }>();

function getSession(sessionId: string): SessionState {
  const now = Date.now();
  let s = sessions.get(sessionId);
  if (!s || s.expiresAt < now) {
    s = { messageCount: 0, booked: false, expiresAt: now + SESSION_TTL_MS };
    sessions.set(sessionId, s);
  }
  return s;
}

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  let rec = ipCounters.get(ip);
  if (!rec || rec.resetAt < now) {
    rec = { count: 0, resetAt: now + IP_WINDOW_MS };
    ipCounters.set(ip, rec);
  }
  rec.count++;
  return rec.count <= IP_MAX_REQUESTS;
}

// Periodically purge expired sessions to avoid memory leak
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) {
    if (v.expiresAt < now) sessions.delete(k);
  }
  for (const [k, v] of ipCounters) {
    if (v.resetAt < now) ipCounters.delete(k);
  }
}, 10 * 60 * 1000);

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ConciergeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ConciergeReply {
  reply: string;
  done: boolean;
  booking?: {
    customerName: string;
    jobTitle: string;
    scheduledAt: string | null;
    approvalRequired: boolean;
  };
  error?: string;
}

// ─── Tool definitions ──────────────────────────────────────────────────────────

const CONCIERGE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_availability',
      description:
        'Returns concrete available appointment slots for the next 7 days based on the company work hours and existing bookings. Call this when the customer asks about availability or timing.',
      parameters: {
        type: 'object',
        properties: {
          urgency: {
            type: 'string',
            enum: ['routine', 'urgent', 'emergency'],
            description: 'How urgent the job is. Emergency gets the first available slot today.',
          },
        },
        required: ['urgency'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_booking',
      description:
        'Creates the booking once you have all required information: name, phone, postcode, description of the problem, and a preferred slot the customer agreed to. Only call this once.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Customer full name' },
          phone: { type: 'string', description: 'Customer phone number' },
          postcode: { type: 'string', description: 'Property postcode' },
          address: { type: 'string', description: 'Full address if given' },
          problem: { type: 'string', description: 'Description of the issue' },
          urgency: {
            type: 'string',
            enum: ['routine', 'urgent', 'emergency'],
          },
          preferred_slot: {
            type: 'string',
            description: 'The slot the customer chose, e.g. "Thursday 9am" or "tomorrow morning"',
          },
          scheduled_iso: {
            type: 'string',
            description:
              'ISO8601 datetime string for the scheduled appointment if a concrete date was agreed, e.g. 2026-07-24T09:00:00. Omit if only a vague time was agreed.',
          },
        },
        required: ['name', 'phone', 'postcode', 'problem', 'urgency', 'preferred_slot'],
      },
    },
  },
];

// ─── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class ConciergeService {
  private readonly logger = new Logger(ConciergeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comms: CommsService,
  ) {}

  async chat(
    slug: string,
    messages: ConciergeMessage[],
    sessionId: string,
    clientIp: string,
  ): Promise<ConciergeReply> {

    // ── Rate limit ──────────────────────────────────────────────────────────
    if (!checkIpRateLimit(clientIp)) {
      return { reply: "We're very busy right now. Please try again in a moment or call us directly.", done: false, error: 'rate_limited' };
    }

    const session = getSession(sessionId);
    if (session.messageCount >= MAX_MESSAGES_PER_SESSION) {
      return { reply: "This conversation has reached its limit. Please call us directly to book.", done: true };
    }
    if (session.booked) {
      return { reply: "You're already booked in! Check your confirmation above. Is there anything else?", done: true };
    }

    // ── Load company ────────────────────────────────────────────────────────
    const company = await this.prisma.client.company.findUnique({
      where: { slug },
      select: {
        id: true, name: true, logo_url: true, phone: true,
        branding_footer_enabled: true,
        concierge_enabled: true,
        concierge_approval_mode: true,
        concierge_work_days: true,
        concierge_work_start: true,
        concierge_work_end: true,
        concierge_auto_assign: true,
      },
    });

    if (!company || !company.concierge_enabled) {
      return { reply: "Booking is not currently available online. Please call us to enquire.", done: true };
    }

    session.messageCount++;

    // ── Build system prompt ─────────────────────────────────────────────────
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const workDays = company.concierge_work_days || 'Mon,Tue,Wed,Thu,Fri';
    const startH = company.concierge_work_start ?? 8;
    const endH = company.concierge_work_end ?? 17;

    const systemPrompt = `You are the booking assistant for ${company.name}, a UK plumbing and heating firm.
Today is ${dateStr}. You work ${workDays}, ${startH}:00–${endH}:00.

Your job:
1. Warmly greet the customer and find out what they need.
2. Collect ONLY what you still need: name, phone, postcode, problem description, and preferred timing.
   Ask one or two things at a time — do NOT fire a list of questions.
3. Judge urgency: routine (can wait days), urgent (today/tomorrow), emergency (no heat/leak/gas).
4. When you have enough context, call get_availability to offer 2–3 concrete slot options.
5. Once the customer picks a slot, call create_booking.
6. NEVER quote prices — say "the engineer will confirm the cost on site".
7. NEVER mention other customers, financial data, internal IDs, or anything from this system beyond what's needed for booking.
8. Keep replies SHORT — 1–3 sentences. Mobile customers are impatient.
9. British English spelling and tone: warm, professional, brief.
10. CRITICAL — gas smells: immediately say "If you can smell gas, please call the National Gas Emergency line on 0800 111 999 immediately and leave the property." Then offer booking for after they're safe.
11. Emergencies (no heat, active leak): offer the earliest possible slot.
12. If the customer says they'd rather call or fill in a form, acknowledge warmly and say the form is below. Set done=true only after a successful booking.

${company.concierge_approval_mode ? 'Note: After booking, the team will confirm the appointment shortly (not immediate auto-confirmation).' : 'After booking, the appointment is confirmed.'}`;

    // ── Build message list for the model ───────────────────────────────────
    const modelMessages: ModelMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-18).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    // ── Call model (one round, handle single tool call) ───────────────────
    const apiKey = process.env.AI_API_KEY ?? '';
    const apiUrl = process.env.AI_API_URL ?? 'https://api.fireworks.ai/inference/v1';
    const model  = process.env.AI_MODEL  ?? 'accounts/fireworks/models/deepseek-v4-flash';

    const firstRes = await this.callModel(apiUrl, apiKey, model, modelMessages, CONCIERGE_TOOLS);

    if (!firstRes.tool_calls?.length) {
      // Plain text reply
      return { reply: firstRes.content ?? "I'm not sure. Could you say that again?", done: false };
    }

    const toolCall = firstRes.tool_calls[0];
    const toolName = toolCall.function.name;
    let toolArgs: Record<string, unknown>;
    try {
      toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    } catch {
      return { reply: "Something went wrong on my end. Could you rephrase?", done: false };
    }

    let toolResult: unknown;

    if (toolName === 'get_availability') {
      toolResult = await this.getAvailability(
        company.id,
        (toolArgs['urgency'] as string) ?? 'routine',
        workDays, startH, endH,
      );
    } else if (toolName === 'create_booking') {
      if (session.booked) {
        toolResult = { error: 'A booking already exists for this session.' };
      } else {
        const bookingResult = await this.createBooking(company, toolArgs, sessionId);
        if (bookingResult.success) {
          session.booked = true;
          // Ask model to compose the confirmation message
          const confirmMessages: ModelMessage[] = [
            ...modelMessages,
            { role: 'assistant', content: null, tool_calls: [toolCall] },
            { role: 'tool', content: JSON.stringify(bookingResult), tool_call_id: toolCall.id },
          ];
          const confirmRes = await this.callModel(apiUrl, apiKey, model, confirmMessages, []);
          return {
            reply: confirmRes.content ?? 'Your booking has been received — we\'ll be in touch shortly to confirm.',
            done: true,
            booking: {
              customerName: bookingResult.customerName as string,
              jobTitle: bookingResult.jobTitle as string,
              scheduledAt: (bookingResult.scheduledAt as string) ?? null,
              approvalRequired: company.concierge_approval_mode,
            },
          };
        }
        toolResult = bookingResult;
      }
    } else {
      toolResult = { error: `Unknown tool: ${toolName}` };
    }

    // ── Follow-up after tool result ────────────────────────────────────────
    const followUpMessages: ModelMessage[] = [
      ...modelMessages,
      { role: 'assistant', content: null, tool_calls: [toolCall] },
      { role: 'tool', content: JSON.stringify(toolResult), tool_call_id: toolCall.id },
    ];
    const followUp = await this.callModel(apiUrl, apiKey, model, followUpMessages, CONCIERGE_TOOLS);

    return { reply: followUp.content ?? "Let me check on that.", done: false };
  }

  // ── get_availability tool ────────────────────────────────────────────────────

  private async getAvailability(
    companyId: string,
    urgency: string,
    workDays: string,
    startH: number,
    endH: number,
  ): Promise<{ slots: string[] }> {
    const now = new Date();
    const lookahead = urgency === 'emergency' ? 2 : urgency === 'urgent' ? 4 : 7;
    const end = new Date(now.getTime() + lookahead * 24 * 60 * 60 * 1000);

    // Fetch existing jobs in window
    const existing = await this.prisma.client.job.findMany({
      where: {
        company_id: companyId,
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        scheduled_at: { gte: now, lte: end },
      },
      select: { scheduled_at: true },
    });

    const busyDates = new Set(
      existing
        .filter(j => j.scheduled_at)
        .map(j => j.scheduled_at!.toISOString().slice(0, 10)),
    );

    const workDayAbbrevs = workDays.split(',').map(d => d.trim().toLowerCase().slice(0, 3));
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

    const slots: string[] = [];
    const cursor = new Date(now);
    cursor.setHours(0, 0, 0, 0);
    if (urgency !== 'emergency') cursor.setDate(cursor.getDate() + 1);

    while (slots.length < 4 && cursor <= end) {
      const dayAbbrev = dayNames[cursor.getDay()];
      if (workDayAbbrevs.includes(dayAbbrev)) {
        const dateKey = cursor.toISOString().slice(0, 10);
        if (!busyDates.has(dateKey)) {
          const label = cursor.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
          const morningH = startH;
          const afternoonH = Math.min(startH + Math.floor((endH - startH) / 2), 13);

          if (slots.length < 2) {
            slots.push(`${label} morning (around ${morningH}:00am)`);
          }
          if (slots.length < 4 && afternoonH < endH) {
            slots.push(`${label} afternoon (around ${afternoonH + 1}:00pm)`);
          }
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    if (!slots.length) {
      slots.push('This week is quite full — please call us to discuss timing.');
    }

    return { slots };
  }

  // ── create_booking tool ──────────────────────────────────────────────────────

  private async createBooking(
    company: {
      id: string;
      name: string;
      phone: string | null;
      concierge_approval_mode: boolean;
      concierge_auto_assign: boolean;
      branding_footer_enabled: boolean;
    },
    args: Record<string, unknown>,
    sessionId: string,
  ): Promise<Record<string, unknown>> {
    const name     = String(args['name'] ?? '').trim();
    const phone    = String(args['phone'] ?? '').trim();
    const postcode = String(args['postcode'] ?? '').trim().toUpperCase();
    const address  = args['address'] ? String(args['address']).trim() : null;
    const problem  = String(args['problem'] ?? '').trim();
    const urgency  = String(args['urgency'] ?? 'routine');
    const slotLabel = String(args['preferred_slot'] ?? '');
    const scheduledIso = args['scheduled_iso'] ? String(args['scheduled_iso']) : null;

    if (!name || !phone || !postcode || !problem) {
      return { error: 'Missing required fields', missing: { name: !name, phone: !phone, postcode: !postcode, problem: !problem } };
    }

    // Sanitise inputs (prevent DB injection, XSS)
    const safe = (s: string) => s.replace(/[<>]/g, '').slice(0, 500);

    const safeName     = safe(name);
    const safePhone    = phone.replace(/[^0-9+\s()-]/g, '').slice(0, 20);
    const safePostcode = postcode.replace(/[^A-Z0-9 ]/g, '').slice(0, 10);
    const safeAddress  = address ? safe(address) : null;
    const safeProblem  = safe(problem);

    const priority = urgency === 'emergency' ? 'URGENT' : urgency === 'urgent' ? 'HIGH' : 'MEDIUM';

    try {
      const result = await this.prisma.client.$transaction(async (tx) => {
        // Dedupe customer by phone, then by postcode+name
        let customer = await tx.customer.findFirst({
          where: { company_id: company.id, phone: safePhone },
        });
        if (!customer) {
          customer = await tx.customer.findFirst({
            where: {
              company_id: company.id,
              name: { equals: safeName, mode: 'insensitive' },
              postcode: safePostcode,
            },
          });
        }
        if (!customer) {
          customer = await tx.customer.create({
            data: {
              company_id: company.id,
              name: safeName,
              phone: safePhone || null,
              postcode: safePostcode || null,
              address_line1: safeAddress || null,
            },
          });
        }

        // Auto-assign engineer if only one
        let engineerId: string | null = null;
        if (company.concierge_auto_assign) {
          const engineers = await tx.user.findMany({
            where: { companyId: company.id, role: 'ENGINEER' },
            select: { id: true },
          });
          if (engineers.length === 1) engineerId = engineers[0].id;
        }

        const jobStatus = company.concierge_approval_mode ? 'QUOTED' : 'SCHEDULED';
        const scheduledAt = scheduledIso ? new Date(scheduledIso) : null;
        const jobTitle = `CONCIERGE: ${safeProblem.slice(0, 120)}`;

        const job = await tx.job.create({
          data: {
            company_id: company.id,
            customer_id: customer.id,
            engineer_id: engineerId,
            title: jobTitle,
            description: `Booked via AI Concierge (${slotLabel}). Problem: ${safeProblem}`,
            status: jobStatus,
            scheduled_at: scheduledAt,
          },
        });

        // Enquiry record
        const agg = await tx.enquiry.aggregate({
          where: { company_id: company.id },
          _max: { enquiry_no: true },
        });
        const enquiryNo = (agg._max.enquiry_no ?? 0) + 1;
        await tx.enquiry.create({
          data: {
            company_id: company.id,
            enquiry_no: enquiryNo,
            customer_id: customer.id,
            name: safeName,
            phone: safePhone || null,
            postcode: safePostcode || null,
            notes: safeProblem,
            source: 'OTHER',
            intake_method: 'DIRECT_LINK',
            status: 'CONVERTED',
            converted_job_id: job.id,
            converted_at: new Date(),
          },
        });

        // Owner todo if approval required
        if (company.concierge_approval_mode) {
          const owner = await tx.user.findFirst({
            where: { companyId: company.id, role: 'OWNER' },
            select: { id: true },
          });
          if (owner) {
            await tx.todo.create({
              data: {
                company_id: company.id,
                created_by_id: owner.id,
                title: `CONCIERGE: Confirm booking for ${safeName} — ${slotLabel}`,
                description: safeProblem,
                priority: priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
                job_id: job.id,
              },
            });
          }
        }

        return { job, customer, engineerId };
      });

      // AutopilotEvent — fire and forget
      void this.prisma.client.autopilotEvent.create({
        data: {
          company_id: company.id,
          type: 'CONCIERGE_BOOKED',
          title: `Concierge booked ${safeName} — ${safeProblem.slice(0, 60)} (${slotLabel})`,
          meta: { jobId: result.job.id, urgency, slot: slotLabel, approvalRequired: company.concierge_approval_mode },
        },
      }).catch(() => {});

      // PipInsight — fire and forget (expires in 7 days)
      void this.prisma.client.pipInsight.create({
        data: {
          company_id: company.id,
          type: 'CONCIERGE_BOOKING',
          title: '🌙 Concierge booked a job while you were away',
          message: `${safeName} booked in for ${slotLabel}: "${safeProblem.slice(0, 80)}${safeProblem.length > 80 ? '…' : ''}"${company.concierge_approval_mode ? ' — needs your confirmation.' : ' (auto-confirmed).'}`,
          severity: 'INFO',
          action_label: 'View job',
          action_type: 'navigate',
          action_data: { url: `/dashboard/jobs/${result.job.id}` },
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      }).catch(() => {});

      // Send owner email notification — fire and forget
      void this.notifyOwner(company, safeName, slotLabel, safeProblem, result.job.id);

      this.logger.log(`Concierge booked job ${result.job.id} for ${safeName} (session ${sessionId})`);

      return {
        success: true,
        customerName: safeName,
        jobTitle: `CONCIERGE: ${safeProblem.slice(0, 80)}`,
        scheduledAt: scheduledIso,
        slot: slotLabel,
        approvalRequired: company.concierge_approval_mode,
        jobId: result.job.id,
      };
    } catch (err) {
      this.logger.error(`Concierge booking failed: ${String(err)}`);
      return { error: 'Booking failed — please call us directly.', detail: String(err) };
    }
  }

  // ── Owner notification email ─────────────────────────────────────────────────

  private async notifyOwner(
    company: { id: string; name: string; branding_footer_enabled: boolean },
    customerName: string,
    slot: string,
    problem: string,
    jobId: string,
  ): Promise<void> {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return;

    const owner = await this.prisma.client.user.findFirst({
      where: { companyId: company.id, role: 'OWNER' },
      select: { email: true },
    });
    if (!owner?.email) return;

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3001';
    const jobUrl = `${frontendUrl}/dashboard/jobs/${jobId}`;

    const resend = new Resend(resendKey);
    const { error } = await resend.emails.send({
      from: process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
      to: owner.email,
      subject: `🌙 New concierge booking — ${customerName}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
        <div style="background:#1d4ed8;padding:20px 28px;border-radius:8px 8px 0 0;">
          <h1 style="color:white;margin:0;font-size:18px;">${company.name}</h1>
          <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">New Concierge Booking</p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
          <p style="margin:0 0 16px;font-size:15px;">Pip booked a job while you were away:</p>
          <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;margin-bottom:20px;">
            <tr><td style="padding:10px 16px;font-size:13px;color:#888;">Customer</td><td style="padding:10px 16px;font-size:13px;font-weight:600;">${customerName}</td></tr>
            <tr style="border-top:1px solid #e5e7eb;"><td style="padding:10px 16px;font-size:13px;color:#888;">Slot</td><td style="padding:10px 16px;font-size:13px;">${slot}</td></tr>
            <tr style="border-top:1px solid #e5e7eb;"><td style="padding:10px 16px;font-size:13px;color:#888;">Problem</td><td style="padding:10px 16px;font-size:13px;">${problem}</td></tr>
          </table>
          <a href="${jobUrl}" style="display:inline-block;background:#1d4ed8;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px;">View Job →</a>
        </div>
      </div>`,
    });

    if (error) this.logger.warn(`Concierge owner notification failed: ${error.message}`);

    void this.comms.log({
      company_id: company.id,
      type: 'CONCIERGE_NOTIFICATION',
      subject: `New concierge booking — ${customerName}`,
      to_email: owner.email,
      notes: `Concierge booked job for ${customerName} (${slot})`,
    });
  }

  // ── Model call ───────────────────────────────────────────────────────────────

  private async callModel(
    apiUrl: string,
    apiKey: string,
    model: string,
    messages: ModelMessage[],
    tools: unknown[],
  ): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
    const res = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
        max_tokens: 512,
        temperature: 0.4,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI error ${res.status}: ${text}`);
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string | null; tool_calls?: ToolCall[] } }>;
    };
    return data.choices[0].message;
  }
}
