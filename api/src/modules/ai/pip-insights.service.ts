import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface InsightPayload {
  type: string;
  title: string;
  message: string;
  severity: 'INFO' | 'WARNING' | 'URGENT';
  action_label?: string;
  action_type?: string;
  action_data?: Record<string, unknown>;
}

@Injectable()
export class PipInsightsService {
  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 6 * * *')
  async generateDailyInsights(): Promise<void> {
    const companies = await this.prisma.client.company.findMany({
      where: { subscription_status: { in: ['TRIAL', 'ACTIVE'] } },
      select: { id: true },
    });

    for (const company of companies) {
      try {
        await this.generateForCompany(company.id);
      } catch {
        // Never let one company failure block others
      }
    }
  }

  async generateForCompany(companyId: string): Promise<void> {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    // Delete expired insights
    await this.prisma.client.pipInsight.deleteMany({
      where: { company_id: companyId, expires_at: { lt: now } },
    });

    // Delete today's already-generated insights to avoid duplicates
    await this.prisma.client.pipInsight.deleteMany({
      where: { company_id: companyId, created_at: { gte: todayStart } },
    });

    const insights: InsightPayload[] = [];

    // 1. Overdue invoices
    const overdueInvoices = await this.prisma.client.invoice.findMany({
      where: {
        company_id: companyId,
        status: { in: ['SENT', 'PART_PAID', 'OVERDUE'] },
        due_date: { lt: todayStart },
      },
      select: { id: true, amount_due_pence: true, invoice_number: true },
    });

    if (overdueInvoices.length > 0) {
      const totalPence = overdueInvoices.reduce((s, inv) => s + inv.amount_due_pence, 0);
      const totalStr = `£${(totalPence / 100).toFixed(2)}`;
      const severity: 'URGENT' | 'WARNING' = totalPence >= 50000 ? 'URGENT' : 'WARNING';
      insights.push({
        type: 'overdue_invoices',
        title: `${overdueInvoices.length} overdue invoice${overdueInvoices.length > 1 ? 's' : ''}`,
        message: `You have ${overdueInvoices.length} unpaid invoice${overdueInvoices.length > 1 ? 's' : ''} totalling ${totalStr} that ${overdueInvoices.length > 1 ? 'are' : 'is'} past due. Chase these today to protect your cash flow.`,
        severity,
        action_label: 'View overdue invoices',
        action_type: 'navigate',
        action_data: { url: '/dashboard/invoices?filter=overdue' },
      });
    }

    // 2. Jobs scheduled today
    const jobsToday = await this.prisma.client.job.findMany({
      where: {
        company_id: companyId,
        scheduled_at: { gte: todayStart, lte: todayEnd },
        status: { in: ['QUOTED', 'SCHEDULED', 'IN_PROGRESS'] },
      },
      select: { id: true, title: true },
    });

    if (jobsToday.length > 0) {
      insights.push({
        type: 'jobs_today',
        title: `${jobsToday.length} job${jobsToday.length > 1 ? 's' : ''} scheduled today`,
        message: `You have ${jobsToday.length} job${jobsToday.length > 1 ? 's' : ''} on the schedule today. Tap to review them and ensure engineers are briefed.`,
        severity: 'INFO',
        action_label: 'View today\'s jobs',
        action_type: 'navigate',
        action_data: { url: '/dashboard/jobs' },
      });
    }

    // 3. CIS300 deadline approaching (19th of month, warn from 14th)
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: { cis_registered: true },
    });

    if (company?.cis_registered) {
      const day = now.getDate();
      if (day >= 14 && day <= 18) {
        const daysLeft = 19 - day;
        insights.push({
          type: 'cis_deadline',
          title: `CIS300 due in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
          message: `Your CIS300 monthly return is due on the 19th. You have ${daysLeft} day${daysLeft !== 1 ? 's' : ''} to submit it to HMRC. Check all subcontractor payments are recorded.`,
          severity: daysLeft <= 1 ? 'URGENT' : 'WARNING',
          action_label: 'Review CIS returns',
          action_type: 'navigate',
          action_data: { url: '/dashboard/cis' },
        });
      }
    }

    // 4. CP12 renewals due in next 30 days
    const thirtyDaysAhead = new Date(now);
    thirtyDaysAhead.setDate(thirtyDaysAhead.getDate() + 30);

    const cp12Due = await this.prisma.client.gasSafetyCertificate.findMany({
      where: {
        company_id: companyId,
        cert_type: 'CP12',
        next_due_date: { gte: todayStart, lte: thirtyDaysAhead },
        status: { not: 'DRAFT' },
      },
      select: { id: true, next_due_date: true },
    });

    if (cp12Due.length > 0) {
      insights.push({
        type: 'cp12_renewals',
        title: `${cp12Due.length} CP12 renewal${cp12Due.length > 1 ? 's' : ''} due soon`,
        message: `${cp12Due.length} CP12 certificate${cp12Due.length > 1 ? 's are' : ' is'} due for renewal within 30 days. Book these jobs now to avoid leaving customers unprotected.`,
        severity: 'WARNING',
        action_label: 'View gas certificates',
        action_type: 'navigate',
        action_data: { url: '/dashboard/gas-certificates' },
      });
    }

    // 5. Stale quotes (sent 7+ days ago, still SENT status)
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const staleQuotes = await this.prisma.client.quote.findMany({
      where: {
        company_id: companyId,
        status: 'SENT',
        last_sent_at: { lt: sevenDaysAgo },
      },
      select: { id: true, quote_number: true, total_pence: true },
    });

    if (staleQuotes.length > 0) {
      const totalPence = staleQuotes.reduce((s, q) => s + q.total_pence, 0);
      insights.push({
        type: 'stale_quotes',
        title: `${staleQuotes.length} quote${staleQuotes.length > 1 ? 's' : ''} need chasing`,
        message: `${staleQuotes.length} quote${staleQuotes.length > 1 ? 's worth £' + (totalPence / 100).toFixed(2) : ''} ${staleQuotes.length > 1 ? 'have' : 'has'} been waiting for a response for over 7 days. A quick follow-up call can double your win rate.`,
        severity: 'INFO',
        action_label: 'View quotes',
        action_type: 'navigate',
        action_data: { url: '/dashboard/quotes' },
      });
    }

    // 6. Todos/reminders due today or overdue
    const [dueTodos, overdueTodos] = await Promise.all([
      this.prisma.client.todo.findMany({
        where: {
          company_id: companyId,
          status: 'OPEN',
          due_date: { gte: todayStart, lt: todayEnd },
        },
        orderBy: { priority: 'desc' },
        take: 5,
        select: { title: true },
      }),
      this.prisma.client.todo.findMany({
        where: {
          company_id: companyId,
          status: 'OPEN',
          due_date: { lt: todayStart },
        },
        orderBy: { due_date: 'asc' },
        take: 3,
        select: { title: true },
      }),
    ]);

    if (dueTodos.length > 0 || overdueTodos.length > 0) {
      const allDue = [...overdueTodos, ...dueTodos];
      const titles = allDue.slice(0, 3).map(t => t.title).join(', ');
      const more = allDue.length > 3 ? ` + ${allDue.length - 3} more` : '';
      insights.push({
        type: 'REMINDERS_DUE',
        title: overdueTodos.length > 0
          ? `${overdueTodos.length} overdue + ${dueTodos.length} reminder${dueTodos.length !== 1 ? 's' : ''} due today`
          : `${dueTodos.length} reminder${dueTodos.length > 1 ? 's' : ''} due today`,
        message: titles + more,
        severity: overdueTodos.length > 0 ? 'WARNING' : 'INFO',
        action_label: 'View to-do list',
        action_type: 'navigate',
        action_data: { url: '/dashboard/todos' },
      });
    }

    if (insights.length === 0) return;

    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 1); // expire after 24 hours

    await this.prisma.client.pipInsight.createMany({
      data: insights.map(insight => ({
        company_id: companyId,
        type: insight.type,
        title: insight.title,
        message: insight.message,
        severity: insight.severity,
        action_label: insight.action_label ?? null,
        action_type: insight.action_type ?? null,
        action_data: insight.action_data
          ? (insight.action_data as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        expires_at: expiresAt,
      })),
    });
  }

  async getUnread(companyId: string) {
    return this.prisma.client.pipInsight.findMany({
      where: {
        company_id: companyId,
        is_dismissed: false,
        expires_at: { gt: new Date() },
      },
      orderBy: [
        { severity: 'desc' },
        { created_at: 'desc' },
      ],
    });
  }

  async getUnreadCount(companyId: string): Promise<number> {
    return this.prisma.client.pipInsight.count({
      where: {
        company_id: companyId,
        is_read: false,
        is_dismissed: false,
        expires_at: { gt: new Date() },
      },
    });
  }

  async markRead(companyId: string): Promise<void> {
    await this.prisma.client.pipInsight.updateMany({
      where: { company_id: companyId, is_read: false },
      data: { is_read: true },
    });
  }

  async dismiss(companyId: string, id: string): Promise<void> {
    await this.prisma.client.pipInsight.updateMany({
      where: { id, company_id: companyId },
      data: { is_dismissed: true },
    });
  }
}
