import { Injectable, Logger } from '@nestjs/common';
import { AiToolsService } from './ai-tools.service';
import { PipMemoryService } from './pip-memory.service';

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
  ) {}

  async chat(
    companyId: string,
    userId: string,
    message: string,
    history: Array<{ role: string; content: string }>,
    confirmedAction?: { tool: string; args: Record<string, unknown> },
  ) {
    const today = new Date().toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });

    // Load recent conversation summaries for context injection
    const recentContext = await this.memory.getRecentContext(companyId, userId);
    const contextBlock = recentContext
      ? `\n\nRecent conversations with this owner:\n${recentContext}\n\nUse this context naturally — if the owner references something from a previous conversation, you can recall it. Don't say "from our previous conversation" — just know the context like a colleague who remembers.`
      : '';

    const systemPrompt = `You are Pip, a helpful AI assistant for Vantro — a job management app for UK plumbing and heating firms.

Today is: ${today}

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
- Record subcontractor CIS payments
- Open forms pre-filled with known details
- Set reminders for future dates ("remind me", "follow up", "chase", "don't forget")
- List upcoming reminders and overdue ones
- Mark reminders as done

When resolving relative dates for reminders: "tomorrow" = next day, "next Tuesday" = the coming Tuesday, "in 3 days" = today + 3, "next week" = next Monday, "end of month" = last day of current month. Always resolve to YYYY-MM-DD.

Rules:
- ALWAYS use tools when the user asks you to DO something
- Amounts are displayed in £ with two decimal places
- Dates in DD/MM/YYYY format
- Never expose internal IDs to the user — refer to records by name or number
- When the user asks to CREATE something with complex data (quotes with line items, jobs with many fields, gas certificates with technical details, new subcontractors), use the prepare_form tool to open the form pre-filled rather than asking them to type everything in chat
- For SIMPLE creates (just a name and a basic title), use create_job or create_customer directly
- Guideline: if you would need to ask the user for more than 3 fields of information, use prepare_form instead${contextBlock}`;

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
        ]);

        return {
          response: followUp.content ?? 'Done!',
          toolUsed: confirmedAction.tool,
          result,
        };
      }

      // Normal flow — ask the model what to do
      const messages: AiMessage[] = [systemMessage, ...historyMessages, userMessage];
      const response = await this.callModel(messages);

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
        if (this.isRiskyAction(toolName)) {
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
        ]);

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

  private async callModel(messages: AiMessage[]): Promise<ModelResponse> {
    const res = await fetch(`${AI_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages,
        tools: this.tools.getToolDefinitions(),
        tool_choice: 'auto',
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

  private isRiskyAction(toolName: string): boolean {
    return [
      'create_invoice_from_quote',
      'send_invoice',
      'send_payment_reminders',
      'record_subcontractor_payment',
    ].includes(toolName);
  }
}
