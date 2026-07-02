import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const AI_API_URL = process.env.AI_API_URL ?? 'https://api.fireworks.ai/inference/v1';
const AI_API_KEY = process.env.AI_API_KEY ?? '';
const AI_MODEL   = process.env.AI_MODEL ?? 'accounts/fireworks/models/deepseek-v4-flash';

interface StoredMessage {
  role: string;
  content: string;
  timestamp?: string;
}

@Injectable()
export class PipMemoryService {
  private readonly logger = new Logger(PipMemoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async saveSession(
    companyId: string,
    userId: string,
    messages: StoredMessage[],
  ): Promise<void> {
    const meaningful = messages.filter(
      m => (m.role === 'user' || m.role === 'assistant') && m.content?.trim(),
    );
    if (meaningful.length < 2) return;

    const summary = await this.generateSummary(meaningful);

    await this.prisma.client.pipConversation.create({
      data: {
        company_id: companyId,
        user_id: userId,
        messages: messages as object[],
        summary,
        message_count: messages.length,
        started_at: messages[0]?.timestamp ? new Date(messages[0].timestamp) : new Date(),
        ended_at: new Date(),
      },
    });

    await this.pruneOldSessions(companyId, userId);
  }

  async getRecentContext(
    companyId: string,
    userId: string,
    limit = 5,
  ): Promise<string> {
    const recent = await this.prisma.client.pipConversation.findMany({
      where: {
        company_id: companyId,
        user_id: userId,
        summary: { not: null },
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: { summary: true, created_at: true },
    });

    if (recent.length === 0) return '';

    return recent
      .reverse()
      .map(r => {
        const date = r.created_at.toLocaleDateString('en-GB', {
          weekday: 'short', day: 'numeric', month: 'short',
        });
        return `[${date}] ${r.summary}`;
      })
      .join('\n');
  }

  async getLastSession(
    companyId: string,
    userId: string,
  ): Promise<Array<{ role: string; content: string }> | null> {
    const last = await this.prisma.client.pipConversation.findFirst({
      where: { company_id: companyId, user_id: userId },
      orderBy: { created_at: 'desc' },
      select: { messages: true },
    });

    if (!last) return null;

    const messages = last.messages as unknown as StoredMessage[];
    // Return last 10 user+assistant messages — don't overload context
    const filtered = messages.filter(
      m => m.role === 'user' || m.role === 'assistant',
    );
    return filtered.slice(-10).map(m => ({ role: m.role, content: m.content }));
  }

  private async generateSummary(messages: StoredMessage[]): Promise<string | null> {
    try {
      const relevant = messages.slice(-20);
      if (relevant.length < 2) return null;

      const conversationText = relevant
        .map(m => `${m.role === 'user' ? 'Owner' : 'Pip'}: ${m.content}`)
        .join('\n');

      const res = await fetch(`${AI_API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            {
              role: 'user',
              content: `Summarize this conversation between a plumbing business owner and their AI assistant in 1-2 sentences. Focus on: what was discussed, any actions taken, any decisions made, any follow-ups mentioned. Be specific about names, amounts, and dates mentioned.

${conversationText}

Summary (1-2 sentences, no quotes):`,
            },
          ],
          max_tokens: 200,
          temperature: 0.3,
        }),
      });

      if (!res.ok) return null;

      const data = await res.json() as { choices: Array<{ message: { content: string } }> };
      return data.choices?.[0]?.message?.content?.trim() ?? null;
    } catch {
      return null;
    }
  }

  private async pruneOldSessions(companyId: string, userId: string, keep = 20): Promise<void> {
    const old = await this.prisma.client.pipConversation.findMany({
      where: { company_id: companyId, user_id: userId },
      orderBy: { created_at: 'desc' },
      select: { id: true },
      skip: keep,
    });

    if (old.length > 0) {
      await this.prisma.client.pipConversation.deleteMany({
        where: { id: { in: old.map(c => c.id) } },
      });
    }
  }
}
