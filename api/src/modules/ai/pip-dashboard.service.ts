import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InvoiceStatus } from '@prisma/client';

// ─── Types ─────────────────────────────────────────────────────────────────

interface HealthScoreLosing {
  label: string;
  points: number;
  icon: string;
  fix_label: string;
  fix_type: string;
  fix_data: Record<string, unknown>;
}

interface HealthScoreEarning {
  label: string;
  points: number;
  icon: string;
}

export interface HealthScoreResult {
  score: number;
  label: string;
  colour: string;
  earning: HealthScoreEarning[];
  losing: HealthScoreLosing[];
  path_to_100: {
    potential_score: number;
    steps: Array<{ action: string; gain: number }>;
    note: string;
  };
  trend: { direction: 'up' | 'down' | 'stable'; change: number };
}

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class PipDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardData(companyId: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - (weekStart.getDay() === 0 ? 6 : weekStart.getDay() - 1));
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const sevenDaysAgo = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      overdueInvoices,
      unbilledJobs,
      todaysJobs,
      thisWeekJobCount,
      paidThisMonth,
      paidLastMonth,
      outstandingInvoices,
      pendingQuotes,
      acceptedQuotes,
      rejectedQuotes,
      timesheetsThisWeek,
      overdueTodos,
      dueTodayTodos,
      upcomingTodos,
      cisData,
      recentActivity,
      companyData,
      lastWeekSnapshot,
      todaySnapshot,
    ] = await Promise.all([
      // Overdue invoices
      this.prisma.client.invoice.findMany({
        where: {
          company_id: companyId,
          status: { in: [InvoiceStatus.SENT, InvoiceStatus.PART_PAID] },
          due_date: { lt: now },
        },
        include: { customer: { select: { name: true, phone: true } } },
        orderBy: { due_date: 'asc' },
        take: 10,
      }),

      // Unbilled completed jobs
      this.prisma.client.job.findMany({
        where: {
          company_id: companyId,
          status: 'COMPLETED',
          invoices: { none: { status: { not: InvoiceStatus.CANCELLED } } },
        },
        include: {
          customer: { select: { name: true } },
          quotes: { select: { total_pence: true }, orderBy: { created_at: 'desc' }, take: 1 },
        },
        take: 10,
      }),

      // Today's jobs
      this.prisma.client.job.findMany({
        where: {
          company_id: companyId,
          scheduled_at: { gte: todayStart, lt: todayEnd },
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        },
        include: {
          customer: { select: { name: true } },
          engineer: { select: { name: true, calendar_colour: true } },
        },
        orderBy: { scheduled_at: 'asc' },
      }),

      // This week job count
      this.prisma.client.job.count({
        where: { company_id: companyId, scheduled_at: { gte: weekStart, lt: weekEnd } },
      }),

      // Revenue this month
      this.prisma.client.invoice.aggregate({
        where: { company_id: companyId, status: InvoiceStatus.PAID, paid_date: { gte: monthStart } },
        _sum: { total_pence: true },
        _count: true,
      }),

      // Revenue last month
      this.prisma.client.invoice.aggregate({
        where: { company_id: companyId, status: InvoiceStatus.PAID, paid_date: { gte: prevMonthStart, lt: monthStart } },
        _sum: { total_pence: true },
      }),

      // Outstanding invoices
      this.prisma.client.invoice.aggregate({
        where: { company_id: companyId, status: { in: [InvoiceStatus.SENT, InvoiceStatus.PART_PAID] } },
        _sum: { amount_due_pence: true },
        _count: true,
      }),

      // Pending quotes
      this.prisma.client.quote.findMany({
        where: { company_id: companyId, status: 'SENT' },
        include: { customer: { select: { name: true } } },
        orderBy: { updated_at: 'asc' },
        take: 5,
      }),

      // Accepted quotes (90 days, win rate)
      this.prisma.client.quote.count({
        where: { company_id: companyId, status: 'ACCEPTED', created_at: { gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) } },
      }),

      // Rejected quotes (90 days, win rate)
      this.prisma.client.quote.count({
        where: { company_id: companyId, status: 'REJECTED', created_at: { gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) } },
      }),

      // Team hours this week
      this.prisma.client.timesheet.aggregate({
        where: { company_id: companyId, date: { gte: weekStart, lt: weekEnd } },
        _sum: { duration_minutes: true },
      }),

      // Overdue todos
      this.prisma.client.todo.findMany({
        where: { company_id: companyId, status: 'OPEN', due_date: { lt: todayStart } },
        orderBy: { due_date: 'asc' },
        select: { id: true, title: true, due_date: true, priority: true },
        take: 5,
      }),

      // Todos due today
      this.prisma.client.todo.findMany({
        where: { company_id: companyId, status: 'OPEN', due_date: { gte: todayStart, lt: todayEnd } },
        select: { id: true, title: true, priority: true },
        take: 5,
      }),

      // Upcoming todos (next 3, after today)
      this.prisma.client.todo.findMany({
        where: { company_id: companyId, status: 'OPEN', due_date: { gte: todayEnd } },
        orderBy: { due_date: 'asc' },
        select: { id: true, title: true, due_date: true, priority: true },
        take: 3,
      }),

      // CIS data
      this.getCisData(companyId, now),

      // Recent payments
      this.getRecentActivity(companyId),

      // Company name
      this.prisma.client.company.findUnique({
        where: { id: companyId },
        select: { name: true },
      }),

      // Health score snapshot from ~7 days ago (for trend)
      this.prisma.client.healthScoreSnapshot.findFirst({
        where: { company_id: companyId, date: { gte: sevenDaysAgo, lt: new Date(sevenDaysAgo.getTime() + 24 * 60 * 60 * 1000) } },
        orderBy: { date: 'desc' },
      }),

      // Today's snapshot (to avoid duplicate saves)
      this.prisma.client.healthScoreSnapshot.findFirst({
        where: { company_id: companyId, date: { gte: todayStart, lt: todayEnd } },
      }),
    ]);

    const revenueChange = this.calcRevenueChange(
      paidThisMonth._sum.total_pence ?? 0,
      paidLastMonth._sum.total_pence ?? 0,
    );

    const quoteWinRate =
      acceptedQuotes + rejectedQuotes > 0
        ? (acceptedQuotes / (acceptedQuotes + rejectedQuotes)) * 100
        : null;

    const healthScore = this.calculateHealthScore({
      overdueCount: overdueInvoices.length,
      unbilledCount: unbilledJobs.length,
      overdueTodosCount: overdueTodos.length,
      cisSubmitted: cisData?.submitted ?? true,
      cisDaysUntilDeadline: cisData?.daysUntilDeadline ?? 99,
      quoteWinRate,
      timesheetsLogged: (timesheetsThisWeek._sum.duration_minutes ?? 0) > 0,
      revenueChange,
      lastWeekScore: lastWeekSnapshot?.score ?? null,
    });

    // Lazy snapshot: save today's score if not already saved
    if (!todaySnapshot) {
      void this.prisma.client.healthScoreSnapshot.create({
        data: { company_id: companyId, score: healthScore.score },
      }).catch(() => {});
    }

    const actions = this.buildActions(
      overdueInvoices,
      unbilledJobs,
      cisData,
      overdueTodos,
      pendingQuotes,
    );

    return {
      greeting: this.getGreeting(companyData?.name),
      healthScore,
      actions,

      todaysJobs: todaysJobs.map(j => ({
        id: j.id,
        title: j.title,
        customer: j.customer?.name ?? null,
        engineer: j.engineer?.name ?? null,
        engineerColour: j.engineer?.calendar_colour ?? null,
        time: j.scheduled_at
          ? j.scheduled_at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
          : null,
        status: j.status,
      })),

      stats: {
        revenueThisMonth: (paidThisMonth._sum.total_pence ?? 0) / 100,
        revenueLastMonth: (paidLastMonth._sum.total_pence ?? 0) / 100,
        revenueChange,
        outstanding: (outstandingInvoices._sum.amount_due_pence ?? 0) / 100,
        outstandingCount: outstandingInvoices._count,
        overdue: overdueInvoices.reduce((s, i) => s + i.amount_due_pence, 0) / 100,
        overdueCount: overdueInvoices.length,
        quoteWinRate: quoteWinRate !== null ? Math.round(quoteWinRate) : null,
        jobsThisWeek: thisWeekJobCount,
        teamHours: Math.round((timesheetsThisWeek._sum.duration_minutes ?? 0) / 60),
        invoicesPaidThisMonth: paidThisMonth._count,
      },

      overdue: overdueInvoices.map(i => ({
        id: i.id,
        number: i.invoice_number,
        customer: i.customer?.name ?? null,
        phone: i.customer?.phone ?? null,
        amount: i.amount_due_pence / 100,
        days: i.due_date
          ? Math.floor((now.getTime() - i.due_date.getTime()) / (1000 * 60 * 60 * 24))
          : 0,
      })),

      unbilled: unbilledJobs.map(j => ({
        id: j.id,
        title: j.title,
        customer: j.customer?.name ?? null,
        estimatedValue: (j.quotes[0]?.total_pence ?? 0) / 100,
      })),

      pendingQuotes: pendingQuotes.map(q => ({
        id: q.id,
        number: q.quote_number,
        customer: q.customer?.name ?? null,
        amount: q.total_pence / 100,
        daysSent: Math.floor((now.getTime() - q.updated_at.getTime()) / (1000 * 60 * 60 * 24)),
      })),

      todos: {
        overdue: overdueTodos.map(t => ({
          id: t.id,
          title: t.title,
          priority: t.priority,
          daysOverdue: t.due_date
            ? Math.floor((now.getTime() - t.due_date.getTime()) / (1000 * 60 * 60 * 24))
            : 0,
        })),
        dueToday: dueTodayTodos.map(t => ({ id: t.id, title: t.title, priority: t.priority })),
        upcoming: upcomingTodos.map(t => ({
          id: t.id,
          title: t.title,
          priority: t.priority,
          due_date: t.due_date
            ? t.due_date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
            : null,
        })),
      },

      cis: cisData,
      recentActivity,
    };
  }

  // ── Public: used by AI tools for explain_health_score ─────────────────────

  async getHealthScoreForTool(companyId: string): Promise<HealthScoreResult> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - (weekStart.getDay() === 0 ? 6 : weekStart.getDay() - 1));
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const sevenDaysAgo = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      overdueCount,
      unbilledCount,
      overdueTodosCount,
      cisData,
      acceptedQuotes,
      rejectedQuotes,
      timesheets,
      paidThisMonth,
      paidLastMonth,
      lastWeekSnapshot,
    ] = await Promise.all([
      this.prisma.client.invoice.count({
        where: { company_id: companyId, status: { in: [InvoiceStatus.SENT, InvoiceStatus.PART_PAID] }, due_date: { lt: now } },
      }),
      this.prisma.client.job.count({
        where: { company_id: companyId, status: 'COMPLETED', invoices: { none: { status: { not: InvoiceStatus.CANCELLED } } } },
      }),
      this.prisma.client.todo.count({
        where: { company_id: companyId, status: 'OPEN', due_date: { lt: todayStart } },
      }),
      this.getCisData(companyId, now),
      this.prisma.client.quote.count({
        where: { company_id: companyId, status: 'ACCEPTED', created_at: { gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) } },
      }),
      this.prisma.client.quote.count({
        where: { company_id: companyId, status: 'REJECTED', created_at: { gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) } },
      }),
      this.prisma.client.timesheet.aggregate({
        where: { company_id: companyId, date: { gte: weekStart, lt: weekEnd } },
        _sum: { duration_minutes: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { company_id: companyId, status: InvoiceStatus.PAID, paid_date: { gte: monthStart } },
        _sum: { total_pence: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { company_id: companyId, status: InvoiceStatus.PAID, paid_date: { gte: prevMonthStart, lt: monthStart } },
        _sum: { total_pence: true },
      }),
      this.prisma.client.healthScoreSnapshot.findFirst({
        where: { company_id: companyId, date: { gte: sevenDaysAgo, lt: new Date(sevenDaysAgo.getTime() + 24 * 60 * 60 * 1000) } },
        orderBy: { date: 'desc' },
      }),
    ]);

    const quoteWinRate =
      acceptedQuotes + rejectedQuotes > 0
        ? (acceptedQuotes / (acceptedQuotes + rejectedQuotes)) * 100
        : null;

    const revenueChange = this.calcRevenueChange(
      paidThisMonth._sum.total_pence ?? 0,
      paidLastMonth._sum.total_pence ?? 0,
    );

    return this.calculateHealthScore({
      overdueCount,
      unbilledCount,
      overdueTodosCount,
      cisSubmitted: cisData?.submitted ?? true,
      cisDaysUntilDeadline: cisData?.daysUntilDeadline ?? 99,
      quoteWinRate,
      timesheetsLogged: (timesheets._sum.duration_minutes ?? 0) > 0,
      revenueChange,
      lastWeekScore: lastWeekSnapshot?.score ?? null,
    });
  }

  // ── HEALTH SCORE ──────────────────────────────────────────────────────────

  private calculateHealthScore(data: {
    overdueCount: number;
    unbilledCount: number;
    overdueTodosCount: number;
    cisSubmitted: boolean;
    cisDaysUntilDeadline: number;
    quoteWinRate: number | null;
    timesheetsLogged: boolean;
    revenueChange: number;
    lastWeekScore: number | null;
  }): HealthScoreResult {
    let score = 70;
    const earning: HealthScoreEarning[] = [];
    const losing: HealthScoreLosing[] = [];

    // Negatives
    if (data.overdueCount > 0) {
      const points = Math.min(data.overdueCount * 4, 20);
      score -= points;
      losing.push({
        label: `${data.overdueCount} overdue invoice${data.overdueCount > 1 ? 's' : ''}`,
        points,
        icon: '⚠️',
        fix_label: 'Send reminders',
        fix_type: 'pip_command',
        fix_data: { command: 'Send payment reminders for all overdue invoices' },
      });
    }

    if (data.unbilledCount > 0) {
      const points = Math.min(data.unbilledCount * 3, 15);
      score -= points;
      losing.push({
        label: `${data.unbilledCount} completed job${data.unbilledCount > 1 ? 's' : ''} not invoiced`,
        points,
        icon: '📋',
        fix_label: 'View jobs',
        fix_type: 'navigate',
        fix_data: { url: '/dashboard/jobs?status=COMPLETED' },
      });
    }

    if (!data.cisSubmitted && data.cisDaysUntilDeadline <= 14) {
      const points = data.cisDaysUntilDeadline <= 3 ? 10 : 5;
      score -= points;
      losing.push({
        label: `CIS return not submitted (${data.cisDaysUntilDeadline} days left)`,
        points,
        icon: '⏰',
        fix_label: 'Go to CIS',
        fix_type: 'navigate',
        fix_data: { url: '/dashboard/cis' },
      });
    }

    if (data.overdueTodosCount > 0) {
      const points = Math.min(data.overdueTodosCount * 2, 8);
      score -= points;
      losing.push({
        label: `${data.overdueTodosCount} overdue reminder${data.overdueTodosCount > 1 ? 's' : ''}`,
        points,
        icon: '📌',
        fix_label: 'View todos',
        fix_type: 'navigate',
        fix_data: { url: '/dashboard/todos' },
      });
    }

    if (data.revenueChange < -10) {
      const points = Math.min(Math.round(Math.abs(data.revenueChange) / 5), 6);
      score -= points;
      losing.push({
        label: `Revenue down ${Math.round(Math.abs(data.revenueChange))}% vs last month`,
        points,
        icon: '📉',
        fix_label: 'Cash flow forecast',
        fix_type: 'pip_command',
        fix_data: { command: 'Give me a cash flow forecast' },
      });
    }

    // Positives
    if (data.quoteWinRate !== null && data.quoteWinRate >= 60) {
      const points = Math.min(Math.round((data.quoteWinRate - 50) / 5), 8);
      score += points;
      earning.push({
        label: `${Math.round(data.quoteWinRate)}% quote win rate`,
        points,
        icon: '📊',
      });
    }

    if (data.timesheetsLogged) {
      score += 3;
      earning.push({ label: 'Team timesheets logged this week', points: 3, icon: '👷' });
    }

    if (data.revenueChange > 5) {
      const points = Math.min(Math.round(data.revenueChange / 3), 8);
      score += points;
      earning.push({
        label: `Revenue up ${Math.round(data.revenueChange)}% vs last month`,
        points,
        icon: '📈',
      });
    }

    if (data.overdueCount === 0 && data.unbilledCount === 0) {
      score += 5;
      earning.push({ label: 'All invoiced, nothing overdue', points: 5, icon: '✅' });
    }

    score = Math.max(0, Math.min(100, score));

    const label =
      score >= 81 ? 'Excellent' :
      score >= 61 ? 'Looking good' :
      score >= 41 ? 'Getting there' :
      'Needs attention';

    const colour =
      score >= 81 ? '#22c55e' :
      score >= 61 ? '#3b82f6' :
      score >= 41 ? '#f59e0b' :
      '#ef4444';

    // Path to 100
    const losingPoints = losing.reduce((s, l) => s + l.points, 0);
    const potentialScore = Math.min(100, score + losingPoints);
    const steps = losing.map(l => ({ action: l.label, gain: l.points }));
    const remaining = 100 - potentialScore;
    const note =
      potentialScore >= 100
        ? 'Fix everything above and you hit 100!'
        : remaining <= 5
          ? `Fix the above to reach ${potentialScore}. The last ${remaining} point${remaining > 1 ? 's' : ''} come from sustained win rate and revenue growth.`
          : `Fix the above to reach ${potentialScore}. Further gains come from a higher quote win rate, revenue growth, and consistent timesheets.`;

    // Trend
    let trend: HealthScoreResult['trend'] = { direction: 'stable', change: 0 };
    if (data.lastWeekScore !== null) {
      const change = score - data.lastWeekScore;
      if (change >= 2) trend = { direction: 'up', change };
      else if (change <= -2) trend = { direction: 'down', change: Math.abs(change) };
    }

    return {
      score,
      label,
      colour,
      earning,
      losing,
      path_to_100: { potential_score: potentialScore, steps, note },
      trend,
    };
  }

  // ── PRIORITISED ACTIONS ───────────────────────────────────────────────────

  private buildActions(
    overdueInvoices: Array<{ customer: { name: string } | null; amount_due_pence: number }>,
    unbilledJobs: Array<{ quotes: Array<{ total_pence: number }> }>,
    cisData: { submitted: boolean; daysUntilDeadline: number } | null,
    overdueTodos: Array<{ title: string }>,
    pendingQuotes: Array<{ customer: { name: string } | null; updated_at: Date }>,
  ) {
    const actions: Array<{
      priority: number;
      icon: string;
      category: string;
      title: string;
      detail: string;
      action_label: string;
      action_type: string;
      action_data: Record<string, unknown>;
      severity: 'urgent' | 'warning' | 'info';
    }> = [];

    if (overdueInvoices.length > 0) {
      const total = overdueInvoices.reduce((s, i) => s + i.amount_due_pence, 0);
      const oldest = overdueInvoices[0];
      actions.push({
        priority: 100,
        icon: '⚠️',
        category: 'Revenue at risk',
        title: `${overdueInvoices.length} overdue invoice${overdueInvoices.length > 1 ? 's' : ''} — £${Math.round(total / 100).toLocaleString()}`,
        detail: oldest.customer?.name ? `Oldest: ${oldest.customer.name}` : '',
        action_label: 'Send reminders',
        action_type: 'pip_command',
        action_data: { command: 'Send payment reminders for all overdue invoices' },
        severity: 'urgent',
      });
    }

    if (unbilledJobs.length > 0) {
      const total = unbilledJobs.reduce((s, j) => s + (j.quotes[0]?.total_pence ?? 0), 0);
      actions.push({
        priority: 80,
        icon: '📋',
        category: 'Unbilled work',
        title: `${unbilledJobs.length} completed job${unbilledJobs.length > 1 ? 's' : ''} not invoiced`,
        detail: total > 0 ? `~£${Math.round(total / 100).toLocaleString()} to bill` : '',
        action_label: 'View jobs',
        action_type: 'navigate',
        action_data: { url: '/dashboard/jobs?status=COMPLETED' },
        severity: 'warning',
      });
    }

    if (cisData && !cisData.submitted && cisData.daysUntilDeadline <= 14) {
      actions.push({
        priority: cisData.daysUntilDeadline <= 3 ? 95 : 70,
        icon: '⏰',
        category: 'Compliance',
        title: `CIS return due ${cisData.daysUntilDeadline === 0 ? 'TODAY' : `in ${cisData.daysUntilDeadline} days`}`,
        detail: 'Monthly CIS300 not yet submitted',
        action_label: 'Go to CIS',
        action_type: 'navigate',
        action_data: { url: '/dashboard/cis' },
        severity: cisData.daysUntilDeadline <= 3 ? 'urgent' : 'warning',
      });
    }

    if (pendingQuotes.length > 0) {
      const oldest = pendingQuotes[0];
      const days = Math.floor((Date.now() - oldest.updated_at.getTime()) / (1000 * 60 * 60 * 24));
      if (days >= 7) {
        actions.push({
          priority: 50,
          icon: '📝',
          category: 'Pipeline',
          title: `${pendingQuotes.length} quote${pendingQuotes.length > 1 ? 's' : ''} awaiting response`,
          detail: oldest.customer?.name ? `Oldest: ${oldest.customer.name} (${days} days)` : `${days} days waiting`,
          action_label: 'Follow up',
          action_type: 'pip_command',
          action_data: { command: 'Show my quote pipeline' },
          severity: 'info',
        });
      }
    }

    if (overdueTodos.length > 0) {
      actions.push({
        priority: 40,
        icon: '📌',
        category: 'Follow-ups',
        title: `${overdueTodos.length} overdue reminder${overdueTodos.length > 1 ? 's' : ''}`,
        detail: overdueTodos[0].title,
        action_label: 'View todos',
        action_type: 'navigate',
        action_data: { url: '/dashboard/todos' },
        severity: 'info',
      });
    }

    return actions.sort((a, b) => b.priority - a.priority);
  }

  // ── HELPERS ───────────────────────────────────────────────────────────────

  private getGreeting(companyName?: string | null): string {
    const hour = new Date().getHours();
    const time = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    return companyName ? `${time}, ${companyName}` : time;
  }

  private calcRevenueChange(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  }

  private async getCisData(companyId: string, now: Date) {
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const subPayments = await this.prisma.client.subcontractorPayment.count({
      where: { company_id: companyId, tax_month: currentMonth },
    });

    if (subPayments === 0) return null;

    const returnStatus = await this.prisma.client.cisMonthlyReturn.findUnique({
      where: { company_id_tax_month: { company_id: companyId, tax_month: currentMonth } },
    });

    const monthNum = now.getMonth() + 1;
    const yearNum = now.getFullYear();
    const deadlineMonth = monthNum === 12 ? 1 : monthNum + 1;
    const deadlineYear = monthNum === 12 ? yearNum + 1 : yearNum;
    const deadline = new Date(deadlineYear, deadlineMonth - 1, 19);
    const daysUntilDeadline = Math.ceil(
      (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    return {
      submitted: !!returnStatus,
      daysUntilDeadline,
      deadline: deadline.toLocaleDateString('en-GB'),
      paymentCount: subPayments,
    };
  }

  private async getRecentActivity(companyId: string) {
    const recent = await this.prisma.client.invoice.findMany({
      where: { company_id: companyId, status: InvoiceStatus.PAID },
      orderBy: { paid_date: 'desc' },
      take: 4,
      include: { customer: { select: { name: true } } },
    });

    return recent.map(i => ({
      type: 'payment_received',
      description: `${i.customer?.name ?? 'Customer'} paid ${i.invoice_number}`,
      amount: i.total_pence / 100,
      date: (i.paid_date ?? i.updated_at).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
      }),
    }));
  }
}
